import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { BILL_LINE_KIND_TH, formatDate, formatMoney, toISODate, toOptions, vendorBillSchema } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { dateInput } from '@/lib/utils';
import { useSuppliers } from '@/features/purchasing/purchasing-dialogs';
import { accountOptions, INV, useAccounts } from './lookups';
import type { BillDetail, UnbilledReceipt } from './types';

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
type WLine = { kind?: string; goodsReceiptId?: string; amount?: string };

export function VendorBillDialog({ bill, onClose, onSaved }: { bill?: BillDetail | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const suppliers = useSuppliers();
  const accounts = useAccounts();
  const vessels = useVessels();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(vendorBillSchema) as never,
    defaultValues: {
      supplierId: bill?.supplier.id ?? '', supplierInvoiceNo: bill?.supplierInvoiceNo ?? '', billDate: dateInput(bill?.billDate) || toISODate(),
      dueDate: dateInput(bill?.dueDate), vatRate: bill ? String(Number(bill.vatRate)) : '7', notes: bill?.notes ?? '',
      lines: bill
        ? bill.lines.map((l) => ({
          kind: l.kind, goodsReceiptId: l.goodsReceipt?.id ?? '', accountId: l.account?.id ?? '', amount: l.kind === 'EXPENSE' ? String(Number(l.amount)) : '',
          description: l.description ?? '', vesselId: l.vessel?.id ?? '',
        }))
        : [{ kind: 'GR', goodsReceiptId: '', accountId: '', amount: '', description: '', vesselId: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: f.control, name: 'lines' });
  const supplierId = f.watch('supplierId') as string;
  const lines = (f.watch('lines') ?? []) as WLine[];
  const vatRate = num(f.watch('vatRate'));
  const unbilled = useQuery({
    queryKey: ['accounting', 'unbilled', supplierId, bill?.id],
    queryFn: () => api.get<UnbilledReceipt[]>('/accounting/ap/unbilled-receipts', { supplierId, billId: bill?.id }),
    enabled: !!supplierId,
  });
  const grMap = new Map((unbilled.data ?? []).map((r) => [r.id, r]));
  // reset GR picks when supplier changes
  const prev = useRef(supplierId);
  useEffect(() => {
    if (prev.current !== supplierId) {
      prev.current = supplierId;
      lines.forEach((l, i) => l.kind === 'GR' && f.setValue(`lines.${i}.goodsReceiptId`, ''));
    }
  });
  const lineAmt = (l: WLine) => (l.kind === 'GR' ? num(grMap.get(l.goodsReceiptId ?? '')?.amount) : num(l.amount));
  const subtotal = r2(lines.reduce((s, l) => s + lineAmt(l), 0));
  const vat = r2((subtotal * vatRate) / 100);
  const acctOpts = accountOptions(accounts.data);
  const save = useAction(
    (v: FieldValues) => (bill ? api.put<{ id: string }>(`/accounting/ap/bills/${bill.id}`, v) : api.post<{ id: string }>('/accounting/ap/bills', v)),
    { success: 'บันทึกใบแจ้งหนี้แล้ว', invalidate: INV, silentError: true, onSuccess: (r) => { onClose(); onSaved?.(r?.id ?? bill?.id ?? ''); } },
  );
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    const body = {
      ...v,
      lines: (v.lines as FieldValues[]).map((l) => (l.kind === 'GR'
        ? { kind: 'GR', goodsReceiptId: l.goodsReceiptId }
        : { kind: 'EXPENSE', accountId: l.accountId, amount: l.amount, description: l.description, vesselId: l.vesselId })),
    };
    return save.mutateAsync(body).catch((e) => setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ'));
  });
  const e = (k: string) => errOf(f.formState.errors, k);
  const linesErr = e('lines') ?? e('lines.root');
  const picked = (i: number) => new Set(lines.filter((_, j) => j !== i).map((l) => l.goodsReceiptId).filter(Boolean));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={bill ? `แก้ไขใบแจ้งหนี้ ${bill.billNo}` : 'บันทึกใบแจ้งหนี้ผู้ขาย'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึกเป็นร่าง</Button></>}>
      {rootErr && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
      <FormGrid cols={3}>
        <Field label="ผู้ขาย" required error={e('supplierId')}>
          <Select options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} placeholder="เลือกผู้ขาย" {...f.register('supplierId')} />
        </Field>
        <Field label="เลขที่ใบแจ้งหนี้ผู้ขาย" required error={e('supplierInvoiceNo')}><Input {...f.register('supplierInvoiceNo')} /></Field>
        <Field label="VAT (%)" error={e('vatRate')}><Input inputMode="decimal" {...f.register('vatRate')} /></Field>
        <Field label="วันที่ใบแจ้งหนี้" required error={e('billDate')}><Input type="date" {...f.register('billDate')} /></Field>
        <Field label="วันครบกำหนด" error={e('dueDate')}><Input type="date" {...f.register('dueDate')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')}><Textarea rows={1} {...f.register('notes')} /></Field>
      </FormGrid>
      <div className="mt-4 overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr><th className="w-8 px-2 py-2">#</th><th className="w-40 px-2">ประเภท</th><th className="px-2">ใบรับสินค้า / บัญชี</th><th className="px-2">คำอธิบาย</th><th className="w-40 px-2">เรือ</th><th className="w-32 px-2 text-right">จำนวนเงิน</th><th className="w-10" /></tr>
          </thead>
          <tbody>
            {fields.map((fl, i) => {
              const l = lines[i] ?? {};
              const isGr = l.kind === 'GR';
              const used = picked(i);
              return (
                <tr key={fl.id} className="border-t border-line align-top">
                  <td className="px-2 py-2 text-muted">{i + 1}</td>
                  <td className="px-2 py-1.5"><Select options={toOptions(BILL_LINE_KIND_TH)} {...f.register(`lines.${i}.kind`)} /></td>
                  <td className="px-2 py-1.5">
                    {isGr ? (
                      <>
                        <Select placeholder={supplierId ? 'เลือกใบรับสินค้า' : 'เลือกผู้ขายก่อน'} aria-invalid={!!e(`lines.${i}.goodsReceiptId`)}
                          options={(unbilled.data ?? []).filter((r) => !used.has(r.id)).map((r) => ({ value: r.id, label: `${r.grNo} · ${r.poNo} · ${formatDate(r.receivedAt)}` }))}
                          {...f.register(`lines.${i}.goodsReceiptId`)} />
                        {e(`lines.${i}.goodsReceiptId`) && <p className="text-xs text-bad">{e(`lines.${i}.goodsReceiptId`)}</p>}
                      </>
                    ) : (
                      <>
                        <Select options={acctOpts} placeholder="เลือกบัญชี" {...f.register(`lines.${i}.accountId`)} />
                        {e(`lines.${i}.accountId`) && <p className="text-xs text-bad">{e(`lines.${i}.accountId`)}</p>}
                      </>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{isGr ? <span className="text-muted">{grMap.get(l.goodsReceiptId ?? '')?.supplierInvoiceNo ?? ''}</span> : <Input {...f.register(`lines.${i}.description`)} />}</td>
                  <td className="px-2 py-1.5">{isGr ? null : <Select options={vesselOptions(vessels.data)} placeholder="-" {...f.register(`lines.${i}.vesselId`)} />}</td>
                  <td className="px-2 py-1.5">
                    {isGr ? <div className="py-2 text-right tabular-nums">{lineAmt(l) ? formatMoney(lineAmt(l)) : '-'}</div> : (
                      <>
                        <Input inputMode="decimal" className="text-right" aria-invalid={!!e(`lines.${i}.amount`)} {...f.register(`lines.${i}.amount`)} />
                        {e(`lines.${i}.amount`) && <p className="text-xs text-bad">{e(`lines.${i}.amount`)}</p>}
                      </>
                    )}
                  </td>
                  <td className="px-1 py-1.5"><Button type="button" size="icon" variant="ghost" aria-label="ลบบรรทัด" disabled={fields.length <= 1} onClick={() => remove(i)}><Trash2 /></Button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line bg-slate-50">
            <tr><td colSpan={5} className="px-2 py-1.5 text-right">รวมก่อน VAT</td><td className="px-2 text-right tabular-nums">{formatMoney(subtotal)}</td><td /></tr>
            <tr><td colSpan={5} className="px-2 py-1.5 text-right">VAT {vatRate}%</td><td className="px-2 text-right tabular-nums">{formatMoney(vat)}</td><td /></tr>
            <tr className="font-semibold"><td colSpan={5} className="px-2 py-2 text-right">รวมทั้งสิ้น</td><td className="px-2 text-right tabular-nums">{formatMoney(r2(subtotal + vat))}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      {linesErr && <p className="mt-1 text-xs text-bad">{linesErr}</p>}
      <div className="mt-2"><Button type="button" size="sm" variant="outline" onClick={() => append({ kind: 'GR', goodsReceiptId: '', accountId: '', amount: '', description: '', vesselId: '' })}><Plus /> เพิ่มรายการ</Button></div>
    </Dialog>
  );
}
