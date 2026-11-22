import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatDate, formatDateTime, formatMoney, PAYMENT_METHOD_TH, toISODate, toOptions, VENDOR_BILL_STATUS_TH, VENDOR_PAYMENT_STATUS_TH } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/export';
import { useAction, type useListParams } from '@/lib/hooks';
import { INV } from './lookups';
import { BillStatusBadge, VPayStatusBadge } from './status';
import type { ApAging, BillRow, PaymentRow } from './types';
import { VendorBillDialog } from './vendor-bill-dialog';
import { VendorPaymentDialog } from './vendor-payment-dialog';

type LP = ReturnType<typeof useListParams>;
const PAGE = 20;
const bc = createColumnHelper<BillRow>();
const pc = createColumnHelper<PaymentRow>();
const SUBS = [{ value: 'bills', label: 'ใบแจ้งหนี้ผู้ขาย' }, { value: 'payments', label: 'การจ่ายชำระ' }, { value: 'aging', label: 'อายุเจ้าหนี้' }];

export function ApTab({ lp, canEdit, canApprove }: { lp: LP; canEdit: boolean; canApprove: boolean }) {
  const sub = lp.get('sub') || 'bills';
  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {SUBS.map((s) => (
          <Button key={s.value} size="sm" variant={sub === s.value ? 'primary' : 'outline'} onClick={() => lp.set({ sub: s.value, page: undefined, q: undefined, status: undefined })}>{s.label}</Button>
        ))}
      </div>
      {sub === 'bills' && <BillsView lp={lp} canEdit={canEdit} />}
      {sub === 'payments' && <PaymentsView lp={lp} canApprove={canApprove} />}
      {sub === 'aging' && <AgingView />}
    </div>
  );
}

function BillsView({ lp, canEdit }: { lp: LP; canEdit: boolean }) {
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const params = { status: lp.get('status') || undefined, q: lp.get('q') || undefined, openOnly: lp.get('open') === '1' ? 'true' : undefined, page: lp.page, pageSize: PAGE };
  const list = useQuery({ queryKey: ['accounting', 'ap-bills', params], queryFn: () => api.get<{ items: BillRow[]; total: number }>('/accounting/ap/bills', params), placeholderData: keepPreviousData });
  const cols = [
    bc.accessor('billNo', { header: 'เลขที่', cell: (i) => <span className="font-medium text-accent">{i.getValue()}</span> }),
    bc.accessor('supplierInvoiceNo', { header: 'เลขที่ใบแจ้งหนี้ผู้ขาย' }),
    bc.display({ id: 'sup', header: 'ผู้ขาย', cell: ({ row: { original: r } }) => r.supplier.name }),
    bc.accessor('billDate', { header: 'วันที่', cell: (i) => formatDate(i.getValue()) }),
    bc.accessor('dueDate', { header: 'ครบกำหนด', cell: (i) => (i.getValue() ? formatDate(i.getValue()) : '-') }),
    bc.accessor('status', { header: 'สถานะ', cell: (i) => <BillStatusBadge s={i.getValue()} /> }),
    bc.accessor('total', { header: 'รวม (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    bc.accessor('outstanding', { header: 'ค้างชำระ', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
  ];
  return (
    <div>
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่/ผู้ขาย..." />
        <Select options={toOptions(VENDOR_BILL_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={lp.get('open') === '1'} onChange={(e) => lp.set({ open: e.target.checked ? '1' : undefined })} /> เฉพาะที่ค้างชำระ</label>
        {canEdit && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> บันทึกใบแจ้งหนี้</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/accounting/bills/${r.id}`)} />
      {creating && <VendorBillDialog onClose={() => setCreating(false)} onSaved={(id) => id && nav(`/accounting/bills/${id}`)} />}
    </div>
  );
}

function PaymentsView({ lp, canApprove }: { lp: LP; canApprove: boolean }) {
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const params = { status: lp.get('status') || undefined, q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE };
  const list = useQuery({ queryKey: ['accounting', 'ap-payments', params], queryFn: () => api.get<{ items: PaymentRow[]; total: number }>('/accounting/ap/payments', params), placeholderData: keepPreviousData });
  const voidIt = useAction((v: { id: string; reason: string }) => api.post(`/accounting/ap/payments/${v.id}/void`, { reason: v.reason }), {
    success: 'ยกเลิกการจ่ายชำระแล้ว', invalidate: INV, onSuccess: () => setVoiding(null),
  });
  const cols = [
    pc.accessor('paymentNo', { header: 'เลขที่', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    pc.accessor('paidAt', { header: 'วันที่จ่าย', cell: (i) => formatDateTime(i.getValue()) }),
    pc.display({ id: 'sup', header: 'ผู้ขาย', cell: ({ row: { original: r } }) => r.supplier.name }),
    pc.display({ id: 'bills', header: 'ใบแจ้งหนี้', cell: ({ row: { original: r } }) => r.allocations.map((a) => a.bill.billNo).join(', ') }),
    pc.accessor('method', { header: 'วิธีจ่าย', cell: (i) => PAYMENT_METHOD_TH[i.getValue()] }),
    pc.accessor('grossAmount', { header: 'ยอดรวม', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    pc.accessor('whtAmount', { header: 'หัก ณ ที่จ่าย', meta: { align: 'right' }, cell: (i) => (Number(i.getValue()) ? formatMoney(i.getValue()) : '-') }),
    pc.accessor('netAmount', { header: 'จ่ายสุทธิ', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    pc.accessor('status', { header: 'สถานะ', cell: (i) => <VPayStatusBadge s={i.getValue()} /> }),
    pc.display({
      id: 'act', header: '',
      cell: ({ row: { original: r } }) => (canApprove && r.status === 'POSTED' ? <Button size="sm" variant="danger-outline" onClick={() => setVoiding(r)}>ยกเลิก</Button> : null),
    }),
  ];
  return (
    <div>
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่/ผู้ขาย/อ้างอิง..." />
        <Select options={toOptions(VENDOR_PAYMENT_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
        {canApprove && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> จ่ายชำระ</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} />
      {creating && <VendorPaymentDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)} title="ยกเลิกการจ่ายชำระ" danger requireReason loading={voidIt.isPending}
        message={`ยกเลิก ${voiding?.paymentNo ?? ''} (ระบบกลับรายการบัญชีให้)`} onConfirm={(reason) => voiding && voidIt.mutate({ id: voiding.id, reason })} />
    </div>
  );
}

function AgingView() {
  const [asOf, setAsOf] = useState(toISODate());
  const q = useQuery({ queryKey: ['accounting', 'ap-aging', asOf], queryFn: () => api.get<ApAging>('/accounting/ap/aging', { asOf }), placeholderData: keepPreviousData });
  const th = 'px-3 py-2 text-right';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <label className="text-sm text-muted" htmlFor="ag-asof">ณ วันที่</label>
        <Input id="ag-asof" type="date" className="w-auto" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
      </div>
      <QueryView q={q}>
        {(d) => {
          const sum = (k: 'current' | 'd30' | 'd60' | 'd90' | 'over90') => d.items.reduce((s, i) => s + i[k], 0);
          return (
            <Panel title={`อายุเจ้าหนี้ ณ ${formatDate(d.asOf)}`} bodyClass="p-0"
              actions={<Button size="sm" variant="outline" onClick={() => downloadCsv(`ap-aging-${d.asOf}.csv`, [['รหัส', 'ผู้ขาย', 'ยังไม่ครบกำหนด', '1-30 วัน', '31-60 วัน', '61-90 วัน', 'เกิน 90 วัน', 'รวม'], ...d.items.map((i) => [i.code, i.name, i.current, i.d30, i.d60, i.d90, i.over90, i.total]), ['', 'รวม', sum('current'), sum('d30'), sum('d60'), sum('d90'), sum('over90'), d.total]])}><Download /> CSV</Button>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr><th className="px-3 py-2">ผู้ขาย</th><th className={th}>ยังไม่ครบกำหนด</th><th className={th}>1-30 วัน</th><th className={th}>31-60 วัน</th><th className={th}>61-90 วัน</th><th className={th}>เกิน 90 วัน</th><th className={th}>รวม</th></tr>
                  </thead>
                  <tbody>
                    {d.items.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">ไม่มียอดค้างชำระ</td></tr>}
                    {d.items.map((i) => (
                      <tr key={i.supplierId} className="border-t border-line">
                        <td className="px-3 py-1.5">{i.code} {i.name}</td>
                        {([i.current, i.d30, i.d60, i.d90, i.over90, i.total] as number[]).map((v, k) => <td key={k} className={`px-3 py-1.5 text-right tabular-nums ${k === 4 && v > 0 ? 'text-bad' : ''}`}>{v ? formatMoney(v) : '-'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  {d.items.length > 0 && (
                    <tfoot className="border-t border-line bg-slate-50 font-semibold">
                      <tr><td className="px-3 py-2">รวม</td>{[sum('current'), sum('d30'), sum('d60'), sum('d90'), sum('over90'), d.total].map((v, k) => <td key={k} className="px-3 text-right tabular-nums">{formatMoney(v)}</td>)}</tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Panel>
          );
        }}
      </QueryView>
    </div>
  );
}
