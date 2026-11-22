import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { ACCOUNT_MAP_KEY, ACCOUNT_MAP_KEY_TH, ACCOUNT_TYPE_TH, accountSchema, NORMAL_BALANCE_TH, toOptions } from '@fisher/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { accountOptions, INV, useAccounts } from './lookups';
import type { Account, Mapping } from './types';
import { useQuery } from '@tanstack/react-query';

function AccountDialog({ account, all, onClose }: { account: Account | null; all: Account[]; onClose: () => void }) {
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(accountSchema) as never,
    defaultValues: {
      code: account?.code ?? '', nameTh: account?.nameTh ?? '', nameEn: account?.nameEn ?? '', type: account?.type ?? 'ASSET', normalBalance: account?.normalBalance ?? 'DEBIT',
      parentId: account?.parentId ?? '', isPostable: account?.isPostable ?? true, isActive: account?.isActive ?? true, description: account?.description ?? '',
    },
  });
  const type = f.watch('type');
  const parents = all.filter((a) => !a.isPostable && a.type === type && a.id !== account?.id).sort((a, b) => a.code.localeCompare(b.code));
  const save = useAction((v: FieldValues) => (account ? api.put(`/accounting/accounts/${account.id}`, v) : api.post('/accounting/accounts', v)), {
    success: 'บันทึกบัญชีแล้ว', invalidate: INV, silentError: true, onSuccess: onClose,
  });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync(v).catch((e) => setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={account ? `แก้ไขบัญชี ${account.code}` : 'เพิ่มบัญชี'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึก</Button></>}>
      {rootErr && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
      <FormGrid cols={2}>
        <Field label="รหัสบัญชี" required error={e('code')} hint="ตัวเลข 4–6 หลัก"><Input {...f.register('code')} /></Field>
        <Field label="ชื่อบัญชี (ไทย)" required error={e('nameTh')}><Input {...f.register('nameTh')} /></Field>
        <Field label="ชื่อบัญชี (อังกฤษ)" error={e('nameEn')}><Input {...f.register('nameEn')} /></Field>
        <Field label="หมวดบัญชี" required error={e('type')}><Select options={toOptions(ACCOUNT_TYPE_TH)} {...f.register('type')} /></Field>
        <Field label="ด้านปกติ" required error={e('normalBalance')}><Select options={toOptions(NORMAL_BALANCE_TH)} {...f.register('normalBalance')} /></Field>
        <Field label="บัญชีแม่" error={e('parentId')} hint="เฉพาะบัญชีหัวข้อหมวดเดียวกัน"><Select options={parents.map((p) => ({ value: p.id, label: `${p.code} ${p.nameTh}` }))} placeholder="ไม่มี" {...f.register('parentId')} /></Field>
        <Field label="คำอธิบาย" error={e('description')} className="sm:col-span-2"><Textarea rows={2} {...f.register('description')} /></Field>
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Checkbox label="ลงบัญชีได้ (ไม่ใช่บัญชีหัวข้อ)" {...f.register('isPostable')} />
          <Checkbox label="ใช้งาน" {...f.register('isActive')} />
        </div>
      </FormGrid>
    </Dialog>
  );
}

function MappingsPanel({ canApprove, accounts }: { canApprove: boolean; accounts: Account[] }) {
  const q = useQuery({ queryKey: ['accounting', 'mappings'], queryFn: () => api.get<Mapping[]>('/accounting/mappings') });
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setVals(Object.fromEntries(q.data.map((m) => [m.key, m.account?.id ?? ''])));
  }, [q.data]);
  const opts = accountOptions(accounts);
  const save = useAction(() => api.put('/accounting/mappings', { mappings: Object.fromEntries(Object.entries(vals).filter(([, v]) => v)) }), {
    success: 'บันทึกการกำหนดบัญชีแล้ว', invalidate: INV,
  });
  return (
    <Panel title="บัญชีสำหรับลงอัตโนมัติ" actions={canApprove && <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>บันทึก</Button>}>
      <QueryView q={q}>
        {() => (
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            {ACCOUNT_MAP_KEY.map((k) => (
              <Field key={k} label={ACCOUNT_MAP_KEY_TH[k]}>
                <Select options={opts} placeholder="ยังไม่กำหนด" disabled={!canApprove} value={vals[k] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
        )}
      </QueryView>
    </Panel>
  );
}

export function AccountsTab({ canApprove }: { canApprove: boolean }) {
  const q = useAccounts();
  const [dlg, setDlg] = useState<{ account: Account | null } | null>(null);
  const rows = useMemo(() => {
    const list = [...(q.data ?? [])].sort((a, b) => a.code.localeCompare(b.code));
    const byId = new Map(list.map((a) => [a.id, a]));
    const depth = (a: Account) => { let d = 0; let p = a.parentId ? byId.get(a.parentId) : undefined; while (p && d < 10) { d++; p = p.parentId ? byId.get(p.parentId) : undefined; } return d; };
    return list.map((a) => ({ a, d: depth(a) }));
  }, [q.data]);
  return (
    <div className="space-y-4">
      <Panel title={`ผังบัญชี (${rows.length})`} bodyClass="p-0" actions={canApprove && <Button size="sm" onClick={() => setDlg({ account: null })}><Plus /> เพิ่มบัญชี</Button>}>
        <QueryView q={q}>
          {() => rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600">
                  <tr><th className="px-4 py-2">รหัส</th><th className="px-2">ชื่อบัญชี</th><th className="px-2">หมวด</th><th className="px-2">ด้านปกติ</th><th className="px-2">ประเภท</th><th className="px-2">สถานะ</th><th className="px-2 text-right">รายการ</th><th className="px-2">ใช้ลงอัตโนมัติ</th><th className="px-2" /></tr>
                </thead>
                <tbody>
                  {rows.map(({ a, d }) => (
                    <tr key={a.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{a.code}</td>
                      <td className={`whitespace-nowrap px-2 py-2 ${a.isPostable ? '' : 'font-semibold'}`} style={{ paddingLeft: 8 + d * 16 }}>{a.nameTh}</td>
                      <td className="whitespace-nowrap px-2 py-2">{ACCOUNT_TYPE_TH[a.type]}</td>
                      <td className="whitespace-nowrap px-2 py-2">{NORMAL_BALANCE_TH[a.normalBalance]}</td>
                      <td className="whitespace-nowrap px-2 py-2">{a.isPostable ? 'ลงบัญชีได้' : 'หัวข้อ'}</td>
                      <td className="px-2 py-2"><Badge tone={a.isActive ? 'ok' : 'neutral'}>{a.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge></td>
                      <td className="px-2 py-2 text-right tabular-nums">{a.lineCount}</td>
                      <td className="px-2 py-2"><div className="flex flex-wrap gap-1">{a.mappedAs.map((m) => <Badge key={m} tone="info">{ACCOUNT_MAP_KEY_TH[m as keyof typeof ACCOUNT_MAP_KEY_TH] ?? m}</Badge>)}</div></td>
                      <td className="px-2 py-2 text-right">{canApprove && <Button size="icon" variant="ghost" aria-label="แก้ไขบัญชี" onClick={() => setDlg({ account: a })}><Pencil /></Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty />}
        </QueryView>
      </Panel>
      <MappingsPanel canApprove={canApprove} accounts={q.data ?? []} />
      {dlg && <AccountDialog account={dlg.account} all={q.data ?? []} onClose={() => setDlg(null)} />}
    </div>
  );
}
