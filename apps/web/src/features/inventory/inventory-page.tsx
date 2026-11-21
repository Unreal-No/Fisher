import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  formatDateTime, formatMoney, formatNumber, STOCK_MOVE_TYPE_TH, SUPPLY_CATEGORY_TH, toISODate, toOptions,
  type StockMoveType, type SupplyCategory,
} from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadCsv } from '@/lib/export';
import { useAction, useListParams } from '@/lib/hooks';
import { ItemDialog, StockAdjustDialog, StockIssueDialog, StockReceiptDialog, StockTransferDialog, useWarehouses, WarehouseDialog } from './inventory-dialogs';
import type { Balance, BalancesResult, InventoryItem, StockMovement, Warehouse } from './types';

type LP = ReturnType<typeof useListParams>;
const INV = ['inventory', 'trip', 'trips'];
const bc = createColumnHelper<Balance>();
const ic = createColumnHelper<InventoryItem>();
const mc = createColumnHelper<StockMovement>();
const wc = createColumnHelper<Warehouse>();
const MOVE_TONE = { RECEIPT: 'ok', ISSUE: 'info', TRANSFER_OUT: 'neutral', TRANSFER_IN: 'neutral', ADJUSTMENT: 'warn' } as const;
const activeBadge = (v: boolean) => <Badge tone={v ? 'ok' : 'neutral'}>{v ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge>;

function usePagedInv<T>(kind: string, path: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['inventory', kind, params],
    queryFn: () => api.get<{ items: T[]; total: number }>(path, params),
    placeholderData: keepPreviousData,
  });
}

export function InventoryPage() {
  const { can } = useAuth();
  const lp = useListParams();
  const [dlg, setDlg] = useState<'issue' | 'transfer' | 'adjust' | 'receipt' | null>(null);
  const canEdit = can('inventory.edit');
  const tab = lp.get('tab') || 'balances';
  return (
    <>
      <PageHeader
        title="คลังสินค้า" subtitle="สต็อกคงเหลือ การเบิกจ่ายเข้าเรือ โอนย้าย และตรวจนับ"
        actions={canEdit && (
          <>
            <Button onClick={() => setDlg('issue')}>เบิกเข้าเรือ</Button>
            <Button variant="outline" onClick={() => setDlg('transfer')}>โอนย้าย</Button>
            <Button variant="outline" onClick={() => setDlg('adjust')}>ตรวจนับ/ปรับยอด</Button>
            <Button variant="outline" onClick={() => setDlg('receipt')}>รับเข้า (ไม่มีใบสั่งซื้อ)</Button>
          </>
        )}
      />
      <Tabs
        value={tab}
        onValueChange={(t) => lp.set({ tab: t, page: undefined, q: undefined, category: undefined, warehouseId: undefined, type: undefined, belowMin: undefined, from: undefined, to: undefined })}
        tabs={[
          { value: 'balances', label: 'สต็อกคงเหลือ', content: <BalancesTab lp={lp} canExport={can('report.export')} /> },
          { value: 'items', label: 'สินค้า', content: <ItemsTab lp={lp} canEdit={canEdit} /> },
          { value: 'movements', label: 'ความเคลื่อนไหว', content: <MovementsTab lp={lp} /> },
          { value: 'warehouses', label: 'คลังสินค้า', content: <WarehousesTab canEdit={canEdit} /> },
        ]}
      />
      <StockIssueDialog key={`i${dlg === 'issue'}`} open={dlg === 'issue'} onOpenChange={(o) => !o && setDlg(null)} />
      <StockTransferDialog key={`t${dlg === 'transfer'}`} open={dlg === 'transfer'} onOpenChange={(o) => !o && setDlg(null)} />
      <StockAdjustDialog key={`a${dlg === 'adjust'}`} open={dlg === 'adjust'} onOpenChange={(o) => !o && setDlg(null)} />
      <StockReceiptDialog key={`r${dlg === 'receipt'}`} open={dlg === 'receipt'} onOpenChange={(o) => !o && setDlg(null)} />
    </>
  );
}

const balanceCols = [
  bc.display({ id: 'item', header: 'สินค้า', cell: ({ row: { original: r } }) => `${r.item.code} · ${r.item.name}` }),
  bc.display({ id: 'cat', header: 'หมวดหมู่', cell: ({ row }) => SUPPLY_CATEGORY_TH[row.original.item.category as SupplyCategory] }),
  bc.display({ id: 'wh', header: 'คลัง', cell: ({ row }) => row.original.warehouse.name }),
  bc.display({
    id: 'qty', header: 'คงเหลือ', meta: { align: 'right' },
    cell: ({ row: { original: r } }) => <span className="tabular-nums">{formatNumber(r.quantity)} {r.item.unit} {r.belowMin && <Badge tone="warn">ต่ำกว่าขั้นต่ำ</Badge>}</span>,
  }),
  bc.accessor('avgCost', { header: 'ต้นทุนเฉลี่ย', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
  bc.accessor('value', { header: 'มูลค่า (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
];

function BalancesTab({ lp, canExport }: { lp: LP; canExport: boolean }) {
  const wh = useWarehouses();
  const params = { warehouseId: lp.get('warehouseId') || undefined, q: lp.get('q') || undefined, belowMin: lp.get('belowMin') === 'true' ? 'true' : undefined };
  const q = useQuery({ queryKey: ['inventory', 'balances', params], queryFn: () => api.get<BalancesResult>('/inventory/balances', params), placeholderData: keepPreviousData });
  const exportCsv = () => downloadCsv(`inventory-balances-${toISODate()}.csv`, [
    ['รหัส', 'สินค้า', 'หมวดหมู่', 'คลัง', 'คงเหลือ', 'หน่วย', 'ต้นทุนเฉลี่ย', 'มูลค่า (บาท)', 'ต่ำกว่าขั้นต่ำ'],
    ...(q.data?.items ?? []).map((r) => [r.item.code, r.item.name, SUPPLY_CATEGORY_TH[r.item.category], r.warehouse.name, r.quantity, r.item.unit, r.avgCost, r.value, r.belowMin ? 'ใช่' : '']),
  ]);
  const rows = q.data?.items;
  return (
    <div className="space-y-3">
      <FilterBar>
        <Select options={(wh.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} placeholder="ทุกคลัง" value={lp.get('warehouseId')} onChange={(e) => lp.set({ warehouseId: e.target.value })} />
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} />
        <Checkbox label="เฉพาะต่ำกว่าจุดสั่งซื้อ" checked={lp.get('belowMin') === 'true'} onChange={(e) => lp.set({ belowMin: e.target.checked ? 'true' : undefined })} />
        {canExport && <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={!rows?.length}><Download /> ส่งออก CSV</Button>}
      </FilterBar>
      <DataTable
        columns={balanceCols} data={rows} total={rows?.length} pageSize={100000} loading={q.isFetching} error={q.error}
        footer={rows?.length ? <tr><td colSpan={5} className="px-3 py-2 text-right">มูลค่ารวม (บาท)</td><td className="px-3 text-right tabular-nums">{formatMoney(q.data?.totalValue ?? 0)}</td></tr> : undefined}
      />
    </div>
  );
}

function ItemsTab({ lp, canEdit }: { lp: LP; canEdit: boolean }) {
  const [edit, setEdit] = useState<InventoryItem | null | undefined>(undefined);
  const [del, setDel] = useState<InventoryItem | null>(null);
  const params = { q: lp.get('q') || undefined, category: lp.get('category') || undefined, page: lp.page, pageSize: 20 };
  const list = usePagedInv<InventoryItem>('items', '/inventory/items', params);
  const remove = useAction((id: string) => api.del<{ deactivated?: boolean }>(`/inventory/items/${id}`), {
    invalidate: INV, success: 'ดำเนินการแล้ว', onSuccess: () => setDel(null),
  });
  const cols = [
    ic.accessor('code', { header: 'รหัส' }),
    ic.accessor('name', { header: 'ชื่อสินค้า' }),
    ic.accessor('category', { header: 'หมวดหมู่', cell: (i) => SUPPLY_CATEGORY_TH[i.getValue() as SupplyCategory] }),
    ic.accessor('unit', { header: 'หน่วย' }),
    ic.accessor('minStock', { header: 'ขั้นต่ำ', meta: { align: 'right' }, cell: (i) => (i.getValue() === null ? '-' : formatNumber(i.getValue())) }),
    ic.accessor('onHand', { header: 'คงเหลือ', meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular-nums">{formatNumber(r.onHand)} {r.belowMin && <Badge tone="warn">ต่ำกว่าขั้นต่ำ</Badge>}</span> }),
    ic.accessor('stockValue', { header: 'มูลค่า (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    ic.accessor('isActive', { header: 'สถานะ', cell: (i) => activeBadge(i.getValue()) }),
    ...(canEdit ? [ic.display({
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => (
        <span className="inline-flex gap-1">
          <Button size="icon" variant="ghost" aria-label="แก้ไขสินค้า" onClick={() => setEdit(r)}><Pencil /></Button>
          <Button size="icon" variant="ghost" aria-label="ลบสินค้า" onClick={() => setDel(r)}><Trash2 /></Button>
        </span>
      ),
    })] : []),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} />
        <Select options={toOptions(SUPPLY_CATEGORY_TH)} placeholder="ทุกหมวดหมู่" value={lp.get('category')} onChange={(e) => lp.set({ category: e.target.value })} />
        {canEdit && <Button className="ml-auto" onClick={() => setEdit(null)}><Plus /> เพิ่มสินค้า</Button>}
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)} loading={list.isFetching} error={list.error} />
      {edit !== undefined && <ItemDialog item={edit} onClose={() => setEdit(undefined)} />}
      <ConfirmDialog
        open={!!del} onOpenChange={(o) => !o && setDel(null)} title="ลบสินค้า" danger confirmText="ลบ" loading={remove.isPending}
        message={`ลบ ${del?.code ?? ''} · ${del?.name ?? ''} — หากมีความเคลื่อนไหวแล้ว ระบบจะปิดใช้งานแทนการลบ`}
        onConfirm={() => del && remove.mutate(del.id)}
      />
    </div>
  );
}

const moveCols = [
  mc.accessor('movedAt', { header: 'วันที่', cell: (i) => formatDateTime(i.getValue()) }),
  mc.accessor('moveNo', { header: 'เลขที่' }),
  mc.accessor('type', { header: 'ประเภท', cell: (i) => <Badge tone={MOVE_TONE[i.getValue() as StockMoveType]}>{STOCK_MOVE_TYPE_TH[i.getValue() as StockMoveType]}</Badge> }),
  mc.display({ id: 'item', header: 'สินค้า', cell: ({ row }) => `${row.original.item.code} · ${row.original.item.name}` }),
  mc.display({ id: 'wh', header: 'คลัง', cell: ({ row }) => row.original.warehouse.code }),
  mc.accessor('quantity', {
    header: 'จำนวน', meta: { align: 'right' },
    cell: ({ row: { original: r } }) => { const n = Number(r.quantity); return <span className={n < 0 ? 'text-bad' : 'text-ok'}>{n > 0 ? '+' : ''}{formatNumber(n)} {r.item.unit}</span>; },
  }),
  mc.accessor('totalCost', { header: 'มูลค่า (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
  mc.accessor('balanceAfter', { header: 'คงเหลือหลังรายการ', meta: { align: 'right' }, cell: (i) => formatNumber(i.getValue()) }),
  mc.display({
    id: 'ref', header: 'อ้างอิง',
    cell: ({ row: { original: r } }) => (
      <span className="text-xs">
        {[r.vessel?.name, r.refType, r.notes].filter(Boolean).join(' · ')}
        {r.tripId && <> <Link className="text-accent hover:underline" to={`/trips/${r.tripId}`}>เที่ยวเรือ</Link></>}
        {r.overrideReason && <Badge tone="warn">อนุมัติเบิกเกิน: {r.overrideReason}</Badge>}
      </span>
    ),
  }),
];

function MovementsTab({ lp }: { lp: LP }) {
  const wh = useWarehouses();
  const params = {
    warehouseId: lp.get('warehouseId') || undefined, type: lp.get('type') || undefined, from: lp.get('from') || undefined, to: lp.get('to') || undefined,
    page: lp.page, pageSize: 20,
  };
  const list = usePagedInv<StockMovement>('movements', '/inventory/movements', params);
  return (
    <div className="space-y-3">
      <FilterBar>
        <Select options={(wh.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} placeholder="ทุกคลัง" value={lp.get('warehouseId')} onChange={(e) => lp.set({ warehouseId: e.target.value })} />
        <Select options={toOptions(STOCK_MOVE_TYPE_TH)} placeholder="ทุกประเภท" value={lp.get('type')} onChange={(e) => lp.set({ type: e.target.value })} />
        <Input type="date" className="w-40" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="ถึง" />
      </FilterBar>
      <DataTable columns={moveCols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)} loading={list.isFetching} error={list.error} />
    </div>
  );
}

function WarehousesTab({ canEdit }: { canEdit: boolean }) {
  const q = useWarehouses();
  const [edit, setEdit] = useState<Warehouse | null | undefined>(undefined);
  const cols = [
    wc.accessor('code', { header: 'รหัส' }),
    wc.accessor('name', { header: 'ชื่อคลัง' }),
    wc.accessor('location', { header: 'ที่ตั้ง', cell: (i) => i.getValue() ?? '-' }),
    wc.accessor('isActive', { header: 'สถานะ', cell: (i) => activeBadge(i.getValue()) }),
    wc.accessor('notes', { header: 'หมายเหตุ', cell: (i) => i.getValue() ?? '-' }),
    ...(canEdit ? [wc.display({
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => <Button size="icon" variant="ghost" aria-label="แก้ไขคลัง" onClick={() => setEdit(r)}><Pencil /></Button>,
    })] : []),
  ];
  return (
    <div className="space-y-3">
      {canEdit && <div className="flex justify-end"><Button onClick={() => setEdit(null)}><Plus /> เพิ่มคลัง</Button></div>}
      <DataTable columns={cols} data={q.data} total={q.data?.length} pageSize={1000} loading={q.isFetching} error={q.error} />
      {edit !== undefined && <WarehouseDialog warehouse={edit} onClose={() => setEdit(undefined)} />}
    </div>
  );
}
