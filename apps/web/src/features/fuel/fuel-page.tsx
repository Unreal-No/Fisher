import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  formatDate, formatDateTime, formatKg, formatMoney, formatMonth, formatNumber, FUEL_TXN_TYPE_TH, FUEL_TYPE_TH, MEASUREMENT_TH, toISODate, toOptions,
  type FuelTxnType, type FuelType, type Measurement,
} from '@fisher/shared';
import { FilterBar } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/input';
import { Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadCsv } from '@/lib/export';
import { useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { AdjustDialog, IssueDialog, ReceiptDialog, TankDialog } from './fuel-dialogs';
import type { FuelEntry, FuelReport, FuelTank, FuelTxn } from './types';

const NAVY = '#1b365d';
const DAY = 86_400_000;
const defaultFrom = () => toISODate(new Date(Date.now() - 90 * DAY));
const dash = (v: number | null | undefined, f: (n: number) => string) => (v === null || v === undefined ? '-' : f(v));
const fmt1 = (n: number) => formatNumber(n, 2);

const ec = createColumnHelper<FuelEntry>();
const tc = createColumnHelper<FuelTxn>();
const kc = createColumnHelper<FuelTank>();
const TXN_TONE = { RECEIPT: 'ok', ISSUE: 'info', ADJUSTMENT: 'warn' } as const;

export function FuelPage() {
  const { can } = useAuth();
  const lp = useListParams({ from: defaultFrom(), to: toISODate() });
  const vessels = useVessels();
  const tab = lp.get('tab') || 'report';
  const range = { from: lp.get('from'), to: lp.get('to'), vesselId: lp.get('vesselId') || undefined };

  return (
    <>
      <PageHeader title="น้ำมันเชื้อเพลิง" subtitle="การเติมน้ำมันเข้าเรือ ถังน้ำมันบริษัท และประสิทธิภาพการใช้น้ำมัน" />
      <FilterBar>
        <Input type="date" className="w-40" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="ถึง" />
        <Select options={vesselOptions(vessels.data)} placeholder="ทุกเรือ" value={lp.get('vesselId')} onChange={(e) => lp.set({ vesselId: e.target.value })} />
      </FilterBar>
      <Tabs
        value={tab}
        onValueChange={(t) => lp.set({ tab: t }, false)}
        tabs={[
          { value: 'report', label: 'รายงาน', content: <ReportTab range={range} /> },
          { value: 'entries', label: 'รายการเติมเข้าเรือ', content: <EntriesTab lp={lp} canExport={can('report.export')} /> },
          { value: 'tanks', label: 'ถังน้ำมันบริษัท', content: <TanksTab canEdit={can('fuel.edit')} /> },
          { value: 'ledger', label: 'สมุดรายการน้ำมัน', content: <LedgerTab lp={lp} /> },
        ]}
      />
    </>
  );
}

function usePagedFuel<T>(kind: string, path: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['fuel', kind, params],
    queryFn: () => api.get<{ items: T[]; total: number } & Record<string, unknown>>(path, params),
    placeholderData: keepPreviousData,
  });
}

type LP = ReturnType<typeof useListParams>;

function ReportTab({ range }: { range: { from: string; to: string; vesselId?: string } }) {
  const q = useQuery({ queryKey: ['fuel', 'report', range], queryFn: () => api.get<FuelReport>('/fuel/report', range) });
  return (
    <QueryView q={q}>
      {(d) => {
        const loaded = d.byVessel.reduce((a, v) => a + v.loadedL, 0);
        const cost = d.byVessel.reduce((a, v) => a + v.fuelCost, 0);
        const consumed = d.byVessel.reduce((a, v) => a + v.consumedL, 0);
        const catchKg = d.byVessel.reduce((a, v) => a + v.catchKg, 0);
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="ลิตรที่เติม (เที่ยวที่เข้าท่าแล้ว)" value={formatNumber(loaded)} />
              <Stat label="ค่าน้ำมัน (บาท)" value={formatMoney(cost)} />
              <Stat label="ลิตรที่ใช้ (เที่ยวที่เข้าท่าแล้ว)" value={formatNumber(consumed)} />
              <Stat label="ค่าน้ำมัน/กก." value={catchKg > 0 ? formatMoney(cost / catchKg) : '-'} sub={catchKg > 0 ? `สัตว์น้ำ ${formatKg(catchKg)} กก.` : undefined} />
            </div>
            <Panel title="ปริมาณน้ำมันที่เติมรายเดือน (ลิตร)">
              {d.monthly.length ? (
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={d.monthly.map((m) => ({ ...m, label: formatMonth(`${m.month}-01`) }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatNumber(v)} width={70} />
                      <Tooltip formatter={(v) => [`${formatNumber(v)} ลิตร`, 'น้ำมัน']} />
                      <Bar dataKey="liters" fill={NAVY} radius={[2, 2, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty title="ไม่มีข้อมูลในช่วงที่เลือก" />}
            </Panel>
            <Panel title="สรุปตามเรือ" bodyClass="p-0">
              {d.byVessel.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="px-4 py-2">เรือ</th><th className="px-2 text-right">เที่ยว</th><th className="px-2 text-right">เติม (ลิตร)</th><th className="px-2 text-right">ใช้ (ลิตร)</th><th className="px-2 text-right">ค่าน้ำมัน (บาท)</th><th className="px-2 text-right">สัตว์น้ำ (กก.)</th><th className="px-4 text-right">บาท/กก.</th></tr>
                    </thead>
                    <tbody>
                      {d.byVessel.map((v) => (
                        <tr key={v.vessel.id} className="border-t border-line">
                          <td className="px-4 py-2">{v.vessel.name}</td>
                          <td className="px-2 text-right">{formatNumber(v.trips)}</td>
                          <td className="px-2 text-right tabular-nums">{formatNumber(v.loadedL)}</td>
                          <td className="px-2 text-right tabular-nums">{v.consumedTrips ? formatNumber(v.consumedL) : '-'} {v.isEstimated && <Badge tone="warn">ประมาณการ</Badge>}</td>
                          <td className="px-2 text-right tabular-nums">{formatMoney(v.fuelCost)}</td>
                          <td className="px-2 text-right tabular-nums">{formatKg(v.catchKg)}</td>
                          <td className="px-4 text-right tabular-nums">{dash(v.fuelCostPerKg, formatMoney)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty />}
            </Panel>
            <Panel title="สรุปตามเที่ยว" bodyClass="p-0">
              {d.byTrip.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="px-4 py-2">เที่ยว</th><th className="px-2">เรือ</th><th className="px-2 text-right">วัน</th><th className="px-2 text-right">เติม (ลิตร)</th><th className="px-2 text-right">ใช้ (ลิตร)</th><th className="px-2 text-right">ค่าน้ำมัน (บาท)</th><th className="px-2 text-right">สัตว์น้ำ (กก.)</th><th className="px-2 text-right">บาท/กก.</th><th className="px-4 text-right">ลิตร/ชม.เครื่อง</th></tr>
                    </thead>
                    <tbody>
                      {d.byTrip.map((t) => (
                        <tr key={t.tripId} className="border-t border-line">
                          <td className="px-4 py-2"><Link className="text-accent hover:underline" to={`/trips/${t.tripId}`}>{t.tripNo}</Link></td>
                          <td className="px-2">{t.vessel.name}</td>
                          <td className="px-2 text-right">{dash(t.days, formatNumber)}</td>
                          <td className="px-2 text-right tabular-nums">{formatNumber(t.loadedL)}</td>
                          <td className="px-2 text-right tabular-nums">{dash(t.consumedL, formatNumber)} {t.isEstimated && <Badge tone="warn">ประมาณการ</Badge>}</td>
                          <td className="px-2 text-right tabular-nums">{formatMoney(t.fuelCost)}</td>
                          <td className="px-2 text-right tabular-nums">{formatKg(t.catchKg)}</td>
                          <td className="px-2 text-right tabular-nums">{dash(t.fuelCostPerKg, formatMoney)}</td>
                          <td className="px-4 text-right tabular-nums">{dash(t.litersPerEngineHour, fmt1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty />}
              <p className="border-t border-line px-4 py-2 text-xs text-muted">ลิตรที่ใช้ = คงเหลือก่อนเติม + เติม − คงเหลือเมื่อเข้าท่า · ติดป้ายประมาณการเมื่อมีค่าที่ไม่ได้วัดจริง</p>
            </Panel>
          </div>
        );
      }}
    </QueryView>
  );
}

const entryCols = [
  ec.accessor('recordedAt', { header: 'วันที่', cell: (i) => formatDateTime(i.getValue()) }),
  ec.accessor('trip', { header: 'เที่ยว', cell: (i) => <Link className="text-accent hover:underline" to={`/trips/${i.getValue().id}`}>{i.getValue().tripNo}</Link> }),
  ec.display({ id: 'vessel', header: 'เรือ', cell: ({ row }) => row.original.trip.vessel.name }),
  ec.accessor('fuelType', { header: 'ชนิด', cell: (i) => FUEL_TYPE_TH[i.getValue() as FuelType] }),
  ec.accessor('liters', { header: 'ลิตร', meta: { align: 'right' }, cell: (i) => formatNumber(i.getValue()) }),
  ec.accessor('pricePerLiter', { header: 'บาท/ลิตร', meta: { align: 'right' }, cell: (i) => (i.getValue() === null ? '-' : formatMoney(i.getValue())) }),
  ec.accessor('totalCost', { header: 'รวม (บาท)', meta: { align: 'right' }, cell: (i) => (i.getValue() === null ? '-' : formatMoney(i.getValue())) }),
  ec.display({ id: 'source', header: 'แหล่งที่มา', cell: ({ row: { original: r } }) => (r.fuelTxn ? `ถังบริษัท ${r.fuelTxn.txnNo}` : r.supplierName ?? '-') }),
  ec.accessor('measurement', { header: 'วิธีได้ค่า', cell: (i) => <Badge tone={i.getValue() === 'MEASURED' ? 'ok' : 'warn'}>{MEASUREMENT_TH[i.getValue() as Measurement]}</Badge> }),
];

function EntriesTab({ lp, canExport }: { lp: LP; canExport: boolean }) {
  const params = { from: lp.get('from'), to: lp.get('to'), vesselId: lp.get('vesselId') || undefined, page: lp.page, pageSize: 20 };
  const list = usePagedFuel<FuelEntry>('entries', '/fuel/entries', params);
  const totals = list.data as { totalLiters?: number; totalCost?: number } | undefined;
  const exportCsv = async () => {
    const all = await api.get<{ items: FuelEntry[] }>('/fuel/entries', { ...params, page: 1, pageSize: 200 });
    downloadCsv(`fuel-entries-${toISODate()}.csv`, [
      ['วันที่', 'เที่ยว', 'เรือ', 'ชนิด', 'ลิตร', 'บาท/ลิตร', 'รวม (บาท)', 'แหล่งที่มา', 'วิธีได้ค่า'],
      ...all.items.map((r) => [r.recordedAt, r.trip.tripNo, r.trip.vessel.name, FUEL_TYPE_TH[r.fuelType], r.liters, r.pricePerLiter, r.totalCost, r.fuelTxn ? `ถังบริษัท ${r.fuelTxn.txnNo}` : r.supplierName, MEASUREMENT_TH[r.measurement]]),
    ]);
  };
  return (
    <div className="space-y-3">
      {canExport && <div className="flex justify-end"><Button variant="outline" onClick={exportCsv}><Download /> ส่งออก CSV</Button></div>}
      <DataTable
        columns={entryCols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error}
        footer={list.data && list.data.total > 0 ? (
          <tr><td colSpan={4} className="px-3 py-2 text-right">รวมทั้งหมด {formatNumber(list.data.total)} รายการ</td><td className="px-3 text-right tabular-nums">{formatNumber(totals?.totalLiters ?? 0)}</td><td /><td className="px-3 text-right tabular-nums">{formatMoney(totals?.totalCost ?? 0)}</td><td colSpan={2} /></tr>
        ) : undefined}
      />
    </div>
  );
}

function TanksTab({ canEdit }: { canEdit: boolean }) {
  const q = useQuery({ queryKey: ['fuel', 'tanks'], queryFn: () => api.get<FuelTank[]>('/fuel/tanks') });
  const [dlg, setDlg] = useState<{ kind: 'tank' | 'receipt' | 'issue' | 'adjust'; tank: FuelTank | null } | null>(null);
  const close = () => setDlg(null);
  const cols = [
    kc.accessor('code', { header: 'รหัส' }),
    kc.accessor('name', { header: 'ชื่อถัง' }),
    kc.accessor('fuelType', { header: 'ชนิด', cell: (i) => FUEL_TYPE_TH[i.getValue() as FuelType] }),
    kc.accessor('balanceL', { header: 'คงเหลือ (ลิตร)', meta: { align: 'right' }, cell: (i) => formatNumber(i.getValue()) }),
    kc.accessor('capacityL', { header: 'ความจุ (ลิตร)', meta: { align: 'right' }, cell: (i) => (i.getValue() === null ? '-' : formatNumber(i.getValue())) }),
    kc.accessor('avgCost', { header: 'ต้นทุนเฉลี่ย/ลิตร', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    kc.display({ id: 'value', header: 'มูลค่าคงเหลือ (บาท)', meta: { align: 'right' }, cell: ({ row: { original: r } }) => formatMoney(Number(r.balanceL) * Number(r.avgCost)) }),
    kc.accessor('isActive', { header: 'สถานะ', cell: (i) => <Badge tone={i.getValue() ? 'ok' : 'neutral'}>{i.getValue() ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge> }),
    ...(canEdit
      ? [kc.display({
          id: 'actions', header: '', meta: { align: 'right' },
          cell: ({ row: { original: r } }) => (
            <span className="inline-flex gap-1 whitespace-nowrap">
              <Button size="sm" variant="outline" disabled={!r.isActive} onClick={() => setDlg({ kind: 'receipt', tank: r })}>รับเข้าถัง</Button>
              <Button size="sm" variant="outline" disabled={!r.isActive} onClick={() => setDlg({ kind: 'issue', tank: r })}>จ่ายเข้าเรือ</Button>
              <Button size="sm" variant="outline" disabled={!r.isActive} onClick={() => setDlg({ kind: 'adjust', tank: r })}>ปรับยอด</Button>
              <Button size="icon" variant="ghost" aria-label="แก้ไขถัง" onClick={() => setDlg({ kind: 'tank', tank: r })}><Pencil /></Button>
            </span>
          ),
        })]
      : []),
  ];
  return (
    <div className="space-y-3">
      {canEdit && <div className="flex justify-end"><Button onClick={() => setDlg({ kind: 'tank', tank: null })}><Plus /> เพิ่มถัง</Button></div>}
      <DataTable columns={cols} data={q.data} total={q.data?.length} pageSize={1000} loading={q.isFetching} error={q.error} />
      {dlg?.kind === 'tank' && <TankDialog tank={dlg.tank} onClose={close} />}
      {dlg?.kind === 'receipt' && dlg.tank && <ReceiptDialog tank={dlg.tank} onClose={close} />}
      {dlg?.kind === 'issue' && dlg.tank && <IssueDialog tank={dlg.tank} onClose={close} />}
      {dlg?.kind === 'adjust' && dlg.tank && <AdjustDialog tank={dlg.tank} onClose={close} />}
    </div>
  );
}

const ledgerCols = [
  tc.accessor('txnDate', { header: 'วันที่', cell: (i) => formatDate(i.getValue()) }),
  tc.accessor('txnNo', { header: 'เลขที่' }),
  tc.accessor('type', { header: 'ประเภท', cell: (i) => <Badge tone={TXN_TONE[i.getValue() as FuelTxnType]}>{FUEL_TXN_TYPE_TH[i.getValue() as FuelTxnType]}</Badge> }),
  tc.display({ id: 'tank', header: 'ถัง', cell: ({ row }) => row.original.tank.code }),
  tc.display({ id: 'vessel', header: 'เรือ / เที่ยว', cell: ({ row: { original: r } }) => (
    <span>{r.vessel?.name ?? '-'}{r.tripFuel && <> · <Link className="text-accent hover:underline" to={`/trips/${r.tripFuel.trip.id}`}>{r.tripFuel.trip.tripNo}</Link></>}</span>
  ) }),
  tc.accessor('liters', {
    header: 'ลิตร', meta: { align: 'right' },
    cell: (i) => { const n = Number(i.getValue()); return <span className={n < 0 ? 'text-bad' : 'text-ok'}>{n > 0 ? '+' : ''}{formatNumber(n)}</span>; },
  }),
  tc.accessor('totalCost', { header: 'มูลค่า (บาท)', meta: { align: 'right' }, cell: (i) => (i.getValue() === null ? '-' : formatMoney(i.getValue())) }),
  tc.accessor('balanceAfterL', { header: 'คงเหลือหลังรายการ', meta: { align: 'right' }, cell: (i) => formatNumber(i.getValue()) }),
  tc.accessor('avgCostAfter', { header: 'ต้นทุนเฉลี่ยหลังรายการ', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
  tc.display({ id: 'note', header: 'หมายเหตุ', cell: ({ row: { original: r } }) => (
    <span className="text-xs">
      {[r.supplierName, r.docNo, r.notes].filter(Boolean).join(' · ')}
      {r.overrideReason && <Badge tone="warn">อนุมัติจ่ายเกิน: {r.overrideReason}</Badge>}
    </span>
  ) }),
];

function LedgerTab({ lp }: { lp: LP }) {
  const tanks = useQuery({ queryKey: ['fuel', 'tanks'], queryFn: () => api.get<FuelTank[]>('/fuel/tanks') });
  const params = { from: lp.get('from'), to: lp.get('to'), vesselId: lp.get('vesselId') || undefined, tankId: lp.get('tankId') || undefined, type: lp.get('type') || undefined, page: lp.page, pageSize: 20 };
  const list = usePagedFuel<FuelTxn>('ledger', '/fuel/transactions', params);
  return (
    <div className="space-y-3">
      <FilterBar>
        <Select options={(tanks.data ?? []).map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} placeholder="ทุกถัง" value={lp.get('tankId')} onChange={(e) => lp.set({ tankId: e.target.value })} />
        <Select options={toOptions(FUEL_TXN_TYPE_TH)} placeholder="ทุกประเภท" value={lp.get('type')} onChange={(e) => lp.set({ type: e.target.value })} />
      </FilterBar>
      <DataTable columns={ledgerCols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)} loading={list.isFetching} error={list.error} />
    </div>
  );
}
