import { useQuery } from '@tanstack/react-query';
import { Ban, Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useParams } from 'react-router';
import { BILL_LINE_KIND_TH, formatDate, formatDateTime, formatMoney } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DL, Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { INV } from './lookups';
import { BillStatusBadge, VPayStatusBadge } from './status';
import type { BillDetail } from './types';
import { VendorBillDialog } from './vendor-bill-dialog';

export function VendorBillPage() {
  const { id } = useParams() as { id: string };
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['accounting', 'ap-bill', id], queryFn: () => api.get<BillDetail>(`/accounting/ap/bills/${id}`) });
  const [dlg, setDlg] = useState<null | 'edit' | 'approve' | 'void'>(null);
  const close = () => setDlg(null);
  const approve = useAction(() => api.post(`/accounting/ap/bills/${id}/approve`, {}), { success: 'อนุมัติใบแจ้งหนี้แล้ว', invalidate: INV, onSuccess: close });
  const voidIt = useAction((reason: string) => api.post(`/accounting/ap/bills/${id}/void`, { reason }), { success: 'ยกเลิกใบแจ้งหนี้แล้ว', invalidate: INV, onSuccess: close });
  return (
    <QueryView q={q}>
      {(b) => {
        const self = !!me && b.createdById === me.id;
        return (
          <>
            <PageHeader
              title={`ใบแจ้งหนี้ผู้ขาย ${b.billNo}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><BillStatusBadge s={b.status} /> {formatDate(b.billDate)} <Link className="text-accent hover:underline" to="/accounting?tab=ap">กลับไปเจ้าหนี้</Link></span>}
              actions={
                <>
                  {b.status === 'DRAFT' && can('finance.edit') && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                  {b.status === 'DRAFT' && can('finance.approve') && (
                    <Button disabled={self} title={self ? 'ผู้บันทึกอนุมัติของตัวเองไม่ได้' : undefined} onClick={() => setDlg('approve')}><Check /> อนุมัติ</Button>
                  )}
                  {b.status !== 'VOID' && can('finance.approve') && <Button variant="danger-outline" onClick={() => setDlg('void')}><Ban /> ยกเลิก</Button>}
                </>
              }
            />
            {b.status === 'DRAFT' && self && can('finance.approve') && <p className="-mt-2 mb-3 text-xs text-muted">ผู้บันทึกอนุมัติของตัวเองไม่ได้ — ต้องให้ผู้อื่นอนุมัติ</p>}
            <div className="space-y-4">
              <Panel title="ข้อมูลใบแจ้งหนี้">
                <DL cols={3} items={[
                  ['ผู้ขาย', `${b.supplier.code} ${b.supplier.name}`], ['เลขผู้เสียภาษี', b.supplier.taxId], ['เลขที่ใบแจ้งหนี้ผู้ขาย', b.supplierInvoiceNo],
                  ['วันที่', formatDate(b.billDate)], ['ครบกำหนด', b.dueDate ? formatDate(b.dueDate) : null], ['หมายเหตุ', b.notes],
                ]} />
              </Panel>
              <Panel title={`รายการ (${b.lines.length})`} bodyClass="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="px-4 py-2">#</th><th className="px-2">ประเภท</th><th className="px-2">รายการ</th><th className="px-2">เรือ/เที่ยว</th><th className="px-4 text-right">จำนวนเงิน</th></tr>
                    </thead>
                    <tbody>
                      {b.lines.map((l) => (
                        <tr key={l.lineNo} className="border-t border-line align-top">
                          <td className="px-4 py-2 text-muted">{l.lineNo}</td>
                          <td className="whitespace-nowrap px-2 py-2">{BILL_LINE_KIND_TH[l.kind]}</td>
                          <td className="px-2 py-2">
                            {l.goodsReceipt ? <Link className="text-accent hover:underline" to={`/purchasing/orders/${l.goodsReceipt.poId}`}>{l.goodsReceipt.grNo}</Link> : `${l.account?.code ?? ''} ${l.account?.nameTh ?? ''}`}
                            {l.description ? <span className="text-muted"> · {l.description}</span> : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2">{[l.vessel?.name, l.trip?.tripNo].filter(Boolean).join(' · ') || '-'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-line bg-slate-50">
                      <tr><td colSpan={4} className="px-4 py-1.5 text-right">รวมก่อน VAT</td><td className="px-4 text-right tabular-nums">{formatMoney(b.subtotal)}</td></tr>
                      <tr><td colSpan={4} className="px-4 py-1.5 text-right">VAT {Number(b.vatRate)}%</td><td className="px-4 text-right tabular-nums">{formatMoney(b.vatAmount)}</td></tr>
                      <tr className="font-semibold"><td colSpan={4} className="px-4 py-1.5 text-right">รวมทั้งสิ้น</td><td className="px-4 text-right tabular-nums">{formatMoney(b.total)}</td></tr>
                      <tr><td colSpan={4} className="px-4 py-1.5 text-right">จ่ายแล้ว</td><td className="px-4 text-right tabular-nums">{formatMoney(b.paidAmount)}</td></tr>
                      <tr className="font-semibold"><td colSpan={4} className="px-4 py-1.5 text-right">ค้างชำระ</td><td className={`px-4 text-right tabular-nums ${Number(b.outstanding) > 0 ? 'text-warn' : 'text-ok'}`}>{formatMoney(b.outstanding)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </Panel>
              <Panel title="การจ่ายชำระ" bodyClass="p-0">
                {b.allocations.length === 0 ? <p className="p-4 text-sm text-muted">ยังไม่มีการจ่ายชำระ</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">เลขที่</th><th className="px-2">วันที่จ่าย</th><th className="px-2">สถานะ</th><th className="px-4 text-right">จำนวนที่ตัดหนี้</th></tr></thead>
                      <tbody>
                        {b.allocations.map((a) => (
                          <tr key={a.payment.id} className="border-t border-line">
                            <td className="px-4 py-2">{a.payment.paymentNo}</td><td className="px-2">{formatDateTime(a.payment.paidAt)}</td>
                            <td className="px-2"><VPayStatusBadge s={a.payment.status} /></td><td className="px-4 text-right tabular-nums">{formatMoney(a.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
            {dlg === 'edit' && <VendorBillDialog bill={b} onClose={close} />}
            <ConfirmDialog open={dlg === 'approve'} onOpenChange={close} title="อนุมัติใบแจ้งหนี้" message="เมื่ออนุมัติแล้วระบบจะบันทึกเจ้าหนี้ และแก้ไขไม่ได้" loading={approve.isPending} onConfirm={() => approve.mutate(undefined)} />
            <ConfirmDialog open={dlg === 'void'} onOpenChange={close} title="ยกเลิกใบแจ้งหนี้" danger requireReason loading={voidIt.isPending} message={`ยกเลิก ${b.billNo}`} onConfirm={(r) => voidIt.mutate(r)} />
          </>
        );
      }}
    </QueryView>
  );
}
