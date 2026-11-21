import { createColumnHelper } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { formatNumber, toOptions, VESSEL_STATUS_TH } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { ExpiryText, TripStatusBadge, VesselStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Select } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { useListParams, usePaged } from '@/lib/hooks';
import { personName } from '@/lib/utils';
import type { Vessel } from './types';

const c = createColumnHelper<Vessel>();
const columns = [
  c.accessor('code', { header: 'รหัส', meta: { sortKey: 'code' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
  c.accessor('name', { header: 'ชื่อเรือ', meta: { sortKey: 'name' } }),
  c.accessor('registrationNo', { header: 'ทะเบียน' }),
  c.accessor('vesselType', { header: 'ประเภท' }),
  c.accessor('grossTonnage', { header: 'ตันกรอส', meta: { align: 'right' }, cell: (i) => formatNumber(i.getValue(), 2) }),
  c.accessor('captain', { header: 'ไต้ก๋ง', cell: (i) => personName(i.getValue()) }),
  c.accessor('status', { header: 'สถานะ', meta: { sortKey: 'status' }, cell: (i) => <VesselStatusBadge s={i.getValue()} /> }),
  c.accessor('activeTrip', { header: 'เที่ยวปัจจุบัน', cell: (i) => (i.getValue() ? <span className="inline-flex gap-1.5">{i.getValue()!.tripNo} <TripStatusBadge s={i.getValue()!.status} /></span> : '-') }),
  c.accessor('crewCount', { header: 'ลูกเรือ', meta: { align: 'right' } }),
  c.accessor('licenseExpiry', { header: 'ใบอนุญาตหมดอายุ', meta: { sortKey: 'licenseExpiry' }, cell: (i) => <ExpiryText date={i.getValue()} /> }),
];

export function VesselListPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const lp = useListParams({ sort: 'code', order: 'asc' });
  const q = usePaged<Vessel>('vessels', '/vessels', lp.params);
  return (
    <>
      <PageHeader title="ทะเบียนเรือ" subtitle="ข้อมูลเรือ ใบอนุญาต และสถานะกองเรือ" actions={can('vessel.create') && <Button onClick={() => nav('/vessels/new')}><Plus /> เพิ่มเรือ</Button>} />
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาชื่อ รหัส ทะเบียน" />
        <Select options={toOptions(VESSEL_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
      </FilterBar>
      <DataTable
        columns={columns} data={q.data?.items} total={q.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)}
        sort={lp.get('sort')} order={lp.get('order') as 'asc'} onSortChange={(sort, order) => lp.set({ sort, order })}
        loading={q.isFetching} error={q.error} onRowClick={(v) => nav(`/vessels/${v.id}`)}
      />
    </>
  );
}
