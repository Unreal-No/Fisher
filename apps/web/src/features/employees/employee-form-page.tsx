import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import {
  EMPLOYEE_POSITION_TH, EMPLOYEE_STATUS_TH, employeeSchema, GENDER_TH, NATIONALITY_TH, PAY_TYPE_TH, toISODate, toOptions, type EmployeeInput,
} from '@fisher/shared';
import { FileUpload } from '@/components/file-upload';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Field, FormGrid, FormSection } from '@/components/ui/form';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Spinner } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { dateInput } from '@/lib/utils';
import type { Employee } from './types';

const toForm = (e?: Employee): EmployeeInput => ({
  code: e?.code ?? '', firstName: e?.firstName ?? '', lastName: e?.lastName ?? '', firstNameEn: e?.firstNameEn ?? '', lastNameEn: e?.lastNameEn ?? '',
  nickname: e?.nickname ?? '', dateOfBirth: dateInput(e?.dateOfBirth), nationality: (e?.nationality as never) ?? 'TH', gender: e?.gender ?? 'UNSPECIFIED',
  phone: e?.phone ?? '', address: e?.address ?? '', emergencyContactName: e?.emergencyContactName ?? '', emergencyContactPhone: e?.emergencyContactPhone ?? '',
  nationalIdNo: e?.nationalIdNo ?? '', startDate: dateInput(e?.startDate) || toISODate(), status: e?.status ?? 'ACTIVE', position: e?.position ?? 'DECKHAND',
  payType: e?.payType ?? 'MONTHLY', baseRate: e?.baseRate ?? '', bankName: e?.bankName ?? '', bankAccountNo: e?.bankAccountNo ?? '',
  photoFileId: e?.photoFileId ?? '', notes: e?.notes ?? '',
});

export function EmployeeFormPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api.get<Employee>(`/employees/${id}`), enabled: !!id });
  if (id && q.isLoading) return <Spinner />;
  return <EmployeeForm employee={q.data} />;
}

function EmployeeForm({ employee }: { employee?: Employee }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const sensitive = can('employee.sensitive');
  const f = useForm({ resolver: zodResolver(employeeSchema), defaultValues: toForm(employee) });
  const e = f.formState.errors;
  const save = useAction(
    (v: Record<string, unknown>) => {
      // never send masked values back (users without employee.sensitive see masked IDs)
      if (!sensitive && employee) for (const k of ['nationalIdNo', 'bankAccountNo']) delete v[k];
      return employee ? api.patch<Employee>(`/employees/${employee.id}`, v) : api.post<Employee>('/employees', v);
    },
    { success: 'บันทึกข้อมูลพนักงานแล้ว', invalidate: ['employees', 'employee', 'dashboard'], onSuccess: (r) => nav(`/employees/${r.id}`), silentError: true },
  );
  const submit = f.handleSubmit((v) =>
    save.mutateAsync(v as Record<string, unknown>).catch((err) => {
      if (err instanceof ApiError && err.fieldErrors) for (const [k, m] of Object.entries(err.fieldErrors)) f.setError(k as never, { message: m[0] });
      else f.setError('root', { message: err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ' });
    }),
  );
  const r = f.register;
  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={employee ? `แก้ไข ${employee.firstName} ${employee.lastName}` : 'เพิ่มพนักงาน/ลูกเรือ'}
        actions={<><Button variant="outline" onClick={() => nav(-1)}>ยกเลิก</Button><Button type="submit" loading={save.isPending}>บันทึก</Button></>}
      />
      {e.root && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{e.root.message}</div>}
      <Panel bodyClass="space-y-6">
        <FormSection title="ข้อมูลส่วนบุคคล">
          <FormGrid cols={4}>
            <Field label="รหัสพนักงาน" hint="เว้นว่างเพื่อสร้างอัตโนมัติ"><Input {...r('code')} /></Field>
            <Field label="ชื่อ" required error={e.firstName?.message}><Input {...r('firstName')} /></Field>
            <Field label="นามสกุล" required error={e.lastName?.message}><Input {...r('lastName')} /></Field>
            <Field label="ชื่อเล่น"><Input {...r('nickname')} /></Field>
            <Field label="ชื่อ (อังกฤษ/ตามพาสปอร์ต)"><Input {...r('firstNameEn')} /></Field>
            <Field label="นามสกุล (อังกฤษ)"><Input {...r('lastNameEn')} /></Field>
            <Field label="สัญชาติ" required><Select options={toOptions(NATIONALITY_TH)} {...r('nationality')} /></Field>
            <Field label="เพศ" hint="ระบุเมื่อจำเป็นต่อการปฏิบัติงาน"><Select options={toOptions(GENDER_TH)} {...r('gender')} /></Field>
            <Field label="วันเกิด" error={e.dateOfBirth?.message}><Input type="date" {...r('dateOfBirth')} /></Field>
            <Field label="เลขประจำตัว (บัตร ปชช./อื่นๆ)" hint={!sensitive && employee ? 'ไม่มีสิทธิ์แก้ไขข้อมูลส่วนบุคคล' : 'ข้อมูลส่วนบุคคล (PDPA)'}>
              <Input {...r('nationalIdNo')} disabled={!sensitive && !!employee} autoComplete="off" />
            </Field>
            <Field label="โทรศัพท์"><Input inputMode="tel" {...r('phone')} /></Field>
            <Field label="รูปถ่าย"><FileUpload sensitivity="CONFIDENTIAL" accept="image/jpeg,image/png,image/webp" value={f.watch('photoFileId') as string} onChange={(v) => f.setValue('photoFileId', v ?? '')} /></Field>
            <Field label="ที่อยู่" className="sm:col-span-2"><Textarea rows={2} {...r('address')} /></Field>
            <Field label="ผู้ติดต่อฉุกเฉิน"><Input {...r('emergencyContactName')} /></Field>
            <Field label="โทรผู้ติดต่อฉุกเฉิน"><Input inputMode="tel" {...r('emergencyContactPhone')} /></Field>
          </FormGrid>
        </FormSection>
        <FormSection title="การจ้างงาน">
          <FormGrid cols={4}>
            <Field label="วันเริ่มงาน" required error={e.startDate?.message}><Input type="date" {...r('startDate')} /></Field>
            <Field label="ตำแหน่ง" required><Select options={toOptions(EMPLOYEE_POSITION_TH)} {...r('position')} /></Field>
            <Field label="สถานะ"><Select options={toOptions(EMPLOYEE_STATUS_TH)} {...r('status')} /></Field>
            <Field label="รูปแบบค่าตอบแทน" hint="กฎการคำนวณกำหนดในโมดูลเงินเดือน"><Select options={toOptions(PAY_TYPE_TH)} {...r('payType')} /></Field>
            <Field label="อัตราพื้นฐาน (บาท)" error={e.baseRate?.message}><Input inputMode="decimal" {...r('baseRate')} /></Field>
            <Field label="ธนาคาร"><Input {...r('bankName')} /></Field>
            <Field label="เลขบัญชี"><Input {...r('bankAccountNo')} disabled={!sensitive && !!employee} autoComplete="off" /></Field>
          </FormGrid>
          {!employee && <p className="text-xs text-muted">การกำหนดเรือที่ประจำ ทำได้ที่หน้ารายละเอียดพนักงานหลังบันทึก (เก็บประวัติการย้ายเรือ)</p>}
        </FormSection>
        <FormSection title="หมายเหตุ"><Textarea {...r('notes')} /></FormSection>
      </Panel>
    </form>
  );
}
