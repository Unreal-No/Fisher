import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import {
  arriveSchema, departSchema, EMPLOYEE_POSITION_TH, FUEL_TYPE_TH, INCIDENT_TYPE_TH, MEASUREMENT_TH, SEVERITY_TH, SUPPLY_CATEGORY_TH, toISODate,
  toOptions, TRIP_EXPENSE_CATEGORY_TH, tripExpenseSchema, tripFuelSchema, tripIncidentSchema, tripSupplySchema, tripUpdateSchema, type CrewDocIssue, type EmployeePosition,
} from '@fisher/shared';
import { FileUpload } from '@/components/file-upload';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useEmployees } from '@/lib/lookups';
import { fromLocalInput, personName, toLocalInput } from '@/lib/utils';
import type { Trip } from './types';

const INV = ['trip', 'trips', 'trip-settlement', 'dashboard', 'vessels', 'vessel'];
const PROBLEM_TH: Record<CrewDocIssue['problem'], string> = {
  MISSING: 'ขาดเอกสาร', EXPIRED: 'หมดอายุ', EXPIRING: 'จะหมดอายุระหว่างเที่ยว', NOT_ACTIVE: 'สถานะไม่พร้อมปฏิบัติงาน', ON_OTHER_TRIP: 'อยู่ในเที่ยวอื่น',
};

export function IssuesList({ issues }: { issues: CrewDocIssue[] }) {
  if (!issues.length) return <div className="flex items-center gap-2 rounded border border-green-200 bg-ok-soft px-3 py-2 text-sm text-ok"><CheckCircle2 className="size-4" /> เอกสารและสถานะลูกเรือครบถ้วน</div>;
  return (
    <ul className="divide-y divide-line rounded border border-line text-sm">
      {issues.map((i, k) => (
        <li key={k} className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span><b>{i.employeeName}</b> · {i.documentType}</span>
          <Badge tone={i.blocking ? 'bad' : 'warn'}>{PROBLEM_TH[i.problem]}{i.expiryDate ? ` (${i.expiryDate})` : ''}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Crew editor (plan stage). Replaces the crew list atomically. */
export function CrewEditor({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const emps = useEmployees();
  const [rows, setRows] = useState(trip.crew.map((c) => ({ employeeId: c.employeeId, role: c.role })));
  const [pick, setPick] = useState('');
  const save = useAction(() => api.put(`/trips/${trip.id}/crew`, { members: rows }), { success: 'บันทึกรายชื่อลูกเรือแล้ว', invalidate: INV, onSuccess: onClose });
  const byId = new Map((emps.data ?? []).map((e) => [e.id, e]));
  const avail = (emps.data ?? []).filter((e) => !rows.some((r) => r.employeeId === e.id))
    .sort((a, b) => Number(b.currentVesselId === trip.vesselId) - Number(a.currentVesselId === trip.vesselId));
  const add = (id: string) => {
    const e = byId.get(id);
    if (e) setRows([...rows, { employeeId: id, role: e.position as EmployeePosition }]);
    setPick('');
  };
  const addVesselCrew = () => setRows([...rows, ...avail.filter((e) => e.currentVesselId === trip.vesselId).map((e) => ({ employeeId: e.id, role: e.position as EmployeePosition }))]);
  const crewName = (id: string) => {
    const e = byId.get(id) ?? trip.crew.find((c) => c.employeeId === id)?.employee;
    return e ? `${e.code} · ${personName(e)}` : id;
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`ลูกเรือเที่ยว ${trip.tripNo}`} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>บันทึก ({rows.length} คน)</Button></>}>
      {emps.isLoading ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select className="flex-1" options={avail.map((e) => ({ value: e.id, label: `${e.code} · ${e.firstName} ${e.lastName} · ${EMPLOYEE_POSITION_TH[e.position as EmployeePosition]}${e.currentVesselId === trip.vesselId ? ' (ประจำเรือนี้)' : ''}${e.docStatus !== 'OK' ? ' ⚠' : ''}` }))}
              placeholder="- เพิ่มพนักงาน (เฉพาะสถานะปฏิบัติงาน) -" value={pick} onChange={(e) => add(e.target.value)} />
            <Button variant="outline" onClick={addVesselCrew}><Plus /> เพิ่มลูกเรือประจำเรือทั้งหมด</Button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.employeeId} className="border-b border-line">
                  <td className="py-1.5">{crewName(r.employeeId)} {byId.get(r.employeeId)?.docStatus && byId.get(r.employeeId)!.docStatus !== 'OK' && <Badge tone="warn">เอกสาร</Badge>}</td>
                  <td className="w-48 py-1.5"><Select options={toOptions(EMPLOYEE_POSITION_TH)} value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value as EmployeePosition } : x)))} /></td>
                  <td className="w-10 text-right"><Button variant="ghost" size="icon" aria-label="นำออก" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="text-sm text-muted">ยังไม่มีลูกเรือ</p>}
        </div>
      )}
    </Dialog>
  );
}

export function DepartDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { can } = useAuth();
  const check = useQuery({ queryKey: ['crew-check', trip.id], queryFn: () => api.get<{ ok: boolean; issues: CrewDocIssue[] }>(`/trips/${trip.id}/crew-check`) });
  const [serverIssues, setServerIssues] = useState<CrewDocIssue[] | null>(null);
  const f = useForm({
    resolver: zodResolver(departSchema),
    defaultValues: {
      departedAt: toLocalInput(), departurePort: trip.departurePort ?? trip.vessel.homePort ?? '', departureLat: '', departureLng: '',
      fuelAtDepartureL: '', fuelAtDepartureMeasurement: 'MEASURED' as const, engineHoursAtDeparture: '', conditionNote: '', override: false, overrideReason: '',
    },
  });
  const save = useAction((v: Record<string, unknown>) => api.post(`/trips/${trip.id}/depart`, v), {
    success: 'บันทึกออกเรือแล้ว', invalidate: INV, onSuccess: onClose, silentError: true,
  });
  const issues = serverIssues ?? check.data?.issues ?? [];
  const blocking = issues.some((i) => i.blocking);
  const e = f.formState.errors;
  const submit = f.handleSubmit((v) =>
    save.mutateAsync({ ...v, departedAt: fromLocalInput(v.departedAt) }).catch((err) => {
      if (err instanceof ApiError && err.code === 'DEPARTURE_CHECK_FAILED') setServerIssues(err.details as CrewDocIssue[]);
      f.setError('root', { message: err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ' });
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`ยืนยันออกเรือ ${trip.tripNo}`} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} disabled={blocking && !f.watch('override')} onClick={submit}>ยืนยันออกเรือ</Button></>}>
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-sm font-semibold">ตรวจสอบเอกสารลูกเรือ ({trip.crew.length} คน)</h4>
          {check.isLoading ? <Spinner label="กำลังตรวจสอบ..." /> : <IssuesList issues={issues} />}
        </div>
        {e.root && <div className="rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{e.root.message}</div>}
        <FormGrid cols={2}>
          <Field label="วันเวลาออกเรือ" required error={e.departedAt?.message}><Input type="datetime-local" {...f.register('departedAt')} /></Field>
          <Field label="ท่าออกเรือ" required error={e.departurePort?.message}><Input {...f.register('departurePort')} /></Field>
          <Field label="ละติจูด" error={e.departureLat?.message}><Input inputMode="decimal" placeholder="เช่น 7.2" {...f.register('departureLat')} /></Field>
          <Field label="ลองจิจูด" error={e.departureLng?.message}><Input inputMode="decimal" placeholder="เช่น 100.6" {...f.register('departureLng')} /></Field>
          <Field label="น้ำมันคงเหลือในถังก่อนเติม (ลิตร)" required error={e.fuelAtDepartureL?.message} hint="น้ำมันที่เติมให้บันทึกในแท็บน้ำมัน">
            <Input inputMode="decimal" {...f.register('fuelAtDepartureL')} />
          </Field>
          <Field label="วิธีได้ค่า"><Select options={toOptions(MEASUREMENT_TH)} {...f.register('fuelAtDepartureMeasurement')} /></Field>
          <Field label="ชั่วโมงเครื่องยนต์ (มิเตอร์)" error={e.engineHoursAtDeparture?.message} hint="ถ้ามี — ใช้คำนวณลิตร/ชั่วโมง"><Input inputMode="decimal" {...f.register('engineHoursAtDeparture')} /></Field>
          <Field label="สภาพเรือก่อนออก" className="sm:col-span-2"><Textarea rows={2} {...f.register('conditionNote')} placeholder="เครื่องยนต์ อุปกรณ์ความปลอดภัย ฯลฯ" /></Field>
        </FormGrid>
        {blocking && (
          <div className="space-y-2 rounded border border-amber-200 bg-warn-soft p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-warn"><AlertTriangle className="size-4" /> มีปัญหาที่ต้องแก้ไขก่อนออกเรือ</div>
            {can('trip.approve') ? (
              <>
                <Checkbox label="อนุมัติข้ามเงื่อนไข (บันทึกในประวัติการตรวจสอบ)" {...f.register('override')} />
                {f.watch('override') && <Input placeholder="เหตุผลการอนุมัติ (จำเป็น)" {...f.register('overrideReason')} />}
              </>
            ) : <p className="text-warn">ต้องให้ผู้มีสิทธิ์อนุมัติดำเนินการ หรือแก้ไขเอกสาร/รายชื่อลูกเรือ</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function ArriveDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const f = useForm({
    resolver: zodResolver(arriveSchema),
    defaultValues: { arrivedAt: toLocalInput(), arrivalPort: trip.departurePort ?? '', arrivalLat: '', arrivalLng: '', fuelAtArrivalL: '', fuelAtArrivalMeasurement: 'MEASURED' as const, engineHoursAtArrival: '', notes: trip.notes ?? '' },
  });
  const save = useAction((v: Record<string, unknown>) => api.post(`/trips/${trip.id}/arrive`, v), { success: 'บันทึกเข้าท่าแล้ว', invalidate: INV, onSuccess: onClose });
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`บันทึกเข้าท่า ${trip.tripNo}`} description="ขั้นต่อไป: บันทึกสัตว์น้ำ ค่าใช้จ่าย เหตุการณ์ แล้วส่งสรุปเที่ยว"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate({ ...v, arrivedAt: fromLocalInput(v.arrivedAt) }))}>บันทึกเข้าท่า</Button></>}>
      <FormGrid cols={2}>
        <Field label="วันเวลาเข้าท่า" required error={e.arrivedAt?.message}><Input type="datetime-local" {...f.register('arrivedAt')} /></Field>
        <Field label="ท่าเทียบเรือ" required error={e.arrivalPort?.message}><Input {...f.register('arrivalPort')} /></Field>
        <Field label="ละติจูดสุดท้าย" error={e.arrivalLat?.message}><Input inputMode="decimal" {...f.register('arrivalLat')} /></Field>
        <Field label="ลองจิจูดสุดท้าย" error={e.arrivalLng?.message}><Input inputMode="decimal" {...f.register('arrivalLng')} /></Field>
        <Field label="น้ำมันคงเหลือ (ลิตร)" required error={e.fuelAtArrivalL?.message}><Input inputMode="decimal" {...f.register('fuelAtArrivalL')} /></Field>
        <Field label="วิธีได้ค่า"><Select options={toOptions(MEASUREMENT_TH)} {...f.register('fuelAtArrivalMeasurement')} /></Field>
        <Field label="ชั่วโมงเครื่องยนต์ (มิเตอร์)" error={e.engineHoursAtArrival?.message}><Input inputMode="decimal" {...f.register('engineHoursAtArrival')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

// ---------- generic line-item dialog (fuel / supplies / expenses / incidents) ----------
type ItemKind = 'fuel' | 'supplies' | 'expenses' | 'incidents';
const SCHEMAS = { fuel: tripFuelSchema, supplies: tripSupplySchema, expenses: tripExpenseSchema, incidents: tripIncidentSchema };
const TITLES: Record<ItemKind, string> = { fuel: 'บันทึกการเติมน้ำมัน', supplies: 'บันทึกเสบียง/วัสดุขึ้นเรือ', expenses: 'บันทึกค่าใช้จ่ายเที่ยวเรือ', incidents: 'บันทึกเหตุการณ์' };
const DEFAULTS = (): Record<ItemKind, Record<string, unknown>> => ({
  fuel: { recordedAt: toLocalInput(), fuelType: 'DIESEL_B7', liters: '', pricePerLiter: '', supplierName: '', measurement: 'MEASURED', fileId: '', notes: '' },
  supplies: { category: 'FOOD', description: '', quantity: '', unit: '', unitCost: '', notes: '' },
  expenses: { category: 'OTHER', description: '', amount: '', expenseDate: toISODate(), isEstimate: false, fileId: '', notes: '' },
  incidents: { occurredAt: toLocalInput(), type: 'OTHER', severity: 'LOW', description: '', lat: '', lng: '' },
});

function F<T extends FieldValues>({ f, name, label, required, children, className }: { f: UseFormReturn<T>; name: Path<T>; label: string; required?: boolean; children?: React.ReactNode; className?: string }) {
  const err = (f.formState.errors as Record<string, { message?: string }>)[name]?.message;
  return <Field label={label} required={required} error={err} className={className}>{children ?? <Input {...f.register(name)} />}</Field>;
}

export function ItemDialog({ trip, kind, onClose }: { trip: Trip; kind: ItemKind; onClose: () => void }) {
  const f = useForm<z.input<(typeof SCHEMAS)[ItemKind]>>({ resolver: zodResolver(SCHEMAS[kind] as never), defaultValues: DEFAULTS()[kind] as never });
  const save = useAction((v: Record<string, unknown>) => api.post(`/trips/${trip.id}/${kind}`, v), { success: 'บันทึกแล้ว', invalidate: INV, onSuccess: onClose });
  const submit = f.handleSubmit((v: Record<string, unknown>) => {
    const body = { ...v };
    for (const k of ['recordedAt', 'occurredAt']) if (typeof body[k] === 'string') body[k] = fromLocalInput(body[k] as string);
    save.mutate(body);
  });
  const ff = f as unknown as UseFormReturn<Record<string, unknown>>;
  const r = ff.register;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={TITLES[kind]}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        {kind === 'fuel' && <>
          <F f={ff} name="recordedAt" label="วันเวลา" required><Input type="datetime-local" {...r('recordedAt')} /></F>
          <F f={ff} name="fuelType" label="ชนิดน้ำมัน"><Select options={toOptions(FUEL_TYPE_TH)} {...r('fuelType')} /></F>
          <F f={ff} name="liters" label="ปริมาณ (ลิตร)" required><Input inputMode="decimal" {...r('liters')} /></F>
          <F f={ff} name="pricePerLiter" label="ราคา/ลิตร (บาท)"><Input inputMode="decimal" {...r('pricePerLiter')} /></F>
          <F f={ff} name="supplierName" label="ผู้จำหน่าย" />
          <F f={ff} name="measurement" label="วิธีได้ค่า"><Select options={toOptions(MEASUREMENT_TH)} {...r('measurement')} /></F>
          <Field label="ใบเสร็จ/หลักฐาน" className="sm:col-span-2"><FileUpload sensitivity="CONFIDENTIAL" value={ff.watch('fileId') as string} onChange={(v) => ff.setValue('fileId', v ?? '')} /></Field>
        </>}
        {kind === 'supplies' && <>
          <F f={ff} name="category" label="หมวด"><Select options={toOptions(SUPPLY_CATEGORY_TH)} {...r('category')} /></F>
          <F f={ff} name="description" label="รายการ" required />
          <F f={ff} name="quantity" label="จำนวน" required><Input inputMode="decimal" {...r('quantity')} /></F>
          <F f={ff} name="unit" label="หน่วย" required><Input placeholder="ซอง/ถัง/ชุด/กก." {...r('unit')} /></F>
          <F f={ff} name="unitCost" label="ราคาต่อหน่วย (บาท)"><Input inputMode="decimal" {...r('unitCost')} /></F>
        </>}
        {kind === 'expenses' && <>
          <F f={ff} name="category" label="หมวด"><Select options={toOptions(TRIP_EXPENSE_CATEGORY_TH)} {...r('category')} /></F>
          <F f={ff} name="description" label="รายการ" required />
          <F f={ff} name="amount" label="จำนวนเงิน (บาท)" required><Input inputMode="decimal" {...r('amount')} /></F>
          <F f={ff} name="expenseDate" label="วันที่" required><Input type="date" {...r('expenseDate')} /></F>
          <Checkbox label="เป็นยอดประมาณการ (ยังไม่มีเอกสารยืนยัน)" {...r('isEstimate')} className="sm:col-span-2" />
          <Field label="หลักฐาน" className="sm:col-span-2"><FileUpload sensitivity="CONFIDENTIAL" value={ff.watch('fileId') as string} onChange={(v) => ff.setValue('fileId', v ?? '')} /></Field>
        </>}
        {kind === 'incidents' && <>
          <F f={ff} name="occurredAt" label="วันเวลา" required><Input type="datetime-local" {...r('occurredAt')} /></F>
          <F f={ff} name="type" label="ประเภท"><Select options={toOptions(INCIDENT_TYPE_TH)} {...r('type')} /></F>
          <F f={ff} name="severity" label="ความรุนแรง"><Select options={toOptions(SEVERITY_TH)} {...r('severity')} /></F>
          <div />
          <F f={ff} name="lat" label="ละติจูด"><Input inputMode="decimal" {...r('lat')} /></F>
          <F f={ff} name="lng" label="ลองจิจูด"><Input inputMode="decimal" {...r('lng')} /></F>
          <F f={ff} name="description" label="รายละเอียด" required className="sm:col-span-2"><Textarea {...r('description')} /></F>
        </>}
        {kind !== 'incidents' && <F f={ff} name="notes" label="หมายเหตุ" className="sm:col-span-2"><Textarea rows={2} {...r('notes')} /></F>}
      </FormGrid>
    </Dialog>
  );
}

/** Edit plan (DRAFT/PREPARING): captain, schedule, port, area, notes. */
export function PlanDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const captains = useEmployees({ position: 'CAPTAIN' });
  const f = useForm({
    resolver: zodResolver(tripUpdateSchema),
    defaultValues: {
      captainId: trip.captainId ?? '', plannedDepartureAt: trip.plannedDepartureAt ? toLocalInput(trip.plannedDepartureAt) : '',
      plannedReturnAt: trip.plannedReturnAt ? toLocalInput(trip.plannedReturnAt) : '', departurePort: trip.departurePort ?? '',
      fishingArea: trip.fishingArea ?? '', notes: trip.notes ?? '',
    },
  });
  const save = useAction((v: Record<string, unknown>) => api.patch(`/trips/${trip.id}`, v), { success: 'บันทึกแผนแล้ว', invalidate: INV, onSuccess: onClose });
  const submit = f.handleSubmit((v) =>
    save.mutate({ ...v, plannedDepartureAt: fromLocalInput((v.plannedDepartureAt as string) ?? ''), plannedReturnAt: fromLocalInput((v.plannedReturnAt as string) ?? '') }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`แก้ไขแผนเที่ยว ${trip.tripNo}`}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="ไต้ก๋ง/นายเรือ" className="sm:col-span-2">
          <Select options={(captains.data ?? []).map((e) => ({ value: e.id, label: `${e.code} · ${e.firstName} ${e.lastName}` }))} placeholder="- ไม่ระบุ -" {...f.register('captainId')} />
        </Field>
        <Field label="กำหนดออกเรือ"><Input type="datetime-local" {...f.register('plannedDepartureAt')} /></Field>
        <Field label="กำหนดกลับ"><Input type="datetime-local" {...f.register('plannedReturnAt')} /></Field>
        <Field label="ท่าออกเรือ"><Input {...f.register('departurePort')} /></Field>
        <Field label="พื้นที่ทำการประมง"><Input {...f.register('fishingArea')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}
