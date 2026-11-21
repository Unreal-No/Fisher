import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ADVANCE_KIND_TH, ADVANCE_STATUS_TH, COMP_BASIS_TH, EMPLOYEE_POSITION_TH, formatDate, formatMoney, PAY_TYPE_TH, PAYROLL_STATUS_TH, reasonSchema, toOptions,
} from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { Stat } from '@/components/ui/panel';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { AdvanceDialog, INV, PeriodDialog, RATE_LABEL, RuleDialog } from './payroll-dialogs';
import { AdvanceStatusBadge, PayrollStatusBadge } from './status';
import type { Advance, AdvancePage, CompRule, PeriodRow } from './types';

const PAGE = 20;
type LP = ReturnType<typeof useListParams>;

const pc = createColumnHelper<PeriodRow>();
const rc = createColumnHelper<CompRule>();
const ac = createColumnHelper<Advance>();

export function PayrollPage() {
  const { can } = useAuth();
  const lp = useListParams();
  const tab = lp.get('tab') || 'periods';
  return (
    <>
      <PageHeader title="เงินเดือน/ค่าตอบแทน" subtitle="งวดเงินเดือนลูกเรือ กฎค่าตอบแทน และเงินเบิก/เงินกู้" />
      <Tabs
        value={tab}
        onValueChange={(t) => lp.set({ tab: t })}
        tabs={[
          { value: 'periods', label: 'งวดเงินเดือน', content: <PeriodsTab lp={lp} canEdit={can('payroll.edit')} /> },
          { value: 'rules', label: 'กฎค่าตอบแทน', content: <RulesTab canEdit={can('payroll.edit')} /> },
          { value: 'advances', label: 'เงินเบิก/เงินกู้', content: <AdvancesTab lp={lp} canEdit={can('payroll.edit')} canApprove={can('payroll.approve')} /> },
        ]}
      />
    </>
  );
}

function PeriodsTab({ lp, canEdit }: { lp: LP; canEdit: boolean }) {
  const nav = useNavigate();
  const vessels = useVessels();
  const [creating, setCreating] = useState(false);
  const params = { status: lp.get('status') || undefined, vesselId: lp.get('vesselId') || undefined, q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE };
  const list = useQuery({
    queryKey: ['payroll', 'periods', params],
    queryFn: () => api.get<{ items: PeriodRow[]; total: number }>('/payroll/periods', params),
    placeholderData: keepPreviousData,
  });
  const cols = [
    pc.accessor('code', { header: 'เลขที่', cell: (i) => <span className="font-medium text-accent">{i.getValue()}</span> }),
    pc.accessor('name', { header: 'ชื่องวด' }),
    pc.display({ id: 'range', header: 'ช่วงเวลา', cell: ({ row: { original: p } }) => `${formatDate(p.startDate)} – ${formatDate(p.endDate)}` }),
    pc.display({ id: 'vessel', header: 'เรือ', cell: ({ row }) => (row.original.vessel ? `${row.original.vessel.code} · ${row.original.vessel.name}` : 'ทุกลำ') }),
    pc.accessor('status', { header: 'สถานะ', cell: (i) => <PayrollStatusBadge s={i.getValue()} /> }),
    pc.display({ id: 'cnt', header: 'จำนวนคน', meta: { align: 'right' }, cell: ({ row }) => row.original._count.records }),
    pc.accessor('totalGross', { header: 'รายได้รวม (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    pc.accessor('totalNet', { header: 'สุทธิ (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    pc.accessor('payDate', { header: 'วันที่จ่าย', cell: (i) => formatDate(i.getValue()) }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่/ชื่องวด..." />
        <Select options={vesselOptions(vessels.data)} placeholder="ทุกลำ" value={lp.get('vesselId')} onChange={(e) => lp.set({ vesselId: e.target.value })} />
        <Select options={toOptions(PAYROLL_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
        {canEdit && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> สร้างงวดเงินเดือน</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/payroll/periods/${r.id}`)} />
      {creating && <PeriodDialog onClose={() => setCreating(false)} onSaved={(id) => nav(`/payroll/periods/${id}`)} />}
    </div>
  );
}

function RulesTab({ canEdit }: { canEdit: boolean }) {
  const [dlg, setDlg] = useState<{ rule: CompRule | null } | null>(null);
  const q = useQuery({ queryKey: ['payroll', 'rules'], queryFn: () => api.get<CompRule[]>('/payroll/rules') });
  const cols = [
    rc.accessor('name', { header: 'ชื่อกฎ', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    rc.accessor('method', { header: 'วิธีคำนวณ', cell: (i) => PAY_TYPE_TH[i.getValue()] }),
    rc.display({ id: 'rate', header: 'อัตรา', meta: { align: 'right' }, cell: ({ row: { original: r } }) => `${formatMoney(r.rate)} ${RATE_LABEL[r.method]}` }),
    rc.accessor('basis', { header: 'ฐานคำนวณ', cell: (i) => (i.getValue() ? COMP_BASIS_TH[i.getValue()!] : '-') }),
    rc.display({
      id: 'scope', header: 'ขอบเขต',
      cell: ({ row: { original: r } }) =>
        [r.employee ? `${r.employee.code} ${r.employee.firstName}` : null, r.vessel?.name ?? null, r.position ? EMPLOYEE_POSITION_TH[r.position] : null].filter(Boolean).join(' · ') || 'ทั่วไป',
    }),
    rc.display({ id: 'eff', header: 'มีผล', cell: ({ row: { original: r } }) => `${formatDate(r.effectiveFrom)}${r.effectiveTo ? ` – ${formatDate(r.effectiveTo)}` : ' เป็นต้นไป'}` }),
    rc.accessor('isActive', { header: 'สถานะ', cell: (i) => <Badge tone={i.getValue() ? 'ok' : 'neutral'}>{i.getValue() ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge> }),
    rc.display({
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => canEdit && <Button size="icon" variant="ghost" aria-label="แก้ไขกฎ" onClick={() => setDlg({ rule: r })}><Pencil /></Button>,
    }),
  ];
  return (
    <div className="space-y-3">
      <div className="rounded border border-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
        ลำดับความสำคัญของกฎ: พนักงาน &gt; เรือ &gt; ตำแหน่ง &gt; ทั่วไป · หากไม่มีกฎที่ตรงกัน ระบบจะใช้ประเภทค่าตอบแทนและอัตราพื้นฐานของพนักงานเอง (รายเดือน/รายวัน/รายเที่ยว)
      </div>
      {canEdit && <div className="flex justify-end"><Button onClick={() => setDlg({ rule: null })}><Plus /> เพิ่มกฎ</Button></div>}
      <DataTable columns={cols} data={q.data} loading={q.isFetching} error={q.error} />
      {dlg && <RuleDialog rule={dlg.rule} onClose={() => setDlg(null)} />}
    </div>
  );
}

function AdvancesTab({ lp, canEdit, canApprove }: { lp: LP; canEdit: boolean; canApprove: boolean }) {
  const [creating, setCreating] = useState(false);
  const [cancel, setCancel] = useState<Advance | null>(null);
  const params = { status: lp.get('astatus') || undefined, q: lp.get('aq') || undefined, page: lp.page, pageSize: PAGE };
  const list = useQuery({
    queryKey: ['payroll', 'advances', params],
    queryFn: () => api.get<AdvancePage>('/payroll/advances', params),
    placeholderData: keepPreviousData,
  });
  const doCancel = useAction((v: { id: string; reason: string }) => api.post(`/payroll/advances/${v.id}/cancel`, reasonSchema.parse({ reason: v.reason })), {
    success: 'ยกเลิกรายการแล้ว', invalidate: INV, onSuccess: () => setCancel(null),
  });
  const cols = [
    ac.accessor('advanceNo', { header: 'เลขที่', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    ac.display({ id: 'emp', header: 'พนักงาน', cell: ({ row: { original: a } }) => `${a.employee.code} · ${a.employee.firstName} ${a.employee.lastName}` }),
    ac.accessor('kind', { header: 'ประเภท', cell: (i) => ADVANCE_KIND_TH[i.getValue()] }),
    ac.accessor('advanceDate', { header: 'วันที่', cell: (i) => formatDate(i.getValue()) }),
    ac.accessor('amount', { header: 'จำนวน (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    ac.accessor('installment', { header: 'ผ่อน/งวด', meta: { align: 'right' }, cell: (i) => (i.getValue() ? formatMoney(i.getValue()) : '-') }),
    ac.accessor('recoveredAmount', { header: 'หักแล้ว', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    ac.accessor('outstanding', { header: 'คงค้าง', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    ac.accessor('status', { header: 'สถานะ', cell: (i) => <AdvanceStatusBadge s={i.getValue()} /> }),
    ac.display({
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row: { original: a } }) => canApprove && a.status === 'OPEN' && Number(a.recoveredAmount) === 0
        && <Button size="icon" variant="ghost" aria-label="ยกเลิกรายการ" title="ยกเลิกรายการ" onClick={() => setCancel(a)}><XCircle /></Button>,
    }),
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ยอดค้างหักรวม (ตามตัวกรอง)" value={list.data ? formatMoney(list.data.outstandingTotal) : '-'} tone={list.data && Number(list.data.outstandingTotal) > 0 ? 'warn' : undefined} sub="บาท" />
      </div>
      <FilterBar>
        <SearchInput value={lp.get('aq')} onChange={(v) => lp.set({ aq: v })} placeholder="ค้นหาเลขที่/พนักงาน..." />
        <Select options={toOptions(ADVANCE_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('astatus')} onChange={(e) => lp.set({ astatus: e.target.value })} />
        {canEdit && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> บันทึกเงินเบิก/เงินกู้</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} />
      {creating && <AdvanceDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)} title="ยกเลิกเงินเบิก/เงินกู้" danger requireReason loading={doCancel.isPending}
        message={`ยกเลิก ${cancel?.advanceNo ?? ''} (ยกเลิกได้เฉพาะรายการที่ยังไม่เคยถูกหักคืน)`} onConfirm={(r) => cancel && doCancel.mutate({ id: cancel.id, reason: r })} />
    </div>
  );
}
