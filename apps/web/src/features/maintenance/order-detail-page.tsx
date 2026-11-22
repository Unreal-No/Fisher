import { useQuery } from '@tanstack/react-query';
import { Ban, CheckCheck, PackageMinus, Paperclip, Pencil, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDate, formatDateTime, formatMoney, formatNumber, MAINT_CATEGORY_TH, MAINT_TYPE_TH } from '@fisher/shared';
import { FileLink } from '@/components/file-upload';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DL, Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { AttachDialog, CompleteDialog, INV, OrderDialog, PartDialog } from './maintenance-dialogs';
import { MaintStatusBadge, PriorityBadge } from './status';
import type { MaintOrder } from './types';

export function MaintenanceOrderPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['maintenance', 'order', id], queryFn: () => api.get<MaintOrder>(`/maintenance/orders/${id}`) });
  const [dlg, setDlg] = useState<null | 'edit' | 'part' | 'complete' | 'attach' | 'cancel' | 'start'>(null);
  const close = () => setDlg(null);
  const start = useAction(() => api.post(`/maintenance/orders/${id}/start`, {}), { success: 'เริ่มซ่อมแล้ว', invalidate: INV, onSuccess: close });
  const cancel = useAction((reason: string) => api.post(`/maintenance/orders/${id}/cancel`, { reason }), { success: 'ยกเลิกใบสั่งซ่อมแล้ว', invalidate: INV, onSuccess: close });

  return (
    <QueryView q={q}>
      {(o) => {
        const edit = can('maintenance.edit');
        const create = can('maintenance.create');
        const active = o.status === 'OPEN' || o.status === 'IN_PROGRESS';
        return (
          <>
            <PageHeader
              title={`ใบสั่งซ่อม ${o.orderNo}`}
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <MaintStatusBadge s={o.status} /> <PriorityBadge p={o.priority} />
                  <Link className="text-accent hover:underline" to={`/vessels/${o.vesselId}`}>{o.vessel.code} · {o.vessel.name}</Link>
                  <Link className="text-accent hover:underline" to="/maintenance">กลับไปรายการ</Link>
                </span>
              }
              actions={
                <>
                  {active && edit && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                  {o.status === 'OPEN' && edit && <Button onClick={() => setDlg('start')}><Play /> เริ่มซ่อม</Button>}
                  {o.status === 'IN_PROGRESS' && edit && <Button variant="outline" onClick={() => setDlg('part')}><PackageMinus /> เบิกอะไหล่</Button>}
                  {o.status === 'IN_PROGRESS' && edit && <Button onClick={() => setDlg('complete')}><CheckCheck /> ปิดงาน</Button>}
                  {o.status !== 'CANCELLED' && (edit || create) && <Button variant="outline" onClick={() => setDlg('attach')}><Paperclip /> แนบไฟล์</Button>}
                  {active && edit && <Button variant="danger-outline" onClick={() => setDlg('cancel')}><Ban /> ยกเลิก</Button>}
                </>
              }
            />
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="ค่าแรง (บาท)" value={formatMoney(o.laborCost)} />
              <Stat label="ค่าจ้างภายนอก (บาท)" value={formatMoney(o.externalCost)} />
              <Stat label="ค่าอะไหล่ (บาท)" value={formatMoney(o.partsCost)} />
              <Stat label="รวม (บาท)" value={formatMoney(o.totalCost)} />
            </div>
            <div className="space-y-4">
              <Panel title="ข้อมูลใบสั่งซ่อม">
                <DL cols={3} items={[
                  ['เรื่อง', o.title], ['หมวด', MAINT_CATEGORY_TH[o.category]], ['ประเภท', MAINT_TYPE_TH[o.type]],
                  ['แผนบำรุงรักษา', o.plan ? <Link className="text-accent hover:underline" to={`/maintenance?tab=plans&vesselId=${o.vesselId}`}>{o.plan.name}</Link> : null],
                  ['ต้องหยุดใช้เรือ', o.takesOutOfService ? 'ใช่ (สถานะเรือ = ซ่อมบำรุง)' : 'ไม่'],
                  ['ผู้ให้บริการ/อู่ซ่อม', o.provider ? `${o.provider.code} · ${o.provider.name}` : null],
                  ['แจ้งเมื่อ', formatDateTime(o.reportedAt)], ['เริ่มซ่อม', formatDateTime(o.startedAt)], ['เสร็จเมื่อ', formatDateTime(o.completedAt)],
                  ['ชั่วโมงเครื่อง', o.engineHours != null ? formatNumber(o.engineHours, 1) : null], ['เลขที่ใบแจ้งหนี้', o.invoiceNo],
                  ['เหตุผลที่ยกเลิก', o.cancelReason],
                  ['รายละเอียด', o.description], ['ผลการตรวจ/ดำเนินการ', o.findings],
                ]} />
              </Panel>
              <Panel title={`อะไหล่ที่เบิก (${o.parts.length})`} bodyClass="p-0">
                {o.parts.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-600">
                        <tr><th className="px-4 py-2">เลขที่</th><th className="px-2">วันที่</th><th className="px-2">สินค้า</th><th className="px-2">คลัง</th><th className="px-2 text-right">จำนวน</th><th className="px-2 text-right">ต้นทุน/หน่วย</th><th className="px-4 text-right">รวม</th></tr>
                      </thead>
                      <tbody>
                        {o.parts.map((p) => (
                          <tr key={p.id} className="border-t border-line">
                            <td className="px-4 py-2">{p.moveNo}</td>
                            <td className="px-2">{formatDate(p.movedAt)}</td>
                            <td className="px-2">{p.item.code} · {p.item.name}</td>
                            <td className="px-2">{p.warehouse.code} · {p.warehouse.name}</td>
                            <td className="px-2 text-right tabular-nums">{formatNumber(Math.abs(Number(p.quantity)), 2)} {p.item.unit}</td>
                            <td className="px-2 text-right tabular-nums">{formatMoney(p.unitCost)}</td>
                            <td className="px-4 text-right tabular-nums">{formatMoney(Math.abs(Number(p.totalCost)))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Empty title="ยังไม่มีการเบิกอะไหล่" />}
              </Panel>
              <Panel title={`ไฟล์แนบ (${o.attachments.length})`} bodyClass="p-0">
                {o.attachments.length ? (
                  <ul className="divide-y divide-line">
                    {o.attachments.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-x-4 px-4 py-2 text-sm">
                        <FileLink id={a.fileId} label={a.note || 'ไฟล์แนบ'} />
                        <span className="text-xs text-muted">{formatDateTime(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <Empty title="ไม่มีไฟล์แนบ" />}
              </Panel>
            </div>
            {dlg === 'edit' && <OrderDialog order={o} onClose={close} />}
            {dlg === 'part' && <PartDialog orderId={id} onClose={close} />}
            {dlg === 'complete' && <CompleteDialog order={o} onClose={close} />}
            {dlg === 'attach' && <AttachDialog orderId={id} onClose={close} />}
            <ConfirmDialog open={dlg === 'start'} onOpenChange={close} title="เริ่มซ่อม" message={o.takesOutOfService ? 'ใบสั่งซ่อมนี้ต้องหยุดใช้เรือ สถานะเรือจะเปลี่ยนเป็น "ซ่อมบำรุง" (เรือต้องไม่อยู่ในทะเล)' : 'ยืนยันเริ่มซ่อม?'} loading={start.isPending} onConfirm={() => start.mutate(undefined)} />
            <ConfirmDialog open={dlg === 'cancel'} onOpenChange={close} title="ยกเลิกใบสั่งซ่อม" danger requireReason loading={cancel.isPending} message="ยกเลิกไม่ได้หากมีการเบิกอะไหล่แล้ว" onConfirm={(r) => cancel.mutate(r)} />
          </>
        );
      }}
    </QueryView>
  );
}
