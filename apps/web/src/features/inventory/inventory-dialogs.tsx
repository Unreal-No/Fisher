import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import {
  formatMoney, formatNumber, inventoryItemSchema, stockAdjustSchema, stockIssueSchema, stockReceiptSchema, stockTransferSchema, SUPPLY_CATEGORY_TH, toOptions, warehouseSchema,
} from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { fromLocalInput, toLocalInput } from '@/lib/utils';
import type { BalancesResult, InventoryItem, Warehouse } from './types';

const INV = ['inventory', 'trip', 'trips'];
const err = (f: { formState: { errors: FieldValues } }, k: string) => (f.formState.errors[k] as { message?: string } | undefined)?.message;

export function useWarehouses() {
  return useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: () => api.get<Warehouse[]>('/inventory/warehouses') });
}
function useItemOptions() {
  return useQuery({
    queryKey: ['inventory', 'item-options'],
    queryFn: () => api.get<{ items: InventoryItem[] }>('/inventory/items', { all: 'true', active: 'true' }).then((r) => r.items),
  });
}
const warehouseOpts = (w?: Warehouse[]) => (w ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }));

function useOnHand(warehouseId: string, itemId: string) {
  const q = useQuery({
    queryKey: ['inventory', 'balances', 'dialog', warehouseId],
    queryFn: () => api.get<BalancesResult>('/inventory/balances', { warehouseId }),
    enabled: !!warehouseId,
  });
  if (!warehouseId || !itemId || !q.data) return null;
  const b = q.data.items.find((x) => x.itemId === itemId);
  return { qty: b ? Number(b.quantity) : 0, avgCost: b ? Number(b.avgCost) : 0 };
}
function OnHand({ warehouseId, itemId, unit }: { warehouseId: string; itemId: string; unit?: string }) {
  const h = useOnHand(warehouseId, itemId);
  if (!h) return null;
  return (
    <div className="rounded border border-line bg-slate-50 px-3 py-2 text-sm">
      คงเหลือในคลังนี้ <b>{formatNumber(h.qty)}</b> {unit} · ต้นทุนเฉลี่ย <b>{formatMoney(h.avgCost)}</b> บาท/หน่วย
    </div>
  );
}

const footer = (onClose: () => void, pending: boolean, submit: () => void) => (
  <><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={pending} onClick={submit}>บันทึก</Button></>
);

type StockProps = { open: boolean; onOpenChange: (o: boolean) => void };

export function WarehouseDialog({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const f = useForm<FieldValues>({
    resolver: zodResolver(warehouseSchema) as never,
    defaultValues: { code: warehouse?.code ?? '', name: warehouse?.name ?? '', location: warehouse?.location ?? '', isActive: warehouse?.isActive ?? true, notes: warehouse?.notes ?? '' },
  });
  const save = useAction((v: FieldValues) => (warehouse ? api.patch(`/inventory/warehouses/${warehouse.id}`, v) : api.post('/inventory/warehouses', v)), { success: 'บันทึกคลังสินค้าแล้ว', invalidate: INV, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={warehouse ? `แก้ไขคลัง ${warehouse.code}` : 'เพิ่มคลังสินค้า'} footer={footer(onClose, save.isPending, f.handleSubmit((v) => save.mutate(v)))}>
      <FormGrid cols={2}>
        <Field label="รหัสคลัง" required error={err(f, 'code')}><Input {...f.register('code')} /></Field>
        <Field label="ชื่อคลัง" required error={err(f, 'name')}><Input {...f.register('name')} /></Field>
        <Field label="ที่ตั้ง" error={err(f, 'location')} className="sm:col-span-2"><Input {...f.register('location')} /></Field>
        <Field label="หมายเหตุ" error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

export function ItemDialog({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const f = useForm<FieldValues>({
    resolver: zodResolver(inventoryItemSchema) as never,
    defaultValues: { code: item?.code ?? '', name: item?.name ?? '', category: item?.category ?? 'OTHER', unit: item?.unit ?? '', minStock: item?.minStock ?? '', isActive: item?.isActive ?? true, notes: item?.notes ?? '' },
  });
  const save = useAction((v: FieldValues) => (item ? api.patch(`/inventory/items/${item.id}`, v) : api.post('/inventory/items', v)), { success: 'บันทึกสินค้าแล้ว', invalidate: INV, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={item ? `แก้ไขสินค้า ${item.code}` : 'เพิ่มสินค้า'} footer={footer(onClose, save.isPending, f.handleSubmit((v) => save.mutate(v)))}>
      <FormGrid cols={2}>
        <Field label="รหัสสินค้า" error={err(f, 'code')} hint={item ? undefined : 'เว้นว่างเพื่อให้ระบบสร้างอัตโนมัติ'}><Input {...f.register('code')} /></Field>
        <Field label="ชื่อสินค้า" required error={err(f, 'name')}><Input {...f.register('name')} /></Field>
        <Field label="หมวดหมู่" required error={err(f, 'category')}><Select options={toOptions(SUPPLY_CATEGORY_TH)} {...f.register('category')} /></Field>
        <Field label="หน่วย" required error={err(f, 'unit')}><Input {...f.register('unit')} /></Field>
        <Field label="จุดสั่งซื้อ (ขั้นต่ำ)" error={err(f, 'minStock')}><Input inputMode="decimal" {...f.register('minStock')} /></Field>
        <Field label="หมายเหตุ" error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

function ItemWarehouseFields({ f, items, warehouses, whName = 'warehouseId', whLabel = 'คลัง' }: {
  f: ReturnType<typeof useForm<FieldValues>>; items?: InventoryItem[]; warehouses?: Warehouse[]; whName?: string; whLabel?: string;
}) {
  return (
    <>
      <Field label={whLabel} required error={err(f, whName)}><Select options={warehouseOpts(warehouses)} placeholder="- เลือกคลัง -" {...f.register(whName)} /></Field>
      <Field label="สินค้า" required error={err(f, 'itemId')}>
        <Select options={(items ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name} (${i.unit})` }))} placeholder="- เลือกสินค้า -" {...f.register('itemId')} />
      </Field>
    </>
  );
}

export function StockReceiptDialog({ open, onOpenChange }: StockProps) {
  const items = useItemOptions();
  const wh = useWarehouses();
  const f = useForm<FieldValues>({
    resolver: zodResolver(stockReceiptSchema) as never,
    defaultValues: { warehouseId: '', itemId: '', quantity: '', unitCost: '', movedAt: toLocalInput(), notes: '' },
  });
  const close = () => onOpenChange(false);
  const save = useAction((v: FieldValues) => api.post('/inventory/receipts', v), { success: 'บันทึกรับเข้าแล้ว', invalidate: INV, onSuccess: close });
  const unit = items.data?.find((i) => i.id === f.watch('itemId'))?.unit;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="รับเข้า (ไม่มีใบสั่งซื้อ)" description="สำหรับการรับเข้าโดยไม่มีใบสั่งซื้อ เช่น ยอดยกมา"
      footer={footer(close, save.isPending, f.handleSubmit((v) => save.mutate({ ...v, movedAt: fromLocalInput(v.movedAt) })))}>
      <div className="space-y-3">
        <OnHand warehouseId={f.watch('warehouseId')} itemId={f.watch('itemId')} unit={unit} />
        <FormGrid cols={2}>
          <ItemWarehouseFields f={f} items={items.data} warehouses={wh.data} />
          <Field label="จำนวน" required error={err(f, 'quantity')}><Input inputMode="decimal" {...f.register('quantity')} /></Field>
          <Field label="ราคาต่อหน่วย (บาท)" required error={err(f, 'unitCost')}><Input inputMode="decimal" {...f.register('unitCost')} /></Field>
          <Field label="วันเวลา" required error={err(f, 'movedAt')}><Input type="datetime-local" {...f.register('movedAt')} /></Field>
          <Field label="หมายเหตุ" required error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}

export function StockIssueDialog({ open, onOpenChange, vesselId, tripId }: StockProps & { vesselId?: string; tripId?: string }) {
  const { can } = useAuth();
  const items = useItemOptions();
  const wh = useWarehouses();
  const vessels = useVessels();
  const [needOverride, setNeedOverride] = useState(false);
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(stockIssueSchema) as never,
    defaultValues: { warehouseId: '', itemId: '', quantity: '', movedAt: toLocalInput(), vesselId: vesselId ?? '', tripId: tripId ?? '', notes: '', override: false, overrideReason: '' },
  });
  const close = () => onOpenChange(false);
  const vid = (f.watch('vesselId') as string) || vesselId || '';
  const trips = useQuery({
    queryKey: ['inventory', 'open-trips', vid],
    queryFn: () => api.get<{ items: { id: string; tripNo: string }[] }>('/trips', { vesselId: vid, open: 'true', pageSize: 100 }).then((r) => r.items),
    enabled: !!vid && !tripId,
  });
  const save = useAction((v: FieldValues) => api.post('/inventory/issues', v), { success: 'เบิกสินค้าเข้าเรือแล้ว', invalidate: INV, onSuccess: close, silentError: true });
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    return save.mutateAsync({ ...v, movedAt: fromLocalInput(v.movedAt), override: v.override ? true : undefined }).catch((e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') setNeedOverride(true);
      setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ');
    });
  });
  const unit = items.data?.find((i) => i.id === f.watch('itemId'))?.unit;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="เบิกเข้าเรือ" footer={footer(close, save.isPending, submit)}>
      <div className="space-y-3">
        <OnHand warehouseId={f.watch('warehouseId')} itemId={f.watch('itemId')} unit={unit} />
        {rootErr && <div className="rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
        <FormGrid cols={2}>
          <ItemWarehouseFields f={f} items={items.data} warehouses={wh.data} />
          <Field label="จำนวน" required error={err(f, 'quantity')}><Input inputMode="decimal" {...f.register('quantity')} /></Field>
          <Field label="วันเวลา" required error={err(f, 'movedAt')}><Input type="datetime-local" {...f.register('movedAt')} /></Field>
          {!vesselId && (
            <Field label="เรือ" required error={err(f, 'vesselId')}>
              <Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" {...f.register('vesselId', { onChange: () => f.setValue('tripId', '') })} />
            </Field>
          )}
          {!tripId && (
            <Field label="เที่ยวเรือ" error={err(f, 'tripId')} hint={vid && !trips.isLoading && !trips.data?.length ? 'ไม่มีเที่ยวที่เปิดอยู่' : undefined}>
              <Select options={(trips.data ?? []).map((t) => ({ value: t.id, label: t.tripNo }))} placeholder="- ไม่ระบุเที่ยว -" disabled={!vid} {...f.register('tripId')} />
            </Field>
          )}
          <Field label="หมายเหตุ" error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        </FormGrid>
        {needOverride && (
          <div className="space-y-2 rounded border border-amber-200 bg-warn-soft p-3 text-sm">
            {can('inventory.approve') ? (
              <>
                <Checkbox label="อนุมัติเบิกเกินยอดคงเหลือ" {...f.register('override')} />
                {f.watch('override') && <Input placeholder="เหตุผลการอนุมัติ (จำเป็น)" {...f.register('overrideReason')} />}
              </>
            ) : <p className="text-warn">ต้องให้ผู้มีสิทธิ์อนุมัติดำเนินการ หรือลดจำนวนที่เบิก</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function StockTransferDialog({ open, onOpenChange }: StockProps) {
  const items = useItemOptions();
  const wh = useWarehouses();
  const f = useForm<FieldValues>({
    resolver: zodResolver(stockTransferSchema) as never,
    defaultValues: { fromWarehouseId: '', toWarehouseId: '', itemId: '', quantity: '', movedAt: toLocalInput(), notes: '' },
  });
  const close = () => onOpenChange(false);
  const save = useAction((v: FieldValues) => api.post('/inventory/transfers', v), { success: 'โอนย้ายสินค้าแล้ว', invalidate: INV, onSuccess: close });
  const unit = items.data?.find((i) => i.id === f.watch('itemId'))?.unit;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="โอนย้ายระหว่างคลัง"
      footer={footer(close, save.isPending, f.handleSubmit((v) => save.mutate({ ...v, movedAt: fromLocalInput(v.movedAt) })))}>
      <div className="space-y-3">
        <OnHand warehouseId={f.watch('fromWarehouseId')} itemId={f.watch('itemId')} unit={unit} />
        <FormGrid cols={2}>
          <ItemWarehouseFields f={f} items={items.data} warehouses={wh.data} whName="fromWarehouseId" whLabel="คลังต้นทาง" />
          <Field label="คลังปลายทาง" required error={err(f, 'toWarehouseId')}><Select options={warehouseOpts(wh.data)} placeholder="- เลือกคลัง -" {...f.register('toWarehouseId')} /></Field>
          <Field label="จำนวน" required error={err(f, 'quantity')}><Input inputMode="decimal" {...f.register('quantity')} /></Field>
          <Field label="วันเวลา" required error={err(f, 'movedAt')}><Input type="datetime-local" {...f.register('movedAt')} /></Field>
          <Field label="หมายเหตุ" error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}

export function StockAdjustDialog({ open, onOpenChange }: StockProps) {
  const items = useItemOptions();
  const wh = useWarehouses();
  const f = useForm<FieldValues>({
    resolver: zodResolver(stockAdjustSchema) as never,
    defaultValues: { warehouseId: '', itemId: '', countedQty: '', movedAt: toLocalInput(), reason: '' },
  });
  const close = () => onOpenChange(false);
  const save = useAction((v: FieldValues) => api.post('/inventory/adjustments', v), { success: 'ปรับยอดตามการตรวจนับแล้ว', invalidate: INV, onSuccess: close });
  const unit = items.data?.find((i) => i.id === f.watch('itemId'))?.unit;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="ตรวจนับ / ปรับยอด" description="กรอกจำนวนที่นับได้จริง ระบบจะบันทึกส่วนต่างให้อัตโนมัติ"
      footer={footer(close, save.isPending, f.handleSubmit((v) => save.mutate({ ...v, movedAt: fromLocalInput(v.movedAt) })))}>
      <div className="space-y-3">
        <OnHand warehouseId={f.watch('warehouseId')} itemId={f.watch('itemId')} unit={unit} />
        <FormGrid cols={2}>
          <ItemWarehouseFields f={f} items={items.data} warehouses={wh.data} />
          <Field label="จำนวนที่นับได้" required error={err(f, 'countedQty')}><Input inputMode="decimal" {...f.register('countedQty')} /></Field>
          <Field label="วันเวลาที่นับ" required error={err(f, 'movedAt')}><Input type="datetime-local" {...f.register('movedAt')} /></Field>
          <Field label="เหตุผล" required error={err(f, 'reason')} className="sm:col-span-2"><Textarea rows={2} {...f.register('reason')} /></Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}
