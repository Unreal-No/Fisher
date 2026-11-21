import { useQuery } from '@tanstack/react-query';
import { Anchor, Ban, Check, CheckCircle2, ClipboardCheck, Lock, Navigation, Package, Pencil, Plus, RotateCcw, Ship, Trash2, Undo2, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  ARRIVAL_EDITABLE_STATUSES, CATCH_EDITABLE_STATUSES, EMPLOYEE_POSITION_TH, formatDate, formatDateTime, formatKg, formatMoney, formatNumber,
  FUEL_TYPE_TH, INCIDENT_TYPE_TH, MEASUREMENT_TH, NATIONALITY_TH, PLAN_EDITABLE_STATUSES, SEVERITY_TH, SUPPLY_CATEGORY_TH, TRIP_EXPENSE_CATEGORY_TH,
  TRIP_STATUS_TH, type Nationality, type TripSettlement, type TripStatus,
} from '@fisher/shared';
import { AuditList, type AuditRow } from '@/components/audit-list';
import { FileLink } from '@/components/file-upload';
import { PageHeader } from '@/components/layout/app-layout';
import { TripStatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DL, Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView, Spinner } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { cn, personName } from '@/lib/utils';
import { CatchFormDialog, type CatchRow } from '../catch/catch-dialogs';
import { catchColumns, useCatchActions } from '../catch/catch-page';
import { StockIssueDialog } from '../inventory/inventory-dialogs';
import { ArriveDialog, CrewEditor, DepartDialog, IssuesList, ItemDialog, PlanDialog } from './trip-dialogs';
import type { Trip } from './types';

const STEPS: TripStatus[] = ['DRAFT', 'PREPARING', 'DEPARTED', 'AT_SEA', 'ARRIVED', 'PENDING_SETTLEMENT', 'CLOSED'];
const INV = ['trip', 'trips', 'trip-settlement', 'dashboard', 'vessels', 'vessel'];
type ItemKind = 'fuel' | 'supplies' | 'expenses' | 'incidents';

function Stepper({ status }: { status: TripStatus }) {
  const cur = status === 'RETURNING' ? 3 : STEPS.indexOf(status);
  if (status === 'CANCELLED') return <div className="mb-4 rounded border border-line bg-slate-50 px-3 py-2 text-sm text-muted">เที่ยวนี้ถูกยกเลิก</div>;
  return (
    <ol className="mb-4 flex overflow-x-auto rounded-md border border-line bg-white">
      {STEPS.map((s, i) => (
        <li key={s} className={cn('flex min-w-28 flex-1 items-center gap-2 border-r border-line px-3 py-2 text-xs last:border-0', i < cur && 'text-ok', i === cur && 'bg-accent-soft font-semibold text-navy-900', i > cur && 'text-slate-400')}>
          <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]', i < cur ? 'border-ok bg-ok text-white' : i === cur ? 'border-navy-800 text-navy-900' : 'border-slate-300')}>
            {i < cur ? <Check className="size-3" /> : i + 1}
          </span>
          {s === 'AT_SEA' && status === 'RETURNING' ? TRIP_STATUS_TH.RETURNING : TRIP_STATUS_TH[s]}
        </li>
      ))}
    </ol>
  );
}

function ItemTable({ head, rows, onDelete }: { head: string[]; rows: { id: string; cells: ReactNode[] }[]; onDelete?: (id: string) => void }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr>{head.map((h, i) => <th key={i} className={cn('px-3 py-2', i === 0 && 'pl-4')}>{h}</th>)}{onDelete && <th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              {r.cells.map((c, i) => <td key={i} className={cn('whitespace-nowrap px-3 py-2', i === 0 && 'pl-4')}>{c}</td>)}
              {onDelete && <td className="px-2 text-right"><Button variant="ghost" size="icon" aria-label="ลบ" onClick={() => onDelete(r.id)}><Trash2 /></Button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TripDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['trip', id], queryFn: () => api.get<Trip>(`/trips/${id}`) });
  const [dlg, setDlg] = useState<null | 'depart' | 'arrive' | 'crew' | 'plan' | 'catch' | 'cancel' | 'close' | ItemKind>(null);
  const [delItem, setDelItem] = useState<{ kind: ItemKind; id: string } | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const settlement = useQuery({ queryKey: ['trip-settlement', id], queryFn: () => api.get<TripSettlement>(`/trips/${id}/settlement`) });
  const catches = useQuery({ queryKey: ['catch', 'trip', id], queryFn: () => api.get<{ items: CatchRow[]; total: number; totalKg: number }>('/catch/records', { tripId: id, pageSize: 200, sort: 'catchDate', order: 'asc' }), enabled: can('catch.view') });
  const crewCheck = useQuery({ queryKey: ['crew-check', id], queryFn: () => api.get<{ ok: boolean; issues: import('@fisher/shared').CrewDocIssue[] }>(`/trips/${id}/crew-check`), enabled: false });
  const audit = useQuery({ queryKey: ['trip-audit', id], queryFn: () => api.get<{ items: AuditRow[] }>('/audit-logs', { entityId: id, pageSize: 100 }), enabled: can('audit.view') });
  const status = useAction((v: { status: string; note?: string }) => api.post(`/trips/${id}/status`, v), { success: 'อัปเดตสถานะแล้ว', invalidate: INV });
  const cancel = useAction((reason: string) => api.post(`/trips/${id}/cancel`, { reason }), { success: 'ยกเลิกเที่ยวแล้ว', invalidate: INV, onSuccess: () => setDlg(null) });
  const close = useAction((note: string) => api.post(`/trips/${id}/close`, { note }), { success: 'ปิดเที่ยวเรือแล้ว', invalidate: INV, onSuccess: () => setDlg(null) });
  const remove = useAction((v: { kind: ItemKind; id: string }) => api.del(`/trips/${id}/${v.kind}/${v.id}`), { success: 'ลบรายการแล้ว', invalidate: INV, onSuccess: () => setDelItem(null) });
  const catchActions = useCatchActions();

  return (
    <QueryView q={q}>
      {(t) => {
        const plan = PLAN_EDITABLE_STATUSES.includes(t.status);
        const open = !['CLOSED', 'CANCELLED'].includes(t.status);
        const edit = can('trip.edit');
        const s = settlement.data;
        const act = (label: string, icon: ReactNode, onClick: () => void, variant: 'primary' | 'outline' | 'danger-outline' = 'outline') => (
          <Button variant={variant} onClick={onClick} loading={status.isPending && variant === 'primary'}>{icon} {label}</Button>
        );
        return (
          <>
            <PageHeader
              title={`เที่ยวเรือ ${t.tripNo}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Link className="text-accent hover:underline" to={`/vessels/${t.vessel.id}`}>{t.vessel.code} · {t.vessel.name}</Link> <TripStatusBadge s={t.status} /> {t.allowConcurrent && <Badge tone="warn">อนุญาตเที่ยวซ้อน</Badge>}</span>}
              actions={edit && (
                <>
                  {t.status === 'DRAFT' && act('เริ่มเตรียมออกเรือ', <ClipboardCheck />, () => status.mutate({ status: 'PREPARING' }), 'primary')}
                  {t.status === 'PREPARING' && act('ยืนยันออกเรือ', <Ship />, () => setDlg('depart'), 'primary')}
                  {t.status === 'PREPARING' && act('กลับเป็นร่าง', <Undo2 />, () => status.mutate({ status: 'DRAFT' }))}
                  {t.status === 'DEPARTED' && act('อยู่ในพื้นที่ทำประมง', <Navigation />, () => status.mutate({ status: 'AT_SEA' }))}
                  {['DEPARTED', 'AT_SEA'].includes(t.status) && act('กำลังกลับเข้าฝั่ง', <Undo2 />, () => status.mutate({ status: 'RETURNING' }))}
                  {['DEPARTED', 'AT_SEA', 'RETURNING'].includes(t.status) && act('บันทึกเข้าท่า', <Anchor />, () => setDlg('arrive'), 'primary')}
                  {t.status === 'ARRIVED' && act('ส่งสรุปเที่ยว', <CheckCircle2 />, () => status.mutate({ status: 'PENDING_SETTLEMENT' }), 'primary')}
                  {t.status === 'PENDING_SETTLEMENT' && can('trip.approve') && act('ปิดเที่ยว', <Lock />, () => setDlg('close'), 'primary')}
                  {t.status === 'PENDING_SETTLEMENT' && can('trip.approve') && act('เปิดกลับเพื่อแก้ไข', <RotateCcw />, () => status.mutate({ status: 'ARRIVED', note: 'เปิดกลับเพื่อแก้ไข' }))}
                  {plan && act('แก้ไขแผน', <Pencil />, () => setDlg('plan'))}
                  {plan && can('trip.delete') && act('ยกเลิกเที่ยว', <Ban />, () => setDlg('cancel'), 'danger-outline')}
                </>
              )}
            />
            <Stepper status={t.status} />
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="ลูกเรือ" value={formatNumber(t.crew.length)} sub={`ไต้ก๋ง: ${personName(t.captain)}`} />
              <Stat label="สัตว์น้ำ (กก.)" value={formatKg(s?.catchKg ?? 0)} sub={s?.lossKg ? `สูญเสีย ${formatKg(s.lossKg)} กก.` : undefined} />
              <Stat label="น้ำมันเติม (ลิตร)" value={formatNumber(s?.fuel.loadedL ?? 0)} />
              <Stat label="ใช้น้ำมัน (ลิตร)" value={s?.fuel.consumedL !== null && s?.fuel.consumedL !== undefined ? formatNumber(s.fuel.consumedL) : '-'} sub={s?.fuel.isEstimated ? 'มีค่าประมาณการ' : s?.fuel.consumedL !== null ? 'จากค่าที่วัดจริง' : 'รอข้อมูลเข้าท่า'} />
              <Stat label="จำนวนวัน" value={s?.days ?? '-'} />
              <Stat label="ต้นทุนรวม (บาท)" value={formatMoney(s?.totalCost ?? 0)} sub={s?.costPerKg ? `${formatMoney(s.costPerKg)} บาท/กก.` : undefined} />
            </div>
            <Tabs
              tabs={[
                {
                  value: 'overview', label: 'ภาพรวม',
                  content: (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel title="แผนและการออกเรือ">
                        <DL cols={2} items={[
                          ['กำหนดออก', formatDateTime(t.plannedDepartureAt)], ['กำหนดกลับ', formatDateTime(t.plannedReturnAt)],
                          ['พื้นที่ทำประมง', t.fishingArea], ['ท่าออก', t.departurePort],
                          ['ออกเรือจริง', formatDateTime(t.departedAt)], ['พิกัดออก', t.departureLat ? `${t.departureLat}, ${t.departureLng}` : null],
                          ['น้ำมันในถังก่อนเติม', t.fuelAtDepartureL ? `${formatNumber(t.fuelAtDepartureL)} ลิตร (${MEASUREMENT_TH[t.fuelAtDepartureMeasurement!]})` : null],
                          ['สภาพเรือ', t.conditionNote], ['เหตุผลข้ามเงื่อนไข', t.departureOverrideReason], ['เหตุผลเที่ยวซ้อน', t.concurrentReason],
                        ]} />
                      </Panel>
                      <Panel title="การเข้าท่าและปิดเที่ยว">
                        <DL cols={2} items={[
                          ['เข้าท่า', formatDateTime(t.arrivedAt)], ['ท่าเทียบ', t.arrivalPort],
                          ['พิกัดสุดท้าย', t.arrivalLat ? `${t.arrivalLat}, ${t.arrivalLng}` : null],
                          ['น้ำมันคงเหลือ', t.fuelAtArrivalL ? `${formatNumber(t.fuelAtArrivalL)} ลิตร (${MEASUREMENT_TH[t.fuelAtArrivalMeasurement!]})` : null],
                          ['ปิดเที่ยวเมื่อ', formatDateTime(t.closedAt)], ['ยกเลิก', t.cancelledAt ? `${formatDateTime(t.cancelledAt)} · ${t.cancelReason}` : null],
                          ['หมายเหตุ', t.notes],
                        ]} />
                      </Panel>
                    </div>
                  ),
                },
                {
                  value: 'crew', label: `ลูกเรือ (${t.crew.length})`,
                  content: (
                    <div className="space-y-4">
                      <Panel title="รายชื่อลูกเรือ" bodyClass="p-0" actions={<>
                        <Button size="sm" variant="outline" onClick={() => crewCheck.refetch()} loading={crewCheck.isFetching}><ClipboardCheck /> ตรวจเอกสาร</Button>
                        {plan && edit && <Button size="sm" onClick={() => setDlg('crew')}><Users /> แก้ไขรายชื่อ</Button>}
                      </>}>
                        <ItemTable head={['รหัส', 'ชื่อ', 'สัญชาติ', 'หน้าที่ในเที่ยว', 'ผลตรวจตอนออกเรือ']} rows={t.crew.map((c) => ({
                          id: c.id,
                          cells: [
                            <Link className="text-accent" to={`/employees/${c.employeeId}`}>{c.employee.code}</Link>, personName(c.employee),
                            NATIONALITY_TH[c.employee.nationality as Nationality] ?? c.employee.nationality, EMPLOYEE_POSITION_TH[c.role],
                            Array.isArray(c.docCheck) ? (c.docCheck.length ? <Badge tone="warn">{c.docCheck.length} ประเด็น</Badge> : <Badge tone="ok">ผ่าน</Badge>) : '-',
                          ],
                        }))} />
                      </Panel>
                      {crewCheck.data && <Panel title="ผลตรวจเอกสาร ณ ปัจจุบัน"><IssuesList issues={crewCheck.data.issues} /></Panel>}
                    </div>
                  ),
                },
                {
                  value: 'catch', label: `สัตว์น้ำ (${catches.data?.total ?? 0})`, hidden: !can('catch.view'),
                  content: (
                    <div className="space-y-2">
                      <div className="flex justify-end">
                        {can('catch.create') && CATCH_EDITABLE_STATUSES.includes(t.status) && <Button size="sm" onClick={() => setDlg('catch')}><Plus /> บันทึกสัตว์น้ำ</Button>}
                        {!CATCH_EDITABLE_STATUSES.includes(t.status) && <span className="text-sm text-muted">{plan ? 'บันทึกสัตว์น้ำได้หลังออกเรือ' : 'เที่ยวปิดแล้ว ไม่สามารถแก้ไขได้'}</span>}
                      </div>
                      <DataTable
                        columns={catchColumns({
                          onAdjust: can('catch.edit') && CATCH_EDITABLE_STATUSES.includes(t.status) ? catchActions.setAdjust : undefined,
                          onVoid: can('catch.delete') && CATCH_EDITABLE_STATUSES.includes(t.status) ? catchActions.setVoidRow : undefined,
                        })}
                        data={catches.data?.items} loading={catches.isLoading} error={catches.error}
                        footer={catches.data?.items.length ? <tr><td colSpan={3} className="px-3 py-2 text-right">รวม</td><td className="px-3 text-right tabular-nums">{formatKg(catches.data.totalKg)}</td><td colSpan={3} /></tr> : undefined}
                      />
                    </div>
                  ),
                },
                ...(([
                  ['fuel', 'น้ำมัน', open, ['วันเวลา', 'ชนิด', 'ลิตร', 'ราคา/ลิตร', 'รวม (บาท)', 'ผู้จำหน่าย', 'ค่า', 'หลักฐาน'],
                    t.fuel.map((x) => ({ id: x.id, cells: [formatDateTime(x.recordedAt), FUEL_TYPE_TH[x.fuelType], formatNumber(x.liters, 2), x.pricePerLiter ? formatNumber(x.pricePerLiter, 2) : '-', x.totalCost ? formatMoney(x.totalCost) : '-', x.supplierName ?? '-', <Badge tone={x.measurement === 'ESTIMATED' ? 'warn' : 'neutral'}>{MEASUREMENT_TH[x.measurement]}</Badge>, <FileLink id={x.fileId} label="ดู" />] }))],
                  ['supplies', 'เสบียง/วัสดุ', open, ['หมวด', 'รายการ', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'รวม (บาท)'],
                    t.supplies.map((x) => ({ id: x.id, cells: [SUPPLY_CATEGORY_TH[x.category], x.description, formatNumber(x.quantity, 2), x.unit, x.unitCost ? formatMoney(x.unitCost) : '-', x.totalCost ? formatMoney(x.totalCost) : '-'] }))],
                  ['expenses', 'ค่าใช้จ่าย', open, ['วันที่', 'หมวด', 'รายการ', 'จำนวนเงิน', 'สถานะ', 'หลักฐาน'],
                    t.expenses.map((x) => ({ id: x.id, cells: [formatDate(x.expenseDate), TRIP_EXPENSE_CATEGORY_TH[x.category], x.description, formatMoney(x.amount), <Badge tone={x.isEstimate ? 'warn' : 'ok'}>{x.isEstimate ? 'ประมาณการ' : 'ยืนยันแล้ว'}</Badge>, <FileLink id={x.fileId} label="ดู" />] }))],
                  ['incidents', 'เหตุการณ์', ARRIVAL_EDITABLE_STATUSES.includes(t.status), ['วันเวลา', 'ประเภท', 'ความรุนแรง', 'รายละเอียด', 'พิกัด'],
                    t.incidents.map((x) => ({ id: x.id, cells: [formatDateTime(x.occurredAt), INCIDENT_TYPE_TH[x.type], <Badge tone={x.severity === 'HIGH' ? 'bad' : x.severity === 'MEDIUM' ? 'warn' : 'neutral'}>{SEVERITY_TH[x.severity]}</Badge>, x.description, x.lat ? `${x.lat}, ${x.lng}` : '-'] }))],
                ] as [ItemKind, string, boolean, string[], { id: string; cells: ReactNode[] }[]][]).map(([kind, label, editable, head, rows]) => ({
                  value: kind, label: `${label} (${rows.length})`,
                  content: (
                    <Panel bodyClass="p-0" title={label} actions={editable && edit && <>
                      {kind === 'supplies' && can('inventory.edit') && <Button size="sm" variant="outline" onClick={() => setStockOpen(true)}><Package /> เบิกจากคลัง</Button>}
                      <Button size="sm" onClick={() => setDlg(kind)}><Plus /> เพิ่มรายการ</Button>
                    </>}>
                      <ItemTable head={head} rows={rows} onDelete={editable && edit ? (rid) => setDelItem({ kind, id: rid }) : undefined} />
                    </Panel>
                  ),
                }))),
                {
                  value: 'settlement', label: 'สรุปเที่ยว',
                  content: settlement.isLoading || !s ? <Spinner /> : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel title="สัตว์น้ำตามชนิด" bodyClass="p-0">
                        <ItemTable head={['ชนิด', 'น้ำหนัก (กก.)']} rows={s.catchBySpecies.map((x) => ({ id: x.speciesId, cells: [x.nameTh, formatKg(x.weightKg)] }))} />
                      </Panel>
                      <Panel title={`ต้นทุนเที่ยวเรือ${t.status === 'CLOSED' ? ' (บันทึก ณ วันปิดเที่ยว)' : ' (ประมาณการล่าสุด)'}`}>
                        <DL cols={2} items={[
                          ['น้ำมันในถังก่อนเติม (ลิตร)', formatNumber(s.fuel.atDepartureL)], ['น้ำมันที่เติม (ลิตร)', formatNumber(s.fuel.loadedL)],
                          ['น้ำมันคงเหลือเมื่อเข้าท่า (ลิตร)', formatNumber(s.fuel.atArrivalL)],
                          ['ใช้ไป (ลิตร)', s.fuel.consumedL === null ? 'รอข้อมูล' : <>{formatNumber(s.fuel.consumedL)} {s.fuel.isEstimated && <Badge tone="warn">มีค่าประมาณการ</Badge>}</>],
                          ['ค่าน้ำมัน', `${formatMoney(s.fuel.cost)} บาท`], ['ค่าเสบียง/วัสดุ', `${formatMoney(s.suppliesCost)} บาท`],
                          ['ค่าใช้จ่ายยืนยันแล้ว', `${formatMoney(s.expenses)} บาท`], ['ค่าใช้จ่ายประมาณการ', `${formatMoney(s.estimatedExpenses)} บาท`],
                          ['ต้นทุนรวม', <b>{formatMoney(s.totalCost)} บาท</b>], ['ค่าน้ำมันต่อ กก.', s.fuelCostPerKg === null ? '-' : `${formatMoney(s.fuelCostPerKg)} บาท`],
                          ['ต้นทุนต่อ กก.', s.costPerKg === null ? '-' : `${formatMoney(s.costPerKg)} บาท`], ['สัตว์น้ำสูญเสีย', `${formatKg(s.lossKg)} กก.`],
                          ['ขายแล้ว (สุทธิ)', `${formatKg(s.soldKg ?? 0)} กก. · ${formatMoney(s.revenue ?? 0)} บาท`],
                          ['กำไรขั้นต้น (ขาย − ต้นทุนเที่ยว)', <b className={(s.grossProfit ?? 0) < 0 ? 'text-bad' : 'text-ok'}>{formatMoney(s.grossProfit ?? 0)} บาท</b>],
                          ['ชั่วโมงเครื่องยนต์', s.engineHours === null || s.engineHours === undefined ? '-' : formatNumber(s.engineHours, 1)], ['ลิตร/ชั่วโมงเครื่อง', s.litersPerEngineHour == null ? '-' : formatNumber(s.litersPerEngineHour, 1)],
                        ]} />
                        <p className="mt-3 text-xs text-muted">ตัวเลขเชิงปฏิบัติการ ยังไม่ใช่รายการบัญชี · ยอดขายจากใบแจ้งหนี้ที่ยืนยันแล้ว ไม่รวม VAT หลังหักส่วนลด/ใบลดหนี้ · ยังไม่รวมค่าแรงลูกเรือ</p>
                      </Panel>
                    </div>
                  ),
                },
                {
                  value: 'history', label: 'ประวัติ',
                  content: (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Panel title="ประวัติสถานะ">
                        <ol className="space-y-2 text-sm">
                          {t.statusHistory.map((h) => (
                            <li key={h.id} className="border-l-2 border-line pl-3">
                              <div className="text-xs text-muted">{formatDateTime(h.changedAt)}</div>
                              <div>{h.fromStatus ? `${TRIP_STATUS_TH[h.fromStatus]} → ` : ''}<b>{TRIP_STATUS_TH[h.toStatus]}</b></div>
                              {h.note && <div className="text-xs text-muted">{h.note}</div>}
                            </li>
                          ))}
                        </ol>
                      </Panel>
                      {can('audit.view') && <Panel title="บันทึกการตรวจสอบ (Audit)"><AuditList rows={audit.data?.items} /></Panel>}
                    </div>
                  ),
                },
              ]}
            />
            {dlg === 'depart' && <DepartDialog trip={t} onClose={() => setDlg(null)} />}
            {dlg === 'arrive' && <ArriveDialog trip={t} onClose={() => setDlg(null)} />}
            {dlg === 'crew' && <CrewEditor trip={t} onClose={() => setDlg(null)} />}
            {dlg === 'plan' && <PlanDialog trip={t} onClose={() => setDlg(null)} />}
            {(['fuel', 'supplies', 'expenses', 'incidents'] as const).map((k) => dlg === k && <ItemDialog key={k} trip={t} kind={k} onClose={() => setDlg(null)} />)}
            <CatchFormDialog open={dlg === 'catch'} onOpenChange={(o) => setDlg(o ? 'catch' : null)} tripId={t.id} />
            <ConfirmDialog open={dlg === 'cancel'} onOpenChange={() => setDlg(null)} title="ยกเลิกเที่ยวเรือ" danger requireReason loading={cancel.isPending}
              message="ยกเลิกได้เฉพาะก่อนออกเรือ ข้อมูลจะถูกเก็บไว้ในประวัติ" onConfirm={(r) => cancel.mutate(r)} />
            <ConfirmDialog open={dlg === 'close'} onOpenChange={() => setDlg(null)} title="ปิดเที่ยวเรือ" loading={close.isPending} confirmText="ปิดเที่ยว"
              message="ระบบจะบันทึกสรุปเที่ยว ณ ขณะนี้ และล็อกรายการสัตว์น้ำของเที่ยวนี้" onConfirm={(r) => close.mutate(r)} />
            <ConfirmDialog open={!!delItem} onOpenChange={() => setDelItem(null)} title="ลบรายการ" danger loading={remove.isPending}
              message="ยืนยันลบรายการนี้? (บันทึกในประวัติการตรวจสอบ)" onConfirm={() => delItem && remove.mutate(delItem)} />
            {stockOpen && <StockIssueDialog open onOpenChange={setStockOpen} vesselId={t.vesselId} tripId={t.id} />}
            {catchActions.dialogs}
          </>
        );
      }}
    </QueryView>
  );
}
