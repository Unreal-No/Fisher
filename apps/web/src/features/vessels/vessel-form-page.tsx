import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { toOptions, VESSEL_STATUS_TH, vesselSchema, type VesselInput } from '@fisher/shared';
import { FileUpload } from '@/components/file-upload';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Field, FormGrid, FormSection } from '@/components/ui/form';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Spinner } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { employeeOptions, useEmployees } from '@/lib/lookups';
import { dateInput } from '@/lib/utils';
import type { Vessel } from './types';

export const VESSEL_TYPES = ['อวนลากแผ่นตะเฆ่', 'อวนลากคู่', 'อวนล้อมจับ', 'อวนติดตา', 'อวนครอบหมึก', 'ลอบ', 'เบ็ดราว', 'เรือประมงพื้นบ้าน', 'เรือขนถ่ายสัตว์น้ำ', 'อื่นๆ'];

const toForm = (v?: Vessel): VesselInput => ({
  code: v?.code ?? '', name: v?.name ?? '', registrationNo: v?.registrationNo ?? '', vesselType: v?.vesselType ?? '',
  lengthM: v?.lengthM ?? '', widthM: v?.widthM ?? '', grossTonnage: v?.grossTonnage ?? '', netTonnage: v?.netTonnage ?? '',
  hullMaterial: v?.hullMaterial ?? '', buildYear: v?.buildYear ?? '', homePort: v?.homePort ?? '', engineMake: v?.engineMake ?? '',
  engineModel: v?.engineModel ?? '', engineSerialNo: v?.engineSerialNo ?? '', enginePowerHp: v?.enginePowerHp ?? '',
  fuelTankCapacityL: v?.fuelTankCapacityL ?? '', ownerName: v?.ownerName ?? '', ownerTaxId: v?.ownerTaxId ?? '', captainId: v?.captainId ?? '',
  radioCallSign: v?.radioCallSign ?? '', mmsi: v?.mmsi ?? '', commEquipment: v?.commEquipment ?? '', licenseNo: v?.licenseNo ?? '',
  licenseExpiry: dateInput(v?.licenseExpiry), registrationExpiry: dateInput(v?.registrationExpiry), status: v?.status ?? 'AT_PORT',
  photoFileId: v?.photoFileId ?? '', notes: v?.notes ?? '',
});

export function VesselFormPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['vessel', id], queryFn: () => api.get<Vessel>(`/vessels/${id}`), enabled: !!id });
  if (id && q.isLoading) return <Spinner />;
  return <VesselForm vessel={q.data} />;
}

function VesselForm({ vessel }: { vessel?: Vessel }) {
  const nav = useNavigate();
  const captains = useEmployees({ position: 'CAPTAIN' });
  const f = useForm({ resolver: zodResolver(vesselSchema), defaultValues: toForm(vessel) });
  const e = f.formState.errors;
  const save = useAction(
    (v: unknown) => (vessel ? api.patch<Vessel>(`/vessels/${vessel.id}`, v) : api.post<Vessel>('/vessels', v)),
    { success: 'บันทึกข้อมูลเรือแล้ว', invalidate: ['vessels', 'vessel', 'dashboard'], onSuccess: (r) => nav(`/vessels/${r.id}`), silentError: true },
  );
  const submit = f.handleSubmit((v) =>
    save.mutateAsync(v).catch((err) => {
      if (err instanceof ApiError && err.fieldErrors) for (const [k, m] of Object.entries(err.fieldErrors)) f.setError(k as never, { message: m[0] });
      else f.setError('root', { message: err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ' });
    }),
  );
  const r = f.register;
  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={vessel ? `แก้ไขเรือ ${vessel.name}` : 'เพิ่มเรือใหม่'}
        actions={
          <>
            <Button variant="outline" onClick={() => nav(-1)}>ยกเลิก</Button>
            <Button type="submit" loading={save.isPending}>บันทึก</Button>
          </>
        }
      />
      {e.root && <div className="mb-3 rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{e.root.message}</div>}
      <Panel className="space-y-6" bodyClass="space-y-6">
        <FormSection title="ข้อมูลทั่วไป">
          <FormGrid>
            <Field label="รหัสเรือ" hint="เว้นว่างเพื่อสร้างอัตโนมัติ" error={e.code?.message}><Input {...r('code')} /></Field>
            <Field label="ชื่อเรือ" required error={e.name?.message}><Input {...r('name')} /></Field>
            <Field label="เลขทะเบียนเรือ" required error={e.registrationNo?.message}><Input {...r('registrationNo')} /></Field>
            <Field label="ประเภทเรือ/เครื่องมือ" required error={e.vesselType?.message}>
              <Input list="vessel-types" {...r('vesselType')} />
              <datalist id="vessel-types">{VESSEL_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
            <Field label="สถานะ"><Select options={toOptions(VESSEL_STATUS_TH)} {...r('status')} /></Field>
            <Field label="ท่าเรือประจำ" error={e.homePort?.message}><Input {...r('homePort')} /></Field>
            <Field label="ไต้ก๋ง/นายเรือประจำ"><Select options={employeeOptions(captains.data)} placeholder="- ไม่ระบุ -" {...r('captainId')} /></Field>
            <Field label="เจ้าของเรือ" error={e.ownerName?.message}><Input {...r('ownerName')} /></Field>
            <Field label="เลขผู้เสียภาษีเจ้าของ" error={e.ownerTaxId?.message}><Input {...r('ownerTaxId')} /></Field>
          </FormGrid>
        </FormSection>
        <FormSection title="ขนาดและโครงสร้าง">
          <FormGrid cols={4}>
            <Field label="ความยาว (ม.)" error={e.lengthM?.message}><Input inputMode="decimal" {...r('lengthM')} /></Field>
            <Field label="ความกว้าง (ม.)" error={e.widthM?.message}><Input inputMode="decimal" {...r('widthM')} /></Field>
            <Field label="ขนาดตันกรอส" error={e.grossTonnage?.message}><Input inputMode="decimal" {...r('grossTonnage')} /></Field>
            <Field label="ขนาดตันเนต" error={e.netTonnage?.message}><Input inputMode="decimal" {...r('netTonnage')} /></Field>
            <Field label="วัสดุตัวเรือ"><Input {...r('hullMaterial')} /></Field>
            <Field label="ปีที่ต่อ (ค.ศ.)" error={e.buildYear?.message}><Input inputMode="numeric" {...r('buildYear')} /></Field>
            <Field label="ความจุถังน้ำมัน (ลิตร)" error={e.fuelTankCapacityL?.message}><Input inputMode="decimal" {...r('fuelTankCapacityL')} /></Field>
          </FormGrid>
        </FormSection>
        <FormSection title="เครื่องยนต์">
          <FormGrid cols={4}>
            <Field label="ยี่ห้อ"><Input {...r('engineMake')} /></Field>
            <Field label="รุ่น"><Input {...r('engineModel')} /></Field>
            <Field label="หมายเลขเครื่อง"><Input {...r('engineSerialNo')} /></Field>
            <Field label="กำลัง (แรงม้า)" error={e.enginePowerHp?.message}><Input inputMode="decimal" {...r('enginePowerHp')} /></Field>
          </FormGrid>
        </FormSection>
        <FormSection title="การสื่อสารและใบอนุญาต">
          <FormGrid cols={4}>
            <Field label="สัญญาณเรียกขาน"><Input {...r('radioCallSign')} /></Field>
            <Field label="MMSI (AIS)" error={e.mmsi?.message}><Input inputMode="numeric" {...r('mmsi')} /></Field>
            <Field label="เลขที่ใบอนุญาตทำการประมง"><Input {...r('licenseNo')} /></Field>
            <Field label="ใบอนุญาตหมดอายุ" error={e.licenseExpiry?.message}><Input type="date" {...r('licenseExpiry')} /></Field>
            <Field label="ทะเบียนเรือหมดอายุ" error={e.registrationExpiry?.message}><Input type="date" {...r('registrationExpiry')} /></Field>
            <Field label="อุปกรณ์สื่อสาร" className="sm:col-span-2 lg:col-span-3"><Input {...r('commEquipment')} placeholder="เช่น วิทยุ VHF, SSB, VMS" /></Field>
          </FormGrid>
        </FormSection>
        <FormSection title="อื่นๆ">
          <FormGrid cols={2}>
            <Field label="รูปเรือ"><FileUpload value={f.watch('photoFileId') as string} onChange={(v) => f.setValue('photoFileId', v ?? '')} accept="image/jpeg,image/png,image/webp" /></Field>
            <Field label="หมายเหตุ"><Textarea {...r('notes')} /></Field>
          </FormGrid>
        </FormSection>
      </Panel>
    </form>
  );
}
