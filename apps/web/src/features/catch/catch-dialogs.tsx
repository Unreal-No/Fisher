import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { CATCH_EDITABLE_STATUSES, CATCH_QUALITY_TH, catchCreateSchema, catchUpdateSchema, STORAGE_TYPE_TH, toISODate, toOptions, type CatchCreateInput, type Paged } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useGrades, useSpecies } from '@/lib/lookups';
import { enqueue } from '@/lib/offline-queue';
import { useQueryClient } from '@tanstack/react-query';

export interface CatchRow {
  id: string; tripId: string; catchDate: string; weightKg: string; quantity: number | null; basketCount: number | null; quality: string | null;
  storageType: string; notes: string | null; version: number; voidedAt: string | null; createdAt: string;
  species: { id: string; code: string; nameTh: string }; grade: { id: string; code: string; nameTh: string } | null;
  trip: { id: string; tripNo: string; status: string }; vessel: { id: string; code: string; name: string };
}

const useOpenTrips = (enabled: boolean) =>
  useQuery({
    queryKey: ['trips', 'catchable'],
    queryFn: () => api.get<Paged<{ id: string; tripNo: string; vessel: { name: string } }>>('/trips', { status: CATCH_EDITABLE_STATUSES.join(','), pageSize: 100 }),
    enabled,
  });

/** New catch entry. Works offline: queued in IndexedDB with idempotency key, synced later. */
export function CatchFormDialog({ open, onOpenChange, tripId }: { open: boolean; onOpenChange: (o: boolean) => void; tripId?: string }) {
  const qc = useQueryClient();
  const species = useSpecies(true);
  const grades = useGrades();
  const trips = useOpenTrips(open && !tripId);
  const [again, setAgain] = useState(true);
  const blank: CatchCreateInput = { tripId: tripId ?? '', speciesId: '', gradeId: '', catchDate: toISODate(), weightKg: '', quantity: '', basketCount: '', quality: '', storageType: 'ICE', notes: '' };
  const f = useForm<CatchCreateInput>({ resolver: zodResolver(catchCreateSchema), defaultValues: blank });
  const e = f.formState.errors;
  const [busy, setBusy] = useState(false);

  const submit = f.handleSubmit(async (v) => {
    const body = { ...v, clientRequestId: crypto.randomUUID() } as Record<string, unknown>;
    const sp = species.data?.find((s) => s.id === v.speciesId)?.nameTh ?? '';
    const kg = String(v.weightKg);
    const done = () => {
      if (again) f.reset({ ...blank, tripId: v.tripId, catchDate: v.catchDate, storageType: v.storageType });
      else onOpenChange(false);
    };
    setBusy(true);
    try {
      if (!navigator.onLine) throw new ApiError(0, 'NETWORK', 'offline');
      await api.post('/catch/records', body);
      toast.success(`บันทึก ${sp} ${kg} กก. แล้ว`);
      for (const k of ['catch', 'trip', 'trip-settlement', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
      done();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
        await enqueue('/catch/records', body, `${sp} ${kg} กก. (${v.catchDate})`);
        toast.warning('ไม่มีสัญญาณ: บันทึกไว้ในเครื่องแล้ว จะส่งอัตโนมัติเมื่อออนไลน์');
        done();
      } else toast.error(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="บันทึกสัตว์น้ำที่จับได้" description="น้ำหนักที่จับได้ ไม่ใช่น้ำหนักที่ขาย"
      footer={<>
        <Checkbox label="บันทึกต่อเนื่อง" checked={again} onChange={(x) => setAgain(x.target.checked)} className="mr-auto" />
        <Button variant="outline" onClick={() => onOpenChange(false)}>ปิด</Button>
        <Button loading={busy} onClick={submit}>บันทึก</Button>
      </>}>
      <FormGrid cols={2}>
        {!tripId && (
          <Field label="เที่ยวเรือ" required error={e.tripId?.message} className="sm:col-span-2">
            <Select options={(trips.data?.items ?? []).map((t) => ({ value: t.id, label: `${t.tripNo} · ${t.vessel.name}` }))} placeholder="- เลือกเที่ยวที่ออกเรือแล้ว -" {...f.register('tripId')} />
          </Field>
        )}
        <Field label="ชนิดสัตว์น้ำ" required error={e.speciesId?.message}>
          <Select options={(species.data ?? []).map((s) => ({ value: s.id, label: s.nameTh }))} placeholder="- เลือก -" {...f.register('speciesId')} />
        </Field>
        <Field label="เกรด"><Select options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.nameTh }))} placeholder="- ไม่ระบุ -" {...f.register('gradeId')} /></Field>
        <Field label="น้ำหนัก (กก.)" required error={e.weightKg?.message}><Input inputMode="decimal" autoFocus {...f.register('weightKg')} /></Field>
        <Field label="วันที่จับ" required error={e.catchDate?.message}><Input type="date" {...f.register('catchDate')} /></Field>
        <Field label="จำนวนเข่ง/ลัง" error={e.basketCount?.message}><Input inputMode="numeric" {...f.register('basketCount')} /></Field>
        <Field label="จำนวนตัว" error={e.quantity?.message}><Input inputMode="numeric" {...f.register('quantity')} /></Field>
        <Field label="คุณภาพ"><Select options={toOptions(CATCH_QUALITY_TH)} placeholder="- ไม่ระบุ -" {...f.register('quality')} /></Field>
        <Field label="การเก็บรักษา"><Select options={toOptions(STORAGE_TYPE_TH)} {...f.register('storageType')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

/** Adjustment requires reason; keeps full history server-side. */
export function CatchAdjustDialog({ row, onClose }: { row: CatchRow; onClose: () => void }) {
  const species = useSpecies(true);
  const grades = useGrades();
  const f = useForm({
    resolver: zodResolver(catchUpdateSchema),
    defaultValues: {
      version: row.version, reason: '', speciesId: row.species.id, gradeId: row.grade?.id ?? '', catchDate: row.catchDate.slice(0, 10),
      weightKg: row.weightKg, basketCount: row.basketCount ?? '', quantity: row.quantity ?? '', quality: row.quality ?? '', storageType: row.storageType as never, notes: row.notes ?? '',
    },
  });
  const save = useAction((v: unknown) => api.patch(`/catch/records/${row.id}`, v), {
    success: 'ปรับปรุงรายการแล้ว (บันทึกประวัติ)', invalidate: ['catch', 'trip', 'trip-settlement', 'dashboard'], onSuccess: onClose,
  });
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`ปรับปรุงรายการ ${row.species.nameTh}`} description={`เที่ยว ${row.trip.tripNo} · ทุกการแก้ไขต้องระบุเหตุผล`}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึกการปรับปรุง</Button></>}>
      <FormGrid cols={2}>
        <Field label="ชนิดสัตว์น้ำ"><Select options={(species.data ?? []).map((s) => ({ value: s.id, label: s.nameTh }))} {...f.register('speciesId')} /></Field>
        <Field label="เกรด"><Select options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.nameTh }))} placeholder="- ไม่ระบุ -" {...f.register('gradeId')} /></Field>
        <Field label="น้ำหนัก (กก.)" error={e.weightKg?.message}><Input inputMode="decimal" {...f.register('weightKg')} /></Field>
        <Field label="จำนวนเข่ง/ลัง"><Input inputMode="numeric" {...f.register('basketCount')} /></Field>
        <Field label="เหตุผลการปรับปรุง" required error={e.reason?.message} className="sm:col-span-2"><Textarea rows={2} {...f.register('reason')} /></Field>
      </FormGrid>
    </Dialog>
  );
}
