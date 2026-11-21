import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { formatMoney, SPECIES_CATEGORY_TH, speciesSchema, toOptions, type SpeciesCategory } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useSpecies, type Species } from '@/lib/lookups';

export function SpeciesPage() {
  const { can } = useAuth();
  const q = useSpecies();
  const [edit, setEdit] = useState<Species | 'new' | null>(null);
  return (
    <>
      <PageHeader title="ทะเบียนชนิดสัตว์น้ำ" subtitle="ข้อมูลหลักสำหรับบันทึกสัตว์น้ำและการขาย" actions={can('species.manage') && <Button onClick={() => setEdit('new')}><Plus /> เพิ่มชนิด</Button>} />
      <QueryView q={q}>
        {(rows) => (
          <Panel bodyClass="p-0">
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">รหัส</th><th className="px-2">ชื่อไทย</th><th className="px-2">ชื่ออังกฤษ</th><th className="px-2">ชื่อวิทยาศาสตร์</th><th className="px-2">หมวด</th><th className="px-2">หน่วย</th><th className="px-2 text-right">ราคาตั้งต้น</th><th className="px-2">สถานะ</th><th /></tr></thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} className="border-t border-line">
                        <td className="px-4 py-2 font-mono text-xs">{s.code}</td><td className="px-2 font-medium">{s.nameTh}</td><td className="px-2">{s.nameEn ?? '-'}</td>
                        <td className="px-2 italic text-muted">{s.scientificName ?? '-'}</td><td className="px-2">{SPECIES_CATEGORY_TH[s.category as SpeciesCategory]}</td>
                        <td className="px-2">{s.unit}</td><td className="px-2 text-right">{s.defaultPrice ? formatMoney(s.defaultPrice) : '-'}</td>
                        <td className="px-2">{s.isActive ? <Badge tone="ok">ใช้งาน</Badge> : <Badge>ปิดใช้งาน</Badge>}</td>
                        <td className="px-2 text-right">{can('species.manage') && <Button variant="ghost" size="icon" aria-label="แก้ไข" onClick={() => setEdit(s)}><Pencil /></Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty />}
          </Panel>
        )}
      </QueryView>
      {edit && <SpeciesDialog s={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SpeciesDialog({ s, onClose }: { s?: Species; onClose: () => void }) {
  const f = useForm({
    resolver: zodResolver(speciesSchema),
    defaultValues: { code: s?.code ?? '', nameTh: s?.nameTh ?? '', nameEn: s?.nameEn ?? '', scientificName: s?.scientificName ?? '', category: (s?.category as never) ?? 'FISH', unit: s?.unit ?? 'กก.', defaultPrice: s?.defaultPrice ?? '', isActive: s?.isActive ?? true, sortOrder: s?.sortOrder ?? 0 },
  });
  const save = useAction((v: unknown) => (s ? api.patch(`/catch/species/${s.id}`, v) : api.post('/catch/species', v)), { success: 'บันทึกแล้ว', invalidate: ['species'], onSuccess: onClose });
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={s ? `แก้ไข ${s.nameTh}` : 'เพิ่มชนิดสัตว์น้ำ'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="รหัส" required error={e.code?.message}><Input {...f.register('code')} /></Field>
        <Field label="ชื่อไทย" required error={e.nameTh?.message}><Input {...f.register('nameTh')} /></Field>
        <Field label="ชื่ออังกฤษ"><Input {...f.register('nameEn')} /></Field>
        <Field label="ชื่อวิทยาศาสตร์"><Input {...f.register('scientificName')} /></Field>
        <Field label="หมวด"><Select options={toOptions(SPECIES_CATEGORY_TH)} {...f.register('category')} /></Field>
        <Field label="หน่วย" required error={e.unit?.message}><Input {...f.register('unit')} /></Field>
        <Field label="ราคาตั้งต้น (บาท/หน่วย)" error={e.defaultPrice?.message}><Input inputMode="decimal" {...f.register('defaultPrice')} /></Field>
        <Field label="ลำดับแสดง"><Input inputMode="numeric" {...f.register('sortOrder')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}
