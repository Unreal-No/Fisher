import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, formatMoney, formatMonth, toISODate } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/export';
import type { useListParams } from '@/lib/hooks';
import type { VatReport, WhtReport, WhtRow } from './types';

type LP = ReturnType<typeof useListParams>;
const th = 'px-3 py-2';
const thr = `${th} text-right`;
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: formatMonth(new Date(Date.UTC(2024, i, 15))).replace(/\s*\d+$/, '') }));

const Actions = ({ csv }: { csv: () => void }) => (
  <>
    <Button size="sm" variant="outline" className="print:hidden" onClick={csv}><Download /> CSV</Button>
    <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}><Printer /> พิมพ์</Button>
  </>
);
const Wrap = ({ children, min = 720 }: { children: ReactNode; min?: number }) => (
  <div className="overflow-x-auto"><table className="w-full text-sm" style={{ minWidth: min }}>{children}</table></div>
);
const Empty = ({ cols }: { cols: number }) => <tr><td colSpan={cols} className="px-3 py-6 text-center text-muted">ไม่มีรายการ</td></tr>;

export function TaxTab({ lp }: { lp: LP }) {
  const now = toISODate();
  const year = Number(lp.get('tyear') || now.slice(0, 4));
  const month = Number(lp.get('tmonth') || now.slice(5, 7));
  const view = lp.get('tax') || 'vat';
  const years = Array.from({ length: 8 }, (_, i) => Number(now.slice(0, 4)) - i);
  const label = `${MONTHS[month - 1]?.label} ${year + 543}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden [&_select]:w-auto [&_select]:min-w-28">
        <Select options={MONTHS} value={String(month)} onChange={(e) => lp.set({ tmonth: e.target.value })} aria-label="เดือน" />
        <Select options={years.map((y) => ({ value: String(y), label: String(y + 543) }))} value={String(year)} onChange={(e) => lp.set({ tyear: e.target.value })} aria-label="ปี พ.ศ." />
        <Button size="sm" variant={view === 'vat' ? 'primary' : 'outline'} onClick={() => lp.set({ tax: 'vat' })}>ภาษีมูลค่าเพิ่ม</Button>
        <Button size="sm" variant={view === 'wht' ? 'primary' : 'outline'} onClick={() => lp.set({ tax: 'wht' })}>ภาษีหัก ณ ที่จ่าย</Button>
      </div>
      <div className="hidden text-center print:block"><h1 className="text-lg font-bold">{view === 'vat' ? 'รายงานภาษีมูลค่าเพิ่ม' : 'รายงานภาษีหัก ณ ที่จ่าย'}</h1><p className="text-sm">{label}</p></div>
      {view === 'vat' ? <VatView year={year} month={month} label={label} /> : <WhtView year={year} month={month} label={label} />}
    </div>
  );
}

function VatView({ year, month, label }: { year: number; month: number; label: string }) {
  const q = useQuery({ queryKey: ['accounting', 'tax-vat', year, month], queryFn: () => api.get<VatReport>('/accounting/tax/vat', { year, month }) });
  const f = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <QueryView q={q}>
      {(d) => {
        const t = d.totals;
        return (
          <div className="space-y-3 print:space-y-2">
            <Panel title={`สรุปภาษีมูลค่าเพิ่ม ${label}`}>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div><dt className="text-xs text-muted">ภาษีขาย</dt><dd className="text-lg font-semibold tabular-nums">{formatMoney(t.outputVat)}</dd></div>
                <div><dt className="text-xs text-muted">ภาษีซื้อ</dt><dd className="text-lg font-semibold tabular-nums">{formatMoney(t.inputVat)}</dd></div>
                <div>
                  <dt className="text-xs text-muted">{t.netVat >= 0 ? 'ภาษีที่ต้องชำระ' : 'ภาษีที่ขอคืน'}</dt>
                  <dd className={`text-lg font-semibold tabular-nums ${t.netVat >= 0 ? 'text-bad' : 'text-ok'}`}>{formatMoney(Math.abs(t.netVat))}</dd>
                </div>
                <div><dt className="text-xs text-muted">ยอดขายที่ได้รับยกเว้น VAT</dt><dd className="text-lg font-semibold tabular-nums">{formatMoney(d.exemptSales)}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-muted">ภาษีขาย − ภาษีซื้อ = {t.netVat >= 0 ? 'ต้องชำระ' : 'ขอคืน'}</p>
            </Panel>
            <Panel title="รายงานภาษีขาย" bodyClass="p-0"
              actions={<Actions csv={() => downloadCsv(`vat-output-${f}.csv`, [['วันที่', 'เลขที่เอกสาร', 'ชื่อลูกค้า', 'เลขผู้เสียภาษี', 'สาขา', 'มูลค่า', 'VAT'], ...d.output.map((r) => [r.date, r.docNo, r.name, r.taxId, r.branch, r.base, r.vat]), ...d.credits.map((r) => [r.date, `${r.docNo} (ลดหนี้ ${r.refDocNo ?? ''})`, r.name, r.taxId, r.branch, r.base, r.vat]), ['', 'รวม', '', '', '', t.outputBase, t.outputVat]])} />}>
              <Wrap>
                <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>วันที่</th><th className={th}>เลขที่เอกสาร</th><th className={th}>ชื่อลูกค้า</th><th className={th}>เลขผู้เสียภาษี</th><th className={th}>สาขา</th><th className={thr}>มูลค่า</th><th className={thr}>VAT</th></tr></thead>
                <tbody>
                  {d.output.length + d.credits.length === 0 && <Empty cols={7} />}
                  {d.output.map((r, i) => (
                    <tr key={`o${i}`} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5">{formatDate(r.date)}</td><td className="px-3">{r.docNo}</td><td className="px-3">{r.name}</td><td className="px-3">{r.taxId ?? '-'}</td><td className="px-3">{r.branch ?? '-'}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.base)}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.vat)}</td></tr>
                  ))}
                  {d.credits.map((r, i) => (
                    <tr key={`c${i}`} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5">{formatDate(r.date)}</td><td className="px-3">{r.docNo} <span className="text-xs text-muted">(ลดหนี้ อ้างอิง {r.refDocNo ?? '-'})</span></td><td className="px-3">{r.name}</td><td className="px-3">{r.taxId ?? '-'}</td><td className="px-3">{r.branch ?? '-'}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.base)}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.vat)}</td></tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line bg-slate-50 font-semibold"><tr><td colSpan={5} className="px-3 py-2 text-right">รวม</td><td className="px-3 text-right tabular-nums">{formatMoney(t.outputBase)}</td><td className="px-3 text-right tabular-nums">{formatMoney(t.outputVat)}</td></tr></tfoot>
              </Wrap>
            </Panel>
            <Panel title="รายงานภาษีซื้อ" bodyClass="p-0"
              actions={<Actions csv={() => downloadCsv(`vat-input-${f}.csv`, [['วันที่', 'เลขที่ใบกำกับ', 'เลขที่ใบแจ้งหนี้', 'ชื่อผู้ขาย', 'เลขผู้เสียภาษี', 'สาขา', 'มูลค่า', 'VAT'], ...d.input.map((r) => [r.date, r.docNo, r.billNo, r.name, r.taxId, r.branch, r.base, r.vat]), ['', 'รวม', '', '', '', '', t.inputBase, t.inputVat]])} />}>
              <Wrap>
                <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>วันที่</th><th className={th}>เลขที่ใบกำกับ</th><th className={th}>ใบแจ้งหนี้</th><th className={th}>ชื่อผู้ขาย</th><th className={th}>เลขผู้เสียภาษี</th><th className={th}>สาขา</th><th className={thr}>มูลค่า</th><th className={thr}>VAT</th></tr></thead>
                <tbody>
                  {d.input.length === 0 && <Empty cols={8} />}
                  {d.input.map((r, i) => (
                    <tr key={i} className="border-t border-line"><td className="whitespace-nowrap px-3 py-1.5">{formatDate(r.date)}</td><td className="px-3">{r.docNo}</td><td className="px-3">{r.billNo}</td><td className="px-3">{r.name}</td><td className="px-3">{r.taxId ?? '-'}</td><td className="px-3">{r.branch ?? '-'}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.base)}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.vat)}</td></tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line bg-slate-50 font-semibold"><tr><td colSpan={6} className="px-3 py-2 text-right">รวม</td><td className="px-3 text-right tabular-nums">{formatMoney(t.inputBase)}</td><td className="px-3 text-right tabular-nums">{formatMoney(t.inputVat)}</td></tr></tfoot>
              </Wrap>
            </Panel>
          </div>
        );
      }}
    </QueryView>
  );
}

function WhtView({ year, month, label }: { year: number; month: number; label: string }) {
  const q = useQuery({ queryKey: ['accounting', 'tax-wht', year, month], queryFn: () => api.get<WhtReport>('/accounting/tax/wht', { year, month }) });
  const f = `${year}-${String(month).padStart(2, '0')}`;
  const table = (title: string, file: string, rows: WhtRow[], tot: { count: number; base: number; wht: number }) => (
    <Panel title={`${title} (${tot.count} รายการ)`} bodyClass="p-0"
      actions={<Actions csv={() => downloadCsv(`${file}-${f}.csv`, [['วันที่', 'เลขที่การจ่าย', 'ชื่อผู้ถูกหักภาษี', 'เลขผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'ฐานภาษี', 'อัตรา %', 'ภาษีที่หัก'], ...rows.map((r) => [r.date, r.paymentNo, r.name, r.taxId, r.branch, r.address, r.base, r.rate, r.wht]), ['', 'รวม', '', '', '', '', tot.base, '', tot.wht]])} />}>
      <Wrap min={820}>
        <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>วันที่</th><th className={th}>เลขที่การจ่าย</th><th className={th}>ชื่อผู้ถูกหักภาษี</th><th className={th}>เลขผู้เสียภาษี</th><th className={th}>ที่อยู่</th><th className={thr}>ฐานภาษี</th><th className={thr}>อัตรา</th><th className={thr}>ภาษีที่หัก</th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty cols={8} />}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="whitespace-nowrap px-3 py-1.5">{formatDate(r.date)}</td><td className="px-3 py-1.5">{r.paymentNo}</td><td className="px-3 py-1.5">{r.name}</td>
              <td className={`px-3 py-1.5 ${r.taxId ? '' : 'text-bad'}`}>{r.taxId ?? 'ไม่มีเลขผู้เสียภาษี'}</td><td className="px-3 py-1.5">{r.address ?? '-'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.base)}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.rate}%</td><td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.wht)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-line bg-slate-50 font-semibold"><tr><td colSpan={5} className="px-3 py-2 text-right">รวม</td><td className="px-3 text-right tabular-nums">{formatMoney(tot.base)}</td><td /><td className="px-3 text-right tabular-nums">{formatMoney(tot.wht)}</td></tr></tfoot>
      </Wrap>
    </Panel>
  );
  return (
    <QueryView q={q}>
      {(d) => (
        <div className="space-y-3 print:space-y-2">
          {d.missingTaxId > 0 && (
            <div className="flex items-start gap-2 rounded border border-amber-300 bg-warn-soft px-3 py-2 text-sm text-warn print:hidden">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> มี {d.missingTaxId} รายการที่ผู้ถูกหักภาษีไม่มีเลขประจำตัวผู้เสียภาษี — กรุณาแก้ไขข้อมูลผู้ขายก่อนยื่นแบบ ({label})
            </div>
          )}
          {table('ภ.ง.ด.3 (บุคคลธรรมดา)', 'pnd3', d.pnd3, d.totals.pnd3)}
          {table('ภ.ง.ด.53 (นิติบุคคล)', 'pnd53', d.pnd53, d.totals.pnd53)}
        </div>
      )}
    </QueryView>
  );
}
