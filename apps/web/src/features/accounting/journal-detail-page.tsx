import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, Pencil, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { formatDate, formatMoney, JOURNAL_SOURCE_TH, journalReverseSchema, toISODate } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { errOf, Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { DL, Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { JournalDialog } from './journal-dialog';
import { INV } from './lookups';
import { JournalStatusBadge } from './status';
import type { JournalDetail } from './types';

function ReverseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const f = useForm<FieldValues>({ resolver: zodResolver(journalReverseSchema) as never, defaultValues: { entryDate: toISODate(), reason: '' } });
  const save = useAction((v: FieldValues) => api.post<{ id: string }>(`/accounting/journals/${id}/reverse`, v), {
    success: 'กลับรายการแล้ว', invalidate: INV, onSuccess: (r) => { onClose(); if (r?.id) nav(`/accounting/journals/${r.id}`); },
  });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm" title="กลับรายการบัญชี"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>กลับรายการ</Button></>}>
      <div className="space-y-3">
        <Field label="วันที่กลับรายการ" required error={e('entryDate')}><Input type="date" {...f.register('entryDate')} /></Field>
        <Field label="เหตุผล" required error={e('reason')}><Textarea rows={3} {...f.register('reason')} /></Field>
      </div>
    </Dialog>
  );
}

export function JournalPage() {
  const { id } = useParams() as { id: string };
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['accounting', 'journal', id], queryFn: () => api.get<JournalDetail>(`/accounting/journals/${id}`) });
  const [dlg, setDlg] = useState<null | 'edit' | 'post' | 'void' | 'reverse'>(null);
  const close = () => setDlg(null);
  const post = useAction(() => api.post(`/accounting/journals/${id}/post`, {}), { success: 'ผ่านรายการแล้ว', invalidate: INV, onSuccess: close });
  const voidIt = useAction((reason: string) => api.post(`/accounting/journals/${id}/void`, { reason }), { success: 'ยกเลิกรายการแล้ว', invalidate: INV, onSuccess: close });
  return (
    <QueryView q={q}>
      {(j) => {
        const manual = !j.sourceType;
        const self = !!me && j.createdById === me.id;
        const dr = j.lines.reduce((s, l) => s + Number(l.debit), 0);
        const cr = j.lines.reduce((s, l) => s + Number(l.credit), 0);
        return (
          <>
            <PageHeader
              title={`รายการบัญชี ${j.entryNo}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><JournalStatusBadge s={j.status} /> {formatDate(j.entryDate)} <Link className="text-accent hover:underline" to="/accounting">กลับไปสมุดรายวัน</Link></span>}
              actions={
                <>
                  {j.status === 'DRAFT' && manual && can('finance.edit') && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                  {j.status === 'DRAFT' && can('finance.approve') && (
                    <Button disabled={self} title={self ? 'ผู้บันทึกผ่านรายการของตัวเองไม่ได้' : undefined} onClick={() => setDlg('post')}><Check /> ผ่านรายการ</Button>
                  )}
                  {j.status === 'DRAFT' && can('finance.edit') && <Button variant="danger-outline" onClick={() => setDlg('void')}><Ban /> ยกเลิก</Button>}
                  {j.status === 'POSTED' && manual && can('finance.approve') && <Button variant="outline" onClick={() => setDlg('reverse')}><Undo2 /> กลับรายการ</Button>}
                </>
              }
            />
            {j.status === 'DRAFT' && self && can('finance.approve') && <p className="-mt-2 mb-3 text-xs text-muted">ผู้บันทึกผ่านรายการของตัวเองไม่ได้ — ต้องให้ผู้อื่นผ่านรายการ</p>}
            {j.status === 'POSTED' && !manual && <p className="-mt-2 mb-3 text-xs text-muted">รายการอัตโนมัติ — ยกเลิกที่เอกสารต้นทาง</p>}
            <div className="space-y-4">
              <Panel title="ข้อมูลรายการ">
                <DL cols={3} items={[
                  ['คำอธิบาย', j.memo], ['เลขอ้างอิง', j.reference],
                  ['ที่มา', manual ? 'บันทึกเอง' : (
                    <span>{JOURNAL_SOURCE_TH[j.sourceType!]} {j.sourceRef && (j.sourceLink ? <Link className="text-accent hover:underline" to={j.sourceLink}>{j.sourceRef}</Link> : j.sourceRef)}</span>
                  )],
                  ['บันทึกโดย', j.createdByName], ['ผ่านรายการโดย', j.postedByName],
                  ['กลับรายการของ', j.reversalOf ? <Link className="text-accent hover:underline" to={`/accounting/journals/${j.reversalOf.id}`}>{j.reversalOf.entryNo}</Link> : null],
                  ['ถูกกลับรายการโดย', j.reversedBy ? <Link className="text-accent hover:underline" to={`/accounting/journals/${j.reversedBy.id}`}>{j.reversedBy.entryNo}</Link> : null],
                ]} />
              </Panel>
              <Panel title={`รายการบัญชี (${j.lines.length} บรรทัด)`} bodyClass="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="px-4 py-2">#</th><th className="px-2">บัญชี</th><th className="px-2">คำอธิบาย</th><th className="px-2">เรือ/เที่ยว</th><th className="px-2 text-right">เดบิต</th><th className="px-4 text-right">เครดิต</th></tr>
                    </thead>
                    <tbody>
                      {j.lines.map((l) => (
                        <tr key={l.lineNo} className="border-t border-line align-top">
                          <td className="px-4 py-2 text-muted">{l.lineNo}</td>
                          <td className="whitespace-nowrap px-2 py-2">{l.account.code} {l.account.nameTh}</td>
                          <td className="px-2 py-2">{l.description ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-2">{[l.vessel?.name, l.trip?.tripNo].filter(Boolean).join(' · ') || '-'}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : ''}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(l.credit) ? formatMoney(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-line bg-slate-50 font-semibold">
                      <tr><td colSpan={4} className="px-4 py-2 text-right">รวม</td><td className="px-2 text-right tabular-nums">{formatMoney(dr)}</td><td className="px-4 text-right tabular-nums">{formatMoney(cr)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </Panel>
            </div>
            {dlg === 'edit' && <JournalDialog entry={j} onClose={close} />}
            {dlg === 'reverse' && <ReverseDialog id={id} onClose={close} />}
            <ConfirmDialog open={dlg === 'post'} onOpenChange={close} title="ผ่านรายการบัญชี" message="เมื่อผ่านรายการแล้วจะแก้ไขไม่ได้ (แก้ได้ด้วยการกลับรายการเท่านั้น)" loading={post.isPending} onConfirm={() => post.mutate(undefined)} />
            <ConfirmDialog open={dlg === 'void'} onOpenChange={close} title="ยกเลิกรายการร่าง" danger requireReason loading={voidIt.isPending} message={`ยกเลิก ${j.entryNo}`} onConfirm={(r) => voidIt.mutate(r)} />
          </>
        );
      }}
    </QueryView>
  );
}
