import { useQuery } from '@tanstack/react-query';
import { Ban, Check, Lock, PackageCheck, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDate, formatDateTime, formatMoney, formatNumber, SUPPLY_CATEGORY_TH } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DL, Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useVessels } from '@/lib/lookups';
import { INV, PoFormDialog, ReceiveDialog, useWarehouses } from './purchasing-dialogs';
import { PoBadge } from './status';
import type { PurchaseOrder } from './types';

export function PurchaseOrderPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const vessels = useVessels();
  const warehouses = useWarehouses();
  const q = useQuery({ queryKey: ['purchasing', 'order', id], queryFn: () => api.get<PurchaseOrder>(`/purchasing/orders/${id}`) });
  const [dlg, setDlg] = useState<null | 'edit' | 'receive' | 'approve' | 'cancel' | 'close'>(null);
  const close = () => setDlg(null);
  const approve = useAction(() => api.post(`/purchasing/orders/${id}/approve`, {}), { success: 'อนุมัติใบสั่งซื้อแล้ว', invalidate: INV, onSuccess: close });
  const cancel = useAction((reason: string) => api.post(`/purchasing/orders/${id}/cancel`, { reason }), { success: 'ยกเลิกใบสั่งซื้อแล้ว', invalidate: INV, onSuccess: close });
  const closePo = useAction((reason: string) => api.post(`/purchasing/orders/${id}/close`, { reason }), { success: 'ปิดใบสั่งซื้อแล้ว', invalidate: INV, onSuccess: close });

  return (
    <QueryView q={q}>
      {(po) => {
        const create = can('purchase.create');
        const approver = can('purchase.approve');
        const receiver = can('inventory.edit');
        const receivedLines = po.items.filter((x) => Number(x.receivedQty) >= Number(x.quantity)).length;
        const vessel = vessels.data?.find((v) => v.id === po.vesselId);
        const wh = warehouses.data?.find((w) => w.id === po.warehouseId);
        const itemName = (poItemId: string) => po.items.find((x) => x.id === poItemId)?.description ?? '-';
        return (
          <>
            <PageHeader
              title={`ใบสั่งซื้อ ${po.poNo}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><PoBadge s={po.status} /> {po.supplier.code} · {po.supplier.name} <Link className="text-accent hover:underline" to="/purchasing?tab=orders">กลับไปรายการ</Link></span>}
              actions={
                <>
                  {po.status === 'DRAFT' && create && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                  {po.status === 'DRAFT' && approver && <Button onClick={() => setDlg('approve')}><Check /> อนุมัติ</Button>}
                  {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && receiver && <Button onClick={() => setDlg('receive')}><PackageCheck /> รับสินค้า</Button>}
                  {po.status === 'PARTIALLY_RECEIVED' && approver && <Button variant="outline" onClick={() => setDlg('close')}><Lock /> ปิดใบสั่งซื้อ</Button>}
                  {['DRAFT', 'APPROVED'].includes(po.status) && create && !po.receipts.length && <Button variant="danger-outline" onClick={() => setDlg('cancel')}><Ban /> ยกเลิก</Button>}
                </>
              }
            />
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="ยอดก่อน VAT (บาท)" value={formatMoney(po.subtotal)} sub={Number(po.discount) ? `ส่วนลด ${formatMoney(po.discount)}` : undefined} />
              <Stat label={`VAT ${formatNumber(po.vatRate, 2)}% (บาท)`} value={formatMoney(po.vatAmount)} />
              <Stat label="ยอดรวม (บาท)" value={formatMoney(po.total)} />
              <Stat label="รับแล้ว" value={`${formatNumber(receivedLines)}/${formatNumber(po.items.length)} รายการ`} tone={receivedLines === po.items.length ? 'ok' : undefined} />
            </div>
            <div className="space-y-4">
              <Panel title="ข้อมูลใบสั่งซื้อ">
                <DL cols={3} items={[
                  ['วันที่สั่งซื้อ', formatDate(po.orderDate)], ['กำหนดรับของ', formatDate(po.expectedDate)], ['คลังที่รับของ', wh ? `${wh.code} · ${wh.name}` : null],
                  ['ใบขอซื้อ', po.pr ? <Link className="text-accent hover:underline" to={`/purchasing/requests/${po.pr.id}`}>{po.pr.prNo}</Link> : null],
                  ['เรือ', vessel ? `${vessel.code} · ${vessel.name}` : null],
                  ['เที่ยวเรือ', po.tripId ? <Link className="text-accent hover:underline" to={`/trips/${po.tripId}`}>ดูเที่ยวเรือ</Link> : null],
                  ['อนุมัติเมื่อ', formatDateTime(po.approvedAt)], ['ปิดเมื่อ', po.closedAt ? `${formatDateTime(po.closedAt)}${po.closeReason ? ` · ${po.closeReason}` : ''}` : null],
                  ['หมายเหตุ', po.notes],
                ]} />
              </Panel>
              <Panel title="รายการสั่งซื้อ" bodyClass="p-0">
                {po.items.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-600">
                        <tr><th className="px-4 py-2">รายการ</th><th className="px-2">หมวด</th><th className="px-2 text-right">สั่ง</th><th className="px-2 text-right">รับแล้ว</th><th className="px-2 text-right">คงค้าง</th><th className="px-2">หน่วย</th><th className="px-2 text-right">ราคา/หน่วย</th><th className="px-4 text-right">รวม</th></tr>
                      </thead>
                      <tbody>
                        {po.items.map((x) => (
                          <tr key={x.id} className="border-t border-line">
                            <td className="px-4 py-2">{x.description}</td>
                            <td className="px-2">{SUPPLY_CATEGORY_TH[x.category]}</td>
                            <td className="px-2 text-right tabular-nums">{formatNumber(x.quantity, 2)}</td>
                            <td className="px-2 text-right tabular-nums">{formatNumber(x.receivedQty, 2)}</td>
                            <td className="px-2 text-right tabular-nums">{formatNumber(Math.max(0, Number(x.quantity) - Number(x.receivedQty)), 2)}</td>
                            <td className="px-2">{x.unit}</td>
                            <td className="px-2 text-right tabular-nums">{formatMoney(x.unitPrice)}</td>
                            <td className="px-4 text-right tabular-nums">{formatMoney(x.lineTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Empty />}
              </Panel>
              <Panel title={`การรับสินค้า (${po.receipts.length})`} bodyClass="p-0">
                {po.receipts.length ? (
                  <div className="divide-y divide-line">
                    {po.receipts.map((r) => (
                      <div key={r.id} className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <b>{r.grNo}</b><span>{formatDateTime(r.receivedAt)}</span>
                          {r.supplierInvoiceNo && <span className="text-muted">ใบส่งของ/ใบกำกับ: {r.supplierInvoiceNo}</span>}
                          {r.notes && <span className="text-muted">{r.notes}</span>}
                        </div>
                        <ul className="mt-1 text-xs text-slate-600">
                          {r.items.map((l) => <li key={l.poItemId}>{itemName(l.poItemId)} · {formatNumber(l.quantity, 2)} × {formatMoney(l.unitCost)} = {formatMoney(l.lineTotal)}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : <Empty title="ยังไม่มีการรับสินค้า" />}
              </Panel>
            </div>
            {dlg === 'edit' && <PoFormDialog po={po} onClose={close} />}
            {dlg === 'receive' && <ReceiveDialog po={po} onClose={close} />}
            <ConfirmDialog open={dlg === 'approve'} onOpenChange={close} title="อนุมัติใบสั่งซื้อ" message="ยืนยันอนุมัติใบสั่งซื้อนี้? หลังอนุมัติจะแก้ไขรายการไม่ได้" loading={approve.isPending} onConfirm={() => approve.mutate(undefined)} />
            <ConfirmDialog open={dlg === 'cancel'} onOpenChange={close} title="ยกเลิกใบสั่งซื้อ" danger requireReason loading={cancel.isPending} message="ยกเลิกได้เฉพาะก่อนมีการรับสินค้า" onConfirm={(r) => cancel.mutate(r)} />
            <ConfirmDialog open={dlg === 'close'} onOpenChange={close} title="ปิดใบสั่งซื้อ" requireReason confirmText="ปิดใบสั่งซื้อ" loading={closePo.isPending} message="ปิดใบสั่งซื้อที่รับสินค้าไม่ครบ รายการคงค้างจะไม่ถูกรับอีก" onConfirm={(r) => closePo.mutate(r)} />
          </>
        );
      }}
    </QueryView>
  );
}
