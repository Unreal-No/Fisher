import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import {
  customerSchema, formatKg, formatMoney, formatNumber, PAYMENT_METHOD_TH, salesInvoiceSchema, salesPaymentSchema, salesReturnSchema, toISODate, toOptions,
} from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { dateInput, fromLocalInput, toLocalInput } from '@/lib/utils';
import type { Customer, Invoice, Lot } from './types';

export const INV = ['sales', 'trip', 'trip-settlement', 'dashboard'];
const STALE = 60_000;

export const useCustomers = () =>
  useQuery({ queryKey: ['sales', 'customers-lite'], queryFn: () => api.get<{ items: Customer[] }>('/sales/customers', { all: 'true' }).then((r) => r.items), staleTime: STALE });

export const useLots = (availableOnly: boolean, enabled = true) =>
  useQuery({
    queryKey: ['sales', 'lots', availableOnly],
    queryFn: () => api.get<Lot[]>('/sales/lots', availableOnly ? { availableOnly: 'true' } : {}),
    placeholderData: keepPreviousData,
    enabled,
  });

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const lotKey = (tripId: string, speciesId: string, gradeId: string | null | undefined) => `${tripId}|${speciesId}|${gradeId ?? ''}`;
const lotLabel = (l: Lot) => `${l.lotNo} · ${l.species.nameTh}${l.grade ? ` ${l.grade.nameTh}` : ''} · คงเหลือ ${formatKg(l.availableKg)} กก.`;

// ---------- customer ----------
export function CustomerDialog({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const c = customer;
  const f = useForm<FieldValues>({
    resolver: zodResolver(customerSchema) as never,
    defaultValues: {
      code: c?.code ?? '', name: c?.name ?? '', taxId: c?.taxId ?? '', branch: c?.branch ?? '', contactName: c?.contactName ?? '', phone: c?.phone ?? '',
      email: c?.email ?? '', address: c?.address ?? '', creditTermDays: c?.creditTermDays ?? '', isActive: c?.isActive ?? true, notes: c?.notes ?? '',
    },
  });
  const save = useAction((v: FieldValues) => (c ? api.patch(`/sales/customers/${c.id}`, v) : api.post('/sales/customers', v)), { success: 'บันทึกลูกค้าแล้ว', invalidate: INV, onSuccess: onClose });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={c ? `แก้ไขลูกค้า ${c.code}` : 'เพิ่มลูกค้า'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="รหัส" error={e('code')} hint={c ? undefined : 'เว้นว่างเพื่อให้ระบบสร้างอัตโนมัติ'}><Input {...f.register('code')} /></Field>
        <Field label="ชื่อลูกค้า" required error={e('name')}><Input {...f.register('name')} /></Field>
        <Field label="เลขผู้เสียภาษี" error={e('taxId')}><Input inputMode="numeric" {...f.register('taxId')} /></Field>
        <Field label="สาขา" error={e('branch')}><Input {...f.register('branch')} /></Field>
        <Field label="ผู้ติดต่อ" error={e('contactName')}><Input {...f.register('contactName')} /></Field>
        <Field label="โทรศัพท์" error={e('phone')}><Input {...f.register('phone')} /></Field>
        <Field label="อีเมล" error={e('email')}><Input type="email" {...f.register('email')} /></Field>
        <Field label="เครดิตเทอม (วัน)" error={e('creditTermDays')}><Input inputMode="numeric" {...f.register('creditTermDays')} /></Field>
        <Field label="ที่อยู่" error={e('address')} className="sm:col-span-2"><Textarea rows={2} {...f.register('address')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

// ---------- invoice (create / edit draft) ----------
interface Line { lotKey: string; tripId: string; speciesId: string; gradeId: string; description: string; weightKg: string; quantity: string; unitPrice: string }
const blankLine: Line = { lotKey: '', tripId: '', speciesId: '', gradeId: '', description: '', weightKg: '', quantity: '', unitPrice: '' };

export function InvoiceDialog({ invoice, onClose, onSaved }: { invoice?: Invoice; onClose: () => void; onSaved?: (id: string) => void }) {
  const customers = useCustomers();
  const lots = useLots(true);
  const lotList = lots.data ?? [];
  const f = useForm<FieldValues>({
    resolver: zodResolver(salesInvoiceSchema) as never,
    defaultValues: {
      customerId: invoice?.customer.id ?? '', invoiceDate: invoice ? dateInput(invoice.invoiceDate) : toISODate(), dueDate: dateInput(invoice?.dueDate),
      discount: invoice && num(invoice.discount) ? invoice.discount : '', additionalCost: invoice && num(invoice.additionalCost) ? invoice.additionalCost : '',
      vatRate: invoice ? String(num(invoice.vatRate)) : '0', notes: invoice?.notes ?? '',
      items: invoice
        ? invoice.items.map((x): Line => ({
          lotKey: lotKey(x.tripId, x.speciesId, x.gradeId), tripId: x.tripId, speciesId: x.speciesId, gradeId: x.gradeId ?? '', description: x.description ?? '',
          weightKg: x.weightKg, quantity: x.quantity == null ? '' : String(x.quantity), unitPrice: x.unitPrice,
        }))
        : [blankLine],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: f.control, name: 'items' });
  const save = useAction((v: FieldValues) => (invoice ? api.put<{ id: string }>(`/sales/invoices/${invoice.id}`, v) : api.post<{ id: string }>('/sales/invoices', v)), {
    success: 'บันทึกใบขายแล้ว', invalidate: INV, onSuccess: (r) => { onClose(); if (r?.id) onSaved?.(r.id); },
  });
  const lines = (f.watch('items') ?? []) as Line[];
  const subtotal = lines.reduce((a, l) => a + num(l.weightKg) * num(l.unitPrice), 0);
  const discount = num(f.watch('discount'));
  const additional = num(f.watch('additionalCost'));
  const vatRate = num(f.watch('vatRate'));
  const net = Math.max(0, subtotal - discount) + additional;
  const vat = (Math.max(0, subtotal - discount) * vatRate) / 100;
  const e = (k: string) => errOf(f.formState.errors, k);
  const rootErr = f.formState.errors.items as { message?: string; root?: { message?: string } } | undefined;

  const pick = (i: number, key: string) => {
    const l = lotList.find((x) => lotKey(x.tripId, x.speciesId, x.gradeId) === key);
    if (!l) return;
    f.setValue(`items.${i}.tripId`, l.tripId);
    f.setValue(`items.${i}.speciesId`, l.speciesId);
    f.setValue(`items.${i}.gradeId`, l.gradeId ?? '');
    if (!f.getValues(`items.${i}.unitPrice`) && l.species.defaultPrice) f.setValue(`items.${i}.unitPrice`, String(num(l.species.defaultPrice)));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={invoice ? `แก้ไขใบขาย ${invoice.orderNo}` : 'สร้างใบขาย'} size="xl"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={4}>
          <Field label="ลูกค้า" required error={e('customerId')} className="sm:col-span-2">
            <Select options={(customers.data ?? []).filter((c) => c.isActive || c.id === invoice?.customer.id).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} placeholder="- เลือกลูกค้า -" {...f.register('customerId')} />
          </Field>
          <Field label="วันที่ขาย" required error={e('invoiceDate')}><Input type="date" {...f.register('invoiceDate')} /></Field>
          <Field label="ครบกำหนดชำระ" error={e('dueDate')} hint="เว้นว่าง = ตามเครดิตเทอมลูกค้า"><Input type="date" {...f.register('dueDate')} /></Field>
          <Field label="ส่วนลด (บาท)" error={e('discount')}><Input inputMode="decimal" {...f.register('discount')} /></Field>
          <Field label="ค่าใช้จ่ายเรียกเก็บเพิ่ม (ขนส่ง/น้ำแข็ง)" error={e('additionalCost')}><Input inputMode="decimal" {...f.register('additionalCost')} /></Field>
          <Field label="VAT (%)" error={e('vatRate')} hint="สัตว์น้ำสดโดยทั่วไปได้รับยกเว้น VAT — ยืนยันกับผู้สอบบัญชี"><Input inputMode="decimal" {...f.register('vatRate')} /></Field>
          <Field label="หมายเหตุ" error={e('notes')}><Input {...f.register('notes')} /></Field>
        </FormGrid>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-navy-800">รายการขาย (เลือกจากล็อตสัตว์น้ำ)</h3>
            <Button type="button" size="sm" variant="outline" onClick={() => append(blankLine)}><Plus /> เพิ่มรายการ</Button>
          </div>
          {(rootErr?.message || rootErr?.root?.message) && <p className="text-xs text-bad">{rootErr.message ?? rootErr.root?.message}</p>}
          {fields.map((fld, i) => {
            const cur = lines[i];
            const key = cur?.lotKey ?? '';
            const lot = lotList.find((x) => lotKey(x.tripId, x.speciesId, x.gradeId) === key);
            const opts = lotList.map((l) => ({ value: lotKey(l.tripId, l.speciesId, l.gradeId), label: lotLabel(l) }));
            if (key && !lot) opts.push({ value: key, label: 'ล็อตเดิมที่เลือกไว้' });
            const over = lot && num(cur?.weightKg) > lot.availableKg + 1e-9;
            return (
              <div key={fld.id} className="space-y-2 rounded border border-line p-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                  <Field label="ล็อต" required error={e(`items.${i}.tripId`) || e(`items.${i}.speciesId`)} className="col-span-2 md:col-span-3">
                    <Select options={opts} placeholder="- เลือกล็อต -" {...f.register(`items.${i}.lotKey`, { onChange: (ev) => pick(i, ev.target.value) })} />
                  </Field>
                  <Field label="น้ำหนัก (กก.)" required error={e(`items.${i}.weightKg`) || (over ? `เกินคงเหลือ ${formatKg(lot.availableKg)} กก.` : undefined)}><Input inputMode="decimal" {...f.register(`items.${i}.weightKg`)} /></Field>
                  <Field label="ราคา/กก. (บาท)" required error={e(`items.${i}.unitPrice`)}><Input inputMode="decimal" {...f.register(`items.${i}.unitPrice`)} /></Field>
                  <Field label="จำนวน (ตัว/ลัง)" error={e(`items.${i}.quantity`)}><Input inputMode="numeric" {...f.register(`items.${i}.quantity`)} /></Field>
                </div>
                <div className="flex items-end gap-2">
                  <Field label="รายละเอียดเพิ่มเติม" error={e(`items.${i}.description`)} className="flex-1"><Input {...f.register(`items.${i}.description`)} /></Field>
                  <span className="pb-2 text-sm tabular-nums text-muted">= {formatMoney(num(cur?.weightKg) * num(cur?.unitPrice))}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label="ลบรายการ" onClick={() => remove(i)}><Trash2 /></Button>
                </div>
              </div>
            );
          })}
        </div>
        <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted">ยอดสัตว์น้ำ</dt><dd className="text-right tabular-nums">{formatMoney(subtotal)}</dd>
          <dt className="text-muted">ส่วนลด</dt><dd className="text-right tabular-nums">-{formatMoney(discount)}</dd>
          <dt className="text-muted">ค่าใช้จ่ายเพิ่ม</dt><dd className="text-right tabular-nums">{formatMoney(additional)}</dd>
          <dt className="text-muted">VAT {formatNumber(vatRate, 2)}%</dt><dd className="text-right tabular-nums">{formatMoney(vat)}</dd>
          <dt className="font-semibold">ยอดรวม</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(net + vat)}</dd>
        </dl>
      </div>
    </Dialog>
  );
}

// ---------- payment ----------
export function PaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const f = useForm<FieldValues>({ defaultValues: { paidAt: toLocalInput(), amount: String(invoice.outstanding), method: 'TRANSFER', reference: '', notes: '' } });
  const [formErr, setFormErr] = useState<string | null>(null);
  const save = useAction((v: unknown) => api.post(`/sales/invoices/${invoice.id}/payments`, v), { success: 'บันทึกรับชำระแล้ว', invalidate: INV, onSuccess: onClose });
  const submit = f.handleSubmit((v) => {
    setFormErr(null);
    const parsed = salesPaymentSchema.safeParse({ ...v, paidAt: v.paidAt ? fromLocalInput(v.paidAt) : '' });
    if (!parsed.success) return setFormErr(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
    save.mutate(parsed.data);
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`รับชำระ ${invoice.invoiceNo ?? invoice.orderNo}`} size="md" description={`คงค้าง ${formatMoney(invoice.outstanding)} บาท`}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึกรับชำระ</Button></>}>
      <div className="space-y-3">
        {formErr && <div className="rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{formErr}</div>}
        <FormGrid cols={2}>
          <Field label="วันเวลาที่รับ" required><Input type="datetime-local" {...f.register('paidAt')} /></Field>
          <Field label="จำนวนเงิน (บาท)" required><Input inputMode="decimal" {...f.register('amount')} /></Field>
          <Field label="วิธีชำระ" required><Select options={toOptions(PAYMENT_METHOD_TH)} {...f.register('method')} /></Field>
          <Field label="เลขที่อ้างอิง"><Input {...f.register('reference')} /></Field>
          <Field label="หมายเหตุ" className="sm:col-span-2"><Input {...f.register('notes')} /></Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}

// ---------- credit note ----------
export function ReturnDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const rows = invoice.items.map((x) => ({ item: x, maxKg: Math.max(0, num(x.weightKg) - num(x.returnedKg)), maxAmt: Math.max(0, num(x.lineTotal) - num(x.discountShare) - num(x.returnedAmount)) }));
  const f = useForm<FieldValues>({
    defaultValues: { returnDate: toISODate(), reason: '', lines: rows.map(() => ({ weightKg: '', amount: '' })) },
  });
  const [formErr, setFormErr] = useState<string | null>(null);
  const save = useAction((v: unknown) => api.post(`/sales/invoices/${invoice.id}/returns`, v), { success: 'ออกใบลดหนี้แล้ว', invalidate: INV, onSuccess: onClose });
  const submit = f.handleSubmit((v) => {
    setFormErr(null);
    const lines = v.lines as { weightKg: string; amount: string }[];
    const items = rows.map((r, i) => ({ salesItemId: r.item.id, weightKg: lines[i]?.weightKg ?? '', amount: lines[i]?.amount ?? '' })).filter((l) => l.weightKg !== '' || l.amount !== '');
    const parsed = salesReturnSchema.safeParse({ returnDate: v.returnDate, reason: v.reason, items });
    if (!parsed.success) return setFormErr(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง');
    const over = parsed.data.items.find((l) => {
      const r = rows.find((x) => x.item.id === l.salesItemId);
      return !r || l.weightKg > r.maxKg + 1e-9 || l.amount > r.maxAmt + 0.005;
    });
    if (over) return setFormErr('น้ำหนักหรือจำนวนเงินที่ลดเกินยอดที่คืนได้');
    save.mutate(parsed.data);
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`ออกใบลดหนี้ ${invoice.invoiceNo ?? ''}`} size="xl"
      description="จำนวนเงินไม่รวม VAT (ระบบคำนวณ VAT เพิ่มให้) · ปลาที่คืนไม่ถูกนำกลับเข้าล็อต"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>ออกใบลดหนี้</Button></>}>
      <div className="space-y-4">
        {formErr && <div className="rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{formErr}</div>}
        <FormGrid cols={2}>
          <Field label="วันที่" required><Input type="date" {...f.register('returnDate')} /></Field>
          <Field label="เหตุผล" required><Input {...f.register('reason')} /></Field>
        </FormGrid>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr><th className="px-3 py-2">รายการ</th><th className="w-36 px-2 text-right">น้ำหนัก (กก.)</th><th className="w-40 px-3 text-right">จำนวนเงิน (ไม่รวม VAT)</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.item.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">{r.item.species.nameTh}{r.item.grade ? ` ${r.item.grade.nameTh}` : ''} <span className="text-xs text-muted">· {r.item.trip.tripNo}</span></td>
                  <td className="px-2 py-1"><Input inputMode="decimal" className="text-right" aria-label="น้ำหนักที่คืน" disabled={!r.maxKg} {...f.register(`lines.${i}.weightKg`)} /><p className="text-right text-xs text-muted">สูงสุด {formatKg(r.maxKg)}</p></td>
                  <td className="px-3 py-1"><Input inputMode="decimal" className="text-right" aria-label="จำนวนเงินที่ลด" disabled={!r.maxAmt} {...f.register(`lines.${i}.amount`)} /><p className="text-right text-xs text-muted">สูงสุด {formatMoney(r.maxAmt)}</p></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">เว้นว่างรายการที่ไม่ลดหนี้</p>
      </div>
    </Dialog>
  );
}
