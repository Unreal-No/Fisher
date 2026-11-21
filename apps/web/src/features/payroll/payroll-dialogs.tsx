import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type FieldValues } from 'react-hook-form';
import {
  ADJUSTMENT_CODES, ADVANCE_KIND_TH, advanceSchema, COMP_BASIS_TH, compensationRuleSchema, EMPLOYEE_POSITION_TH, PAY_ITEM_CODE_TH, PAY_TYPE_TH, PAYMENT_METHOD_TH,
  payrollAdjustmentSchema, payrollPaySchema, payrollPeriodSchema, toISODate, toOptions, type CompBasis, type PayType,
} from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errOf, Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { employeeOptions, useEmployees, useVessels, vesselOptions } from '@/lib/lookups';
import { dateInput, fromLocalInput, toLocalInput } from '@/lib/utils';
import type { CompRule, PeriodRow } from './types';

export const INV = ['payroll', 'employee-payroll'];

const footer = (close: () => void, loading: boolean, submit: () => void, text = 'บันทึก') => (
  <><Button variant="outline" onClick={close}>ยกเลิก</Button><Button loading={loading} onClick={submit}>{text}</Button></>
);
const RootErr = ({ msg }: { msg: string | null }) =>
  msg ? <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{msg}</div> : null;
const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ');

// ---------- period ----------
export function PeriodDialog({ period, onClose, onSaved }: { period?: (PeriodRow & { notes?: string | null }) | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const vessels = useVessels();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(payrollPeriodSchema) as never,
    defaultValues: {
      name: period?.name ?? '', startDate: dateInput(period?.startDate), endDate: dateInput(period?.endDate), payDate: dateInput(period?.payDate),
      vesselId: period?.vesselId ?? '', notes: period?.notes ?? '',
    },
  });
  const save = useAction((v: FieldValues) => (period ? api.put<{ id: string }>(`/payroll/periods/${period.id}`, v) : api.post<{ id: string }>('/payroll/periods', v)), {
    success: 'บันทึกงวดเงินเดือนแล้ว', invalidate: INV, silentError: true, onSuccess: (r) => { onClose(); if (!period) onSaved?.(r.id); },
  });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync(v).catch((e) => setRootErr(msgOf(e))); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={period ? 'แก้ไขงวดเงินเดือน' : 'สร้างงวดเงินเดือน'} size="lg" footer={footer(onClose, save.isPending, submit)}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="ชื่องวด" required error={e('name')} className="sm:col-span-2"><Input placeholder="เช่น เงินเดือน ธ.ค. 2569" {...f.register('name')} /></Field>
        <Field label="วันเริ่มงวด" required error={e('startDate')}><Input type="date" {...f.register('startDate')} /></Field>
        <Field label="วันสิ้นสุดงวด" required error={e('endDate')}><Input type="date" {...f.register('endDate')} /></Field>
        <Field label="วันที่จ่าย" error={e('payDate')}><Input type="date" {...f.register('payDate')} /></Field>
        <Field label="เรือ" error={e('vesselId')} hint={period ? 'เปลี่ยนเรือไม่ได้' : 'ว่าง = ทุกลำ'}>
          <Select options={vesselOptions(vessels.data)} placeholder="ทุกลำ" disabled={!!period} {...f.register('vesselId')} />
        </Field>
        <Field label="หมายเหตุ" error={e('notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

// ---------- compensation rule ----------
export const RATE_LABEL: Record<PayType, string> = {
  MONTHLY: 'บาท/เดือน', DAILY: 'บาท/วันในทะเล', PER_TRIP: 'บาท/เที่ยว', REVENUE_SHARE: '% ต่อคน', CATCH_BASED: 'บาท/กก.',
};
const BASES: Partial<Record<PayType, CompBasis[]>> = { REVENUE_SHARE: ['GROSS_REVENUE', 'NET_PROFIT'], CATCH_BASED: ['CAUGHT_KG', 'SOLD_KG'] };

export function RuleDialog({ rule, onClose }: { rule: CompRule | null; onClose: () => void }) {
  const vessels = useVessels();
  const emps = useEmployees();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(compensationRuleSchema) as never,
    defaultValues: {
      name: rule?.name ?? '', method: rule?.method ?? 'MONTHLY', vesselId: rule?.vesselId ?? '', position: rule?.position ?? '', employeeId: rule?.employeeId ?? '',
      rate: rule?.rate ?? '', basis: rule?.basis ?? '', effectiveFrom: dateInput(rule?.effectiveFrom) || toISODate(), effectiveTo: dateInput(rule?.effectiveTo),
      isActive: rule?.isActive ?? true, notes: rule?.notes ?? '',
    },
  });
  const method = f.watch('method') as PayType;
  const bases = BASES[method];
  const save = useAction((v: FieldValues) => (rule ? api.put(`/payroll/rules/${rule.id}`, v) : api.post('/payroll/rules', v)), {
    success: 'บันทึกกฎค่าตอบแทนแล้ว', invalidate: INV, onSuccess: onClose, silentError: true,
  });
  const submit = f.handleSubmit((v) => {
    setRootErr(null);
    return save.mutateAsync({ ...v, basis: bases ? v.basis : '' }).catch((e) => setRootErr(msgOf(e)));
  });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={rule ? 'แก้ไขกฎค่าตอบแทน' : 'เพิ่มกฎค่าตอบแทน'} size="lg" footer={footer(onClose, save.isPending, submit)}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="ชื่อกฎ" required error={e('name')} className="sm:col-span-2"><Input {...f.register('name')} /></Field>
        <Field label="วิธีคำนวณ" required error={e('method')}><Select options={toOptions(PAY_TYPE_TH)} {...f.register('method', { onChange: () => f.setValue('basis', '') })} /></Field>
        {bases
          ? <Field label="ฐานคำนวณ" required error={e('basis')}><Select options={bases.map((b) => ({ value: b, label: COMP_BASIS_TH[b] }))} placeholder="- เลือกฐาน -" {...f.register('basis')} /></Field>
          : <div />}
        <Field label={`อัตรา (${RATE_LABEL[method]})`} required error={e('rate')}><Input inputMode="decimal" {...f.register('rate')} /></Field>
        <div />
        <Field label="เฉพาะเรือ" error={e('vesselId')} hint="ว่าง = ทุกลำ"><Select options={vesselOptions(vessels.data)} placeholder="ทุกลำ" {...f.register('vesselId')} /></Field>
        <Field label="เฉพาะตำแหน่ง" error={e('position')} hint="ว่าง = ทุกตำแหน่ง"><Select options={toOptions(EMPLOYEE_POSITION_TH)} placeholder="ทุกตำแหน่ง" {...f.register('position')} /></Field>
        <Field label="เฉพาะพนักงาน" error={e('employeeId')} hint="ว่าง = ทุกคน" className="sm:col-span-2"><Select options={employeeOptions(emps.data)} placeholder="ทุกคน" {...f.register('employeeId')} /></Field>
        <Field label="มีผลตั้งแต่" required error={e('effectiveFrom')}><Input type="date" {...f.register('effectiveFrom')} /></Field>
        <Field label="สิ้นสุด" error={e('effectiveTo')}><Input type="date" {...f.register('effectiveTo')} /></Field>
        <Field label="หมายเหตุ" error={e('notes')} className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

// ---------- advance ----------
export function AdvanceDialog({ onClose }: { onClose: () => void }) {
  const emps = useEmployees();
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({
    resolver: zodResolver(advanceSchema) as never,
    defaultValues: { employeeId: '', kind: 'ADVANCE', advanceDate: toISODate(), amount: '', installment: '', method: 'CASH', reason: '' },
  });
  const kind = f.watch('kind');
  const save = useAction((v: FieldValues) => api.post('/payroll/advances', v), { success: 'บันทึกเงินเบิก/เงินกู้แล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync({ ...v, installment: v.kind === 'LOAN' ? v.installment : '' }).catch((e) => setRootErr(msgOf(e))); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="บันทึกเงินเบิก/เงินกู้" size="lg" footer={footer(onClose, save.isPending, submit)}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="พนักงาน" required error={e('employeeId')} className="sm:col-span-2"><Select options={employeeOptions(emps.data)} placeholder="- เลือกพนักงาน -" {...f.register('employeeId')} /></Field>
        <Field label="ประเภท" required error={e('kind')}><Select options={toOptions(ADVANCE_KIND_TH)} {...f.register('kind')} /></Field>
        <Field label="วันที่" required error={e('advanceDate')}><Input type="date" {...f.register('advanceDate')} /></Field>
        <Field label="จำนวนเงิน (บาท)" required error={e('amount')}><Input inputMode="decimal" {...f.register('amount')} /></Field>
        {kind === 'LOAN' && <Field label="ยอดผ่อนต่องวด (บาท)" required error={e('installment')}><Input inputMode="decimal" {...f.register('installment')} /></Field>}
        <Field label="วิธีจ่ายเงิน" required error={e('method')}><Select options={toOptions(PAYMENT_METHOD_TH)} {...f.register('method')} /></Field>
        <Field label="เหตุผล" required error={e('reason')} className="sm:col-span-2"><Textarea rows={2} {...f.register('reason')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

// ---------- adjustment ----------
export function AdjustmentDialog({ periodId, employees, onClose }: { periodId: string; employees: { id: string; label: string }[]; onClose: () => void }) {
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({ resolver: zodResolver(payrollAdjustmentSchema) as never, defaultValues: { employeeId: '', code: 'BONUS', description: '', amount: '' } });
  const save = useAction((v: FieldValues) => api.post(`/payroll/periods/${periodId}/adjustments`, v), { success: 'เพิ่มรายการปรับปรุงแล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync(v).catch((e) => setRootErr(msgOf(e))); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="เพิ่มรายการปรับปรุง" footer={footer(onClose, save.isPending, submit)}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="พนักงาน" required error={e('employeeId')} className="sm:col-span-2">
          <Select options={employees.map((x) => ({ value: x.id, label: x.label }))} placeholder="- เลือกพนักงาน -" {...f.register('employeeId')} />
        </Field>
        <Field label="ประเภท" required error={e('code')}><Select options={ADJUSTMENT_CODES.map((c) => ({ value: c, label: PAY_ITEM_CODE_TH[c] }))} {...f.register('code')} /></Field>
        <Field label="จำนวนเงิน (บาท)" required error={e('amount')}><Input inputMode="decimal" {...f.register('amount')} /></Field>
        <Field label="รายละเอียด" required error={e('description')} className="sm:col-span-2"><Input {...f.register('description')} /></Field>
      </FormGrid>
      <p className="mt-2 text-xs text-muted">เมื่อเพิ่มรายการ งวดจะกลับเป็นสถานะร่างและต้องคำนวณใหม่</p>
    </Dialog>
  );
}

// ---------- pay ----------
export function PayDialog({ periodId, onClose }: { periodId: string; onClose: () => void }) {
  const [rootErr, setRootErr] = useState<string | null>(null);
  const f = useForm<FieldValues>({ resolver: zodResolver(payrollPaySchema) as never, defaultValues: { paidAt: toLocalInput(), method: 'TRANSFER', reference: '' } });
  const save = useAction((v: FieldValues) => api.post(`/payroll/periods/${periodId}/pay`, v), { success: 'บันทึกการจ่ายเงินเดือนแล้ว', invalidate: INV, onSuccess: onClose, silentError: true });
  const submit = f.handleSubmit((v) => { setRootErr(null); return save.mutateAsync({ ...v, paidAt: fromLocalInput(v.paidAt) }).catch((e) => setRootErr(msgOf(e))); });
  const e = (k: string) => errOf(f.formState.errors, k);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="บันทึกการจ่ายเงินเดือน" footer={footer(onClose, save.isPending, submit, 'ยืนยันจ่าย')}>
      <RootErr msg={rootErr} />
      <FormGrid cols={2}>
        <Field label="วันเวลาที่จ่าย" required error={e('paidAt')}><Input type="datetime-local" {...f.register('paidAt')} /></Field>
        <Field label="วิธีจ่าย" required error={e('method')}><Select options={toOptions(PAYMENT_METHOD_TH)} {...f.register('method')} /></Field>
        <Field label="เลขอ้างอิง" error={e('reference')} className="sm:col-span-2"><Input {...f.register('reference')} /></Field>
      </FormGrid>
    </Dialog>
  );
}
