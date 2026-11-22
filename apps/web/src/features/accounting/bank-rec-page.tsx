import { useQuery } from '@tanstack/react-query';
import { Check, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatDate, formatMoney } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DL, Panel, Stat } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { INV } from './lookups';
import { RecStatusBadge } from './status';
import type { BankRecDetail } from './types';

export function BankRecPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['accounting', 'bank-rec', id], queryFn: () => api.get<BankRecDetail>(`/accounting/bank-recs/${id}`) });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<null | 'complete' | 'delete'>(null);
  useEffect(() => {
    if (q.data) setTicked(new Set(q.data.items.filter((i) => i.cleared).map((i) => i.journalLineId)));
  }, [q.data]);
  const close = () => setDlg(null);
  const saveItems = useAction(() => api.put(`/accounting/bank-recs/${id}/items`, { journalLineIds: [...ticked] }), { success: 'บันทึกการเลือกแล้ว', invalidate: INV });
  const complete = useAction(() => api.post(`/accounting/bank-recs/${id}/complete`, {}), { success: 'ปิดการกระทบยอดแล้ว', invalidate: INV, onSuccess: close });
  const del = useAction(() => api.del(`/accounting/bank-recs/${id}`), { success: 'ลบการกระทบยอดแล้ว', invalidate: INV, onSuccess: () => nav('/accounting?tab=bank') });
  return (
    <QueryView q={q}>
      {(r) => {
        const draft = r.status === 'DRAFT';
        const savedSet = new Set(r.items.filter((i) => i.cleared).map((i) => i.journalLineId));
        const dirty = ticked.size !== savedSet.size || [...ticked].some((x) => !savedSet.has(x));
        const allOn = r.items.length > 0 && r.items.every((i) => ticked.has(i.journalLineId));
        const toggle = (lid: string) => setTicked((s) => { const n = new Set(s); if (n.has(lid)) n.delete(lid); else n.add(lid); return n; });
        const zero = Math.abs(r.difference) < 0.005;
        return (
          <>
            <PageHeader
              title={`กระทบยอด ${r.bankAccount.name}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><RecStatusBadge s={r.status} /> {formatDate(r.statementDate)} <Link className="text-accent hover:underline" to="/accounting?tab=bank">กลับไปธนาคาร</Link></span>}
              actions={draft && (
                <>
                  {can('finance.edit') && <Button variant="outline" loading={saveItems.isPending} disabled={!dirty} onClick={() => saveItems.mutate(undefined)}><Save /> บันทึกการเลือก</Button>}
                  {can('finance.approve') && <Button disabled={dirty || !zero} title={dirty ? 'บันทึกการเลือกก่อน' : !zero ? 'ผลต่างต้องเป็น 0' : undefined} onClick={() => setDlg('complete')}><Check /> ปิดการกระทบยอด</Button>}
                  {can('finance.edit') && <Button variant="danger-outline" onClick={() => setDlg('delete')}><Trash2 /> ลบ</Button>}
                </>
              )}
            />
            <div className="space-y-4">
              <Panel title="ข้อมูลการกระทบยอด">
                <DL cols={4} items={[
                  ['ธนาคาร', `${r.bankAccount.bankName} ${r.bankAccount.accountNo}`], ['บัญชีแยกประเภท', `${r.bankAccount.glAccount.code} ${r.bankAccount.glAccount.nameTh}`],
                  ['วันที่ตาม Statement', formatDate(r.statementDate)], ['ยอดตาม Statement', formatMoney(r.statementBalance)],
                ]} />
              </Panel>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label="ยอดตามบัญชี" value={formatMoney(r.bookBalance)} />
                <Stat label="ยอดที่กระทบแล้ว" value={formatMoney(r.clearedBalance)} sub={dirty ? 'ยังไม่ได้บันทึกการเลือกล่าสุด' : undefined} />
                <Stat label="ผลต่าง" value={formatMoney(r.difference)} tone={zero ? 'ok' : 'bad'} sub={zero ? 'ตรงกัน' : 'ยังไม่ตรงกับ Statement'} />
              </div>
              <Panel title={`รายการเคลื่อนไหว (${r.items.length})`} bodyClass="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr>
                        <th className="w-10 px-3 py-2">{draft && <input type="checkbox" aria-label="เลือกทั้งหมด" checked={allOn} onChange={(e) => setTicked(e.target.checked ? new Set(r.items.map((i) => i.journalLineId)) : new Set())} />}</th>
                        <th className="px-2">วันที่</th><th className="px-2">เลขที่รายการ</th><th className="px-2">คำอธิบาย</th><th className="px-2 text-right">เงินเข้า</th><th className="px-3 text-right">เงินออก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.items.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">ไม่มีรายการ</td></tr>}
                      {r.items.map((i) => (
                        <tr key={i.journalLineId} className="border-t border-line">
                          <td className="px-3 py-1.5"><input type="checkbox" aria-label={`เลือก ${i.entryNo}`} disabled={!draft} checked={ticked.has(i.journalLineId)} onChange={() => toggle(i.journalLineId)} /></td>
                          <td className="whitespace-nowrap px-2 py-1.5">{formatDate(i.entryDate)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5"><Link className="text-accent hover:underline" to={`/accounting/journals/${i.entryId}`}>{i.entryNo}</Link></td>
                          <td className="px-2 py-1.5">{[i.memo, i.description, i.sourceRef].filter(Boolean).join(' · ')}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(i.debit) ? formatMoney(i.debit) : ''}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Number(i.credit) ? formatMoney(i.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
            <ConfirmDialog open={dlg === 'complete'} onOpenChange={close} title="ปิดการกระทบยอด" message="เมื่อปิดแล้วจะแก้ไขรายการที่เลือกไม่ได้" loading={complete.isPending} onConfirm={() => complete.mutate(undefined)} />
            <ConfirmDialog open={dlg === 'delete'} onOpenChange={close} title="ลบการกระทบยอด" danger confirmText="ลบ" message="ลบการกระทบยอดฉบับร่างนี้" loading={del.isPending} onConfirm={() => del.mutate(undefined)} />
          </>
        );
      }}
    </QueryView>
  );
}
