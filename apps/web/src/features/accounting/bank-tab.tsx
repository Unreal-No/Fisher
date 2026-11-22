import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { bankAccountSchema, bankRecSchema, formatDate, formatMoney, toISODate } from '@fisher/shared';
import { FilterBar } from '@/components/filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { api } from '@/lib/api';
import { useAction, type useListParams } from '@/lib/hooks';
import { INV, useAccounts, useBankAccounts } from './lookups';
import { RecStatusBadge } from './status';
import type { BankAccount, BankRecRow } from './types';

type LP = ReturnType<typeof useListParams>;
const ac = createColumnHelper<BankAccount>();
const rc = createColumnHelper<BankRecRow>();

export function BankTab({ lp, canEdit, canApprove }: { lp: LP; canEdit: boolean; canApprove: boolean }) {
  const nav = useNavigate();
  const banks = useBankAccounts();
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null);
  const [rec, setRec] = useState(false);
  const bankId = lp.get('bank');
  const recs = useQuery({
    queryKey: ['accounting', 'bank-recs', bankId],
    queryFn: () => api.get<BankRecRow[]>('/accounting/bank-recs', { bankAccountId: bankId || undefined }),
    placeholderData: keepPreviousData,
  });
  const acols = [
    ac.accessor('code', { header: 'รหัส' }), ac.accessor('name', { header: 'ชื่อบัญชี' }), ac.accessor('bankName', { header: 'ธนาคาร' }), ac.accessor('accountNo', { header: 'เลขที่บัญชี' }),
    ac.display({ id: 'gl', header: 'บัญชีแยกประเภท', cell: ({ row: { original: r } }) => `${r.glAccount.code} ${r.glAccount.nameTh}` }),
    ac.accessor('isActive', { header: 'สถานะ', cell: (i) => <Badge tone={i.getValue() ? 'ok' : 'neutral'}>{i.getValue() ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge> }),
    ac.display({ id: 'act', header: '', cell: ({ row: { original: r } }) => (canApprove ? <Button size="sm" variant="ghost" aria-label="แก้ไข" onClick={() => setEditing(r)}><Pencil /></Button> : null) }),
  ];
  const rcols = [
    rc.display({ id: 'bank', header: 'บัญชีธนาคาร', cell: ({ row: { original: r } }) => `${r.bankAccount.code} ${r.bankAccount.name}` }),
    rc.accessor('statementDate', { header: 'วันที่รายการเดินบัญชี', cell: (i) => formatDate(i.getValue()) }),
    rc.accessor('statementBalance', { header: 'ยอดตาม Statement', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    rc.accessor('_count', { header: 'รายการที่กระทบ', meta: { align: 'right' }, cell: (i) => i.getValue().items }),
    rc.accessor('status', { header: 'สถานะ', cell: (i) => <RecStatusBadge s={i.getValue()} /> }),
  ];
  return (
    <div className="space-y-4">
      <Panel title="บัญชีธนาคาร" bodyClass="p-0" actions={canApprove && <Button size="sm" onClick={() => setEditing('new')}><Plus /> เพิ่มบัญชี</Button>}>
        <DataTable columns={acols} data={banks.data} loading={banks.isFetching} error={banks.error} />
      </Panel>
      <div>
        <FilterBar>
          <h2 className="text-sm font-semibold text-navy-900">การกระทบยอดธนาคาร</h2>
          <Select options={(banks.data ?? []).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} placeholder="ทุกบัญชี" value={bankId} onChange={(e) => lp.set({ bank: e.target.value })} aria-label="บัญชีธนาคาร" />
          {canEdit && <Button className="ml-auto" disabled={!banks.data?.length} onClick={() => setRec(true)}><Plus /> เริ่มกระทบยอด</Button>}
        </FilterBar>
        <DataTable columns={rcols} data={recs.data} loading={recs.isFetching} error={recs.error} onRowClick={(r) => nav(`/accounting/bank-recs/${r.id}`)} />
      </div>
      {editing && <BankAccountDialog account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {rec && <BankRecDialog defaultBank={bankId} onClose={() => setRec(false)} onSaved={(id) => id && nav(`/accounting/bank-recs/${id}`)} />}
    </div>
  );
}

function BankAccountDialog({ account: a, onClose }: { account: BankAccount | null; onClose: () => void }) {
  const accounts = useAccounts();
  const f = useForm<FieldValues>({
    resolver: zodResolver(bankAccountSchema) as never,
    defaultValues: { code: a?.code ?? '', name: a?.name ?? '', bankName: a?.bankName ?? '', accountNo: a?.accountNo ?? '', glAccountId: a?.glAccountId ?? '', isActive: a?.isActive ?? true, notes: a?.notes ?? '' },
  });
  const save = useAction((v: FieldValues) => (a ? api.put(`/accounting/bank-accounts/${a.id}`, v) : api.post('/accounting/bank-accounts', v)), { success: 'บันทึกบัญชีธนาคารแล้ว', invalidate: INV, onSuccess: onClose });
  const e = (k: string) => errOf(f.formState.errors, k);
  const gl = (accounts.data ?? []).filter((x) => x.type === 'ASSET' && x.isPostable && x.isActive).sort((x, y) => x.code.localeCompare(y.code)).map((x) => ({ value: x.id, label: `${x.code} ${x.nameTh}` }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={a ? `แก้ไขบัญชีธนาคาร ${a.code}` : 'เพิ่มบัญชีธนาคาร'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="รหัส" required error={e('code')}><Input {...f.register('code')} /></Field>
        <Field label="ชื่อบัญชี" required error={e('name')}><Input {...f.register('name')} /></Field>
        <Field label="ธนาคาร" required error={e('bankName')}><Input {...f.register('bankName')} /></Field>
        <Field label="เลขที่บัญชี" required error={e('accountNo')}><Input inputMode="numeric" {...f.register('accountNo')} /></Field>
        <Field label="บัญชีแยกประเภท (สินทรัพย์)" required error={e('glAccountId')} className="sm:col-span-2"><Select options={gl} placeholder="เลือกบัญชี" {...f.register('glAccountId')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

function BankRecDialog({ defaultBank, onClose, onSaved }: { defaultBank: string; onClose: () => void; onSaved: (id: string) => void }) {
  const banks = useBankAccounts();
  const f = useForm<FieldValues>({ resolver: zodResolver(bankRecSchema) as never, defaultValues: { bankAccountId: defaultBank, statementDate: toISODate(), statementBalance: '', notes: '' } });
  const save = useAction((v: FieldValues) => api.post<{ id: string }>('/accounting/bank-recs', v), { success: 'เริ่มกระทบยอดแล้ว', invalidate: INV, onSuccess: (r) => { onClose(); onSaved(r?.id ?? ''); } });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="md" title="เริ่มกระทบยอดธนาคาร"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>เริ่ม</Button></>}>
      <div className="space-y-3">
        <Field label="บัญชีธนาคาร" required error={e('bankAccountId')}>
          <Select options={(banks.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} placeholder="เลือกบัญชี" {...f.register('bankAccountId')} />
        </Field>
        <Field label="วันที่ตาม Statement" required error={e('statementDate')}><Input type="date" {...f.register('statementDate')} /></Field>
        <Field label="ยอดคงเหลือตาม Statement" required error={e('statementBalance')}><Input inputMode="decimal" className="text-right" {...f.register('statementBalance')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')}><Textarea rows={2} {...f.register('notes')} /></Field>
      </div>
    </Dialog>
  );
}
