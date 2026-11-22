import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import {
  attachmentSchema, engineHourSchema, MAINT_CATEGORY_TH, MAINT_TYPE_TH, maintenanceCompleteSchema, maintenanceOrderSchema, maintenancePartSchema,
  maintenancePlanSchema, PRIORITY_TH, toOptions,
} from '@fisher/shared';
import { FileUpload } from '@/components/file-upload';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { dateInput, fromLocalInput, toLocalInput } from '@/lib/utils';
import type { ItemLite, MaintOrder, MaintPlan, ProviderLite, WarehouseLite } from './types';

export const INV = ['maintenance', 'inventory', 'vessel', 'vessels', 'dashboard'];
const STALE = 60_000;

export const useItems = () =>
  useQuery({ queryKey: ['inventory', 'items-lite'], queryFn: () => api.get<{ items: ItemLite[] }>('/inventory/items', { all: 'true', active: 'true' }).then((r) => r.items), staleTime: STALE });
export const useWarehouses = () =>
  useQuery({ queryKey: ['inventory', 'warehouses-lite'], queryFn: () => api.get<WarehouseLite[]>('/inventory/warehouses'), staleTime: STALE });
export const useProviders = () =>
  useQuery({ queryKey: ['purchasing', 'providers-lite'], queryFn: () => api.get<{ items: ProviderLite[] }>('/purchasing/suppliers', { all: 'true', active: 'true' }).then((r) => r.items), staleTime: STALE });

const footer = (close: () => void, loading: boolean, submit: () => void, text = 'บันทึก') => (
  <><Button variant="outline" onClick={close}>ยกเลิก</Button><Button loading={loading} onClick={submit}>{text}</Button></>
);
const RootErr = ({ msg }: { msg: string | null }) =>
  msg ? <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{msg}</div> : null;
const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ');

// ---------- plan ----------
export function PlanDialog({ plan, vesselId, onClose }: { plan: MaintPlan | null; vesselId?: string; onClose: () => void }) {
  const vessels = useVessels();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(maintenancePlanSchema) as never,
    defaultValues: {
      vesselId: plan?.vesselId ?? vesselId ?? '', name: plan?.name ?? '', category: plan?.category ?? 'ENGINE', intervalDays: plan?.intervalDays ?? '',
      intervalEngineHours: plan?.intervalEngineHours ?? '', lastDoneAt: dateInput(plan?.lastDoneAt), lastDoneEngineHours: plan?.lastDoneEngineHours ?? '',
      isActive: plan?.isActive ?? true, notes: plan?.notes ?? '',
    },
  });
  const save = useAction((v: FieldValues) => (plan ? api.put(`/maintenance/plans/${plan.id}`, v) : api.post('/maintenance/plans', v)), { success: 'บันทึกแผนบำรุงรักษาแล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync(v).catch((e) => setRootErr(msgOf(e))); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={plan ? 'แก้ไขแผนบำรุงรักษา' : 'เพิ่มแผนบำรุงรักษา'} size="lg" footer={footer(onClose, save.isPending, submit)}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="เรือ" required error={e('vesselId')}><Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" disabled={!!plan} {...f.register('vesselId')} /></Field>
        <Field label="ชื่อแผน" required error={e('name')}><Input {...f.register('name')} /></Field>
        <Field label="หมวด" required error={e('category')}><Select options={toOptions(MAINT_CATEGORY_TH)} {...f.register('category')} /></Field>
        <div />
        <Field label="รอบ (วัน)" error={e('intervalDays')} hint="กำหนดอย่างน้อยหนึ่งอย่าง: วัน หรือ ชั่วโมงเครื่อง"><Input inputMode="numeric" {...f.register('intervalDays')} /></Field>
        <Field label="รอบ (ชั่วโมงเครื่อง)" error={e('intervalEngineHours')}><Input inputMode="numeric" {...f.register('intervalEngineHours')} /></Field>
        <Field label="ทำล่าสุดเมื่อ" error={e('lastDoneAt')}><Input type="date" {...f.register('lastDoneAt')} /></Field>
        <Field label="ชั่วโมงเครื่องตอนทำล่าสุด" error={e('lastDoneEngineHours')}><Input inputMode="decimal" {...f.register('lastDoneEngineHours')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

// ---------- engine hours ----------
export function EngineHourDialog({ vesselId, onClose }: { vesselId?: string; onClose: () => void }) {
  const vessels = useVessels();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const [decrease, setDecrease] = useState(false);
  const f = useForm<FieldValues>({
    resolver: zodResolver(engineHourSchema) as never,
    defaultValues: { vesselId: vesselId ?? '', recordedAt: toLocalInput(), hours: '', isReset: false, notes: '' },
  });
  const save = useAction((v: FieldValues) => api.post('/maintenance/engine-hours', v), { success: 'บันทึกชั่วโมงเครื่องแล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    if (v.isReset && !String(v.notes ?? '').trim()) { f.setError('notes', { message: 'ระบุเหตุผลการรีเซ็ตมิเตอร์' }); return; }
    return save.mutateAsync({ ...v, recordedAt: fromLocalInput(v.recordedAt) }).catch((err) => {
      if (err instanceof ApiError && err.code === 'ENGINE_HOURS_DECREASE') setDecrease(true);
      setRootErr(msgOf(err));
    });
  });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="บันทึกชั่วโมงเครื่อง" footer={footer(onClose, save.isPending, submit)}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        {!vesselId && <Field label="เรือ" required error={e('vesselId')} className="sm:col-span-2"><Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" {...f.register('vesselId')} /></Field>}
        <Field label="วันเวลาที่อ่านค่า" required error={e('recordedAt')}><Input type="datetime-local" {...f.register('recordedAt')} /></Field>
        <Field label="ชั่วโมงเครื่องสะสม" required error={e('hours')}><Input inputMode="decimal" {...f.register('hours')} /></Field>
        {decrease && <Checkbox label="รีเซ็ตมิเตอร์ (เปลี่ยนมิเตอร์/เครื่องใหม่)" {...f.register('isReset')} />}
        <Field label={f.watch('isReset') ? 'เหตุผลการรีเซ็ต' : 'หมายเหตุ'} required={!!f.watch('isReset')} error={e('notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

// ---------- order create / edit ----------
export interface OrderPrefill { vesselId?: string; planId?: string; title?: string; category?: string; type?: string }
export function OrderDialog({ order, prefill, onClose, onSaved }: { order?: MaintOrder | null; prefill?: OrderPrefill; onClose: () => void; onSaved?: (id: string) => void }) {
  const vessels = useVessels();
  const providers = useProviders();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(maintenanceOrderSchema) as never,
    defaultValues: {
      vesselId: order?.vesselId ?? prefill?.vesselId ?? '', planId: order?.planId ?? prefill?.planId ?? '', title: order?.title ?? prefill?.title ?? '',
      category: order?.category ?? prefill?.category ?? 'ENGINE', type: order?.type ?? prefill?.type ?? 'CORRECTIVE', priority: order?.priority ?? 'MEDIUM',
      reportedAt: toLocalInput(order?.reportedAt), takesOutOfService: order?.takesOutOfService ?? false, providerId: order?.providerId ?? '', description: order?.description ?? '',
    },
  });
  const save = useAction(
    (v: FieldValues) => (order ? api.patch<{ id: string }>(`/maintenance/orders/${order.id}`, v) : api.post<{ id: string }>('/maintenance/orders', v)),
    { success: order ? 'บันทึกใบสั่งซ่อมแล้ว' : 'สร้างใบสั่งซ่อมแล้ว', invalidate: INV, onSuccess: (r) => { onClose(); if (!order) onSaved?.(r.id); }, silentError: true },
  );
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync({ ...v, reportedAt: fromLocalInput(v.reportedAt) }).catch((err) => setRootErr(msgOf(err))); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={order ? `แก้ไขใบสั่งซ่อม ${order.orderNo}` : 'แจ้งซ่อม'} size="lg" footer={footer(onClose, save.isPending, submit)}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="เรือ" required error={e('vesselId')}><Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" disabled={!!order || !!prefill?.planId} {...f.register('vesselId')} /></Field>
        <Field label="วันเวลาที่แจ้ง" required error={e('reportedAt')}><Input type="datetime-local" {...f.register('reportedAt')} /></Field>
        <Field label="หัวข้อ" required error={e('title')} className="sm:col-span-2"><Input {...f.register('title')} /></Field>
        <Field label="หมวด" required error={e('category')}><Select options={toOptions(MAINT_CATEGORY_TH)} {...f.register('category')} /></Field>
        <Field label="ประเภท" required error={e('type')}><Select options={toOptions(MAINT_TYPE_TH)} {...f.register('type')} /></Field>
        <Field label="ความเร่งด่วน" required error={e('priority')}><Select options={toOptions(PRIORITY_TH)} {...f.register('priority')} /></Field>
        <Field label="ผู้ให้บริการ/อู่ซ่อม" error={e('providerId')}><Select options={(providers.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} placeholder="- ไม่ระบุ -" {...f.register('providerId')} /></Field>
        <Field label="รายละเอียด" error={e('description')} className="sm:col-span-2"><Textarea rows={3} {...f.register('description')} /></Field>
        <Checkbox label="ต้องหยุดใช้เรือระหว่างซ่อม (สถานะเรือ = ซ่อมบำรุง)" {...f.register('takesOutOfService')} />
      </FormGrid>
    </Dialog>
  );
}

// ---------- parts ----------
export function PartDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const items = useItems();
  const wh = useWarehouses();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({ resolver: zodResolver(maintenancePartSchema) as never, defaultValues: { warehouseId: '', itemId: '', quantity: '', notes: '' } });
  const save = useAction((v: FieldValues) => api.post(`/maintenance/orders/${orderId}/parts`, v), { success: 'เบิกอะไหล่แล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync(v).catch((err) => setRootErr(msgOf(err))); });
  const unit = items.data?.find((i) => i.id === f.watch('itemId'))?.unit;
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="เบิกอะไหล่" footer={footer(onClose, save.isPending, submit, 'เบิก')}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="คลัง" required error={e('warehouseId')}><Select options={(wh.data ?? []).filter((w) => w.isActive !== false).map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} placeholder="- เลือกคลัง -" {...f.register('warehouseId')} /></Field>
        <Field label="สินค้า" required error={e('itemId')}><Select options={(items.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))} placeholder="- เลือกสินค้า -" {...f.register('itemId')} /></Field>
        <Field label={unit ? `จำนวน (${unit})` : 'จำนวน'} required error={e('quantity')}><Input inputMode="decimal" {...f.register('quantity')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')}><Input {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

// ---------- complete ----------
export function CompleteDialog({ order, onClose }: { order: MaintOrder; onClose: () => void }) {
  const providers = useProviders();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(maintenanceCompleteSchema) as never,
    defaultValues: { completedAt: toLocalInput(), engineHours: '', findings: order.findings ?? '', laborCost: order.laborCost ?? '', externalCost: order.externalCost ?? '', providerId: order.providerId ?? '', invoiceNo: order.invoiceNo ?? '' },
  });
  const save = useAction((v: FieldValues) => api.post(`/maintenance/orders/${order.id}/complete`, v), { success: 'ปิดงานซ่อมแล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync({ ...v, completedAt: fromLocalInput(v.completedAt) }).catch((err) => setRootErr(msgOf(err))); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`ปิดงาน ${order.orderNo}`} size="lg" footer={footer(onClose, save.isPending, submit, 'ปิดงาน')}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="วันเวลาที่เสร็จ" required error={e('completedAt')}><Input type="datetime-local" {...f.register('completedAt')} /></Field>
        <Field label="ชั่วโมงเครื่อง (ถ้าอ่านได้)" error={e('engineHours')}><Input inputMode="decimal" {...f.register('engineHours')} /></Field>
        <Field label="ค่าแรง (บาท)" error={e('laborCost')}><Input inputMode="decimal" {...f.register('laborCost')} /></Field>
        <Field label="ค่าจ้างภายนอก (บาท)" error={e('externalCost')}><Input inputMode="decimal" {...f.register('externalCost')} /></Field>
        <Field label="ผู้ให้บริการ/อู่ซ่อม" error={e('providerId')}><Select options={(providers.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} placeholder="- ไม่ระบุ -" {...f.register('providerId')} /></Field>
        <Field label="เลขที่ใบแจ้งหนี้" error={e('invoiceNo')}><Input {...f.register('invoiceNo')} /></Field>
        <Field label="ผลการตรวจ/สิ่งที่ดำเนินการ" error={e('findings')} className="sm:col-span-2"><Textarea rows={3} {...f.register('findings')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

// ---------- attachment ----------
export function AttachDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const f = useForm<FieldValues>({ resolver: zodResolver(attachmentSchema) as never, defaultValues: { fileId: '', note: '' } });
  const save = useAction((v: FieldValues) => api.post(`/maintenance/orders/${orderId}/attachments`, v), { success: 'แนบไฟล์แล้ว', invalidate: INV, onSuccess: onClose });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="แนบไฟล์" footer={footer(onClose, save.isPending, f.handleSubmit((v) => save.mutate(v)))}>
      <FormGrid cols={2}>
        <Field label="ไฟล์" required error={e('fileId')} className="sm:col-span-2">
          <FileUpload sensitivity="CONFIDENTIAL" value={f.watch('fileId') || null} onChange={(id) => f.setValue('fileId', id ?? '', { shouldValidate: true })} />
        </Field>
        <Field label="หมายเหตุ" error={e('note')}><Input {...f.register('note')} /></Field>
      </FormGrid>
    </Dialog>
  );
}
