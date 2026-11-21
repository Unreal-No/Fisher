import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import { FUEL_TYPE_TH, fuelAdjustSchema, fuelIssueSchema, fuelReceiptSchema, fuelTankSchema, formatMoney, formatNumber, MEASUREMENT_TH, toOptions } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { fromLocalInput, toLocalInput } from '@/lib/utils';
import type { FuelTank } from './types';

const INV = ['fuel', 'trip', 'trips', 'dashboard'];
const err = (f: { formState: { errors: FieldValues } }, k: string) => (f.formState.errors[k] as { message?: string } | undefined)?.message;

function TankInfo({ tank }: { tank: FuelTank }) {
  return (
    <div className="rounded border border-line bg-slate-50 px-3 py-2 text-sm">
      ถัง {tank.code} · {tank.name} · คงเหลือ <b>{formatNumber(tank.balanceL)}</b> ลิตร · ต้นทุนเฉลี่ย <b>{formatMoney(tank.avgCost)}</b> บาท/ลิตร
    </div>
  );
}

export function TankDialog({ tank, onClose }: { tank: FuelTank | null; onClose: () => void }) {
  const f = useForm<FieldValues>({
    resolver: zodResolver(fuelTankSchema) as never,
    defaultValues: { code: tank?.code ?? '', name: tank?.name ?? '', location: tank?.location ?? '', fuelType: tank?.fuelType ?? 'DIESEL_B7', capacityL: tank?.capacityL ?? '', isActive: tank?.isActive ?? true, notes: tank?.notes ?? '' },
  });
  const save = useAction((v: FieldValues) => (tank ? api.patch(`/fuel/tanks/${tank.id}`, v) : api.post('/fuel/tanks', v)), { success: 'บันทึกถังน้ำมันแล้ว', invalidate: INV, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={tank ? `แก้ไขถัง ${tank.code}` : 'เพิ่มถังน้ำมัน'}
      description="ยอดคงเหลือและต้นทุนเฉลี่ยคำนวณจากสมุดรายการ แก้ไขโดยตรงไม่ได้"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="รหัสถัง" required error={err(f, 'code')}><Input {...f.register('code')} /></Field>
        <Field label="ชื่อถัง" required error={err(f, 'name')}><Input {...f.register('name')} /></Field>
        <Field label="ชนิดน้ำมัน" required error={err(f, 'fuelType')}><Select options={toOptions(FUEL_TYPE_TH)} {...f.register('fuelType')} /></Field>
        <Field label="ความจุ (ลิตร)" error={err(f, 'capacityL')}><Input inputMode="decimal" {...f.register('capacityL')} /></Field>
        <Field label="ที่ตั้ง" error={err(f, 'location')} className="sm:col-span-2"><Input {...f.register('location')} /></Field>
        <Field label="หมายเหตุ" error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

export function ReceiptDialog({ tank, onClose }: { tank: FuelTank; onClose: () => void }) {
  const f = useForm<FieldValues>({
    resolver: zodResolver(fuelReceiptSchema) as never,
    defaultValues: { tankId: tank.id, txnDate: toLocalInput(), liters: '', unitPrice: '', supplierName: '', docNo: '', fileId: '', notes: '' },
  });
  const save = useAction((v: FieldValues) => api.post('/fuel/receipts', v), { success: 'บันทึกรับน้ำมันเข้าถังแล้ว', invalidate: INV, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`รับน้ำมันเข้าถัง ${tank.code}`}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate({ ...v, txnDate: fromLocalInput(v.txnDate) }))}>บันทึก</Button></>}>
      <div className="space-y-3">
        <TankInfo tank={tank} />
        <FormGrid cols={2}>
          <Field label="วันเวลา" required error={err(f, 'txnDate')}><Input type="datetime-local" {...f.register('txnDate')} /></Field>
          <Field label="ผู้จำหน่าย" error={err(f, 'supplierName')}><Input {...f.register('supplierName')} /></Field>
          <Field label="จำนวน (ลิตร)" required error={err(f, 'liters')}><Input inputMode="decimal" {...f.register('liters')} /></Field>
          <Field label="ราคา/ลิตร (บาท)" required error={err(f, 'unitPrice')}><Input inputMode="decimal" {...f.register('unitPrice')} /></Field>
          <Field label="เลขที่เอกสาร" error={err(f, 'docNo')}><Input {...f.register('docNo')} /></Field>
          <Field label="หมายเหตุ" error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}

export function IssueDialog({ tank, onClose }: { tank: FuelTank; onClose: () => void }) {
  const vessels = useVessels();
  const [needOverride, setNeedOverride] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(fuelIssueSchema) as never,
    defaultValues: { tankId: tank.id, txnDate: toLocalInput(), liters: '', vesselId: '', tripId: '', measurement: 'MEASURED', notes: '', override: false, overrideReason: '' },
  });
  const vesselId = f.watch('vesselId') as string;
  const trips = useQuery({
    queryKey: ['fuel', 'open-trips', vesselId],
    queryFn: () => api.get<{ items: { id: string; tripNo: string; status: string }[] }>('/trips', { vesselId, open: 'true', pageSize: 100 }).then((r) => r.items),
    enabled: !!vesselId,
  });
  const save = useAction((v: FieldValues) => api.post('/fuel/issues', v), { success: 'จ่ายน้ำมันเข้าเรือแล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const [rootErr, setRootErr] = useState<string | null>(null);
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    return save.mutateAsync({ ...v, txnDate: fromLocalInput(v.txnDate), override: v.override ? true : undefined }).catch((e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_FUEL') setNeedOverride(e.message);
      setRootErr(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ');
    });
  });
  const { can } = useAuth();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`จ่ายน้ำมันเข้าเรือจากถัง ${tank.code}`}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึก</Button></>}>
      <div className="space-y-3">
        <TankInfo tank={tank} />
        {rootErr && <div className="rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{rootErr}</div>}
        <FormGrid cols={2}>
          <Field label="วันเวลา" required error={err(f, 'txnDate')}><Input type="datetime-local" {...f.register('txnDate')} /></Field>
          <Field label="จำนวน (ลิตร)" required error={err(f, 'liters')}><Input inputMode="decimal" {...f.register('liters')} /></Field>
          <Field label="เรือ" required error={err(f, 'vesselId')}>
            <Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" {...f.register('vesselId', { onChange: () => f.setValue('tripId', '') })} />
          </Field>
          <Field label="เที่ยวเรือ" error={err(f, 'tripId')} hint={vesselId && !trips.isLoading && !trips.data?.length ? 'ไม่มีเที่ยวที่เปิดอยู่' : undefined}>
            <Select options={(trips.data ?? []).map((t) => ({ value: t.id, label: t.tripNo }))} placeholder="- ไม่ระบุเที่ยว -" disabled={!vesselId} {...f.register('tripId')} />
          </Field>
          <Field label="วิธีได้ค่า"><Select options={toOptions(MEASUREMENT_TH)} {...f.register('measurement')} /></Field>
          <Field label="หมายเหตุ" error={err(f, 'notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        </FormGrid>
        {needOverride && (
          <div className="space-y-2 rounded border border-amber-200 bg-warn-soft p-3 text-sm">
            {can('fuel.approve') ? (
              <>
                <Checkbox label="อนุมัติจ่ายเกินยอดคงเหลือ" {...f.register('override')} />
                {f.watch('override') && <Input placeholder="เหตุผลการอนุมัติ (จำเป็น)" {...f.register('overrideReason')} />}
              </>
            ) : <p className="text-warn">ต้องให้ผู้มีสิทธิ์อนุมัติดำเนินการ หรือลดจำนวนลิตร</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function AdjustDialog({ tank, onClose }: { tank: FuelTank; onClose: () => void }) {
  const f = useForm<FieldValues>({
    resolver: zodResolver(fuelAdjustSchema) as never,
    defaultValues: { tankId: tank.id, txnDate: toLocalInput(), measuredBalanceL: '', reason: '' },
  });
  const save = useAction((v: FieldValues) => api.post('/fuel/adjustments', v), { success: 'ปรับยอดถังแล้ว', invalidate: INV, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`ปรับยอดถัง ${tank.code}`} description="กรอกยอดที่วัดจริง ระบบจะบันทึกส่วนต่างให้อัตโนมัติ"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate({ ...v, txnDate: fromLocalInput(v.txnDate) }))}>บันทึก</Button></>}>
      <div className="space-y-3">
        <TankInfo tank={tank} />
        <FormGrid cols={2}>
          <Field label="วันเวลาที่วัด" required error={err(f, 'txnDate')}><Input type="datetime-local" {...f.register('txnDate')} /></Field>
          <Field label="ยอดที่วัดได้ (ลิตร)" required error={err(f, 'measuredBalanceL')}><Input inputMode="decimal" {...f.register('measuredBalanceL')} /></Field>
          <Field label="เหตุผล" required error={err(f, 'reason')} className="sm:col-span-2"><Textarea rows={2} {...f.register('reason')} /></Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}
