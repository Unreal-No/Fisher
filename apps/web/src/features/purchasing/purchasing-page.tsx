import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatMoney, formatMonth, formatNumber, PO_STATUS_TH, PR_STATUS_TH, toISODate, toOptions } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ExportMenu } from '@/components/ui/export-menu';
import { num } from '@/lib/export';
import { useListParams } from '@/lib/hooks';
import { PoBadge, PrBadge } from './status';
import { PoFormDialog, PrFormDialog, SupplierDialog, useSuppliers } from './purchasing-dialogs';
import type { PurchaseOrderRow, PurchaseRequest, PurchaseSummary, Supplier } from './types';

const NAVY = '#1b365d';
const DAY = 86_400_000;
const PAGE = 20;

type LP = ReturnType<typeof useListParams>;

function usePagedP<T>(kind: string, path: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['purchasing', kind, params],
    queryFn: () => api.get<{ items: T[]; total: number }>(path, params),
    placeholderData: keepPreviousData,
  });
}

const prc = createColumnHelper<PurchaseRequest>();
const poc = createColumnHelper<PurchaseOrderRow>();
const sc = createColumnHelper<Supplier>();

export function PurchasingPage() {
  const { can } = useAuth();
  const lp = useListParams({ sFrom: toISODate(new Date(Date.now() - 365 * DAY)), sTo: toISODate() });
  const tab = lp.get('tab') || 'requests';
  return (
    <>
      <PageHeader title="จัดซื้อ" subtitle="ใบขอซื้อ ใบสั่งซื้อ การรับสินค้า และผู้ขาย" />
      <Tabs
        value={tab}
        onValueChange={(t) => lp.set({ tab: t })}
        tabs={[
          { value: 'requests', label: 'ใบขอซื้อ', content: <RequestsTab lp={lp} canCreate={can('purchase.create')} /> },
          { value: 'orders', label: 'ใบสั่งซื้อ', content: <OrdersTab lp={lp} canCreate={can('purchase.create')} /> },
          { value: 'suppliers', label: 'ผู้ขาย', content: <SuppliersTab lp={lp} canEdit={can('purchase.create')} /> },
          { value: 'summary', label: 'สรุปการซื้อ', content: <SummaryTab lp={lp} canExport={can('report.export')} /> },
        ]}
      />
    </>
  );
}

function RequestsTab({ lp, canCreate }: { lp: LP; canCreate: boolean }) {
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = usePagedP<PurchaseRequest>('requests', '/purchasing/requests', { status: lp.get('prStatus') || undefined, q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE });
  const cols = [
    prc.accessor('prNo', { header: 'เลขที่', cell: (i) => <span className="font-medium text-accent">{i.getValue()}</span> }),
    prc.accessor('status', { header: 'สถานะ', cell: (i) => <PrBadge s={i.getValue()} /> }),
    prc.accessor('neededBy', { header: 'ต้องการภายใน', cell: (i) => formatDate(i.getValue()) }),
    prc.display({ id: 'items', header: 'รายการ', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original.items?.length ?? 0) }),
    prc.display({ id: 'orders', header: 'ใบสั่งซื้อ', meta: { align: 'right' }, cell: ({ row }) => formatNumber(row.original._count?.orders ?? 0) }),
    prc.accessor('createdAt', { header: 'สร้างเมื่อ', cell: (i) => formatDate(i.getValue()) }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่ใบขอซื้อ..." />
        <Select options={toOptions(PR_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('prStatus')} onChange={(e) => lp.set({ prStatus: e.target.value })} />
        {canCreate && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> สร้างใบขอซื้อ</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/purchasing/requests/${r.id}`)} />
      {creating && <PrFormDialog pr={null} onClose={() => setCreating(false)} onSaved={(id) => nav(`/purchasing/requests/${id}`)} />}
    </div>
  );
}

function OrdersTab({ lp, canCreate }: { lp: LP; canCreate: boolean }) {
  const nav = useNavigate();
  const suppliers = useSuppliers();
  const [creating, setCreating] = useState(false);
  const list = usePagedP<PurchaseOrderRow>('orders', '/purchasing/orders', {
    status: lp.get('poStatus') || undefined, supplierId: lp.get('supplierId') || undefined, from: lp.get('from') || undefined, to: lp.get('to') || undefined,
    q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE,
  });
  const cols = [
    poc.accessor('poNo', { header: 'เลขที่', cell: (i) => <span className="font-medium text-accent">{i.getValue()}</span> }),
    poc.accessor('status', { header: 'สถานะ', cell: (i) => <PoBadge s={i.getValue()} /> }),
    poc.display({ id: 'supplier', header: 'ผู้ขาย', cell: ({ row }) => `${row.original.supplier.code} · ${row.original.supplier.name}` }),
    poc.accessor('orderDate', { header: 'วันที่สั่ง', cell: (i) => formatDate(i.getValue()) }),
    poc.accessor('expectedDate', { header: 'กำหนดรับ', cell: (i) => formatDate(i.getValue()) }),
    poc.accessor('total', { header: 'ยอดรวม (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่ใบสั่งซื้อ..." />
        <Select options={toOptions(PO_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('poStatus')} onChange={(e) => lp.set({ poStatus: e.target.value })} />
        <Select options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} placeholder="ทุกผู้ขาย" value={lp.get('supplierId')} onChange={(e) => lp.set({ supplierId: e.target.value })} />
        <Input type="date" className="w-40" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="ถึง" />
        {canCreate && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> สร้างใบสั่งซื้อ</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/purchasing/orders/${r.id}`)} />
      {creating && <PoFormDialog onClose={() => setCreating(false)} onSaved={(id) => nav(`/purchasing/orders/${id}`)} />}
    </div>
  );
}

function SuppliersTab({ lp, canEdit }: { lp: LP; canEdit: boolean }) {
  const [dlg, setDlg] = useState<{ s: Supplier | null } | null>(null);
  const list = usePagedP<Supplier>('suppliers', '/purchasing/suppliers', { q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE });
  const cols = [
    sc.accessor('code', { header: 'รหัส' }),
    sc.accessor('name', { header: 'ชื่อผู้ขาย' }),
    sc.accessor('contactName', { header: 'ผู้ติดต่อ', cell: (i) => i.getValue() ?? '-' }),
    sc.accessor('phone', { header: 'โทรศัพท์', cell: (i) => i.getValue() ?? '-' }),
    sc.accessor('paymentTermDays', { header: 'เครดิต (วัน)', meta: { align: 'right' }, cell: (i) => (i.getValue() === null ? '-' : formatNumber(i.getValue())) }),
    sc.accessor('isActive', { header: 'สถานะ', cell: (i) => <Badge tone={i.getValue() ? 'ok' : 'neutral'}>{i.getValue() ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge> }),
    ...(canEdit ? [sc.display({ id: 'actions', header: '', meta: { align: 'right' }, cell: ({ row }) => <Button size="icon" variant="ghost" aria-label="แก้ไขผู้ขาย" onClick={() => setDlg({ s: row.original })}><Pencil /></Button> })] : []),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหารหัส/ชื่อผู้ขาย..." />
        {canEdit && <Button className="ml-auto" onClick={() => setDlg({ s: null })}><Plus /> เพิ่มผู้ขาย</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)} loading={list.isFetching} error={list.error} />
      {dlg && <SupplierDialog supplier={dlg.s} onClose={() => setDlg(null)} />}
    </div>
  );
}

function SummaryTab({ lp, canExport }: { lp: LP; canExport: boolean }) {
  const range = { from: lp.get('sFrom'), to: lp.get('sTo') };
  const q = useQuery({ queryKey: ['purchasing', 'summary', range], queryFn: () => api.get<PurchaseSummary>('/purchasing/summary', range) });
  return (
    <div className="space-y-3">
      <FilterBar>
        <Input type="date" className="w-40" value={range.from} onChange={(e) => lp.set({ sFrom: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={range.to} onChange={(e) => lp.set({ sTo: e.target.value })} aria-label="ถึง" />
        {canExport && (
          <ExportMenu className="ml-auto" disabled={!q.data?.bySupplier.length} baseName={`purchasing-summary-${toISODate()}`} rows={() => !q.data ? [] : [
            ['รหัสผู้ขาย', 'ผู้ขาย', 'จำนวนใบสั่งซื้อ', 'ยอดรวม (รวม VAT)', 'VAT'],
            ...q.data.bySupplier.map((s) => [s.code, s.name, s.orders, num(s.total), num(s.vat)]),
          ]} />
        )}
      </FilterBar>
      <QueryView q={q}>
        {(d) => (
          <div className="space-y-4">
            <Panel title="ยอดซื้อรายเดือน (บาท)">
              {d.monthly.length ? (
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={d.monthly.map((m) => ({ ...m, total: Number(m.total), label: formatMonth(`${m.month}-01`) }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatNumber(v)} width={80} />
                      <Tooltip formatter={(v) => [`${formatMoney(v)} บาท`, 'ยอดซื้อ']} />
                      <Bar dataKey="total" fill={NAVY} radius={[2, 2, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty title="ไม่มีข้อมูลในช่วงที่เลือก" />}
            </Panel>
            <Panel title="สรุปตามผู้ขาย" bodyClass="p-0">
              {d.bySupplier.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="px-4 py-2">ผู้ขาย</th><th className="px-2 text-right">ใบสั่งซื้อ</th><th className="px-2 text-right">VAT (บาท)</th><th className="px-4 text-right">ยอดรวม (บาท)</th></tr>
                    </thead>
                    <tbody>
                      {d.bySupplier.map((s) => (
                        <tr key={s.supplierId} className="border-t border-line">
                          <td className="px-4 py-2">{s.code} · {s.name}</td>
                          <td className="px-2 text-right tabular-nums">{formatNumber(s.orders)}</td>
                          <td className="px-2 text-right tabular-nums">{formatMoney(s.vat)}</td>
                          <td className="px-4 text-right tabular-nums">{formatMoney(s.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty />}
              <p className="border-t border-line px-4 py-2 text-xs text-muted">ยอดรวมรวม VAT · ไม่รวมใบร่าง/ยกเลิก</p>
            </Panel>
          </div>
        )}
      </QueryView>
    </div>
  );
}
