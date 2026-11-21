import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { formatDateTime } from '@fisher/shared';
import { ACTION_TH, type AuditRow } from '@/components/audit-list';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { useListParams, usePaged } from '@/lib/hooks';

type Row = AuditRow & { ip: string | null; entityId: string | null };
const c = createColumnHelper<Row>();
const ENTITIES = ['Vessel', 'VesselDocument', 'Employee', 'EmployeeDocument', 'FishingTrip', 'TripFuel', 'TripSupply', 'TripExpense', 'TripIncident', 'CatchRecord', 'CatchLoss', 'FishSpecies', 'User', 'Role', 'Settings', 'DocumentType', 'File'];

export function AuditPage() {
  const lp = useListParams();
  const q = usePaged<Row>('audit', '/audit-logs', { ...lp.params, pageSize: 50 });
  const [view, setView] = useState<Row | null>(null);
  const columns = [
    c.accessor('at', { header: 'เวลา', cell: (i) => formatDateTime(i.getValue()) }),
    c.accessor('username', { header: 'ผู้ใช้', cell: (i) => i.getValue() ?? 'ระบบ' }),
    c.accessor('action', { header: 'การกระทำ', cell: (i) => ACTION_TH[i.getValue()] ?? i.getValue() }),
    c.accessor('entityType', { header: 'ข้อมูล' }),
    c.accessor('note', { header: 'หมายเหตุ', cell: (i) => <span className="line-clamp-1 max-w-72">{i.getValue() ?? ''}</span> }),
    c.accessor('ip', { header: 'IP' }),
  ];
  return (
    <>
      <PageHeader title="ประวัติการใช้งาน (Audit Log)" subtitle="บันทึกแบบเพิ่มได้อย่างเดียว ไม่สามารถแก้ไข/ลบ · ข้อมูลส่วนบุคคลถูกปิดบังในบันทึก" />
      <FilterBar>
        <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ผู้ใช้ / หมายเหตุ" />
        <Select options={ENTITIES.map((e) => ({ value: e, label: e }))} placeholder="ทุกประเภทข้อมูล" value={lp.get('entityType')} onChange={(e) => lp.set({ entityType: e.target.value })} />
        <Select options={Object.entries(ACTION_TH).map(([value, label]) => ({ value, label }))} placeholder="ทุกการกระทำ" value={lp.get('action')} onChange={(e) => lp.set({ action: e.target.value })} />
        <Input type="date" className="w-40" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} />
        <Input type="date" className="w-40" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} />
      </FilterBar>
      <DataTable columns={columns} data={q.data?.items} total={q.data?.total} page={lp.page} pageSize={50} onPageChange={(p) => lp.set({ page: p }, false)} loading={q.isFetching} error={q.error} onRowClick={setView} />
      {view && (
        <Dialog open onOpenChange={() => setView(null)} title={`${ACTION_TH[view.action] ?? view.action} · ${view.entityType}`} description={`${formatDateTime(view.at)} · ${view.username ?? 'ระบบ'} · ${view.entityId ?? ''}`} size="xl">
          <div className="grid gap-3 md:grid-cols-2">
            {(['before', 'after'] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 text-xs font-semibold text-muted">{k === 'before' ? 'ก่อน' : 'หลัง'}</div>
                <pre className="max-h-[60vh] overflow-auto rounded border border-line bg-slate-50 p-2 text-xs">{view[k] ? JSON.stringify(view[k], null, 2) : '-'}</pre>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
