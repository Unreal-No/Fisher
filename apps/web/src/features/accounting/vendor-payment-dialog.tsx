import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDate, formatMoney, PAYMENT_METHOD_TH, toOptions, vendorPaymentSchema, WHT_RATES } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { fromLocalInput, toLocalInput } from '@/lib/utils';
import { useSuppliers } from '@/features/purchasing/purchasing-dialogs';
import { INV, useBankAccounts } from './lookups';
import type { BillRow } from './types';

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function VendorPaymentDialog({ onClose }: { onClose: () => void }) {
  const suppliers = useSuppliers();
  const banks = useBankAccounts();
  const [supplierId, setSupplierId] = useState('');
  const [paidAt, setPaidAt] = useState(toLocalInput());
  const [method, setMethod] = useState('TRANSFER');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [whtRate, setWhtRate] = useState('');
  const [whtBaseEdit, setWhtBaseEdit] = useState<string | null>(null);
  const [alloc, setAlloc] = useState<Record<string, { on: boolean; amount: string }>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [rootErr, setRootErr] = useState<string | null>(null);
  const bills = useQuery({
    queryKey: ['accounting', 'ap-open-bills', supplierId],
    queryFn: () => api.get<{ items: BillRow[] }>('/accounting/ap/bills', { supplierId, openOnly: 'true', pageSize: 100 }).then((r) => r.items),
    enabled: !!supplierId,
  });
  const rows = bills.data ?? [];
  const amt = (b: BillRow) => alloc[b.id]?.amount ?? '';
  const sel = rows.filter((b) => alloc[b.id]?.on);
  const gross = r2(sel.reduce((s, b) => s + num(amt(b)), 0));
  // pre-VAT share of what is being paid on each bill
  const defaultBase = r2(sel.reduce((s, b) => s + (num(b.total) ? (num(amt(b)) * num(b.subtotal)) / num(b.total) : 0), 0));
  const baseStr = whtBaseEdit ?? (defaultBase ? String(defaultBase) : '');
  const rate = num(whtRate);
  const wht = rate > 0 ? r2((num(baseStr) * rate) / 100) : 0;
  const net = r2(gross - wht);
  const save = useAction((v: unknown) => api.post('/accounting/ap/payments', v), { success: 'บันทึกการจ่ายชำระแล้ว', invalidate: INV, silentError: true, onSuccess: onClose });
  const toggle = (b: BillRow, on: boolean) => setAlloc((a) => ({ ...a, [b.id]: { on, amount: a[b.id]?.amount || b.outstanding } }));
  const submit = () => {
    setRootErr(null);
    const body = {
      supplierId, paidAt: paidAt ? fromLocalInput(paidAt) : '', method, bankAccountId, reference, notes, whtRate, whtBase: rate > 0 ? baseStr : '',
      allocations: sel.map((b) => ({ billId: b.id, amount: amt(b) })),
    };
    const p = vendorPaymentSchema.safeParse(body);
    if (!p.success) {
      const m: Record<string, string> = {};
      for (const i of p.error.issues) m[String(i.path[0])] ??= i.message;
      setErrs(m);
      return;
    }
    const over = sel.find((b) => num(amt(b)) > num(b.outstanding) + 0.001);
    if (over) { setErrs({ allocations: `${over.billNo}: จ่ายเกินยอดค้างชำระ` }); return; }
    setErrs({});
    save.mutateAsync(p.data).catch((e) => setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ'));
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title="จ่ายชำระเจ้าหนี้"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึกการจ่าย</Button></>}>
      {rootErr && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
      <FormGrid cols={3}>
        <Field label="ผู้ขาย" required error={errs.supplierId}>
          <Select options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} placeholder="เลือกผู้ขาย" value={supplierId}
            onChange={(e) => { setSupplierId(e.target.value); setAlloc({}); setWhtBaseEdit(null); }} />
        </Field>
        <Field label="วันเวลาที่จ่าย" required error={errs.paidAt}><Input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        <Field label="วิธีจ่าย" required error={errs.method}><Select options={toOptions(PAYMENT_METHOD_TH)} value={method} onChange={(e) => setMethod(e.target.value)} /></Field>
        <Field label="บัญชีธนาคาร" required={method !== 'CASH'} error={errs.bankAccountId}>
          <Select options={(banks.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} placeholder={method === 'CASH' ? 'เงินสด' : 'เลือกบัญชี'} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} />
        </Field>
        <Field label="เลขอ้างอิง" error={errs.reference}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="หมายเหตุ" error={errs.notes}><Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </FormGrid>
      <div className="mt-4 overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr><th className="w-10 px-2 py-2" /><th className="px-2">ใบแจ้งหนี้</th><th className="px-2">ครบกำหนด</th><th className="px-2 text-right">รวม</th><th className="px-2 text-right">ค้างชำระ</th><th className="w-36 px-2 text-right">จ่ายครั้งนี้</th></tr>
          </thead>
          <tbody>
            {!supplierId && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">เลือกผู้ขายเพื่อแสดงใบแจ้งหนี้ค้างชำระ</td></tr>}
            {supplierId && !bills.isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">ไม่มีใบแจ้งหนี้ค้างชำระ</td></tr>}
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="px-2 py-1.5"><input type="checkbox" aria-label={`เลือก ${b.billNo}`} checked={!!alloc[b.id]?.on} onChange={(e) => toggle(b, e.target.checked)} /></td>
                <td className="px-2 py-1.5">{b.billNo} <span className="text-xs text-muted">({b.supplierInvoiceNo})</span></td>
                <td className="whitespace-nowrap px-2 py-1.5">{b.dueDate ? formatDate(b.dueDate) : '-'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(b.total)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(b.outstanding)}</td>
                <td className="px-2 py-1.5">
                  <Input inputMode="decimal" className="text-right" disabled={!alloc[b.id]?.on} value={alloc[b.id]?.amount ?? ''}
                    onChange={(e) => setAlloc((a) => ({ ...a, [b.id]: { on: true, amount: e.target.value } }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errs.allocations && <p className="mt-1 text-xs text-bad">{errs.allocations}</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="หัก ณ ที่จ่าย (%)" error={errs.whtRate}>
          <Select options={WHT_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} placeholder="ไม่หัก" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} />
        </Field>
        <Field label="ฐานภาษี (ก่อน VAT)" error={errs.whtBase} hint="แก้ไขได้">
          <Input inputMode="decimal" className="text-right" disabled={!(rate > 0)} value={rate > 0 ? baseStr : ''} onChange={(e) => setWhtBaseEdit(e.target.value)} />
        </Field>
        <dl className="space-y-0.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">รวมตัดหนี้</dt><dd className="tabular-nums">{formatMoney(gross)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">หัก ณ ที่จ่าย</dt><dd className="tabular-nums">{formatMoney(wht)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>จ่ายสุทธิ</dt><dd className="tabular-nums">{formatMoney(net)}</dd></div>
        </dl>
      </div>
    </Dialog>
  );
}
