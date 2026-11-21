import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ADVANCE_KIND_TH, formatDate, formatMoney } from '@fisher/shared';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { AdvanceStatusBadge, PayrollStatusBadge } from './status';
import type { EmployeeHistory } from './types';

export function EmployeePayrollTab({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: ['employee-payroll', employeeId], queryFn: () => api.get<EmployeeHistory>(`/payroll/employees/${employeeId}/history`) });
  return (
    <QueryView q={q}>
      {(h) => (
        <div className="space-y-4">
          <Panel title="ประวัติเงินเดือน" bodyClass="p-0">
            {h.records.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr><th className="px-4 py-2">งวด</th><th className="px-2">ช่วงเวลา</th><th className="px-2">สถานะ</th><th className="px-2 text-right">รายได้</th><th className="px-2 text-right">หัก</th><th className="px-2 text-right">สุทธิ</th><th className="px-4" /></tr>
                  </thead>
                  <tbody>
                    {h.records.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="whitespace-nowrap px-4 py-2"><Link className="text-accent hover:underline" to={`/payroll/periods/${r.period.id}`}>{r.period.code}</Link> <span className="text-muted">{r.period.name}</span></td>
                        <td className="whitespace-nowrap px-2">{formatDate(r.period.startDate)} – {formatDate(r.period.endDate)}</td>
                        <td className="px-2"><PayrollStatusBadge s={r.period.status} /></td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.gross)}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.deduction)}</td>
                        <td className="px-2 text-right tabular-nums">{formatMoney(r.net)}</td>
                        <td className="px-4 text-right"><Link className="text-accent hover:underline" to={`/payroll/periods/${r.period.id}/slips/${r.id}`}>สลิป</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title="ยังไม่มีประวัติเงินเดือน" />}
          </Panel>
          <Panel title="เงินเบิก/เงินกู้" bodyClass="p-0">
            {h.advances.length ? (
              <div className="divide-y divide-line">
                {h.advances.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                    <b>{a.advanceNo}</b><span>{ADVANCE_KIND_TH[a.kind]}</span><span>{formatDate(a.advanceDate)}</span><span className="text-muted">{a.reason}</span>
                    <span className="ml-auto tabular-nums">{formatMoney(a.amount)} (ค้าง {formatMoney(a.outstanding)})</span>
                    <AdvanceStatusBadge s={a.status} />
                  </div>
                ))}
              </div>
            ) : <Empty title="ไม่มีรายการเงินเบิก/เงินกู้" />}
          </Panel>
        </div>
      )}
    </QueryView>
  );
}
