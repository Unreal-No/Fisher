import { useQuery } from '@tanstack/react-query';
import { Ban, Check, FilePlus2, Pencil, Send, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DL, Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useVessels } from '@/lib/lookups';
import { PoBadge, PrBadge } from './status';
import { INV, PoFormDialog, PrFormDialog } from './purchasing-dialogs';
import type { PurchaseRequest } from './types';

export function PurchaseRequestPage() {
  const { id } = useParams() as { id: string };
  const nav = useNavigate();
  const { can } = useAuth();
  const vessels = useVessels();
  const q = useQuery({ queryKey: ['purchasing', 'request', id], queryFn: () => api.get<PurchaseRequest>(`/purchasing/requests/${id}`) });
  const [dlg, setDlg] = useState<null | 'edit' | 'po' | 'approve' | 'reject' | 'cancel'>(null);
  const close = () => setDlg(null);
  const submit = useAction(() => api.post(`/purchasing/requests/${id}/submit`, {}), { success: 'ส่งขออนุมัติแล้ว', invalidate: INV });
  const approve = useAction((note: string) => api.post(`/purchasing/requests/${id}/approve`, { note: note || undefined }), { success: 'อนุมัติใบขอซื้อแล้ว', invalidate: INV, onSuccess: close });
  const reject = useAction((reason: string) => api.post(`/purchasing/requests/${id}/reject`, { reason }), { success: 'ไม่อนุมัติใบขอซื้อแล้ว', invalidate: INV, onSuccess: close });
  const cancel = useAction((reason: string) => api.post(`/purchasing/requests/${id}/cancel`, { reason }), { success: 'ยกเลิกใบขอซื้อแล้ว', invalidate: INV, onSuccess: close });

  return (
    <QueryView q={q}>
      {(pr) => {
        const edit = can('purchase.create');
        const approver = can('purchase.approve');
        const vessel = vessels.data?.find((v) => v.id === pr.vesselId);
        const est = pr.items.reduce((a, x) => a + Number(x.quantity) * Number(x.estUnitCost ?? 0), 0);
        const canCancel = edit && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status);
        return (
          <>
            <PageHeader
              title={`ใบขอซื้อ ${pr.prNo}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><PrBadge s={pr.status} /> <Link className="text-accent hover:underline" to="/purchasing">กลับไปรายการจัดซื้อ</Link></span>}
              actions={
                <>
                  {pr.status === 'DRAFT' && edit && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                  {pr.status === 'DRAFT' && edit && <Button loading={submit.isPending} onClick={() => submit.mutate(undefined)}><Send /> ส่งขออนุมัติ</Button>}
                  {pr.status === 'SUBMITTED' && approver && <Button onClick={() => setDlg('approve')}><Check /> อนุมัติ</Button>}
                  {pr.status === 'SUBMITTED' && approver && <Button variant="danger-outline" onClick={() => setDlg('reject')}><X /> ไม่อนุมัติ</Button>}
                  {pr.status === 'APPROVED' && can('purchase.create') && <Button onClick={() => setDlg('po')}><FilePlus2 /> ออกใบสั่งซื้อ</Button>}
                  {canCancel && <Button variant="danger-outline" onClick={() => setDlg('cancel')}><Ban /> ยกเลิก</Button>}
                </>
              }
            />
            <div className="space-y-4">
              <Panel title="ข้อมูลใบขอซื้อ">
                <DL cols={3} items={[
                  ['ต้องการภายใน', formatDate(pr.neededBy)], ['เรือ', vessel ? `${vessel.code} · ${vessel.name}` : null],
                  ['เที่ยวเรือ', pr.tripId ? <Link className="text-accent hover:underline" to={`/trips/${pr.tripId}`}>ดูเที่ยวเรือ</Link> : null],
                  ['ส่งขออนุมัติเมื่อ', formatDateTime(pr.submittedAt)], ['ตัดสินเมื่อ', formatDateTime(pr.decidedAt)], ['บันทึกการตัดสิน', pr.decisionNote],
                  ['หมายเหตุ', pr.notes], ['สร้างเมื่อ', formatDateTime(pr.createdAt)],
                ]} />
              </Panel>
              <Panel title="รายการที่ขอซื้อ" bodyClass="p-0">
                {pr.items.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-600">
                        <tr><th className="px-4 py-2">รายการ</th><th className="px-2 text-right">จำนวน</th><th className="px-2">หน่วย</th><th className="px-2 text-right">ราคาประมาณ/หน่วย</th><th className="px-2 text-right">รวมประมาณ</th><th className="px-4">หมายเหตุ</th></tr>
                      </thead>
                      <tbody>
                        {pr.items.map((x) => (
                          <tr key={x.id} className="border-t border-line">
                            <td className="px-4 py-2">{x.description}</td>
                            <td className="px-2 text-right tabular-nums">{formatNumber(x.quantity, 2)}</td>
                            <td className="px-2">{x.unit}</td>
                            <td className="px-2 text-right tabular-nums">{x.estUnitCost ? formatMoney(x.estUnitCost) : '-'}</td>
                            <td className="px-2 text-right tabular-nums">{x.estUnitCost ? formatMoney(Number(x.quantity) * Number(x.estUnitCost)) : '-'}</td>
                            <td className="px-4">{x.notes ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-line bg-slate-50 font-semibold">
                        <tr><td colSpan={4} className="px-4 py-2 text-right">ประมาณการรวม</td><td className="px-2 text-right tabular-nums">{formatMoney(est)}</td><td /></tr>
                      </tfoot>
                    </table>
                  </div>
                ) : <Empty />}
              </Panel>
              <Panel title="ใบสั่งซื้อที่เกี่ยวข้อง" bodyClass="p-0">
                {pr.orders?.length ? (
                  <ul className="divide-y divide-line text-sm">
                    {pr.orders.map((o) => (
                      <li key={o.id} className="flex items-center gap-3 px-4 py-2"><Link className="text-accent hover:underline" to={`/purchasing/orders/${o.id}`}>{o.poNo}</Link><PoBadge s={o.status} /></li>
                    ))}
                  </ul>
                ) : <Empty title="ยังไม่มีใบสั่งซื้อ" />}
              </Panel>
            </div>
            {dlg === 'edit' && <PrFormDialog pr={pr} onClose={close} />}
            {dlg === 'po' && <PoFormDialog pr={pr} onClose={close} onSaved={(poId) => nav(`/purchasing/orders/${poId}`)} />}
            <ConfirmDialog open={dlg === 'approve'} onOpenChange={close} title="อนุมัติใบขอซื้อ" message="ยืนยันอนุมัติใบขอซื้อนี้? (ระบุหมายเหตุได้ถ้าต้องการ)" loading={approve.isPending} onConfirm={(n) => approve.mutate(n)} />
            <ConfirmDialog open={dlg === 'reject'} onOpenChange={close} title="ไม่อนุมัติใบขอซื้อ" danger requireReason confirmText="ไม่อนุมัติ" loading={reject.isPending} message="ระบุเหตุผลที่ไม่อนุมัติ" onConfirm={(r) => reject.mutate(r)} />
            <ConfirmDialog open={dlg === 'cancel'} onOpenChange={close} title="ยกเลิกใบขอซื้อ" danger requireReason loading={cancel.isPending} message="ข้อมูลจะถูกเก็บไว้ในประวัติ" onConfirm={(r) => cancel.mutate(r)} />
          </>
        );
      }}
    </QueryView>
  );
}
