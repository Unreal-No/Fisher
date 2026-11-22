import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatKg, formatMoney, formatMonth, formatNumber, PAYMENT_STATUS_TH, SALES_STATUS_TH, toISODate, toOptions } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ExportMenu } from '@/components/ui/export-menu';
import { num } from '@/lib/export';
import { useListParams } from '@/lib/hooks';
import { CustomerDialog, InvoiceDialog, useCustomers, useLots } from './sales-dialogs';
import { PayBadge, SalesBadge } from './status';
import type { Customer, GroupBy, InvoiceRow, Lot, Receivables, SalesReport } from './types';

const NAVY = '#1b365d';
const DAY = 86_400_000;
const PAGE = 20;

type LP = ReturnType<typeof useListParams>;

function usePagedS<T>(kind: string, path: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['sales', kind, params],
    queryFn: () => api.get<{ items: T[]; total: number }>(path, params),
    placeholderData: keepPreviousData,
  });
}

const ic = createColumnHelper<InvoiceRow>();
const cc = createColumnHelper<Customer>();
const lc = createColumnHelper<Lot>();

const GROUP_TH: Record<GroupBy, string> = { species: 'ชนิดสัตว์น้ำ', customer: 'ลูกค้า', vessel: 'เรือ', trip: 'เที่ยวเรือ', month: 'เดือน' };

export function SalesPage() {
  const { can } = useAuth();
  const lp = useListParams({ sFrom: toISODate(new Date(Date.now() - 365 * DAY)), sTo: toISODate() });
  const tab = lp.get('tab') || 'invoices';
  return (
    <>
      <PageHeader title="ขายสัตว์น้ำ" subtitle="ใบสั่งขาย ใบแจ้งหนี้ รับชำระ และลูกหนี้ — ขายจากล็อตของเที่ยวเรือ (น้ำหนักจับ ≠ น้ำหนักขาย)" />
      <Tabs
        value={tab}
        onValueChange={(t) => lp.set({ tab: t })}
        tabs={[
          { value: 'invoices', label: 'ใบขาย', content: <InvoicesTab lp={lp} canCreate={can('sales.create')} /> },
          { value: 'lots', label: 'ล็อตสัตว์น้ำ', content: <LotsTab lp={lp} /> },
          { value: 'receivables', label: 'ลูกหนี้', content: <ReceivablesTab /> },
          { value: 'customers', label: 'ลูกค้า', content: <CustomersTab lp={lp} canEdit={can('sales.create')} /> },
          { value: 'report', label: 'รายงานยอดขาย', content: <ReportTab lp={lp} canExport={can('report.export')} /> },
        ]}
      />
    </>
  );
}

function InvoicesTab({ lp, canCreate }: { lp: LP; canCreate: boolean }) {
  const nav = useNavigate();
  const customers = useCustomers();
  const [creating, setCreating] = useState(false);
  const list = usePagedS<InvoiceRow>('invoices', '/sales/invoices', {
    status: lp.get('status') || undefined, paymentStatus: lp.get('paymentStatus') || undefined, customerId: lp.get('customerId') || undefined,
    from: lp.get('from') || undefined, to: lp.get('to') || undefined, q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE,
  });
  const cols = [
    ic.display({ id: 'no', header: 'เลขที่', cell: ({ row: { original: r } }) => (
      <span className="font-medium text-accent">{r.orderNo}{r.invoiceNo && <span className="block text-xs text-slate-600">{r.invoiceNo}</span>}</span>
    ) }),
    ic.accessor('status', { header: 'สถานะ', cell: (i) => <SalesBadge s={i.getValue()} /> }),
    ic.display({ id: 'customer', header: 'ลูกค้า', cell: ({ row }) => `${row.original.customer.code} · ${row.original.customer.name}` }),
    ic.accessor('invoiceDate', { header: 'วันที่', cell: (i) => formatDate(i.getValue()) }),
    ic.accessor('dueDate', { header: 'ครบกำหนด', cell: (i) => formatDate(i.getValue()) }),
    ic.accessor('total', { header: 'ยอดรวม (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    ic.accessor('outstanding', { header: 'คงค้าง (บาท)', meta: { align: 'right' }, cell: ({ row: { original: r } }) => (r.status === 'CONFIRMED' ? formatMoney(r.outstanding) : '-') }),
    ic.accessor('paymentStatus', { header: 'การชำระ', cell: (i) => <PayBadge s={i.getValue()} /> }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่ใบขาย/ใบแจ้งหนี้..." />
        <Select options={toOptions(SALES_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
        <Select options={toOptions(PAYMENT_STATUS_TH)} placeholder="ทุกสถานะชำระ" value={lp.get('paymentStatus')} onChange={(e) => lp.set({ paymentStatus: e.target.value })} />
        <Select options={(customers.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} placeholder="ทุกลูกค้า" value={lp.get('customerId')} onChange={(e) => lp.set({ customerId: e.target.value })} />
        <Input type="date" className="w-40" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="ถึง" />
        {canCreate && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> สร้างใบขาย</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/sales/invoices/${r.id}`)} />
      {creating && <InvoiceDialog onClose={() => setCreating(false)} onSaved={(id) => nav(`/sales/invoices/${id}`)} />}
    </div>
  );
}

function LotsTab({ lp }: { lp: LP }) {
  const availableOnly = lp.get('allLots') !== '1';
  const q = useLots(availableOnly);
  const cols = [
    lc.accessor('lotNo', { header: 'ล็อต', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    lc.display({ id: 'trip', header: 'เที่ยวเรือ', cell: ({ row }) => <Link className="text-accent hover:underline" to={`/trips/${row.original.tripId}`} onClick={(e) => e.stopPropagation()}>{row.original.trip.tripNo}</Link> }),
    lc.display({ id: 'vessel', header: 'เรือ', cell: ({ row }) => `${row.original.trip.vessel.code} · ${row.original.trip.vessel.name}` }),
    lc.display({ id: 'species', header: 'ชนิด', cell: ({ row }) => row.original.species.nameTh }),
    lc.display({ id: 'grade', header: 'เกรด', cell: ({ row }) => row.original.grade?.nameTh ?? '-' }),
    lc.accessor('caughtKg', { header: 'จับได้ (กก.)', meta: { align: 'right' }, cell: (i) => formatKg(i.getValue()) }),
    lc.accessor('soldKg', { header: 'ขายแล้ว (กก.)', meta: { align: 'right' }, cell: (i) => formatKg(i.getValue()) }),
    lc.accessor('availableKg', { header: 'คงเหลือ (กก.)', meta: { align: 'right' }, cell: (i) => formatKg(i.getValue()) }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <Checkbox label="แสดงเฉพาะล็อตที่ขายได้" checked={availableOnly} onChange={(e) => lp.set({ allLots: e.target.checked ? '' : '1' })} />
      </FilterBar>
      <DataTable columns={cols} data={q.data} loading={q.isFetching} error={q.error} />
    </div>
  );
}

function ReceivablesTab() {
  const q = useQuery({ queryKey: ['sales', 'receivables'], queryFn: () => api.get<Receivables>('/sales/receivables') });
  return (
    <QueryView q={q}>
      {(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="ลูกหนี้คงค้างรวม (บาท)" value={formatMoney(d.totalOutstanding)} tone={Number(d.totalOutstanding) > 0 ? 'warn' : undefined} />
            <Stat label="ลูกค้าที่มียอดค้าง" value={formatNumber(d.byCustomer.length)} />
            <Stat label="ใบแจ้งหนี้เกินกำหนด" value={formatNumber(d.invoices.filter((i) => i.overdueDays > 0).length)} />
          </div>
          <Panel title="อายุลูกหนี้ตามลูกค้า (บาท)" bodyClass="p-0">
            {d.byCustomer.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr><th className="px-4 py-2">ลูกค้า</th><th className="px-2 text-right">ยังไม่ถึงกำหนด</th><th className="px-2 text-right">1-30</th><th className="px-2 text-right">31-60</th><th className="px-2 text-right">61-90</th><th className="px-2 text-right">&gt;90</th><th className="px-2 text-right">ใบ</th><th className="px-4 text-right">รวม</th></tr>
                  </thead>
                  <tbody>
                    {d.byCustomer.map((r) => (
                      <tr key={r.customer.id} className="border-t border-line">
                        <td className="px-4 py-2">{r.customer.code} · {r.customer.name}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.current)}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.d1_30)}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.d31_60)}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.d61_90)}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.d90p)}</td>
                        <td className="px-2 text-right tabular-nums">{formatNumber(r.invoices)}</td>
                        <td className="px-4 text-right font-medium tabular-nums">{formatMoney(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title="ไม่มีลูกหนี้คงค้าง" />}
          </Panel>
          <Panel title="ใบแจ้งหนี้ค้างชำระ" bodyClass="p-0">
            {d.invoices.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr><th className="px-4 py-2">เลขที่</th><th className="px-2">ลูกค้า</th><th className="px-2">วันที่</th><th className="px-2">ครบกำหนด</th><th className="px-2 text-right">เกินกำหนด (วัน)</th><th className="px-2 text-right">ยอดรวม</th><th className="px-4 text-right">คงค้าง</th></tr>
                  </thead>
                  <tbody>
                    {d.invoices.map((i) => (
                      <tr key={i.id} className="border-t border-line">
                        <td className="px-4 py-2"><Link className="font-medium text-accent hover:underline" to={`/sales/invoices/${i.id}`}>{i.invoiceNo ?? '-'}</Link></td>
                        <td className="px-2">{i.customer.name}</td>
                        <td className="px-2">{formatDate(i.invoiceDate)}</td>
                        <td className="px-2">{formatDate(i.dueDate)}</td>
                        <td className="px-2 text-right tabular-nums">{i.overdueDays > 0 ? <Badge tone="bad">{formatNumber(i.overdueDays)}</Badge> : '-'}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(i.total)}</td>
                        <td className="px-4 text-right tabular-nums">{formatMoney(i.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty />}
          </Panel>
        </div>
      )}
    </QueryView>
  );
}

function CustomersTab({ lp, canEdit }: { lp: LP; canEdit: boolean }) {
  const [dlg, setDlg] = useState<{ c: Customer | null } | null>(null);
  const list = usePagedS<Customer>('customers', '/sales/customers', { q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE });
  const cols = [
    cc.accessor('code', { header: 'รหัส' }),
    cc.accessor('name', { header: 'ชื่อลูกค้า' }),
    cc.accessor('contactName', { header: 'ผู้ติดต่อ', cell: (i) => i.getValue() ?? '-' }),
    cc.accessor('phone', { header: 'โทรศัพท์', cell: (i) => i.getValue() ?? '-' }),
    cc.accessor('creditTermDays', { header: 'เครดิต (วัน)', meta: { align: 'right' }, cell: (i) => (i.getValue() === null ? '-' : formatNumber(i.getValue())) }),
    cc.accessor('isActive', { header: 'สถานะ', cell: (i) => <Badge tone={i.getValue() ? 'ok' : 'neutral'}>{i.getValue() ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge> }),
    ...(canEdit ? [cc.display({ id: 'actions', header: '', meta: { align: 'right' }, cell: ({ row }) => <Button size="icon" variant="ghost" aria-label="แก้ไขลูกค้า" onClick={() => setDlg({ c: row.original })}><Pencil /></Button> })] : []),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหารหัส/ชื่อลูกค้า..." />
        {canEdit && <Button className="ml-auto" onClick={() => setDlg({ c: null })}><Plus /> เพิ่มลูกค้า</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)} loading={list.isFetching} error={list.error} />
      {dlg && <CustomerDialog customer={dlg.c} onClose={() => setDlg(null)} />}
    </div>
  );
}

function ReportTab({ lp, canExport }: { lp: LP; canExport: boolean }) {
  const groupBy = (lp.get('groupBy') || 'species') as GroupBy;
  const range = { from: lp.get('sFrom'), to: lp.get('sTo') };
  const q = useQuery({ queryKey: ['sales', 'report', range, groupBy], queryFn: () => api.get<SalesReport>('/sales/report', { ...range, groupBy }) });
  return (
    <div className="space-y-3">
      <FilterBar>
        <Input type="date" className="w-40" value={range.from} onChange={(e) => lp.set({ sFrom: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={range.to} onChange={(e) => lp.set({ sTo: e.target.value })} aria-label="ถึง" />
        <Select options={Object.entries(GROUP_TH).map(([value, label]) => ({ value, label: `แยกตาม${label}` }))} value={groupBy} onChange={(e) => lp.set({ groupBy: e.target.value })} aria-label="จัดกลุ่ม" />
        {canExport && (
          <ExportMenu className="ml-auto" disabled={!q.data?.items.length} baseName={`sales-report-${groupBy}-${toISODate()}`} rows={() => !q.data ? [] : [
            [GROUP_TH[groupBy], 'น้ำหนัก (กก.)', 'ยอดขายสุทธิ (บาท)', 'ราคาเฉลี่ย (บาท/กก.)', 'จำนวนใบแจ้งหนี้'],
            ...q.data.items.map((r) => [r.label, num(r.weightKg), num(r.revenue), num(r.avgPrice), r.invoices]),
            ['รวม', num(q.data.totalKg), num(q.data.totalRevenue), '', ''],
          ]} />
        )}
      </FilterBar>
      <QueryView q={q}>
        {(d) => (
          <div className="space-y-4">
            <Panel title={`ยอดขายสุทธิแยกตาม${GROUP_TH[groupBy]} (บาท)`}>
              {d.items.length ? (
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={d.items.map((m) => ({ ...m, label: groupBy === 'month' ? formatMonth(`${m.key}-01`) : m.label }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatNumber(v)} width={80} />
                      <Tooltip formatter={(v) => [`${formatMoney(v)} บาท`, 'ยอดขายสุทธิ']} />
                      <Bar dataKey="revenue" fill={NAVY} radius={[2, 2, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty title="ไม่มีข้อมูลในช่วงที่เลือก" />}
            </Panel>
            <Panel title="รายละเอียด" bodyClass="p-0">
              {d.items.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="px-4 py-2">{GROUP_TH[groupBy]}</th><th className="px-2 text-right">น้ำหนัก (กก.)</th><th className="px-2 text-right">ราคาเฉลี่ย (บาท/กก.)</th><th className="px-2 text-right">ใบแจ้งหนี้</th><th className="px-4 text-right">ยอดขายสุทธิ (บาท)</th></tr>
                    </thead>
                    <tbody>
                      {d.items.map((r) => (
                        <tr key={r.key} className="border-t border-line">
                          <td className="px-4 py-2">{groupBy === 'month' ? formatMonth(`${r.key}-01`) : r.label}</td>
                          <td className="px-2 text-right tabular-nums">{formatKg(r.weightKg)}</td>
                          <td className="px-2 text-right tabular-nums">{r.avgPrice === null ? '-' : formatMoney(r.avgPrice)}</td>
                          <td className="px-2 text-right tabular-nums">{formatNumber(r.invoices)}</td>
                          <td className="px-4 text-right tabular-nums">{formatMoney(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line font-semibold">
                        <td className="px-4 py-2">รวม</td><td className="px-2 text-right tabular-nums">{formatKg(d.totalKg)}</td><td /><td />
                        <td className="px-4 text-right tabular-nums">{formatMoney(d.totalRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : <Empty />}
              <p className="border-t border-line px-4 py-2 text-xs text-muted">ยอดขายสุทธิ ไม่รวม VAT หลังหักส่วนลดและใบลดหนี้</p>
            </Panel>
          </div>
        )}
      </QueryView>
    </div>
  );
}
