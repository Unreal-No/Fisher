import { useQuery } from '@tanstack/react-query';
import { Ban, Calculator, Check, Download, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { EMPLOYEE_POSITION_TH, formatDate, formatDateTime, formatMoney, PAY_ITEM_CODE_TH, PAYROLL_WARNING_TH } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { DL, Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { AdjustmentDialog, INV, PayDialog, PeriodDialog } from './payroll-dialogs';
import { PayrollStatusBadge } from './status';
import type { CalcResult, PeriodDetail } from './types';

async function downloadBankFile(id: string, code: string) {
  const res = await fetch(`/api/v1/payroll/periods/${id}/bank-file`, { credentials: 'include' });
  if (!res.ok) {
    let msg = 'ดาวน์โหลดไฟล์ธนาคารไม่สำเร็จ';
    try { msg = (await res.json())?.error?.message ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, 'ERROR', msg);
  }
  const missing = Number(res.headers.get('x-missing-accounts') ?? 0);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `payroll-${code}-bank.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (missing > 0) toast.warning(`มีพนักงาน ${missing} คนที่ยังไม่มีเลขบัญชีธนาคาร (ไม่อยู่ในไฟล์)`);
}

export function PayrollPeriodPage() {
  const { id } = useParams() as { id: string };
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['payroll', 'period', id], queryFn: () => api.get<PeriodDetail>(`/payroll/periods/${id}`) });
  const [dlg, setDlg] = useState<null | 'edit' | 'approve' | 'pay' | 'cancel' | 'adj'>(null);
  const [delAdj, setDelAdj] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<CalcResult['skipped'] | null>(null);
  const close = () => setDlg(null);
  const calc = useAction(() => api.post<CalcResult>(`/payroll/periods/${id}/calculate`, {}), {
    success: 'คำนวณเงินเดือนแล้ว', invalidate: INV, onSuccess: (r) => { if (r.skipped?.length) setSkipped(r.skipped); },
  });
  const approve = useAction(() => api.post(`/payroll/periods/${id}/approve`, {}), { success: 'อนุมัติงวดเงินเดือนแล้ว', invalidate: INV, onSuccess: close });
  const cancel = useAction((reason: string) => api.post(`/payroll/periods/${id}/cancel`, { reason }), { success: 'ยกเลิกงวดเงินเดือนแล้ว', invalidate: INV, onSuccess: close });
  const delAdjust = useAction((adjId: string) => api.del(`/payroll/periods/${id}/adjustments/${adjId}`), { success: 'ลบรายการปรับปรุงแล้ว', invalidate: INV, onSuccess: () => setDelAdj(null) });
  const bank = useAction(() => downloadBankFile(id, q.data?.code ?? id), {});

  return (
    <QueryView q={q}>
      {(p) => {
        const editable = p.status === 'DRAFT' || p.status === 'CALCULATED';
        const canEdit = can('payroll.edit');
        const canApprove = can('payroll.approve');
        const selfCalc = !!me && p.calculatedById === me.id;
        const people = Array.from(new Map(p.records.map((r) => [r.employeeId, `${r.employee.code} · ${r.employee.firstName} ${r.employee.lastName}`])).entries()).map(([eid, label]) => ({ id: eid, label }));
        return (
          <>
            <PageHeader
              title={`${p.code} · ${p.name}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><PayrollStatusBadge s={p.status} /> {formatDate(p.startDate)} – {formatDate(p.endDate)} · {p.vessel ? p.vessel.name : 'ทุกลำ'} <Link className="text-accent hover:underline" to="/payroll">กลับไปรายการ</Link></span>}
              actions={
                <>
                  {editable && canEdit && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                  {editable && canEdit && <Button variant={p.status === 'DRAFT' ? 'primary' : 'outline'} loading={calc.isPending} onClick={() => calc.mutate(undefined)}><Calculator /> {p.status === 'DRAFT' ? 'คำนวณ' : 'คำนวณใหม่'}</Button>}
                  {p.status === 'CALCULATED' && canApprove && (
                    <Button disabled={selfCalc} title={selfCalc ? 'ผู้คำนวณอนุมัติเองไม่ได้' : undefined} onClick={() => setDlg('approve')}><Check /> อนุมัติ</Button>
                  )}
                  {p.status === 'APPROVED' && canApprove && <Button onClick={() => setDlg('pay')}><Wallet /> บันทึกการจ่าย</Button>}
                  {(p.status === 'APPROVED' || p.status === 'PAID') && canApprove && can('employee.sensitive') && (
                    <Button variant="outline" loading={bank.isPending} onClick={() => bank.mutate(undefined)}><Download /> ไฟล์โอนเงินธนาคาร</Button>
                  )}
                  {p.status !== 'PAID' && p.status !== 'CANCELLED' && canApprove && <Button variant="danger-outline" onClick={() => setDlg('cancel')}><Ban /> ยกเลิก</Button>}
                </>
              }
            />
            {p.status === 'CALCULATED' && selfCalc && canApprove && <p className="-mt-2 mb-3 text-xs text-muted">ผู้คำนวณอนุมัติเองไม่ได้ — ต้องให้ผู้อื่นอนุมัติ</p>}
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="จำนวนคน" value={p.records.length} />
              <Stat label="รายได้รวม (บาท)" value={formatMoney(p.totalGross)} />
              <Stat label="รายการหัก (บาท)" value={formatMoney(p.totalDeduction)} />
              <Stat label="จ่ายสุทธิ (บาท)" value={formatMoney(p.totalNet)} tone="ok" />
            </div>
            <div className="space-y-4">
              {p.needsRecalc && editable && (
                <div className="rounded border border-amber-300 bg-warn-soft px-3 py-2 text-sm text-warn">มีการแก้ไขหลังคำนวณ — ต้องคำนวณใหม่ก่อนอนุมัติ</div>
              )}
              <Panel title="ข้อมูลงวด">
                <DL cols={3} items={[
                  ['วันที่จ่าย', formatDate(p.payDate)], ['สร้างโดย', p.createdByName],
                  ['คำนวณโดย', p.calculatedByName ? `${p.calculatedByName} (${formatDateTime(p.calculatedAt)})` : null],
                  ['อนุมัติโดย', p.approvedByName ? `${p.approvedByName} (${formatDateTime(p.approvedAt)})` : null],
                  ['จ่ายเมื่อ', formatDateTime(p.paidAt)], ['หมายเหตุ', p.notes],
                ]} />
              </Panel>
              <Panel title={`รายชื่อและยอดจ่าย (${p.records.length})`} bodyClass="p-0">
                {p.records.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-600">
                        <tr><th className="px-4 py-2">พนักงาน</th><th className="px-2">ตำแหน่ง</th><th className="px-2">เรือ</th><th className="px-2 text-right">รายได้</th><th className="px-2 text-right">หัก</th><th className="px-2 text-right">สุทธิ</th><th className="px-2">หมายเหตุ</th><th className="px-4" /></tr>
                      </thead>
                      <tbody>
                        {p.records.map((r) => (
                          <tr key={r.id} className="border-t border-line align-top">
                            <td className="whitespace-nowrap px-4 py-2">{r.employee.code} · {r.employee.firstName} {r.employee.lastName}</td>
                            <td className="whitespace-nowrap px-2 py-2">{r.position ? EMPLOYEE_POSITION_TH[r.position] : '-'}</td>
                            <td className="whitespace-nowrap px-2 py-2">{r.vessel?.name ?? '-'}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatMoney(r.gross)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatMoney(r.deduction)}</td>
                            <td className="px-2 py-2 text-right font-medium tabular-nums">{formatMoney(r.net)}</td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap gap-1">
                                {(r.warnings ?? []).map((w) => <Badge key={w} tone="warn" className="whitespace-normal">{PAYROLL_WARNING_TH[w] ?? w}</Badge>)}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2 text-right"><Link className="text-accent hover:underline" to={`/payroll/periods/${p.id}/slips/${r.id}`}>สลิป</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Empty title={p.status === 'DRAFT' ? 'ยังไม่ได้คำนวณ' : 'ไม่มีรายการ'} />}
              </Panel>
              <Panel
                title={`รายการปรับปรุง (${p.adjustments.length})`} bodyClass="p-0"
                actions={editable && canEdit && <Button size="sm" variant="outline" onClick={() => setDlg('adj')}><Plus /> เพิ่มรายการ</Button>}
              >
                {p.adjustments.length ? (
                  <div className="divide-y divide-line">
                    {p.adjustments.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                        <span>{a.employee.code} · {a.employee.firstName} {a.employee.lastName}</span>
                        <Badge tone={a.code === 'OTHER_DEDUCTION' ? 'bad' : 'ok'}>{PAY_ITEM_CODE_TH[a.code]}</Badge>
                        <span className="text-muted">{a.description}</span>
                        <span className="ml-auto tabular-nums">{formatMoney(a.amount)}</span>
                        {editable && canEdit && <Button size="icon" variant="ghost" aria-label="ลบรายการ" onClick={() => setDelAdj(a.id)}><Trash2 /></Button>}
                      </div>
                    ))}
                  </div>
                ) : <Empty title="ไม่มีรายการปรับปรุง" />}
              </Panel>
            </div>

            {dlg === 'edit' && <PeriodDialog period={p} onClose={close} />}
            {dlg === 'adj' && <AdjustmentDialog periodId={id} employees={people} onClose={close} />}
            {dlg === 'pay' && <PayDialog periodId={id} onClose={close} />}
            <ConfirmDialog open={dlg === 'approve'} onOpenChange={close} title="อนุมัติงวดเงินเดือน" message="อนุมัติแล้วจะแก้ไขรายการไม่ได้ ระบบจะตัดยอดเงินเบิก/เงินกู้ที่หักในงวดนี้" loading={approve.isPending} onConfirm={() => approve.mutate(undefined)} />
            <ConfirmDialog open={dlg === 'cancel'} onOpenChange={close} title="ยกเลิกงวดเงินเดือน" danger requireReason loading={cancel.isPending}
              message={p.status === 'APPROVED' ? 'การอนุมัติได้ตัดยอดการหักเงินเบิก/เงินกู้ไปแล้ว การยกเลิกจะคืนยอดที่หักกลับเข้าเงินเบิก/เงินกู้' : 'ยกเลิกงวดเงินเดือนนี้'} onConfirm={(r) => cancel.mutate(r)} />
            <ConfirmDialog open={!!delAdj} onOpenChange={(o) => !o && setDelAdj(null)} title="ลบรายการปรับปรุง" danger confirmText="ลบ" loading={delAdjust.isPending}
              message="ลบรายการนี้ งวดจะกลับเป็นสถานะร่างและต้องคำนวณใหม่" onConfirm={() => delAdj && delAdjust.mutate(delAdj)} />
            <Dialog open={!!skipped} onOpenChange={(o) => !o && setSkipped(null)} title="พนักงานที่ถูกข้าม" footer={<Button onClick={() => setSkipped(null)}>ปิด</Button>}>
              <p className="mb-2 text-sm text-muted">พนักงานต่อไปนี้ไม่ถูกคำนวณในงวดนี้</p>
              <ul className="divide-y divide-line text-sm">
                {skipped?.map((s) => <li key={s.employeeId} className="py-2"><b>{s.name}</b><span className="block text-xs text-muted">{s.reason}</span></li>)}
              </ul>
            </Dialog>
          </>
        );
      }}
    </QueryView>
  );
}
