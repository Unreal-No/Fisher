import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, type Control, type FieldValues, type UseFormReturn } from 'react-hook-form';
import {
  formatMoney, formatNumber, goodsReceiptSchema, purchaseOrderSchema, purchaseRequestSchema, SUPPLY_CATEGORY_TH, supplierSchema, toISODate, toOptions,
} from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { dateInput, fromLocalInput, toLocalInput } from '@/lib/utils';
import type { ItemLite, PurchaseOrder, PurchaseRequest, Supplier, WarehouseLite } from './types';

export const INV = ['purchasing', 'inventory', 'trip', 'trips'];
const STALE = 60_000;

export const useItems = () =>
  useQuery({ queryKey: ['inventory', 'items-lite'], queryFn: () => api.get<{ items: ItemLite[] }>('/inventory/items', { all: 'true', active: 'true' }).then((r) => r.items), staleTime: STALE });
export const useWarehouses = () =>
  useQuery({ queryKey: ['inventory', 'warehouses-lite'], queryFn: () => api.get<WarehouseLite[]>('/inventory/warehouses'), staleTime: STALE });
export const useSuppliers = () =>
  useQuery({ queryKey: ['purchasing', 'suppliers-lite'], queryFn: () => api.get<{ items: Supplier[] }>('/purchasing/suppliers', { all: 'true' }).then((r) => r.items), staleTime: STALE });

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------- supplier ----------
export function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const s = supplier;
  const f = useForm<FieldValues>({
    resolver: zodResolver(supplierSchema) as never,
    defaultValues: {
      code: s?.code ?? '', name: s?.name ?? '', taxId: s?.taxId ?? '', branch: s?.branch ?? '', contactName: s?.contactName ?? '', phone: s?.phone ?? '',
      email: s?.email ?? '', address: s?.address ?? '', paymentTermDays: s?.paymentTermDays ?? '', bankName: s?.bankName ?? '', bankAccountNo: s?.bankAccountNo ?? '',
      isActive: s?.isActive ?? true, notes: s?.notes ?? '',
    },
  });
  const save = useAction((v: FieldValues) => (s ? api.patch(`/purchasing/suppliers/${s.id}`, v) : api.post('/purchasing/suppliers', v)), { success: 'บันทึกผู้ขายแล้ว', invalidate: INV, onSuccess: onClose });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={s ? `แก้ไขผู้ขาย ${s.code}` : 'เพิ่มผู้ขาย'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="รหัส" error={e('code')} hint={s ? undefined : 'เว้นว่างเพื่อให้ระบบสร้างอัตโนมัติ'}><Input {...f.register('code')} /></Field>
        <Field label="ชื่อผู้ขาย" required error={e('name')}><Input {...f.register('name')} /></Field>
        <Field label="เลขผู้เสียภาษี" error={e('taxId')}><Input inputMode="numeric" {...f.register('taxId')} /></Field>
        <Field label="สาขา" error={e('branch')}><Input {...f.register('branch')} /></Field>
        <Field label="ผู้ติดต่อ" error={e('contactName')}><Input {...f.register('contactName')} /></Field>
        <Field label="โทรศัพท์" error={e('phone')}><Input {...f.register('phone')} /></Field>
        <Field label="อีเมล" error={e('email')}><Input type="email" {...f.register('email')} /></Field>
        <Field label="เครดิต (วัน)" error={e('paymentTermDays')}><Input inputMode="numeric" {...f.register('paymentTermDays')} /></Field>
        <Field label="ธนาคาร" error={e('bankName')}><Input {...f.register('bankName')} /></Field>
        <Field label="เลขบัญชี" error={e('bankAccountNo')}><Input {...f.register('bankAccountNo')} /></Field>
        <Field label="ที่อยู่" error={e('address')} className="sm:col-span-2"><Textarea rows={2} {...f.register('address')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

// ---------- shared: vessel + trip ----------
function VesselTripFields({ f, hint }: { f: UseFormReturn<FieldValues>; hint?: string }) {
  const vessels = useVessels();
  const vesselId = f.watch('vesselId') as string;
  const cur = f.getValues('tripId') as string;
  const trips = useQuery({
    queryKey: ['purchasing', 'open-trips', vesselId],
    queryFn: () => api.get<{ items: { id: string; tripNo: string }[] }>('/trips', { vesselId, open: 'true', pageSize: 100 }).then((r) => r.items),
    enabled: !!vesselId,
  });
  const opts = (trips.data ?? []).map((t) => ({ value: t.id, label: t.tripNo }));
  if (cur && trips.data && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: 'เที่ยวเดิมที่เลือกไว้' });
  return (
    <>
      <Field label="เรือ" error={errOf(f.formState.errors, 'vesselId')}>
        <Select options={vesselOptions(vessels.data)} placeholder="- ไม่ระบุเรือ -" {...f.register('vesselId', { onChange: () => f.setValue('tripId', '') })} />
      </Field>
      <Field label="เที่ยวเรือ" error={errOf(f.formState.errors, 'tripId')} hint={hint ?? (vesselId && !trips.isLoading && !trips.data?.length ? 'ไม่มีเที่ยวที่เปิดอยู่' : undefined)}>
        <Select options={opts} placeholder="- ไม่ระบุเที่ยว -" disabled={!vesselId} {...f.register('tripId')} />
      </Field>
    </>
  );
}

// ---------- shared: line editor ----------
function LineEditor({ f, control, kind, items }: { f: UseFormReturn<FieldValues>; control: Control<FieldValues>; kind: 'pr' | 'po'; items: ItemLite[] }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const e = (k: string) => errOf(f.formState.errors, k);
  const blank = kind === 'pr' ? { itemId: '', description: '', quantity: '', unit: '', estUnitCost: '', notes: '' } : { itemId: '', category: 'OTHER', description: '', quantity: '', unit: '', unitPrice: '' };
  const pick = (i: number, id: string) => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    f.setValue(`items.${i}.description`, it.name);
    f.setValue(`items.${i}.unit`, it.unit);
    if (kind === 'po') f.setValue(`items.${i}.category`, it.category);
  };
  const rootErr = (f.formState.errors.items as { message?: string; root?: { message?: string } } | undefined);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-800">รายการ</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => append(blank)}><Plus /> เพิ่มรายการ</Button>
      </div>
      {(rootErr?.message || rootErr?.root?.message) && <p className="text-xs text-bad">{rootErr.message ?? rootErr.root?.message}</p>}
      {fields.map((fld, i) => (
        <div key={fld.id} className="space-y-2 rounded border border-line p-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <Field label="สินค้าในคลัง" className="col-span-2">
              <Select options={items.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} placeholder="- ไม่ใช่สินค้าในคลัง -" {...f.register(`items.${i}.itemId`, { onChange: (ev) => pick(i, ev.target.value) })} />
            </Field>
            {kind === 'po' && <Field label="หมวด"><Select options={toOptions(SUPPLY_CATEGORY_TH)} {...f.register(`items.${i}.category`)} /></Field>}
            <Field label="รายละเอียด" required error={e(`items.${i}.description`)} className={kind === 'po' ? 'col-span-2' : 'col-span-2 md:col-span-3'}><Input {...f.register(`items.${i}.description`)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <Field label="จำนวน" required error={e(`items.${i}.quantity`)}><Input inputMode="decimal" {...f.register(`items.${i}.quantity`)} /></Field>
            <Field label="หน่วย" required error={e(`items.${i}.unit`)}><Input {...f.register(`items.${i}.unit`)} /></Field>
            {kind === 'pr' ? (
              <>
                <Field label="ราคาประมาณ/หน่วย" error={e(`items.${i}.estUnitCost`)}><Input inputMode="decimal" {...f.register(`items.${i}.estUnitCost`)} /></Field>
                <Field label="หมายเหตุ" error={e(`items.${i}.notes`)} className="col-span-2"><Input {...f.register(`items.${i}.notes`)} /></Field>
              </>
            ) : (
              <Field label="ราคา/หน่วย" required error={e(`items.${i}.unitPrice`)}><Input inputMode="decimal" {...f.register(`items.${i}.unitPrice`)} /></Field>
            )}
            <div className="flex items-end justify-end md:col-start-6">
              <Button type="button" variant="ghost" size="icon" aria-label="ลบรายการ" onClick={() => remove(i)}><Trash2 /></Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- purchase request ----------
export function PrFormDialog({ pr, onClose, onSaved }: { pr: PurchaseRequest | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const items = useItems();
  const f = useForm<FieldValues>({
    resolver: zodResolver(purchaseRequestSchema) as never,
    defaultValues: {
      neededBy: dateInput(pr?.neededBy), vesselId: pr?.vesselId ?? '', tripId: pr?.tripId ?? '', notes: pr?.notes ?? '',
      items: pr?.items.map((x) => ({ itemId: x.itemId ?? '', description: x.description, quantity: x.quantity, unit: x.unit, estUnitCost: x.estUnitCost ?? '', notes: x.notes ?? '' }))
        ?? [{ itemId: '', description: '', quantity: '', unit: '', estUnitCost: '', notes: '' }],
    },
  });
  const save = useAction((v: FieldValues) => (pr ? api.put<{ id: string }>(`/purchasing/requests/${pr.id}`, v) : api.post<{ id: string }>('/purchasing/requests', v)), {
    success: 'บันทึกใบขอซื้อแล้ว', invalidate: INV, onSuccess: (r) => { onClose(); if (r?.id) onSaved?.(r.id); },
  });
  const lines = (f.watch('items') ?? []) as { quantity: string; estUnitCost: string }[];
  const est = lines.reduce((a, l) => a + num(l.quantity) * num(l.estUnitCost), 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={pr ? `แก้ไขใบขอซื้อ ${pr.prNo}` : 'สร้างใบขอซื้อ'} size="xl"
      footer={<><span className="mr-auto self-center text-sm text-muted">ประมาณการรวม <b className="text-ink">{formatMoney(est)}</b> บาท</span><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={4}>
          <Field label="ต้องการภายใน" error={errOf(f.formState.errors, 'neededBy')}><Input type="date" {...f.register('neededBy')} /></Field>
          <VesselTripFields f={f} />
          <Field label="หมายเหตุ" error={errOf(f.formState.errors, 'notes')}><Input {...f.register('notes')} /></Field>
        </FormGrid>
        <LineEditor f={f} control={f.control} kind="pr" items={items.data ?? []} />
      </div>
    </Dialog>
  );
}

// ---------- purchase order ----------
export function PoFormDialog({ po, pr, onClose, onSaved }: { po?: PurchaseOrder | null; pr?: PurchaseRequest | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const items = useItems();
  const suppliers = useSuppliers();
  const warehouses = useWarehouses();
  const catOf = (id: string | null) => items.data?.find((x) => x.id === id)?.category ?? 'OTHER';
  const f = useForm<FieldValues>({
    resolver: zodResolver(purchaseOrderSchema) as never,
    defaultValues: {
      supplierId: po?.supplier.id ?? '', prId: po?.pr?.id ?? pr?.id ?? '', orderDate: po ? dateInput(po.orderDate) : toISODate(), expectedDate: dateInput(po?.expectedDate),
      warehouseId: po?.warehouseId ?? '', vesselId: po?.vesselId ?? pr?.vesselId ?? '', tripId: po?.tripId ?? pr?.tripId ?? '',
      discount: po && Number(po.discount) ? po.discount : '', vatRate: po ? String(Number(po.vatRate)) : '7', notes: po?.notes ?? '',
      items: po
        ? po.items.map((x) => ({ itemId: x.itemId ?? '', category: x.category, description: x.description, quantity: x.quantity, unit: x.unit, unitPrice: x.unitPrice }))
        : pr
          ? pr.items.map((x) => ({ itemId: x.itemId ?? '', category: catOf(x.itemId), description: x.description, quantity: x.quantity, unit: x.unit, unitPrice: x.estUnitCost ?? '' }))
          : [{ itemId: '', category: 'OTHER', description: '', quantity: '', unit: '', unitPrice: '' }],
    },
  });
  const save = useAction((v: FieldValues) => (po ? api.put<{ id: string }>(`/purchasing/orders/${po.id}`, v) : api.post<{ id: string }>('/purchasing/orders', v)), {
    success: 'บันทึกใบสั่งซื้อแล้ว', invalidate: INV, onSuccess: (r) => { onClose(); if (r?.id) onSaved?.(r.id); },
  });
  const lines = (f.watch('items') ?? []) as { quantity: string; unitPrice: string }[];
  const subtotal = lines.reduce((a, l) => a + num(l.quantity) * num(l.unitPrice), 0);
  const discount = num(f.watch('discount'));
  const vatRaw = f.watch('vatRate');
  const vatRate = vatRaw === '' || vatRaw == null ? 7 : num(vatRaw);
  const net = Math.max(0, subtotal - discount);
  const vat = (net * vatRate) / 100;
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={po ? `แก้ไขใบสั่งซื้อ ${po.poNo}` : pr ? `ออกใบสั่งซื้อจาก ${pr.prNo}` : 'สร้างใบสั่งซื้อ'} size="xl"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={4}>
          <Field label="ผู้ขาย" required error={e('supplierId')} className="sm:col-span-2">
            <Select options={(suppliers.data ?? []).filter((s) => s.isActive || s.id === po?.supplier.id).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} placeholder="- เลือกผู้ขาย -" {...f.register('supplierId')} />
          </Field>
          <Field label="คลังที่รับของ" required error={e('warehouseId')} className="sm:col-span-2">
            <Select options={(warehouses.data ?? []).filter((w) => w.isActive || w.id === po?.warehouseId).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} placeholder="- เลือกคลัง -" {...f.register('warehouseId')} />
          </Field>
          <Field label="วันที่สั่งซื้อ" required error={e('orderDate')}><Input type="date" {...f.register('orderDate')} /></Field>
          <Field label="กำหนดรับของ" error={e('expectedDate')}><Input type="date" {...f.register('expectedDate')} /></Field>
          <VesselTripFields f={f} hint="ถ้าระบุเที่ยว รายการที่ไม่ใช่สินค้าในคลังจะลงเป็นต้นทุนเที่ยวเมื่อรับของ" />
          <Field label="ส่วนลด (บาท)" error={e('discount')}><Input inputMode="decimal" {...f.register('discount')} /></Field>
          <Field label="VAT (%)" error={e('vatRate')}><Input inputMode="decimal" {...f.register('vatRate')} /></Field>
          <Field label="หมายเหตุ" error={e('notes')} className="sm:col-span-2"><Input {...f.register('notes')} /></Field>
        </FormGrid>
        <LineEditor f={f} control={f.control} kind="po" items={items.data ?? []} />
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted">ยอดก่อน VAT</dt><dd className="text-right tabular-nums">{formatMoney(subtotal)}</dd>
          <dt className="text-muted">ส่วนลด</dt><dd className="text-right tabular-nums">-{formatMoney(discount)}</dd>
          <dt className="text-muted">VAT {formatNumber(vatRate, 2)}%</dt><dd className="text-right tabular-nums">{formatMoney(vat)}</dd>
          <dt className="font-semibold">ยอดรวม</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(net + vat)}</dd>
        </dl>
      </div>
    </Dialog>
  );
}

// ---------- receive goods ----------
export function ReceiveDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const warehouses = useWarehouses();
  const open = po.items.map((x) => ({ item: x, remaining: num(x.quantity) - num(x.receivedQty) })).filter((x) => x.remaining > 0);
  const f = useForm<FieldValues>({
    defaultValues: {
      receivedAt: toLocalInput(), warehouseId: po.warehouseId, supplierInvoiceNo: '', notes: '',
      lines: open.map((x) => ({ poItemId: x.item.id, quantity: String(x.remaining) })),
    },
  });
  const [formErr, setFormErr] = useState<string | null>(null);
  const save = useAction((v: unknown) => api.post(`/purchasing/orders/${po.id}/receive`, v), { success: 'บันทึกรับสินค้าแล้ว', invalidate: INV, onSuccess: onClose });
  const submit = f.handleSubmit((v) => {
    setFormErr(null);
    const lines = (v.lines as { poItemId: string; quantity: string }[]).filter((l) => l.quantity !== '' && num(l.quantity) > 0);
    const parsed = goodsReceiptSchema.safeParse({
      receivedAt: v.receivedAt ? fromLocalInput(v.receivedAt) : '', warehouseId: v.warehouseId, supplierInvoiceNo: v.supplierInvoiceNo, notes: v.notes, lines,
    });
    if (!parsed.success) return setFormErr(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
    const over = open.find((o) => {
      const l = lines.find((x) => x.poItemId === o.item.id);
      return l && num(l.quantity) > o.remaining + 1e-9;
    });
    if (over) return setFormErr(`จำนวนที่รับเกินยอดคงค้าง: ${over.item.description}`);
    save.mutate(parsed.data);
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`รับสินค้า ${po.poNo}`} size="lg"
      description="สินค้าในคลังลงสต็อกด้วยราคาหลังหักส่วนลด ไม่รวม VAT"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึกรับสินค้า</Button></>}>
      <div className="space-y-4">
        {formErr && <div className="rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{formErr}</div>}
        <FormGrid cols={2}>
          <Field label="วันเวลาที่รับ" required><Input type="datetime-local" {...f.register('receivedAt')} /></Field>
          <Field label="คลัง">
            <Select options={(warehouses.data ?? []).filter((w) => w.isActive || w.id === po.warehouseId).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} {...f.register('warehouseId')} />
          </Field>
          <Field label="เลขที่ใบส่งของ/ใบกำกับภาษีผู้ขาย"><Input {...f.register('supplierInvoiceNo')} /></Field>
          <Field label="หมายเหตุ"><Input {...f.register('notes')} /></Field>
        </FormGrid>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr><th className="px-3 py-2">รายการ</th><th className="px-2 text-right">สั่ง</th><th className="px-2 text-right">รับแล้ว</th><th className="px-2 text-right">คงค้าง</th><th className="w-32 px-3 text-right">รับครั้งนี้</th></tr>
            </thead>
            <tbody>
              {open.map((o, i) => (
                <tr key={o.item.id} className="border-t border-line">
                  <td className="px-3 py-2">{o.item.description}</td>
                  <td className="px-2 text-right tabular-nums">{formatNumber(o.item.quantity, 2)} {o.item.unit}</td>
                  <td className="px-2 text-right tabular-nums">{formatNumber(o.item.receivedQty, 2)}</td>
                  <td className="px-2 text-right tabular-nums">{formatNumber(o.remaining, 2)}</td>
                  <td className="px-3"><Input inputMode="decimal" className="text-right" aria-label={`จำนวนที่รับ ${o.item.description}`} {...f.register(`lines.${i}.quantity`)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">เว้นว่างหรือใส่ 0 หากไม่รับรายการนั้นในครั้งนี้</p>
      </div>
    </Dialog>
  );
}
