import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { DOC_APPLIES_TO_TH, documentTypeSchema, toOptions, type DocAppliesTo } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useDocTypes, type DocType } from '@/lib/lookups';

interface Settings { companyName: string; docReminderDays: number[]; gpsSignalLostMinutes: number; maintenanceReminderDays: number; maintenanceReminderHours: number }

export function SettingsPage() {
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const types = useDocTypes();
  const [company, setCompany] = useState('');
  const [days, setDays] = useState('');
  const [lost, setLost] = useState('60');
  const [mDays, setMDays] = useState('14');
  const [mHours, setMHours] = useState('50');
  const [edit, setEdit] = useState<DocType | 'new' | null>(null);
  useEffect(() => {
    if (s.data) { setCompany(s.data.companyName); setDays(s.data.docReminderDays.join(', ')); setLost(String(s.data.gpsSignalLostMinutes)); setMDays(String(s.data.maintenanceReminderDays)); setMHours(String(s.data.maintenanceReminderHours)); }
  }, [s.data]);
  const save = useAction((v: unknown) => api.patch('/settings', v), { success: 'บันทึกการตั้งค่าแล้ว', invalidate: ['settings'] });
  const parsedDays = days.split(/[,\s]+/).filter(Boolean).map(Number);
  const mValid = Number.isInteger(Number(mDays)) && Number(mDays) >= 1 && Number(mDays) <= 180 && Number.isInteger(Number(mHours)) && Number(mHours) >= 1 && Number(mHours) <= 5000;
  const lostValid = Number.isInteger(Number(lost)) && Number(lost) >= 5 && Number(lost) <= 1440;
  const daysValid = parsedDays.length > 0 && parsedDays.every((d) => Number.isInteger(d) && d > 0 && d <= 365);
  return (
    <>
      <PageHeader title="ตั้งค่าระบบ" />
      <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
        <Panel title="ทั่วไปและการแจ้งเตือน">
          <div className="space-y-3">
            <Field label="ชื่อบริษัท"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
            <Field label="แจ้งเตือนเอกสารล่วงหน้า (วัน)" hint="คั่นด้วยจุลภาค เช่น 90, 60, 30, 7 · เป็นการเตือนทางธุรกิจ ไม่ใช่ข้อสรุปทางกฎหมาย" error={daysValid ? undefined : 'ตัวเลข 1–365'}>
              <Input value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label="แจ้งเตือนขาดสัญญาณ GPS เมื่อเรือในทะเลไม่ส่งตำแหน่งเกิน (นาที)" error={lostValid ? undefined : 'ตัวเลข 5–1440'}>
              <Input inputMode="numeric" value={lost} onChange={(e) => setLost(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="เตือนซ่อมบำรุงล่วงหน้า (วัน)" error={mValid ? undefined : '1–180 วัน / 1–5000 ชม.'}><Input inputMode="numeric" value={mDays} onChange={(e) => setMDays(e.target.value)} /></Field>
              <Field label="หรือเหลือชั่วโมงเครื่อง ≤"><Input inputMode="numeric" value={mHours} onChange={(e) => setMHours(e.target.value)} /></Field>
            </div>
            <Button loading={save.isPending} disabled={!daysValid || !lostValid || !mValid} onClick={() => save.mutate({ companyName: company, docReminderDays: parsedDays, gpsSignalLostMinutes: Number(lost), maintenanceReminderDays: Number(mDays), maintenanceReminderHours: Number(mHours) })}>บันทึก</Button>
          </div>
        </Panel>
        <Panel title="ประเภทเอกสารพนักงาน (Checklist)" bodyClass="p-0" actions={<Button size="sm" onClick={() => setEdit('new')}><Plus /> เพิ่มประเภท</Button>}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">รหัส</th><th className="px-2">ชื่อ</th><th className="px-2">ใช้กับ</th><th className="px-2">บังคับ</th><th className="px-2">มีวันหมดอายุ</th><th className="px-2">สถานะ</th><th /></tr></thead>
            <tbody>
              {types.data?.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-2 font-mono text-xs">{t.code}</td><td className="px-2">{t.nameTh}</td><td className="px-2">{DOC_APPLIES_TO_TH[t.appliesTo as DocAppliesTo]}</td>
                  <td className="px-2">{t.isRequired ? <Badge tone="info">บังคับ</Badge> : '-'}</td><td className="px-2">{t.requiresExpiry ? 'มี' : 'ไม่มี'}</td>
                  <td className="px-2">{t.isActive ? <Badge tone="ok">ใช้งาน</Badge> : <Badge>ปิด</Badge>}</td>
                  <td className="px-2 text-right"><Button variant="ghost" size="icon" aria-label="แก้ไข" onClick={() => setEdit(t)}><Pencil /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      {edit && <DocTypeDialog t={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function DocTypeDialog({ t, onClose }: { t?: DocType; onClose: () => void }) {
  const f = useForm({
    resolver: zodResolver(documentTypeSchema),
    defaultValues: { code: t?.code ?? '', nameTh: t?.nameTh ?? '', nameEn: t?.nameEn ?? '', appliesTo: (t?.appliesTo as DocAppliesTo) ?? 'ALL', isRequired: t?.isRequired ?? false, requiresExpiry: t?.requiresExpiry ?? true, isActive: t?.isActive ?? true, sortOrder: t?.sortOrder ?? 0 },
  });
  const save = useAction((v: unknown) => (t ? api.patch(`/document-types/${t.id}`, v) : api.post('/document-types', v)), { success: 'บันทึกแล้ว', invalidate: ['document-types'], onSuccess: onClose });
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t ? 'แก้ไขประเภทเอกสาร' : 'เพิ่มประเภทเอกสาร'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="รหัส" required error={e.code?.message}><Input disabled={!!t} {...f.register('code')} /></Field>
        <Field label="ชื่อไทย" required error={e.nameTh?.message}><Input {...f.register('nameTh')} /></Field>
        <Field label="ชื่ออังกฤษ"><Input {...f.register('nameEn')} /></Field>
        <Field label="ใช้กับ"><Select options={toOptions(DOC_APPLIES_TO_TH)} {...f.register('appliesTo')} /></Field>
        <Field label="ลำดับ"><Input inputMode="numeric" {...f.register('sortOrder')} /></Field>
        <div className="space-y-1.5 pt-5">
          <Checkbox label="เอกสารบังคับ (ตรวจก่อนออกเรือ)" {...f.register('isRequired')} />
          <Checkbox label="มีวันหมดอายุ" {...f.register('requiresExpiry')} />
          <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
        </div>
      </FormGrid>
    </Dialog>
  );
}
