import { zodResolver } from '@hookform/resolvers/zod';
import { createColumnHelper } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { formatDateTime, formatKg, toOptions, TRIP_STATUS_TH, tripCreateSchema } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { TripStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useListParams, usePaged } from '@/lib/hooks';
import { employeeOptions, useEmployees, useVessels, vesselOptions } from '@/lib/lookups';
import { fromLocalInput, personName } from '@/lib/utils';
import type { TripListItem } from './types';

const c = createColumnHelper<TripListItem>();
const columns = [
  c.accessor('tripNo', { header: 'เลขที่เที่ยว', meta: { sortKey: 'tripNo' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
  c.accessor('vessel', { header: 'เรือ', cell: (i) => i.getValue().name }),
  c.accessor('captain', { header: 'ไต้ก๋ง', cell: (i) => personName(i.getValue()) }),
  c.accessor('status', { header: 'สถานะ', meta: { sortKey: 'status' }, cell: (i) => <TripStatusBadge s={i.getValue()} /> }),
  c.accessor('departedAt', { header: 'ออกเรือ', meta: { sortKey: 'departedAt' }, cell: (i) => formatDateTime(i.getValue()) }),
  c.accessor('arrivedAt', { header: 'เข้าท่า', meta: { sortKey: 'arrivedAt' }, cell: (i) => formatDateTime(i.getValue()) }),
  c.accessor('crewCount', { header: 'ลูกเรือ', meta: { align: 'right' } }),
  c.accessor('catchKg', { header: 'สัตว์น้ำ (กก.)', meta: { align: 'right' }, cell: (i) => formatKg(i.getValue()) }),
];

export function TripListPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const lp = useListParams({ sort: 'createdAt', order: 'desc' });
  const vessels = useVessels();
  const q = usePaged<TripListItem>('trips', '/trips', { ...lp.params, new: undefined });
  return (
    <>
      <PageHeader title="เที่ยวเรือ" subtitle="วางแผน ออกเรือ เข้าท่า สรุปและปิดเที่ยว" actions={can('trip.create') && <Button onClick={() => lp.set({ new: '1' }, false)}><Plus /> สร้างเที่ยวเรือ</Button>} />
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="เลขที่เที่ยว / ชื่อเรือ" />
        <Select options={toOptions(TRIP_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value, open: undefined })} />
        <Select options={vesselOptions(vessels.data)} placeholder="ทุกเรือ" value={lp.get('vesselId')} onChange={(e) => lp.set({ vesselId: e.target.value })} />
        <Checkbox label="เฉพาะที่ยังไม่ปิด" checked={lp.get('open') === 'true'} onChange={(e) => lp.set({ open: e.target.checked ? 'true' : undefined, status: undefined })} />
      </FilterBar>
      <DataTable
        columns={columns} data={q.data?.items} total={q.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)}
        sort={lp.get('sort')} order={lp.get('order') as 'desc'} onSortChange={(sort, order) => lp.set({ sort, order })}
        loading={q.isFetching} error={q.error} onRowClick={(t) => nav(`/trips/${t.id}`)}
      />
      {lp.get('new') === '1' && <CreateTripDialog onClose={() => lp.set({ new: undefined }, false)} />}
    </>
  );
}

function CreateTripDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const vessels = useVessels();
  const captains = useEmployees({ position: 'CAPTAIN' });
  const f = useForm({
    resolver: zodResolver(tripCreateSchema),
    defaultValues: { vesselId: '', captainId: '', plannedDepartureAt: '', plannedReturnAt: '', departurePort: '', fishingArea: '', notes: '', allowConcurrent: false, overrideReason: '' },
  });
  const save = useAction((v: Record<string, unknown>) => api.post<{ id: string; tripNo: string }>('/trips', v), {
    success: 'สร้างเที่ยวเรือแล้ว', invalidate: ['trips', 'dashboard'], onSuccess: (t) => nav(`/trips/${t.id}`),
  });
  const vesselId = f.watch('vesselId');
  const sel = vessels.data?.find((v) => v.id === vesselId);
  const e = f.formState.errors;
  const submit = f.handleSubmit((v) =>
    save.mutate({ ...v, plannedDepartureAt: fromLocalInput(v.plannedDepartureAt as string), plannedReturnAt: fromLocalInput(v.plannedReturnAt as string) }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="สร้างเที่ยวเรือ" description="สร้างเป็นร่างก่อน จากนั้นกำหนดลูกเรือ น้ำมัน เสบียง แล้วยืนยันออกเรือ"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>สร้าง</Button></>}>
      <FormGrid cols={2}>
        <Field label="เรือ" required error={e.vesselId?.message}>
          <Select options={vesselOptions(vessels.data?.filter((v) => v.status !== 'INACTIVE'))} placeholder="- เลือกเรือ -"
            {...f.register('vesselId', { onChange: (ev) => { const v = vessels.data?.find((x) => x.id === ev.target.value); if (v) { f.setValue('captainId', v.captainId ?? ''); f.setValue('departurePort', v.homePort ?? ''); } } })} />
        </Field>
        <Field label="ไต้ก๋ง/นายเรือ"><Select options={employeeOptions(captains.data)} placeholder="- ไม่ระบุ -" {...f.register('captainId')} /></Field>
        <Field label="กำหนดออกเรือ"><Input type="datetime-local" {...f.register('plannedDepartureAt')} /></Field>
        <Field label="กำหนดกลับ"><Input type="datetime-local" {...f.register('plannedReturnAt')} /></Field>
        <Field label="ท่าออกเรือ"><Input {...f.register('departurePort')} /></Field>
        <Field label="พื้นที่ทำการประมง"><Input {...f.register('fishingArea')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        {sel?.status === 'MAINTENANCE' && <p className="text-sm text-warn sm:col-span-2">เรือลำนี้อยู่ในสถานะซ่อมบำรุง จะไม่สามารถยืนยันออกเรือได้จนกว่าจะเปลี่ยนสถานะ</p>}
        {can('trip.approve') && (
          <div className="space-y-2 rounded border border-line bg-slate-50 p-3 sm:col-span-2">
            <Checkbox label="อนุญาตให้มีเที่ยวซ้อนกับเที่ยวที่ยังดำเนินการ (ต้องมีเหตุผล)" {...f.register('allowConcurrent')} />
            {f.watch('allowConcurrent') && <Input placeholder="เหตุผล" {...f.register('overrideReason')} />}
          </div>
        )}
      </FormGrid>
    </Dialog>
  );
}
