import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { EARNING_CODES, EMPLOYEE_POSITION_TH, formatDate, formatMoney, formatNumber, PAY_ITEM_CODE_TH, PAYROLL_WARNING_TH } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import type { Slip, SlipItem } from './types';

function Lines({ title, items, total }: { title: string; items: SlipItem[]; total: string }) {
  return (
    <div>
      <h2 className="mb-1 font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-y border-black text-left"><th className="py-1">รายการ</th><th className="text-right">จำนวน</th><th className="text-right">อัตรา</th><th className="text-right">จำนวนเงิน (บาท)</th></tr></thead>
          <tbody>
            {items.length ? items.map((x) => (
              <tr key={x.id} className="border-b border-slate-300 align-top">
                <td className="py-1">
                  {PAY_ITEM_CODE_TH[x.code]}{x.description ? ` — ${x.description}` : ''}
                  {(x.calc?.formula || x.calc?.source) && (
                    <span className="block text-xs text-slate-500 print:hidden">{[x.calc.formula, x.calc.source].filter(Boolean).join(' · ')}</span>
                  )}
                </td>
                <td className="text-right tabular-nums">{x.quantity != null ? formatNumber(x.quantity, 2) : '-'}</td>
                <td className="text-right tabular-nums">{x.rate != null ? formatMoney(x.rate) : '-'}</td>
                <td className="text-right tabular-nums">{formatMoney(x.amount)}</td>
              </tr>
            )) : <tr><td colSpan={4} className="py-2 text-center text-slate-500">ไม่มีรายการ</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3} className="pt-1 text-right font-semibold">รวม</td><td className="pt-1 text-right font-semibold tabular-nums">{formatMoney(total)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

export function PayslipPage() {
  const { id, recordId } = useParams() as { id: string; recordId: string };
  const q = useQuery({ queryKey: ['payroll', 'slip', id, recordId], queryFn: () => api.get<Slip>(`/payroll/periods/${id}/records/${recordId}`) });
  return (
    <QueryView q={q}>
      {(s) => {
        const { record: r, period: p } = s;
        const e = r.employee;
        const earnings = r.items.filter((x) => EARNING_CODES.includes(x.code));
        const deductions = r.items.filter((x) => !EARNING_CODES.includes(x.code));
        return (
          <>
            <div className="print:hidden">
              <PageHeader
                title={`สลิปเงินเดือน ${e.firstName} ${e.lastName}`}
                subtitle={<span>{p.code} · {p.name} <Link className="text-accent hover:underline" to={`/payroll/periods/${id}`}>กลับไปงวดเงินเดือน</Link></span>}
                actions={<Button variant="outline" onClick={() => window.print()}><Printer /> พิมพ์</Button>}
              />
              {(r.warnings ?? []).length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">{r.warnings!.map((w) => <Badge key={w} tone="warn" className="whitespace-normal">{PAYROLL_WARNING_TH[w] ?? w}</Badge>)}</div>
              )}
            </div>
            <div className="mx-auto max-w-[210mm] space-y-4 rounded-md border border-line bg-white p-6 text-sm text-black print:max-w-none print:rounded-none print:border-0 print:p-0">
              <div className="flex justify-between gap-4">
                <div><h1 className="text-xl font-bold">{s.companyName}</h1><p className="text-base font-semibold">สลิปเงินเดือน / ค่าตอบแทน</p></div>
                <dl className="grid grid-cols-[auto_auto] gap-x-3 text-right">
                  <dt>งวด</dt><dd>{p.code}</dd>
                  <dt>ชื่องวด</dt><dd>{p.name}</dd>
                  <dt>ช่วงเวลา</dt><dd>{formatDate(p.startDate)} – {formatDate(p.endDate)}</dd>
                  {p.payDate && <><dt>วันที่จ่าย</dt><dd>{formatDate(p.payDate)}</dd></>}
                </dl>
              </div>
              <div className="rounded border border-black p-2">
                <p className="font-semibold">{e.code} · {e.firstName} {e.lastName}{e.firstNameEn ? ` (${e.firstNameEn} ${e.lastNameEn ?? ''})` : ''}</p>
                <p>ตำแหน่ง {EMPLOYEE_POSITION_TH[r.position ?? e.position]}{r.vessel ? ` · เรือ ${r.vessel.name}` : ''}</p>
                {(e.bankName || e.bankAccountNo) && <p>บัญชีธนาคาร {[e.bankName, e.bankAccountNo].filter(Boolean).join(' ')}</p>}
                {s.trips.length > 0 && <p>เที่ยวเรือ: {s.trips.map((t) => t.tripNo).join(', ')}</p>}
              </div>
              <Lines title="รายได้" items={earnings} total={r.gross} />
              <Lines title="รายการหัก" items={deductions} total={r.deduction} />
              <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-right">
                <dt>รายได้รวม</dt><dd className="tabular-nums">{formatMoney(r.gross)}</dd>
                <dt>รายการหักรวม</dt><dd className="tabular-nums">-{formatMoney(r.deduction)}</dd>
                <dt className="text-base font-bold">จ่ายสุทธิ</dt><dd className="text-base font-bold tabular-nums">{formatMoney(r.net)}</dd>
              </dl>
              <div className="grid grid-cols-2 gap-8 pt-12 text-center">
                <div><div className="border-t border-black pt-1">ผู้จ่ายเงิน</div><div className="text-xs">วันที่ ____/____/______</div></div>
                <div><div className="border-t border-black pt-1">ผู้รับเงิน</div><div className="text-xs">วันที่ ____/____/______</div></div>
              </div>
            </div>
          </>
        );
      }}
    </QueryView>
  );
}
