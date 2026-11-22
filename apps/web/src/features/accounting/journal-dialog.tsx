import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { formatMoney, journalSchema, toISODate } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Input, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { dateInput } from '@/lib/utils';
import { accountOptions, INV, useAccounts } from './lookups';
import type { JournalDetail } from './types';

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const emptyLine = { accountId: '', debit: '', credit: '', description: '', vesselId: '' };

export function JournalDialog({ entry, onClose, onSaved }: { entry?: JournalDetail | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const accounts = useAccounts();
  const vessels = useVessels();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(journalSchema) as never,
    defaultValues: {
      entryDate: dateInput(entry?.entryDate) || toISODate(),
      memo: entry?.memo ?? '',
      reference: entry?.reference ?? '',
      lines: entry
        ? entry.lines.map((l) => ({
          accountId: l.account.id, debit: num(l.debit) ? String(num(l.debit)) : '', credit: num(l.credit) ? String(num(l.credit)) : '',
          description: l.description ?? '', vesselId: l.vessel?.id ?? '',
        }))
        : [{ ...emptyLine }, { ...emptyLine }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: f.control, name: 'lines' });
  const watched = (f.watch('lines') ?? []) as { debit?: string; credit?: string }[];
  const dr = r2(watched.reduce((s, l) => s + num(l.debit), 0));
  const cr = r2(watched.reduce((s, l) => s + num(l.credit), 0));
  const diff = r2(dr - cr);
  const balanced = dr > 0 && diff === 0;
  const opts = accountOptions(accounts.data);
  const save = useAction(
    (v: FieldValues) => (entry ? api.put<{ id: string }>(`/accounting/journals/${entry.id}`, v) : api.post<{ id: string }>('/accounting/journals', v)),
    { success: 'บันทึกรายการบัญชีแล้ว', invalidate: INV, silentError: true, onSuccess: (r) => { onClose(); onSaved?.(r?.id ?? entry?.id ?? ''); } },
  );
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    return save.mutateAsync(v).catch((e) => setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ'));
  });
  const e = (k: string) => errOf(f.formState.errors, k);
  const linesErr = e('lines') ?? e('lines.root');
  return (
    <Dialog
      open onOpenChange={(o) => !o && onClose()} size="xl" title={entry ? `แก้ไขรายการบัญชี ${entry.entryNo}` : 'บันทึกรายการบัญชี'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} disabled={!balanced} onClick={submit}>บันทึกเป็นร่าง</Button></>}
    >
      {rootErr && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
      <FormGrid cols={3}>
        <Field label="วันที่" required error={e('entryDate')}><Input type="date" {...f.register('entryDate')} /></Field>
        <Field label="คำอธิบายรายการ" required error={e('memo')} className="sm:col-span-1 lg:col-span-1"><Input {...f.register('memo')} /></Field>
        <Field label="เลขอ้างอิง" error={e('reference')}><Input {...f.register('reference')} /></Field>
      </FormGrid>
      <div className="mt-4 overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr><th className="w-8 px-2 py-2">#</th><th className="px-2">บัญชี</th><th className="w-32 px-2 text-right">เดบิต</th><th className="w-32 px-2 text-right">เครดิต</th><th className="px-2">คำอธิบาย</th><th className="w-44 px-2">เรือ</th><th className="w-10" /></tr>
          </thead>
          <tbody>
            {fields.map((fl, i) => (
              <tr key={fl.id} className="border-t border-line align-top">
                <td className="px-2 py-2 text-muted">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <Select options={opts} placeholder="เลือกบัญชี" aria-invalid={!!e(`lines.${i}.accountId`)} {...f.register(`lines.${i}.accountId`)} />
                  {e(`lines.${i}.accountId`) && <p className="text-xs text-bad">{e(`lines.${i}.accountId`)}</p>}
                </td>
                <td className="px-2 py-1.5">
                  <Input inputMode="decimal" className="text-right" aria-invalid={!!e(`lines.${i}.debit`)} {...f.register(`lines.${i}.debit`)} />
                  {e(`lines.${i}.debit`) && <p className="text-xs text-bad">{e(`lines.${i}.debit`)}</p>}
                </td>
                <td className="px-2 py-1.5"><Input inputMode="decimal" className="text-right" {...f.register(`lines.${i}.credit`)} /></td>
                <td className="px-2 py-1.5"><Input {...f.register(`lines.${i}.description`)} /></td>
                <td className="px-2 py-1.5"><Select options={vesselOptions(vessels.data)} placeholder="-" {...f.register(`lines.${i}.vesselId`)} /></td>
                <td className="px-1 py-1.5">
                  <Button type="button" size="icon" variant="ghost" aria-label="ลบบรรทัด" disabled={fields.length <= 2} onClick={() => remove(i)}><Trash2 /></Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-slate-50 font-semibold">
            <tr>
              <td colSpan={2} className="px-2 py-2 text-right">รวม</td>
              <td className="px-2 text-right tabular-nums">{formatMoney(dr)}</td>
              <td className="px-2 text-right tabular-nums">{formatMoney(cr)}</td>
              <td colSpan={3} className={`px-2 ${diff === 0 && dr > 0 ? 'text-ok' : 'text-bad'}`}>
                {diff === 0 ? (dr > 0 ? 'สมดุล' : 'ยังไม่มียอด') : `ผลต่าง ${formatMoney(Math.abs(diff))} (${diff > 0 ? 'เดบิตมากกว่า' : 'เครดิตมากกว่า'})`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {linesErr && <p className="mt-1 text-xs text-bad">{linesErr}</p>}
      <div className="mt-2"><Button type="button" size="sm" variant="outline" onClick={() => append({ ...emptyLine })}><Plus /> เพิ่มบรรทัด</Button></div>
    </Dialog>
  );
}
