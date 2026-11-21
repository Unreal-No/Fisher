import { useQuery } from '@tanstack/react-query';
import { Ban, Check, FileMinus, Pencil, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDate, formatDateTime, formatKg, formatMoney, formatNumber, PAYMENT_METHOD_TH } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DL, Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { INV, InvoiceDialog, PaymentDialog, ReturnDialog } from './sales-dialogs';
import { PayBadge, SalesBadge } from './status';
import type { Invoice } from './types';

const gradeOf = (x: { species: { nameTh: string }; grade: { nameTh: string } | null }) => `${x.species.nameTh}${x.grade ? ` ${x.grade.nameTh}` : ''}`;

export function SalesInvoicePage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['sales', 'invoice', id], queryFn: () => api.get<Invoice>(`/sales/invoices/${id}`) });
  const company = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ companyName?: string }>('/settings'), staleTime: 60_000 });
  const [dlg, setDlg] = useState<null | 'edit' | 'confirm' | 'cancel' | 'void' | 'pay' | 'return'>(null);
  const [voidPay, setVoidPay] = useState<string | null>(null);
  const close = () => setDlg(null);
  const confirm = useAction(() => api.post(`/sales/invoices/${id}/confirm`, {}), { success: 'ออกใบแจ้งหนี้แล้ว', invalidate: INV, onSuccess: close });
  const voidInv = useAction((reason: string) => api.post(`/sales/invoices/${id}/void`, { reason }), { success: 'ยกเลิกใบขายแล้ว', invalidate: INV, onSuccess: close });
  const voidPayment = useAction((v: { pid: string; reason: string }) => api.post(`/sales/payments/${v.pid}/void`, { reason: v.reason }), { success: 'ยกเลิกการรับชำระแล้ว', invalidate: INV, onSuccess: () => setVoidPay(null) });

  return (
    <QueryView q={q}>
      {(inv) => {
        const approver = can('sales.approve');
        const canPay = can('sales.create') || can('finance.edit');
        const canVoidPay = approver || can('finance.approve');
        const title = inv.invoiceNo ?? inv.orderNo;
        const isDraft = inv.status === 'DRAFT';
        const isConf = inv.status === 'CONFIRMED';
        return (
          <>
            <div className="print:hidden">
              <PageHeader
                title={`${isDraft ? 'ใบสั่งขาย' : 'ใบแจ้งหนี้'} ${title}`}
                subtitle={<span className="inline-flex flex-wrap items-center gap-2"><SalesBadge s={inv.status} /> <PayBadge s={isConf ? inv.paymentStatus : null} /> {inv.customer.code} · {inv.customer.name} <Link className="text-accent hover:underline" to="/sales">กลับไปรายการ</Link></span>}
                actions={
                  <>
                    {isDraft && can('sales.create') && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                    {isDraft && can('sales.create') && <Button onClick={() => setDlg('confirm')}><Check /> ยืนยันออกใบแจ้งหนี้</Button>}
                    {isDraft && approver && <Button variant="danger-outline" onClick={() => setDlg('cancel')}><Ban /> ยกเลิก</Button>}
                    {isConf && canPay && inv.outstanding > 0 && <Button onClick={() => setDlg('pay')}><Wallet /> รับชำระ</Button>}
                    {isConf && approver && <Button variant="outline" onClick={() => setDlg('return')}><FileMinus /> ออกใบลดหนี้</Button>}
                    {isConf && <Button variant="outline" onClick={() => window.print()}><Printer /> พิมพ์</Button>}
                    {isConf && approver && <Button variant="danger-outline" onClick={() => setDlg('void')}><Ban /> ยกเลิกใบแจ้งหนี้</Button>}
                  </>
                }
              />
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="ยอดรวม (บาท)" value={formatMoney(inv.total)} />
                <Stat label="ชำระแล้ว (บาท)" value={formatMoney(inv.paidAmount)} tone={Number(inv.paidAmount) > 0 ? 'ok' : undefined} />
                <Stat label="ลดหนี้ (บาท)" value={formatMoney(inv.creditedAmount)} />
                <Stat label="คงค้าง (บาท)" value={formatMoney(inv.outstanding)} tone={isConf && inv.outstanding > 0 ? 'warn' : undefined} />
              </div>
              <div className="space-y-4">
                {inv.status === 'VOID' && (
                  <div className="rounded border border-line bg-slate-50 px-3 py-2 text-sm">ยกเลิกเมื่อ {formatDateTime(inv.voidedAt)} · เหตุผล: {inv.voidReason ?? '-'}</div>
                )}
                <Panel title="ข้อมูลใบขาย">
                  <DL cols={3} items={[
                    ['เลขที่ใบสั่งขาย', inv.orderNo], ['เลขที่ใบแจ้งหนี้', inv.invoiceNo], ['ยืนยันเมื่อ', formatDateTime(inv.confirmedAt)],
                    ['วันที่ขาย', formatDate(inv.invoiceDate)], ['ครบกำหนดชำระ', formatDate(inv.dueDate)],
                    ['ลูกค้า', `${inv.customer.code} · ${inv.customer.name}`], ['เลขผู้เสียภาษี', inv.customer.taxId], ['สาขา', inv.customer.branch],
                    ['หมายเหตุ', inv.notes],
                  ]} />
                </Panel>
                <Panel title="รายการขาย" bodyClass="p-0">
                  {inv.items.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-600">
                          <tr><th className="px-4 py-2">ล็อต/เที่ยวเรือ</th><th className="px-2">ชนิด/เกรด</th><th className="px-2 text-right">น้ำหนัก (กก.)</th><th className="px-2 text-right">ราคา/กก.</th><th className="px-2 text-right">รวม</th><th className="px-4 text-right">คืนแล้ว</th></tr>
                        </thead>
                        <tbody>
                          {inv.items.map((x) => (
                            <tr key={x.id} className="border-t border-line">
                              <td className="px-4 py-2"><Link className="text-accent hover:underline" to={`/trips/${x.tripId}`}>{x.trip.tripNo}</Link> <span className="text-xs text-muted">{x.trip.vessel.name}</span></td>
                              <td className="px-2">{gradeOf(x)}{x.description && <span className="block text-xs text-muted">{x.description}</span>}</td>
                              <td className="px-2 text-right tabular-nums">{formatKg(x.weightKg)}</td>
                              <td className="px-2 text-right tabular-nums">{formatMoney(x.unitPrice)}</td>
                              <td className="px-2 text-right tabular-nums">{formatMoney(x.lineTotal)}</td>
                              <td className="px-4 text-right tabular-nums">{Number(x.returnedKg) ? `${formatKg(x.returnedKg)} กก. / ${formatMoney(x.returnedAmount)}` : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <Empty />}
                </Panel>
                <Panel title={`การรับชำระ (${inv.payments.length})`} bodyClass="p-0">
                  {inv.payments.length ? (
                    <div className="divide-y divide-line">
                      {inv.payments.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                          <b className={p.voidedAt ? 'line-through' : ''}>{p.receiptNo}</b><span>{formatDateTime(p.paidAt)}</span>
                          <span>{PAYMENT_METHOD_TH[p.method]}</span>{p.reference && <span className="text-muted">อ้างอิง {p.reference}</span>}
                          {p.notes && <span className="text-muted">{p.notes}</span>}
                          <span className={`ml-auto tabular-nums ${p.voidedAt ? 'line-through' : ''}`}>{formatMoney(p.amount)}</span>
                          {p.voidedAt ? <Badge tone="neutral">ยกเลิก: {p.voidReason}</Badge>
                            : canVoidPay && isConf && <Button size="sm" variant="danger-outline" onClick={() => setVoidPay(p.id)}>ยกเลิก</Button>}
                        </div>
                      ))}
                    </div>
                  ) : <Empty title="ยังไม่มีการรับชำระ" />}
                </Panel>
                <Panel title={`ใบลดหนี้ (${inv.returns.length})`} bodyClass="p-0">
                  {inv.returns.length ? (
                    <div className="divide-y divide-line">
                      {inv.returns.map((r) => (
                        <div key={r.id} className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><b>{r.creditNoteNo}</b><span>{formatDate(r.returnDate)}</span><span className="text-muted">{r.reason}</span><span className="ml-auto tabular-nums">{formatMoney(r.amount)} (ไม่รวม VAT)</span></div>
                          <ul className="mt-1 text-xs text-slate-600">
                            {r.items.map((l) => {
                              const it = inv.items.find((x) => x.id === l.salesItemId);
                              return <li key={l.salesItemId}>{it ? gradeOf(it) : '-'} · {formatKg(l.weightKg)} กก. · {formatMoney(l.amount)}</li>;
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : <Empty title="ยังไม่มีใบลดหนี้" />}
                </Panel>
              </div>
            </div>

            <PrintInvoice inv={inv} company={company.data?.companyName} />

            {dlg === 'edit' && <InvoiceDialog invoice={inv} onClose={close} />}
            {dlg === 'pay' && <PaymentDialog invoice={inv} onClose={close} />}
            {dlg === 'return' && <ReturnDialog invoice={inv} onClose={close} />}
            <ConfirmDialog open={dlg === 'confirm'} onOpenChange={close} title="ยืนยันออกใบแจ้งหนี้" message="ยืนยันออกใบแจ้งหนี้? ระบบจะตัดยอดขายออกจากล็อตและแก้ไขรายการไม่ได้อีก" loading={confirm.isPending} onConfirm={() => confirm.mutate(undefined)} />
            <ConfirmDialog open={dlg === 'cancel'} onOpenChange={close} title="ยกเลิกใบสั่งขาย" danger requireReason loading={voidInv.isPending} message="ยกเลิกใบสั่งขายฉบับร่างนี้" onConfirm={(r) => voidInv.mutate(r)} />
            <ConfirmDialog open={dlg === 'void'} onOpenChange={close} title="ยกเลิกใบแจ้งหนี้" danger requireReason loading={voidInv.isPending} message="ยกเลิกได้เมื่อไม่มีการรับชำระและใบลดหนี้ที่ยังใช้งาน น้ำหนักจะกลับเข้าล็อต" onConfirm={(r) => voidInv.mutate(r)} />
            <ConfirmDialog open={!!voidPay} onOpenChange={(o) => !o && setVoidPay(null)} title="ยกเลิกการรับชำระ" danger requireReason loading={voidPayment.isPending} message="ยกเลิกรายการรับชำระนี้ ยอดคงค้างจะเพิ่มขึ้น" onConfirm={(r) => voidPay && voidPayment.mutate({ pid: voidPay, reason: r })} />
          </>
        );
      }}
    </QueryView>
  );
}

function PrintInvoice({ inv, company }: { inv: Invoice; company?: string }) {
  return (
    <div className="hidden space-y-4 text-sm text-black print:block">
      <div className="flex justify-between">
        <div><h1 className="text-xl font-bold">{company ?? ''}</h1><p className="text-base font-semibold">{inv.invoiceNo ? 'ใบแจ้งหนี้' : 'ใบสั่งขาย'}</p></div>
        <dl className="grid grid-cols-2 gap-x-3 text-right">
          <dt>เลขที่</dt><dd>{inv.invoiceNo ?? inv.orderNo}</dd>
          <dt>วันที่</dt><dd>{formatDate(inv.invoiceDate)}</dd>
          <dt>ครบกำหนด</dt><dd>{formatDate(inv.dueDate)}</dd>
        </dl>
      </div>
      <div className="rounded border border-black p-2">
        <p className="font-semibold">{inv.customer.name}</p>
        {inv.customer.taxId && <p>เลขผู้เสียภาษี {inv.customer.taxId}{inv.customer.branch ? ` สาขา ${inv.customer.branch}` : ''}</p>}
        {inv.customer.address && <p>{inv.customer.address}</p>}
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="border-y border-black text-left"><th className="py-1">รายการ</th><th className="text-right">น้ำหนัก (กก.)</th><th className="text-right">ราคา/กก.</th><th className="text-right">รวม (บาท)</th></tr></thead>
        <tbody>
          {inv.items.map((x) => (
            <tr key={x.id} className="border-b border-slate-300"><td className="py-1">{x.description || gradeOf(x)}</td><td className="text-right">{formatKg(x.weightKg)}</td><td className="text-right">{formatMoney(x.unitPrice)}</td><td className="text-right">{formatMoney(x.lineTotal)}</td></tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-right">
        <dt>รวมเป็นเงิน</dt><dd>{formatMoney(inv.subtotal)}</dd>
        <dt>ส่วนลด</dt><dd>-{formatMoney(inv.discount)}</dd>
        <dt>ค่าใช้จ่ายเพิ่ม</dt><dd>{formatMoney(inv.additionalCost)}</dd>
        <dt>VAT {formatNumber(inv.vatRate, 2)}%</dt><dd>{formatMoney(inv.vatAmount)}</dd>
        <dt className="font-bold">ยอดรวมสุทธิ</dt><dd className="font-bold">{formatMoney(inv.total)}</dd>
      </dl>
      {inv.notes && <p>หมายเหตุ: {inv.notes}</p>}
    </div>
  );
}
