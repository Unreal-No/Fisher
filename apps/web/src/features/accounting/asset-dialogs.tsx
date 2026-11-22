import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { ASSET_CATEGORY_TH, assetDisposalSchema, fixedAssetSchema, formatMoney, PAYMENT_METHOD_TH, toISODate, toOptions } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Input, Select, Textarea } from '@/components/ui/input';
import { QueryView } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { dateInput } from '@/lib/utils';
import { INV, useAccounts, useBankAccounts } from './lookups';
import type { Account, AssetDetail, DepPreview, DepRun } from './types';

export const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const monthBE = (year: number, month: number) => `${MONTHS_TH[month - 1]} ${year + 543}`;
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const opts = (a: Account[] | undefined, f: (x: Account) => boolean) =>
  (a ?? []).filter((x) => x.isPostable && x.isActive && f(x)).sort((x, y) => x.code.localeCompare(y.code)).map((x) => ({ value: x.id, label: `${x.code} ${x.nameTh}` }));
const byCode = (a: Account[] | undefined, code: string) => (a ?? []).find((x) => x.code === code)?.id ?? '';

export function AssetDialog({ asset, onClose, onSaved }: { asset?: AssetDetail | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const accounts = useAccounts();
  const vessels = useVessels();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const a = accounts.data;
  const f = useForm<FieldValues>({
    resolver: zodResolver(fixedAssetSchema) as never,
    values: {
      name: asset?.name ?? '', category: asset?.category ?? 'VESSEL', vesselId: asset?.vessel?.id ?? '', acquisitionDate: dateInput(asset?.acquisitionDate) || toISODate(),
      cost: asset ? String(Number(asset.cost)) : '', salvageValue: asset ? String(Number(asset.salvageValue)) : '', usefulLifeMonths: asset ? String(asset.usefulLifeMonths) : '',
      assetAccountId: asset?.assetAccount.id ?? byCode(a, '1210'), accumDepAccountId: asset?.accumDepAccount.id ?? byCode(a, '1219'),
      depExpenseAccountId: asset?.depExpenseAccount.id ?? byCode(a, '5230'), serialNo: asset?.serialNo ?? '', notes: asset?.notes ?? '',
    },
    resetOptions: { keepDirtyValues: true },
  });
  const save = useAction(
    (v: FieldValues) => (asset ? api.put<{ id: string }>(`/accounting/assets/${asset.id}`, v) : api.post<{ id: string }>('/accounting/assets', v)),
    { success: 'บันทึกทรัพย์สินแล้ว', invalidate: INV, silentError: true, onSuccess: (r) => { onClose(); onSaved?.(r?.id ?? asset?.id ?? ''); } },
  );
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    return save.mutateAsync(v).catch((e) => setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ'));
  });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={asset ? `แก้ไขทรัพย์สิน ${asset.assetNo}` : 'เพิ่มทรัพย์สิน'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึก</Button></>}>
      {rootErr && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
      <FormGrid cols={3}>
        <Field label="ชื่อทรัพย์สิน" required error={e('name')}><Input {...f.register('name')} /></Field>
        <Field label="หมวด" required error={e('category')}><Select options={toOptions(ASSET_CATEGORY_TH)} {...f.register('category')} /></Field>
        <Field label="เรือ" error={e('vesselId')}><Select options={vesselOptions(vessels.data)} placeholder="-" {...f.register('vesselId')} /></Field>
        <Field label="วันที่ได้มา" required error={e('acquisitionDate')}><Input type="date" {...f.register('acquisitionDate')} /></Field>
        <Field label="ราคาทุน (บาท)" required error={e('cost')}><Input inputMode="decimal" className="text-right" {...f.register('cost')} /></Field>
        <Field label="มูลค่าซาก (บาท)" error={e('salvageValue')}><Input inputMode="decimal" className="text-right" {...f.register('salvageValue')} /></Field>
        <Field label="อายุการใช้งาน (เดือน)" required error={e('usefulLifeMonths')}><Input inputMode="numeric" className="text-right" {...f.register('usefulLifeMonths')} /></Field>
        <Field label="เลขทะเบียน/เลขเครื่อง" error={e('serialNo')}><Input {...f.register('serialNo')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')}><Textarea rows={1} {...f.register('notes')} /></Field>
        <Field label="บัญชีทรัพย์สิน" required error={e('assetAccountId')}><Select options={opts(a, (x) => x.type === 'ASSET' && x.normalBalance === 'DEBIT')} placeholder="เลือกบัญชี" {...f.register('assetAccountId')} /></Field>
        <Field label="บัญชีค่าเสื่อมสะสม" required error={e('accumDepAccountId')}><Select options={opts(a, (x) => x.type === 'ASSET' && x.normalBalance === 'CREDIT')} placeholder="เลือกบัญชี" {...f.register('accumDepAccountId')} /></Field>
        <Field label="บัญชีค่าเสื่อมราคา (ค่าใช้จ่าย)" required error={e('depExpenseAccountId')}><Select options={opts(a, (x) => x.type === 'EXPENSE')} placeholder="เลือกบัญชี" {...f.register('depExpenseAccountId')} /></Field>
      </FormGrid>
      <p className="mt-3 rounded border border-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
        เริ่มคิดค่าเสื่อมเดือนถัดจากวันที่ได้มา (ถ้าได้มาวันที่ 1 เริ่มเดือนนั้น) · การบันทึกทรัพย์สินไม่สร้างรายการบัญชีซื้อ — บันทึกการซื้อผ่านใบแจ้งหนี้ผู้ขาย (บัญชี 1210) หรือรายการบัญชี
      </p>
    </Dialog>
  );
}

export function DisposeDialog({ asset, onClose }: { asset: AssetDetail; onClose: () => void }) {
  const banks = useBankAccounts();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(assetDisposalSchema) as never,
    defaultValues: { disposedAt: toISODate(), proceeds: '', method: 'TRANSFER', bankAccountId: '', reason: '' },
  });
  const proceeds = num(f.watch('proceeds'));
  const method = f.watch('method') as string;
  const book = num(asset.bookValue);
  const gain = Math.round((proceeds - book) * 100) / 100;
  const save = useAction((v: FieldValues) => api.post(`/accounting/assets/${asset.id}/dispose`, v), { success: 'จำหน่ายทรัพย์สินแล้ว', invalidate: INV, silentError: true, onSuccess: onClose });
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    return save.mutateAsync(v).catch((er) => setRootErr(er instanceof ApiError ? er.message : 'บันทึกไม่สำเร็จ'));
  });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={`จำหน่าย/ตัดบัญชี ${asset.assetNo}`}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button variant="danger" loading={save.isPending} onClick={submit}>ยืนยันจำหน่าย</Button></>}>
      {rootErr && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
      <FormGrid cols={2}>
        <Field label="วันที่จำหน่าย" required error={e('disposedAt')}><Input type="date" {...f.register('disposedAt')} /></Field>
        <Field label="เงินที่ได้รับ (บาท)" error={e('proceeds')} hint="เว้นว่าง = ตัดบัญชีโดยไม่ได้รับเงิน"><Input inputMode="decimal" className="text-right" {...f.register('proceeds')} /></Field>
        <Field label="วิธีรับเงิน" error={e('method')}><Select options={toOptions(PAYMENT_METHOD_TH)} {...f.register('method')} /></Field>
        <Field label="บัญชีธนาคาร" required={proceeds > 0 && method !== 'CASH'} error={e('bankAccountId')}>
          <Select options={(banks.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} placeholder="-" {...f.register('bankAccountId')} />
        </Field>
        <Field label="เหตุผล" required error={e('reason')} className="sm:col-span-2"><Textarea rows={2} {...f.register('reason')} /></Field>
      </FormGrid>
      <dl className="mt-4 space-y-0.5 rounded border border-line bg-slate-50 px-3 py-2 text-sm">
        <div className="flex justify-between"><dt className="text-muted">มูลค่าตามบัญชีปัจจุบัน</dt><dd className="tabular-nums">{formatMoney(book)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">เงินที่ได้รับ</dt><dd className="tabular-nums">{formatMoney(proceeds)}</dd></div>
        <div className={`flex justify-between font-semibold ${gain < 0 ? 'text-bad' : 'text-ok'}`}><dt>{gain < 0 ? 'ขาดทุนจากการจำหน่าย' : 'กำไรจากการจำหน่าย'}</dt><dd className="tabular-nums">{formatMoney(Math.abs(gain))}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted">ประมาณการเบื้องต้น — ระบบคำนวณค่าเสื่อมจริงตอนบันทึก (ต้องคิดค่าเสื่อมถึงเดือนที่จำหน่ายก่อน)</p>
    </Dialog>
  );
}

export function DepreciationDialog({ runs, onClose }: { runs: DepRun[]; onClose: () => void }) {
  const now = new Date();
  const latest = runs.reduce<DepRun | null>((m, r) => (!m || r.year * 12 + r.month > m.year * 12 + m.month ? r : m), null);
  const init = latest ? { y: latest.month === 12 ? latest.year + 1 : latest.year, m: latest.month === 12 ? 1 : latest.month + 1 } : { y: now.getFullYear(), m: now.getMonth() + 1 };
  const [year, setYear] = useState(init.y);
  const [month, setMonth] = useState(init.m);
  const [rootErr, setRootErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['accounting', 'dep-preview', year, month], queryFn: () => api.get<DepPreview>('/accounting/depreciation/preview', { year, month }) });
  const run = useAction(() => api.post('/accounting/depreciation/runs', { year, month }), { success: 'คิดค่าเสื่อมราคาแล้ว', invalidate: INV, silentError: true, onSuccess: onClose });
  const years = Array.from({ length: 8 }, (_, i) => now.getFullYear() + 1 - i);
  if (!years.includes(year)) years.push(year);
  const th = 'px-3 py-2';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title="คิดค่าเสื่อมราคา"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button>
        <Button loading={run.isPending} disabled={!q.data || q.data.items.length === 0} onClick={() => { setRootErr(null); run.mutateAsync(undefined).catch((e) => setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')); }}>ยืนยันคิดค่าเสื่อม</Button></>}>
      {rootErr && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-2 [&_select]:w-auto">
        <Select aria-label="เดือน" options={MONTHS_TH.map((m, i) => ({ value: String(i + 1), label: m }))} value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} />
        <Select aria-label="ปี พ.ศ." options={years.sort((x, y) => y - x).map((y) => ({ value: String(y), label: String(y + 543) }))} value={String(year)} onChange={(e) => setYear(Number(e.target.value))} />
      </div>
      <QueryView q={q}>
        {(d) => (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>เลขที่</th><th className={th}>ทรัพย์สิน</th><th className={`${th} text-right`}>สะสมก่อนหน้า</th><th className={`${th} text-right`}>ค่าเสื่อมเดือนนี้</th></tr></thead>
              <tbody>
                {d.items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">ไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อมใน {monthBE(year, month)}</td></tr>}
                {d.items.map((i) => (
                  <tr key={i.assetId} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5">{i.assetNo}</td><td className="px-3">{i.name}</td><td className="px-3 text-right tabular-nums">{formatMoney(i.before)}</td><td className="px-3 text-right tabular-nums">{formatMoney(i.amount)}</td></tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-slate-50 font-semibold"><tr><td colSpan={3} className={`${th} text-right`}>รวม {monthBE(year, month)}</td><td className={`${th} text-right tabular-nums`}>{formatMoney(d.total)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </QueryView>
    </Dialog>
  );
}
