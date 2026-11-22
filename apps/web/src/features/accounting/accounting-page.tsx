import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatDate, formatMoney, formatNumber, JOURNAL_SOURCE_TH, JOURNAL_STATUS_TH, toISODate, toOptions } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useListParams } from '@/lib/hooks';
import { AccountsTab } from './accounts-tab';
import { ApTab } from './ap-tab';
import { BankTab } from './bank-tab';
import { JournalDialog } from './journal-dialog';
import { INV } from './lookups';
import { PeriodsTab } from './periods-tab';
import { ReportsTab } from './reports-tab';
import { TaxTab } from './tax-tab';
import { JournalStatusBadge } from './status';
import type { AutoPostResult, JournalRow, PendingItem, PendingResult } from './types';

const PAGE = 20;
type LP = ReturnType<typeof useListParams>;
const jc = createColumnHelper<JournalRow>();
const pc = createColumnHelper<PendingItem>();

export function AccountingPage() {
  const { can } = useAuth();
  const lp = useListParams();
  const tab = lp.get('tab') || 'journals';
  return (
    <>
      <PageHeader title="บัญชี" subtitle="สมุดรายวัน ผังบัญชี งวดบัญชี และรายงานการเงิน" />
      <Tabs
        value={tab}
        onValueChange={(t) => lp.set({ tab: t, page: undefined, q: undefined, status: undefined, sub: undefined })}
        tabs={[
          { value: 'journals', label: 'สมุดรายวัน', content: <JournalsTab lp={lp} canEdit={can('finance.edit')} /> },
          { value: 'autopost', label: 'ลงบัญชีอัตโนมัติ', content: <AutoPostTab canApprove={can('finance.approve')} /> },
          { value: 'ap', label: 'เจ้าหนี้', content: <ApTab lp={lp} canEdit={can('finance.edit')} canApprove={can('finance.approve')} /> },
          { value: 'bank', label: 'ธนาคาร', content: <BankTab lp={lp} canEdit={can('finance.edit')} canApprove={can('finance.approve')} /> },
          { value: 'tax', label: 'ภาษี', content: <TaxTab lp={lp} /> },
          { value: 'accounts', label: 'ผังบัญชี', content: <AccountsTab canApprove={can('finance.approve')} /> },
          { value: 'periods', label: 'งวดบัญชี', content: <PeriodsTab lp={lp} canApprove={can('finance.approve')} /> },
          { value: 'reports', label: 'รายงาน', content: <ReportsTab lp={lp} /> },
        ]}
      />
    </>
  );
}

function JournalsTab({ lp, canEdit }: { lp: LP; canEdit: boolean }) {
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const params = {
    from: lp.get('from') || undefined, to: lp.get('to') || undefined, status: lp.get('status') || undefined, source: lp.get('source') || undefined,
    q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE,
  };
  const list = useQuery({
    queryKey: ['accounting', 'journals', params],
    queryFn: () => api.get<{ items: JournalRow[]; total: number }>('/accounting/journals', params),
    placeholderData: keepPreviousData,
  });
  const cols = [
    jc.accessor('entryNo', { header: 'เลขที่', cell: (i) => <span className="font-medium text-accent">{i.getValue()}</span> }),
    jc.accessor('entryDate', { header: 'วันที่', cell: (i) => formatDate(i.getValue()) }),
    jc.accessor('memo', { header: 'คำอธิบาย', meta: { className: 'max-w-xs truncate' } }),
    jc.display({ id: 'src', header: 'ที่มา', cell: ({ row: { original: r } }) => (r.sourceType ? `${JOURNAL_SOURCE_TH[r.sourceType]}${r.sourceRef ? ` ${r.sourceRef}` : ''}` : 'บันทึกเอง') }),
    jc.accessor('status', { header: 'สถานะ', cell: (i) => <JournalStatusBadge s={i.getValue()} /> }),
    jc.accessor('totalDebit', { header: 'เดบิต', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    jc.accessor('totalCredit', { header: 'เครดิต', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่/คำอธิบาย..." />
        <Input type="date" className="w-auto" aria-label="ตั้งแต่วันที่" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} />
        <span className="text-muted">–</span>
        <Input type="date" className="w-auto" aria-label="ถึงวันที่" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} />
        <Select options={toOptions(JOURNAL_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
        <Select options={[{ value: 'MANUAL', label: 'บันทึกเอง' }, ...toOptions(JOURNAL_SOURCE_TH)]} placeholder="ทุกที่มา" value={lp.get('source')} onChange={(e) => lp.set({ source: e.target.value })} />
        {canEdit && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> บันทึกรายการบัญชี</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/accounting/journals/${r.id}`)} />
      {creating && <JournalDialog onClose={() => setCreating(false)} onSaved={(id) => id && nav(`/accounting/journals/${id}`)} />}
    </div>
  );
}

function AutoPostTab({ canApprove }: { canApprove: boolean }) {
  const [to, setTo] = useState(toISODate());
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<AutoPostResult | null>(null);
  const q = useQuery({ queryKey: ['accounting', 'pending', to], queryFn: () => api.get<PendingResult>('/accounting/auto-post/pending', { to }), placeholderData: keepPreviousData });
  const run = useAction(() => api.post<AutoPostResult>('/accounting/auto-post', { to }), {
    success: 'ลงบัญชีอัตโนมัติแล้ว', invalidate: INV, onSuccess: (r) => { setResult(r); setConfirm(false); },
  });
  const cols = [
    pc.accessor('date', { header: 'วันที่', cell: (i) => formatDate(i.getValue()) }),
    pc.accessor('type', { header: 'ที่มา', cell: (i) => JOURNAL_SOURCE_TH[i.getValue()] }),
    pc.accessor('ref', { header: 'เอกสาร' }),
    pc.accessor('memo', { header: 'คำอธิบาย', meta: { className: 'max-w-xs truncate' } }),
    pc.accessor('amount', { header: 'จำนวนเงิน (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    pc.accessor('reversal', { header: '', cell: (i) => (i.getValue() ? <Badge tone="warn">กลับรายการ</Badge> : null) }),
  ];
  const d = q.data;
  return (
    <div className="space-y-3">
      <div className="rounded border border-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
        เอกสารที่ผ่านแล้วจะไม่ถูกลงซ้ำ · ยกเลิกเอกสารแล้วระบบกลับรายการให้
      </div>
      <FilterBar>
        <label className="text-sm text-muted" htmlFor="ap-to">ถึงวันที่</label>
        <Input id="ap-to" type="date" className="w-auto" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        {canApprove && <Button className="ml-auto" disabled={!d?.total} onClick={() => setConfirm(true)}>ลงบัญชีทั้งหมด</Button>}
      </FilterBar>
      <Panel title={`รอลงบัญชี ${formatNumber(d?.total ?? 0)} รายการ`}>
        {d && Object.keys(d.byType).length ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(d.byType).map(([k, n]) => <Badge key={k} tone="info">{JOURNAL_SOURCE_TH[k as keyof typeof JOURNAL_SOURCE_TH] ?? k}: {formatNumber(n)}</Badge>)}
          </div>
        ) : <p className="text-sm text-muted">ไม่มีเอกสารรอลงบัญชี</p>}
      </Panel>
      <DataTable columns={cols} data={d?.items} loading={q.isFetching} error={q.error} />
      {result && (
        <Panel title={`ผลการลงบัญชี: สำเร็จ ${formatNumber(result.posted)} รายการ`}>
          {result.exceptions.length ? (
            <div className="space-y-2">
              <p className="text-sm text-warn">รายการที่ลงบัญชีไม่ได้ {result.exceptions.length} รายการ</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-3 py-2">เอกสาร</th><th className="px-2">วันที่</th><th className="px-2">เหตุผล</th></tr></thead>
                  <tbody>
                    {result.exceptions.map((x, i) => (
                      <tr key={`${x.id}-${i}`} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-3 py-2">{x.ref}</td><td className="whitespace-nowrap px-2 py-2">{formatDate(x.date)}</td><td className="px-2 py-2 text-bad">{x.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : <p className="text-sm text-ok">ไม่มีรายการผิดพลาด</p>}
        </Panel>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="ลงบัญชีอัตโนมัติ" loading={run.isPending} confirmText="ลงบัญชีทั้งหมด"
        message={`ลงบัญชีเอกสารที่รอทั้งหมด ${formatNumber(d?.total ?? 0)} รายการ ถึงวันที่ ${formatDate(to)}`} onConfirm={() => run.mutate(undefined)} />
    </div>
  );
}
