import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { ClipboardPlus, Download, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ENGINE_HOUR_SOURCE_TH, formatDate, formatDateTime, formatMoney, formatMonth, formatNumber, MAINT_CATEGORY_TH, MAINT_STATUS_TH, MAINT_TYPE_TH, toISODate, toOptions,
  type MaintCategory,
} from '@fisher/shared';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadCsv } from '@/lib/export';
import { useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { EngineHourDialog, OrderDialog, PlanDialog, type OrderPrefill } from './maintenance-dialogs';
import { DueBadge, MaintStatusBadge, PriorityBadge } from './status';
import type { EngineHourLog, MaintOrderRow, MaintPlan, MaintReport } from './types';

const NAVY = '#1b365d';
const DAY = 86_400_000;
const PAGE = 20;

type LP = ReturnType<typeof useListParams>;

function usePagedM<T>(kind: string, path: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['maintenance', kind, params],
    queryFn: () => api.get<{ items: T[]; total: number }>(path, params),
    placeholderData: keepPreviousData,
  });
}

const oc = createColumnHelper<MaintOrderRow>();
const pc = createColumnHelper<MaintPlan>();
const ec = createColumnHelper<EngineHourLog>();

export function MaintenancePage() {
  const { can } = useAuth();
  const lp = useListParams({ rFrom: toISODate(new Date(Date.now() - 365 * DAY)), rTo: toISODate() });
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const tab = lp.get('tab') || 'orders';
  return (
    <>
      <PageHeader
        title="ซ่อมบำรุง"
        subtitle="ใบสั่งซ่อม แผนบำรุงรักษา ชั่วโมงเครื่อง และค่าใช้จ่ายซ่อม"
        actions={can('maintenance.create') && <Button onClick={() => setCreating(true)}><Plus /> แจ้งซ่อม</Button>}
      />
      <Tabs
        value={tab}
        onValueChange={(t) => lp.set({ tab: t })}
        tabs={[
          { value: 'orders', label: 'ใบสั่งซ่อม', content: <OrdersTab lp={lp} /> },
          { value: 'plans', label: 'แผนบำรุงรักษา', content: <PlansTab lp={lp} canCreate={can('maintenance.create')} canEdit={can('maintenance.edit')} /> },
          { value: 'hours', label: 'ชั่วโมงเครื่อง', content: <HoursTab lp={lp} canCreate={can('maintenance.create')} /> },
          { value: 'report', label: 'รายงานค่าซ่อม', content: <ReportTab lp={lp} canExport={can('report.export')} /> },
        ]}
      />
      {creating && <OrderDialog onClose={() => setCreating(false)} onSaved={(id) => nav(`/maintenance/orders/${id}`)} />}
    </>
  );
}

function OrdersTab({ lp }: { lp: LP }) {
  const nav = useNavigate();
  const vessels = useVessels();
  const list = usePagedM<MaintOrderRow>('orders', '/maintenance/orders', {
    vesselId: lp.get('vesselId') || undefined, status: lp.get('status') || undefined, open: lp.get('open') || undefined,
    from: lp.get('from') || undefined, to: lp.get('to') || undefined, q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE,
  });
  const cols = [
    oc.accessor('orderNo', { header: 'เลขที่', cell: (i) => <span className="font-medium text-accent">{i.getValue()}</span> }),
    oc.accessor('title', { header: 'เรื่อง' }),
    oc.display({ id: 'vessel', header: 'เรือ', cell: ({ row }) => `${row.original.vessel.code} · ${row.original.vessel.name}` }),
    oc.accessor('category', { header: 'หมวด', cell: (i) => MAINT_CATEGORY_TH[i.getValue()] }),
    oc.accessor('type', { header: 'ประเภท', cell: (i) => MAINT_TYPE_TH[i.getValue()] }),
    oc.accessor('priority', { header: 'ความเร่งด่วน', cell: (i) => <PriorityBadge p={i.getValue()} /> }),
    oc.accessor('status', { header: 'สถานะ', cell: (i) => <MaintStatusBadge s={i.getValue()} /> }),
    oc.accessor('reportedAt', { header: 'แจ้งเมื่อ', cell: (i) => formatDate(i.getValue()) }),
    oc.accessor('totalCost', { header: 'ค่าใช้จ่าย (บาท)', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่/เรื่อง..." />
        <Select options={vesselOptions(vessels.data)} placeholder="ทุกลำ" value={lp.get('vesselId')} onChange={(e) => lp.set({ vesselId: e.target.value })} />
        <Select options={toOptions(MAINT_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
        <Checkbox label="เฉพาะงานค้าง" checked={lp.get('open') === 'true'} onChange={(e) => lp.set({ open: e.target.checked ? 'true' : '' })} />
        <Input type="date" className="w-40" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="ถึง" />
      </FilterBar>
      <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
        loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/maintenance/orders/${r.id}`)} />
    </div>
  );
}

function PlansTab({ lp, canCreate, canEdit }: { lp: LP; canCreate: boolean; canEdit: boolean }) {
  const nav = useNavigate();
  const vessels = useVessels();
  const [dlg, setDlg] = useState<{ plan: MaintPlan | null } | null>(null);
  const [order, setOrder] = useState<OrderPrefill | null>(null);
  const vesselId = lp.get('vesselId');
  const dueOnly = lp.get('dueOnly') === 'true';
  const q = useQuery({
    queryKey: ['maintenance', 'plans', { vesselId, dueOnly }],
    queryFn: () => api.get<MaintPlan[]>('/maintenance/plans', { vesselId: vesselId || undefined, dueOnly: dueOnly ? 'true' : undefined }),
  });
  const cols = [
    pc.accessor('name', { header: 'แผน', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    pc.display({ id: 'vessel', header: 'เรือ', cell: ({ row }) => `${row.original.vessel.code} · ${row.original.vessel.name}` }),
    pc.accessor('category', { header: 'หมวด', cell: (i) => MAINT_CATEGORY_TH[i.getValue()] }),
    pc.display({ id: 'interval', header: 'รอบ', cell: ({ row: { original: p } }) => [p.intervalDays ? `${formatNumber(p.intervalDays)} วัน` : null, p.intervalEngineHours ? `${formatNumber(p.intervalEngineHours)} ชม.` : null].filter(Boolean).join(' / ') || '-' }),
    pc.display({ id: 'last', header: 'ทำล่าสุด', cell: ({ row: { original: p } }) => [p.lastDoneAt ? formatDate(p.lastDoneAt) : null, p.lastDoneEngineHours ? `${formatNumber(p.lastDoneEngineHours, 1)} ชม.` : null].filter(Boolean).join(' · ') || '-' }),
    pc.display({ id: 'next', header: 'ครบกำหนดถัดไป', cell: ({ row: { original: p } }) => [p.due.nextDueDate ? formatDate(p.due.nextDueDate) : null, p.due.nextDueHours != null ? `${formatNumber(p.due.nextDueHours, 1)} ชม.` : null].filter(Boolean).join(' / ') || '-' }),
    pc.display({ id: 'left', header: 'คงเหลือ', cell: ({ row: { original: p } }) => [p.due.daysLeft != null ? `${formatNumber(p.due.daysLeft)} วัน` : null, p.due.hoursLeft != null ? `${formatNumber(p.due.hoursLeft, 1)} ชม.` : null].filter(Boolean).join(' / ') || '-' }),
    pc.display({ id: 'state', header: 'สถานะ', cell: ({ row: { original: p } }) => (p.isActive ? <DueBadge s={p.due.state} /> : <Badge tone="neutral">ปิดใช้งาน</Badge>) }),
    pc.display({
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row: { original: p } }) => (
        <div className="flex justify-end gap-1">
          {canCreate && <Button size="icon" variant="ghost" aria-label="สร้างใบสั่งซ่อมจากแผน" title="สร้างใบสั่งซ่อมจากแผน" onClick={() => setOrder({ vesselId: p.vesselId, planId: p.id, title: p.name, category: p.category, type: 'PREVENTIVE' })}><ClipboardPlus /></Button>}
          {canEdit && <Button size="icon" variant="ghost" aria-label="แก้ไขแผน" onClick={() => setDlg({ plan: p })}><Pencil /></Button>}
        </div>
      ),
    }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <Select options={vesselOptions(vessels.data)} placeholder="ทุกลำ" value={vesselId} onChange={(e) => lp.set({ vesselId: e.target.value })} />
        <Checkbox label="เฉพาะใกล้/เกินกำหนด" checked={dueOnly} onChange={(e) => lp.set({ dueOnly: e.target.checked ? 'true' : '' })} />
        {canCreate && <Button className="ml-auto" onClick={() => setDlg({ plan: null })}><Plus /> เพิ่มแผน</Button>}
      </FilterBar>
      <DataTable columns={cols} data={q.data} loading={q.isFetching} error={q.error} />
      {dlg && <PlanDialog plan={dlg.plan} vesselId={vesselId || undefined} onClose={() => setDlg(null)} />}
      {order && <OrderDialog prefill={order} onClose={() => setOrder(null)} onSaved={(id) => nav(`/maintenance/orders/${id}`)} />}
    </div>
  );
}

function HoursTab({ lp, canCreate }: { lp: LP; canCreate: boolean }) {
  const vessels = useVessels();
  const [adding, setAdding] = useState(false);
  const vesselId = lp.get('hVessel');
  const q = useQuery({
    queryKey: ['maintenance', 'engine-hours', vesselId],
    queryFn: () => api.get<EngineHourLog[]>('/maintenance/engine-hours', { vesselId }),
    enabled: !!vesselId,
  });
  const cols = [
    ec.accessor('recordedAt', { header: 'วันเวลา', cell: (i) => formatDateTime(i.getValue()) }),
    ec.accessor('hours', { header: 'ชั่วโมงเครื่อง', meta: { align: 'right' }, cell: (i) => formatNumber(i.getValue(), 1) }),
    ec.accessor('source', { header: 'ที่มา', cell: (i) => ENGINE_HOUR_SOURCE_TH[i.getValue()] }),
    ec.accessor('isReset', { header: 'รีเซ็ต', cell: (i) => (i.getValue() ? <Badge tone="warn">รีเซ็ตมิเตอร์</Badge> : '-') }),
    ec.accessor('notes', { header: 'หมายเหตุ', cell: (i) => i.getValue() ?? '-' }),
  ];
  return (
    <div className="space-y-3">
      <FilterBar>
        <Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" value={vesselId} onChange={(e) => lp.set({ hVessel: e.target.value })} />
        {canCreate && <Button className="ml-auto" onClick={() => setAdding(true)}><Plus /> บันทึกชั่วโมงเครื่อง</Button>}
      </FilterBar>
      {vesselId ? <DataTable columns={cols} data={q.data} loading={q.isFetching} error={q.error} /> : <Empty title="เลือกเรือเพื่อดูประวัติชั่วโมงเครื่อง" />}
      {adding && <EngineHourDialog vesselId={vesselId || undefined} onClose={() => setAdding(false)} />}
    </div>
  );
}

const GROUPS = { vessel: 'ตามเรือ', category: 'ตามหมวด', month: 'รายเดือน' } as const;

function ReportTab({ lp, canExport }: { lp: LP; canExport: boolean }) {
  const range = { from: lp.get('rFrom'), to: lp.get('rTo') };
  const groupBy = lp.get('groupBy') || 'vessel';
  const q = useQuery({ queryKey: ['maintenance', 'report', range, groupBy], queryFn: () => api.get<MaintReport>('/maintenance/report', { ...range, groupBy }) });
  const label = (r: MaintReport['items'][number]) =>
    groupBy === 'category' ? (MAINT_CATEGORY_TH[r.label as MaintCategory] ?? r.label) : groupBy === 'month' ? formatMonth(`${r.label}-01`) : r.label;
  return (
    <div className="space-y-3">
      <FilterBar>
        <Input type="date" className="w-40" value={range.from} onChange={(e) => lp.set({ rFrom: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={range.to} onChange={(e) => lp.set({ rTo: e.target.value })} aria-label="ถึง" />
        <Select options={Object.entries(GROUPS).map(([value, l]) => ({ value, label: l }))} value={groupBy} onChange={(e) => lp.set({ groupBy: e.target.value })} />
        {canExport && (
          <Button variant="outline" className="ml-auto" disabled={!q.data?.items.length} onClick={() => q.data && downloadCsv(`maintenance-report-${toISODate()}.csv`, [
            ['กลุ่ม', 'จำนวนใบสั่งซ่อม', 'ค่าแรง', 'ค่าจ้างภายนอก', 'ค่าอะไหล่', 'รวม'],
            ...q.data.items.map((r) => [label(r), r.orders, r.labor, r.external, r.parts, r.total]),
          ])}><Download /> ส่งออก CSV</Button>
        )}
      </FilterBar>
      <QueryView q={q}>
        {(d) => (
          <div className="space-y-4">
            <Panel title="ค่าซ่อมรวม (บาท)">
              {d.items.length ? (
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={d.items.map((r) => ({ label: label(r), total: Number(r.total) }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatNumber(v)} width={80} />
                      <Tooltip formatter={(v) => [`${formatMoney(v)} บาท`, 'ค่าซ่อม']} />
                      <Bar dataKey="total" fill={NAVY} radius={[2, 2, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty title="ไม่มีข้อมูลในช่วงที่เลือก" />}
            </Panel>
            <Panel title="สรุปค่าซ่อม" bodyClass="p-0">
              {d.items.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr><th className="px-4 py-2">{GROUPS[groupBy as keyof typeof GROUPS] ?? 'กลุ่ม'}</th><th className="px-2 text-right">ใบสั่งซ่อม</th><th className="px-2 text-right">ค่าแรง</th><th className="px-2 text-right">จ้างภายนอก</th><th className="px-2 text-right">อะไหล่</th><th className="px-4 text-right">รวม (บาท)</th></tr>
                    </thead>
                    <tbody>
                      {d.items.map((r) => (
                        <tr key={r.key} className="border-t border-line">
                          <td className="px-4 py-2">{label(r)}</td>
                          <td className="px-2 text-right tabular-nums">{formatNumber(r.orders)}</td>
                          <td className="px-2 text-right tabular-nums">{formatMoney(r.labor)}</td>
                          <td className="px-2 text-right tabular-nums">{formatMoney(r.external)}</td>
                          <td className="px-2 text-right tabular-nums">{formatMoney(r.parts)}</td>
                          <td className="px-4 text-right tabular-nums">{formatMoney(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line font-semibold"><td className="px-4 py-2" colSpan={5}>รวมทั้งหมด</td><td className="px-4 text-right tabular-nums">{formatMoney(d.total)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              ) : <Empty />}
            </Panel>
          </div>
        )}
      </QueryView>
    </div>
  );
}
