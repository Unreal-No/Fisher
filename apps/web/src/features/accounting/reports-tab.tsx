import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Link } from 'react-router';
import { formatDate, formatMoney, toISODate, ACCOUNT_TYPE_TH } from '@fisher/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { ExportMenu } from '@/components/ui/export-menu';
import type { useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { accountOptions, useAccounts } from './lookups';
import type { BalanceSheet, CashFlow, GeneralLedger, ProfitLoss, RepLine, TrialBalance } from './types';

type LP = ReturnType<typeof useListParams>;
const REPORTS = [
  { value: 'tb', label: 'งบทดลอง' }, { value: 'pl', label: 'งบกำไรขาดทุน' }, { value: 'bs', label: 'งบแสดงฐานะการเงิน' }, { value: 'gl', label: 'บัญชีแยกประเภท' }, { value: 'cf', label: 'งบกระแสเงินสด' },
];
const TITLE: Record<string, string> = Object.fromEntries(REPORTS.map((r) => [r.value, r.label]));
const th = 'px-3 py-2';
const money = (n: number) => formatMoney(n);
const Balanced = ({ ok }: { ok: boolean }) => <Badge tone={ok ? 'ok' : 'bad'}>{ok ? 'สมดุล' : 'ไม่สมดุล'}</Badge>;

function PrintHead({ title, range }: { title: string; range: string }) {
  return <div className="hidden text-center print:block"><h1 className="text-lg font-bold">{title}</h1><p className="text-sm">{range}</p></div>;
}

export function ReportsTab({ lp }: { lp: LP }) {
  const rep = lp.get('report') || 'tb';
  const today = toISODate();
  const from = lp.get('rfrom') || `${today.slice(0, 4)}-01-01`;
  const to = lp.get('rto') || today;
  const vesselId = lp.get('rvessel');
  const accountId = lp.get('raccount');
  const vessels = useVessels();
  const accounts = useAccounts();
  const asRange = rep === 'bs' ? `ณ วันที่ ${formatDate(to)}` : `${formatDate(from)} – ${formatDate(to)}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 print:hidden [&_select]:w-auto [&_select]:min-w-36">
        <Select options={REPORTS} value={rep} onChange={(e) => lp.set({ report: e.target.value })} aria-label="รายงาน" />
        {rep !== 'bs' && <Input type="date" className="w-auto" aria-label="ตั้งแต่วันที่" value={from} onChange={(e) => e.target.value && lp.set({ rfrom: e.target.value })} />}
        {rep !== 'bs' && <span className="pb-2 text-muted">–</span>}
        <Input type="date" className="w-auto" aria-label={rep === 'bs' ? 'ณ วันที่' : 'ถึงวันที่'} value={to} onChange={(e) => e.target.value && lp.set({ rto: e.target.value })} />
        {(rep === 'pl' || rep === 'gl') && <Select options={vesselOptions(vessels.data)} placeholder="ทุกลำ" value={vesselId} onChange={(e) => lp.set({ rvessel: e.target.value })} aria-label="เรือ" />}
        {rep === 'gl' && <Select options={accountOptions(accounts.data, false)} placeholder="เลือกบัญชี" value={accountId} onChange={(e) => lp.set({ raccount: e.target.value })} aria-label="บัญชี" />}
        <Button variant="outline" className="ml-auto" onClick={() => window.print()}><Printer /> พิมพ์</Button>
      </div>
      <div className="space-y-3 print:space-y-2">
        <PrintHead title={TITLE[rep] ?? ""} range={asRange} />
        {rep === 'tb' && <TrialBalanceView from={from} to={to} range={asRange} />}
        {rep === 'pl' && <ProfitLossView from={from} to={to} vesselId={vesselId} range={asRange} />}
        {rep === 'bs' && <BalanceSheetView asOf={to} range={asRange} />}
        {rep === 'cf' && <CashFlowView from={from} to={to} range={asRange} />}
        {rep === 'gl' && (accountId ? <LedgerView from={from} to={to} vesselId={vesselId} accountId={accountId} range={asRange} /> : <p className="text-sm text-muted">เลือกบัญชีเพื่อดูบัญชีแยกประเภท</p>)}
      </div>
    </div>
  );
}

const Csv = ({ name, rows }: { name: string; rows: (string | number | null)[][] }) => (
  <ExportMenu size="sm" className="print:hidden" baseName={name.replace(/\.csv$/, '')} rows={() => rows} />
);

function TrialBalanceView({ from, to, range }: { from: string; to: string; range: string }) {
  const q = useQuery({ queryKey: ['accounting', 'rep', 'tb', from, to], queryFn: () => api.get<TrialBalance>('/accounting/reports/trial-balance', { from, to }) });
  return (
    <QueryView q={q}>
      {(d) => (
        <Panel title={<span className="inline-flex items-center gap-2">งบทดลอง <Balanced ok={d.balanced} /></span>} bodyClass="p-0"
          actions={<Csv name={`trial-balance-${to}.csv`} rows={[['รหัส', 'ชื่อบัญชี', 'หมวด', 'ยกมา', 'เดบิต', 'เครดิต', 'คงเหลือ'], ...d.items.map((i) => [i.code, i.nameTh, ACCOUNT_TYPE_TH[i.type], i.opening, i.debit, i.credit, i.closing]), ['', 'รวม', '', '', d.totals.debit, d.totals.credit, '']]} />}>
          <p className="px-4 pt-2 text-xs text-muted print:hidden">{range}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>รหัส</th><th className={th}>ชื่อบัญชี</th><th className={`${th} text-right`}>ยกมา</th><th className={`${th} text-right`}>เดบิต</th><th className={`${th} text-right`}>เครดิต</th><th className={`${th} text-right`}>คงเหลือ</th></tr></thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.accountId} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{i.code}</td><td className="whitespace-nowrap px-3 py-1.5">{i.nameTh}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(i.opening)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(i.debit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(i.credit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(i.closing)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-slate-50 font-semibold">
                <tr><td colSpan={3} className={`${th} text-right`}>รวม</td><td className={`${th} text-right tabular-nums`}>{money(d.totals.debit)}</td><td className={`${th} text-right tabular-nums`}>{money(d.totals.credit)}</td><td /></tr>
                <tr><td colSpan={5} className={`${th} text-right`}>ยอดคงเหลือรวม เดบิต / เครดิต</td><td className={`${th} text-right tabular-nums`}>{money(d.totals.closingDebit)} / {money(d.totals.closingCredit)}</td></tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      )}
    </QueryView>
  );
}

function Section({ title, lines, total, totalLabel }: { title: string; lines: RepLine[]; total: number; totalLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th} colSpan={2}>{title}</th><th className={`${th} text-right`}>บาท</th></tr></thead>
        <tbody>
          {lines.length ? lines.map((l) => <tr key={l.accountId} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{l.code}</td><td className="px-3 py-1.5">{l.nameTh}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(l.amount)}</td></tr>)
            : <tr className="border-t border-line"><td colSpan={3} className="px-3 py-2 text-center text-muted">ไม่มีรายการ</td></tr>}
        </tbody>
        <tfoot className="border-t border-line bg-slate-50 font-semibold"><tr><td colSpan={2} className={`${th} text-right`}>{totalLabel}</td><td className={`${th} text-right tabular-nums`}>{money(total)}</td></tr></tfoot>
      </table>
    </div>
  );
}

function ProfitLossView({ from, to, vesselId, range }: { from: string; to: string; vesselId: string; range: string }) {
  const q = useQuery({ queryKey: ['accounting', 'rep', 'pl', from, to, vesselId], queryFn: () => api.get<ProfitLoss>('/accounting/reports/profit-loss', { from, to, vesselId }) });
  return (
    <QueryView q={q}>
      {(d) => (
        <Panel title="งบกำไรขาดทุน" bodyClass="p-0 space-y-3"
          actions={<Csv name={`profit-loss-${from}_${to}.csv`} rows={[['หมวด', 'รหัส', 'ชื่อบัญชี', 'จำนวนเงิน'],
            ...d.revenue.map((l) => ['รายได้', l.code, l.nameTh, l.amount]), ['รายได้', '', 'รวมรายได้', d.totalRevenue],
            ...d.expenses.map((l) => ['ค่าใช้จ่าย', l.code, l.nameTh, l.amount]), ['ค่าใช้จ่าย', '', 'รวมค่าใช้จ่าย', d.totalExpense], ['', '', 'กำไร(ขาดทุน)สุทธิ', d.netProfit],
            [], ['เรือ', 'รหัส', '', 'รายได้', 'ค่าใช้จ่าย', 'กำไร'], ...d.byVessel.map((v) => [v.name, v.code, '', v.revenue, v.expense, v.profit])]} />}>
          <p className="px-4 pt-2 text-xs text-muted print:hidden">{range}</p>
          <Section title="รายได้" lines={d.revenue} total={d.totalRevenue} totalLabel="รวมรายได้" />
          <Section title="ค่าใช้จ่าย" lines={d.expenses} total={d.totalExpense} totalLabel="รวมค่าใช้จ่าย" />
          <div className={`flex justify-between border-t border-line px-3 py-3 text-base font-bold ${d.netProfit < 0 ? 'text-bad' : 'text-ok'}`}><span>กำไร (ขาดทุน) สุทธิ</span><span className="tabular-nums">{money(d.netProfit)}</span></div>
          {d.byVessel.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>เรือ</th><th className={`${th} text-right`}>รายได้</th><th className={`${th} text-right`}>ค่าใช้จ่าย</th><th className={`${th} text-right`}>กำไร</th></tr></thead>
                <tbody>
                  {d.byVessel.map((v) => <tr key={v.vesselId} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5">{v.code} · {v.name}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(v.revenue)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(v.expense)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(v.profit)}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </QueryView>
  );
}

function BalanceSheetView({ asOf, range }: { asOf: string; range: string }) {
  const q = useQuery({ queryKey: ['accounting', 'rep', 'bs', asOf], queryFn: () => api.get<BalanceSheet>('/accounting/reports/balance-sheet', { asOf }) });
  return (
    <QueryView q={q}>
      {(d) => (
        <Panel title={<span className="inline-flex items-center gap-2">งบแสดงฐานะการเงิน <Balanced ok={d.balanced} /></span>} bodyClass="p-0 space-y-3"
          actions={<Csv name={`balance-sheet-${asOf}.csv`} rows={[['หมวด', 'รหัส', 'ชื่อบัญชี', 'จำนวนเงิน'],
            ...d.assets.map((l) => ['สินทรัพย์', l.code, l.nameTh, l.amount]), ['สินทรัพย์', '', 'รวมสินทรัพย์', d.totalAssets],
            ...d.liabilities.map((l) => ['หนี้สิน', l.code, l.nameTh, l.amount]), ['หนี้สิน', '', 'รวมหนี้สิน', d.totalLiabilities],
            ...d.equity.map((l) => ['ส่วนของเจ้าของ', l.code, l.nameTh, l.amount]), ['ส่วนของเจ้าของ', '', 'กำไรสะสมยังไม่ปิดบัญชี', d.unclosedEarnings], ['ส่วนของเจ้าของ', '', 'รวมส่วนของเจ้าของ', d.totalEquity]]} />}>
          <p className="px-4 pt-2 text-xs text-muted print:hidden">{range}</p>
          <Section title="สินทรัพย์" lines={d.assets} total={d.totalAssets} totalLabel="รวมสินทรัพย์" />
          <Section title="หนี้สิน" lines={d.liabilities} total={d.totalLiabilities} totalLabel="รวมหนี้สิน" />
          <Section title="ส่วนของเจ้าของ" lines={[...d.equity, { accountId: 'unclosed', code: '', nameTh: 'กำไร(ขาดทุน)สะสมที่ยังไม่ปิดบัญชี', amount: d.unclosedEarnings }]} total={d.totalEquity} totalLabel="รวมส่วนของเจ้าของ" />
          <div className="flex justify-between border-t border-line px-3 py-3 font-semibold"><span>รวมหนี้สินและส่วนของเจ้าของ</span><span className="tabular-nums">{money(d.totalLiabilities + d.totalEquity)}</span></div>
        </Panel>
      )}
    </QueryView>
  );
}

function LedgerView({ from, to, vesselId, accountId, range }: { from: string; to: string; vesselId: string; accountId: string; range: string }) {
  const q = useQuery({ queryKey: ['accounting', 'rep', 'gl', from, to, vesselId, accountId], queryFn: () => api.get<GeneralLedger>('/accounting/reports/general-ledger', { accountId, from, to, vesselId }) });
  return (
    <QueryView q={q}>
      {(d) => (
        <Panel title={d.account ? `บัญชีแยกประเภท ${d.account.code} ${d.account.nameTh}` : 'บัญชีแยกประเภท'} bodyClass="p-0"
          actions={<Csv name={`ledger-${d.account?.code ?? accountId}.csv`} rows={[['วันที่', 'เลขที่', 'คำอธิบาย', 'เรือ', 'เที่ยว', 'เดบิต', 'เครดิต', 'คงเหลือ'], ['', '', 'ยอดยกมา', '', '', '', '', d.opening],
            ...d.items.map((i) => [i.entryDate.slice(0, 10), i.entryNo, i.description ?? i.memo, i.vesselCode, i.tripNo, i.debit, i.credit, i.balance]), ['', '', 'รวม', '', '', d.totalDebit, d.totalCredit, d.closing]]} />}>
          <p className="px-4 pt-2 text-xs text-muted print:hidden">{range}</p>
          {d.truncated && <p className="mx-4 mt-2 rounded border border-amber-300 bg-warn-soft px-3 py-2 text-sm text-warn">แสดงเฉพาะบางส่วนของรายการ — โปรดจำกัดช่วงวันที่ให้แคบลง</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>วันที่</th><th className={th}>เลขที่</th><th className={th}>คำอธิบาย</th><th className={th}>เรือ/เที่ยว</th><th className={`${th} text-right`}>เดบิต</th><th className={`${th} text-right`}>เครดิต</th><th className={`${th} text-right`}>คงเหลือ</th></tr></thead>
              <tbody>
                <tr className="border-t border-line bg-slate-50/50"><td colSpan={6} className="px-3 py-1.5 font-medium">ยอดยกมา</td><td className="px-3 py-1.5 text-right tabular-nums">{money(d.opening)}</td></tr>
                {d.items.map((i, idx) => (
                  <tr key={`${i.entryId}-${idx}`} className="border-t border-line align-top">
                    <td className="whitespace-nowrap px-3 py-1.5">{formatDate(i.entryDate)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5"><Link className="text-accent hover:underline" to={`/accounting/journals/${i.entryId}`}>{i.entryNo}</Link></td>
                    <td className="px-3 py-1.5">{i.description ?? i.memo}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{[i.vesselCode, i.tripNo].filter(Boolean).join(' · ') || '-'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{i.debit ? money(i.debit) : ''}</td><td className="px-3 py-1.5 text-right tabular-nums">{i.credit ? money(i.credit) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-slate-50 font-semibold"><tr><td colSpan={4} className={`${th} text-right`}>รวม / ยอดคงเหลือ</td><td className={`${th} text-right tabular-nums`}>{money(d.totalDebit)}</td><td className={`${th} text-right tabular-nums`}>{money(d.totalCredit)}</td><td className={`${th} text-right tabular-nums`}>{money(d.closing)}</td></tr></tfoot>
            </table>
          </div>
        </Panel>
      )}
    </QueryView>
  );
}

function CfRows({ title, lines }: { title: string; lines: RepLine[] }) {
  return (
    <>
      <tr className="border-t border-line bg-slate-50/60"><td colSpan={3} className="px-3 py-1.5 text-xs font-medium text-slate-600">{title}</td></tr>
      {lines.length ? lines.map((l) => <tr key={l.accountId} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{l.code}</td><td className="px-3 py-1.5">{l.nameTh}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(l.amount)}</td></tr>)
        : <tr className="border-t border-line"><td colSpan={3} className="px-3 py-1.5 text-center text-muted">ไม่มีรายการ</td></tr>}
    </>
  );
}
const CfTotal = ({ label, v }: { label: string; v: number }) => (
  <tr className="border-t border-line bg-slate-50 font-semibold"><td colSpan={2} className={`${th} text-right`}>{label}</td><td className={`${th} text-right tabular-nums`}>{money(v)}</td></tr>
);

function CashFlowView({ from, to, range }: { from: string; to: string; range: string }) {
  const q = useQuery({ queryKey: ['accounting', 'rep', 'cf', from, to], queryFn: () => api.get<CashFlow>('/accounting/reports/cash-flow', { from, to }) });
  return (
    <QueryView q={q}>
      {(d) => (
        <Panel title={<span className="inline-flex items-center gap-2">งบกระแสเงินสด <Balanced ok={d.balanced} /></span>} bodyClass="p-0"
          actions={<Csv name={`cash-flow-${from}_${to}.csv`} rows={[['หมวด', 'รหัส', 'รายการ', 'จำนวนเงิน'],
            ['กิจกรรมดำเนินงาน', '', 'กำไร(ขาดทุน)สุทธิ', d.netProfit],
            ...d.operating.adjustments.map((l) => ['รายการปรับปรุงที่ไม่ใช่เงินสด', l.code, l.nameTh, l.amount]),
            ...d.operating.workingCapital.map((l) => ['การเปลี่ยนแปลงเงินทุนหมุนเวียน', l.code, l.nameTh, l.amount]),
            ['กิจกรรมดำเนินงาน', '', 'เงินสดสุทธิจากกิจกรรมดำเนินงาน', d.operating.total],
            ...d.investing.items.map((l) => ['กิจกรรมลงทุน', l.code, l.nameTh, l.amount]), ['กิจกรรมลงทุน', '', 'เงินสดสุทธิจากกิจกรรมลงทุน', d.investing.total],
            ...d.financing.items.map((l) => ['กิจกรรมจัดหาเงิน', l.code, l.nameTh, l.amount]), ['กิจกรรมจัดหาเงิน', '', 'เงินสดสุทธิจากกิจกรรมจัดหาเงิน', d.financing.total],
            ['', '', 'เงินสดเพิ่ม(ลด)สุทธิ', d.netChange], ['', '', 'เงินสดต้นงวด', d.openingCash], ['', '', 'เงินสดปลายงวด', d.closingCash]]} />}>
          <p className="px-4 pt-2 text-xs text-muted print:hidden">{range}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                <tr className="bg-slate-50"><td colSpan={3} className={`${th} text-xs font-semibold text-slate-600`}>กิจกรรมดำเนินงาน</td></tr>
                <tr className="border-t border-line"><td colSpan={2} className="px-3 py-1.5">กำไร (ขาดทุน) สุทธิ</td><td className="px-3 py-1.5 text-right tabular-nums">{money(d.netProfit)}</td></tr>
                <CfRows title="รายการปรับปรุงที่ไม่ใช่เงินสด" lines={d.operating.adjustments} />
                <CfRows title="การเปลี่ยนแปลงเงินทุนหมุนเวียน" lines={d.operating.workingCapital} />
                <CfTotal label="เงินสดสุทธิจากกิจกรรมดำเนินงาน" v={d.operating.total} />
                <tr className="border-t border-line bg-slate-50"><td colSpan={3} className={`${th} text-xs font-semibold text-slate-600`}>กิจกรรมลงทุน</td></tr>
                <CfRows title="" lines={d.investing.items} />
                <CfTotal label="เงินสดสุทธิจากกิจกรรมลงทุน" v={d.investing.total} />
                <tr className="border-t border-line bg-slate-50"><td colSpan={3} className={`${th} text-xs font-semibold text-slate-600`}>กิจกรรมจัดหาเงิน</td></tr>
                <CfRows title="" lines={d.financing.items} />
                <CfTotal label="เงินสดสุทธิจากกิจกรรมจัดหาเงิน" v={d.financing.total} />
                <CfTotal label="เงินสดเพิ่ม (ลด) สุทธิ" v={d.netChange} />
                <tr className="border-t border-line"><td colSpan={2} className={`${th} text-right`}>เงินสดต้นงวด</td><td className={`${th} text-right tabular-nums`}>{money(d.openingCash)}</td></tr>
                <CfTotal label="เงินสดปลายงวด" v={d.closingCash} />
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-muted">วิธีทางอ้อมแบบย่อ</p>
        </Panel>
      )}
    </QueryView>
  );
}
