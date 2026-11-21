import { createColumnHelper } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { EMPLOYEE_POSITION_TH, EMPLOYEE_STATUS_TH, formatDate, NATIONALITY_TH, toOptions, type Nationality } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { DocStateBadge, EmployeeStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Select } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { useListParams, usePaged } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import type { Employee } from './types';

const c = createColumnHelper<Employee>();
const columns = [
  c.accessor('code', { header: 'รหัส', meta: { sortKey: 'code' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
  c.display({ id: 'name', header: 'ชื่อ-สกุล', cell: ({ row: { original: e } }) => (
    <div><div>{e.firstName} {e.lastName}{e.nickname ? ` (${e.nickname})` : ''}</div>{(e.firstNameEn || e.lastNameEn) && <div className="text-xs text-muted">{e.firstNameEn} {e.lastNameEn}</div>}</div>
  ) }),
  c.accessor('nationality', { header: 'สัญชาติ', meta: { sortKey: 'nationality' }, cell: (i) => NATIONALITY_TH[i.getValue() as Nationality] ?? i.getValue() }),
  c.accessor('position', { header: 'ตำแหน่ง', meta: { sortKey: 'position' }, cell: (i) => EMPLOYEE_POSITION_TH[i.getValue()] }),
  c.accessor('currentVessel', { header: 'ประจำเรือ', cell: (i) => i.getValue()?.name ?? '-' }),
  c.accessor('startDate', { header: 'เริ่มงาน', meta: { sortKey: 'startDate' }, cell: (i) => formatDate(i.getValue()) }),
  c.accessor('status', { header: 'สถานะ', meta: { sortKey: 'status' }, cell: (i) => <EmployeeStatusBadge s={i.getValue()} /> }),
  c.accessor('docStatus', { header: 'เอกสาร', cell: (i) => (i.getValue() ? <DocStateBadge s={i.getValue()!} /> : '-') }),
];

export function EmployeeListPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const lp = useListParams({ sort: 'code', order: 'asc' });
  const vessels = useVessels();
  const q = usePaged<Employee>('employees', '/employees', lp.params);
  return (
    <>
      <PageHeader title="พนักงานและลูกเรือ" subtitle="ข้อมูลบุคลากร แรงงานต่างด้าว และสถานะเอกสาร" actions={can('employee.create') && <Button onClick={() => nav('/employees/new')}><Plus /> เพิ่มพนักงาน</Button>} />
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาชื่อ รหัส เบอร์โทร" />
        <Select options={toOptions(EMPLOYEE_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
        <Select options={toOptions(EMPLOYEE_POSITION_TH)} placeholder="ทุกตำแหน่ง" value={lp.get('position')} onChange={(e) => lp.set({ position: e.target.value })} />
        <Select options={toOptions(NATIONALITY_TH)} placeholder="ทุกสัญชาติ" value={lp.get('nationality')} onChange={(e) => lp.set({ nationality: e.target.value })} />
        <Select options={[{ value: 'none', label: 'ยังไม่ประจำเรือ' }, ...vesselOptions(vessels.data)]} placeholder="ทุกเรือ" value={lp.get('vesselId')} onChange={(e) => lp.set({ vesselId: e.target.value })} />
      </FilterBar>
      <DataTable
        columns={columns} data={q.data?.items} total={q.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)}
        sort={lp.get('sort')} order={lp.get('order') as 'asc'} onSortChange={(sort, order) => lp.set({ sort, order })}
        loading={q.isFetching} error={q.error} onRowClick={(e) => nav(`/employees/${e.id}`)}
      />
    </>
  );
}
