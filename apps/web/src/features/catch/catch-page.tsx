import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Download, Pencil, Plus, RotateCw, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { formatDate, formatDateTime, formatKg, formatNumber, STORAGE_TYPE_TH, type StorageType } from '@fisher/shared';
import { FilterBar } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadCsv } from '@/lib/export';
import { useAction, useListParams, usePaged } from '@/lib/hooks';
import { useSpecies, useVessels, vesselOptions } from '@/lib/lookups';
import * as queue from '@/lib/offline-queue';
import { CatchAdjustDialog, CatchFormDialog, type CatchRow } from './catch-dialogs';

const c = createColumnHelper<CatchRow>();

export function catchColumns(opts: { showTrip?: boolean; onAdjust?: (r: CatchRow) => void; onVoid?: (r: CatchRow) => void }) {
  return [
    c.accessor('catchDate', { header: 'วันที่', meta: { sortKey: 'catchDate' }, cell: (i) => formatDate(i.getValue()) }),
    ...(opts.showTrip
      ? [
          c.accessor('trip', { header: 'เที่ยว', cell: (i) => <Link className="text-accent hover:underline" to={`/trips/${i.getValue().id}`} onClick={(e) => e.stopPropagation()}>{i.getValue().tripNo}</Link> }),
          c.accessor('vessel', { header: 'เรือ', cell: (i) => i.getValue().name }),
        ]
      : []),
    c.accessor('species', { header: 'ชนิด', cell: (i) => i.getValue().nameTh }),
    c.accessor('grade', { header: 'เกรด', cell: (i) => i.getValue()?.nameTh ?? '-' }),
    c.accessor('weightKg', { header: 'น้ำหนัก (กก.)', meta: { align: 'right', sortKey: 'weightKg' }, cell: (i) => formatKg(i.getValue()) }),
    c.accessor('basketCount', { header: 'เข่ง', meta: { align: 'right' }, cell: (i) => formatNumber(i.getValue()) }),
    c.accessor('storageType', { header: 'การเก็บ', cell: (i) => STORAGE_TYPE_TH[i.getValue() as StorageType] }),
    c.display({
      id: 'actions', header: '', meta: { align: 'right' },
      cell: ({ row: { original: r } }) =>
        r.voidedAt ? <Badge tone="neutral">ยกเลิกแล้ว</Badge> : (
          <span className="inline-flex">
            {opts.onAdjust && <Button variant="ghost" size="icon" aria-label="ปรับปรุง" onClick={() => opts.onAdjust!(r)}><Pencil /></Button>}
            {opts.onVoid && <Button variant="ghost" size="icon" aria-label="ยกเลิก" onClick={() => opts.onVoid!(r)}><XCircle /></Button>}
          </span>
        ),
    }),
  ];
}

export function useCatchActions() {
  const [adjust, setAdjust] = useState<CatchRow | null>(null);
  const [voidRow, setVoidRow] = useState<CatchRow | null>(null);
  const voidM = useAction((v: { id: string; reason: string }) => api.post(`/catch/records/${v.id}/void`, { reason: v.reason }), {
    success: 'ยกเลิกรายการแล้ว', invalidate: ['catch', 'trip', 'trip-settlement', 'dashboard'], onSuccess: () => setVoidRow(null),
  });
  const dialogs = (
    <>
      {adjust && <CatchAdjustDialog row={adjust} onClose={() => setAdjust(null)} />}
      <ConfirmDialog open={!!voidRow} onOpenChange={() => setVoidRow(null)} title="ยกเลิกรายการสัตว์น้ำ" danger requireReason loading={voidM.isPending}
        message={`ยกเลิก ${voidRow?.species.nameTh} ${formatKg(voidRow?.weightKg)} กก. (รายการจะถูกเก็บไว้ในประวัติ)`}
        onConfirm={(reason) => voidRow && voidM.mutate({ id: voidRow.id, reason })} />
    </>
  );
  return { setAdjust, setVoidRow, dialogs };
}

export function CatchPage() {
  const { can } = useAuth();
  const lp = useListParams({ sort: 'catchDate', order: 'desc' });
  const [open, setOpen] = useState(lp.get('new') === '1');
  const vessels = useVessels();
  const species = useSpecies();
  const list = usePaged<CatchRow>('catch', '/catch/records', { ...lp.params, new: undefined, tab: undefined });
  const summary = useQuery({
    queryKey: ['catch', 'summary', lp.params],
    queryFn: () => api.get<{ key: string; label: string; weightKg: number; count: number }[]>('/catch/summary', { ...lp.params, groupBy: lp.get('groupBy') || 'species' }),
  });
  const actions = useCatchActions();
  const cols = catchColumns({ showTrip: true, onAdjust: can('catch.edit') ? actions.setAdjust : undefined, onVoid: can('catch.delete') ? actions.setVoidRow : undefined });

  const exportCsv = async () => {
    const all = await api.get<{ items: CatchRow[] }>('/catch/records', { ...lp.params, pageSize: 200, page: 1 });
    downloadCsv(`catch-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['วันที่', 'เที่ยว', 'เรือ', 'ชนิด', 'เกรด', 'น้ำหนัก (กก.)', 'เข่ง', 'การเก็บ'],
      ...all.items.map((r) => [r.catchDate.slice(0, 10), r.trip.tripNo, r.vessel.name, r.species.nameTh, r.grade?.nameTh ?? '', r.weightKg, r.basketCount ?? '', r.storageType]),
    ]);
  };

  return (
    <>
      <PageHeader
        title="สัตว์น้ำที่จับได้"
        subtitle="บันทึกน้ำหนักจากเที่ยวเรือ (ไม่ใช่น้ำหนักขาย) · ทุกการแก้ไขมีประวัติ"
        actions={<>
          {can('catch.export') && <Button variant="outline" onClick={exportCsv}><Download /> ส่งออก CSV</Button>}
          {can('catch.create') && <Button onClick={() => setOpen(true)}><Plus /> บันทึกสัตว์น้ำ</Button>}
        </>}
      />
      <FilterBar>
        <Input type="date" className="w-40" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="ตั้งแต่" />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="ถึง" />
        <Select options={vesselOptions(vessels.data)} placeholder="ทุกเรือ" value={lp.get('vesselId')} onChange={(e) => lp.set({ vesselId: e.target.value })} />
        <Select options={(species.data ?? []).map((s) => ({ value: s.id, label: s.nameTh }))} placeholder="ทุกชนิด" value={lp.get('speciesId')} onChange={(e) => lp.set({ speciesId: e.target.value })} />
      </FilterBar>
      <Tabs
        value={lp.get('tab') || 'list'}
        onValueChange={(t) => lp.set({ tab: t }, false)}
        tabs={[
          {
            value: 'list', label: 'รายการ',
            content: (
              <DataTable
                columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={20} onPageChange={(p) => lp.set({ page: p }, false)}
                sort={lp.get('sort')} order={lp.get('order') as 'desc'} onSortChange={(sort, order) => lp.set({ sort, order })} loading={list.isFetching} error={list.error}
                footer={list.data && list.data.total > 0 ? (
                  <tr><td colSpan={5} className="px-3 py-2 text-right">รวมทั้งหมด {formatNumber(list.data.total)} รายการ</td><td className="px-3 text-right tabular-nums">{formatKg(list.data.totalKg)}</td><td className="px-3 text-right tabular-nums">{formatNumber(list.data.totalBaskets)}</td><td colSpan={2} /></tr>
                ) : undefined}
              />
            ),
          },
          {
            value: 'summary', label: 'สรุป',
            content: (
              <Panel title="สรุปน้ำหนัก" actions={
                <Select options={[{ value: 'species', label: 'ตามชนิด' }, { value: 'vessel', label: 'ตามเรือ' }, { value: 'trip', label: 'ตามเที่ยว' }, { value: 'month', label: 'ตามเดือน' }]}
                  value={lp.get('groupBy') || 'species'} onChange={(e) => lp.set({ groupBy: e.target.value }, false)} />
              } bodyClass="p-0">
                {summary.data?.length ? (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">รายการ</th><th className="px-2 text-right">จำนวนรายการ</th><th className="px-4 text-right">น้ำหนัก (กก.)</th></tr></thead>
                    <tbody>
                      {summary.data.map((s) => <tr key={s.key} className="border-t border-line"><td className="px-4 py-2">{s.label}</td><td className="px-2 text-right">{formatNumber(s.count)}</td><td className="px-4 text-right tabular-nums">{formatKg(s.weightKg)}</td></tr>)}
                    </tbody>
                    <tfoot className="border-t border-line bg-slate-50 font-semibold"><tr><td className="px-4 py-2">รวม</td><td className="px-2 text-right">{formatNumber(summary.data.reduce((a, s) => a + s.count, 0))}</td><td className="px-4 text-right tabular-nums">{formatKg(summary.data.reduce((a, s) => a + s.weightKg, 0))}</td></tr></tfoot>
                  </table>
                ) : <Empty />}
              </Panel>
            ),
          },
          { value: 'queue', label: 'รอซิงก์ (ออฟไลน์)', content: <QueuePanel /> },
        ]}
      />
      <CatchFormDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o && lp.get('new')) lp.set({ new: undefined }, false); }} />
      {actions.dialogs}
    </>
  );
}

function QueuePanel() {
  const [items, setItems] = useState<queue.QueueItem[]>([]);
  useEffect(() => {
    const r = () => void queue.list().then(setItems);
    r();
    return queue.subscribe(r);
  }, []);
  const syncNow = async () => {
    const r = await queue.sync();
    toast.info(`ส่งสำเร็จ ${r.sent} รายการ${r.failed ? ` · ไม่ผ่าน ${r.failed}` : ''}`);
  };
  return (
    <Panel title={`รายการที่บันทึกในเครื่อง (${items.length})`} bodyClass="p-0" actions={<Button size="sm" variant="outline" onClick={syncNow} disabled={!items.length}><RotateCw /> ซิงก์ตอนนี้</Button>}>
      {items.length ? (
        <table className="w-full text-sm">
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">{i.label}<div className="text-xs text-muted">บันทึกเมื่อ {formatDateTime(i.createdAt)} · พยายามส่ง {i.attempts} ครั้ง</div></td>
                <td className="px-2">{i.status === 'FAILED' ? <Badge tone="bad">ไม่ผ่าน: {i.error}</Badge> : <Badge tone="warn">รอส่ง</Badge>}</td>
                <td className="whitespace-nowrap px-4 text-right">
                  {i.status === 'FAILED' && <Button size="sm" variant="ghost" onClick={() => void queue.retry(i.id)}><RotateCw /> ลองใหม่</Button>}
                  <Button size="icon" variant="ghost" aria-label="ลบ" onClick={() => confirm('ลบรายการนี้ออกจากเครื่อง? ข้อมูลจะไม่ถูกส่งเข้าระบบ') && void queue.remove(i.id)}><Trash2 /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty title="ไม่มีรายการค้างส่ง" />}
      <p className="border-t border-line px-4 py-2 text-xs text-muted">ระบบส่งซ้ำอัตโนมัติเมื่อกลับมาออนไลน์ แต่ละรายการมีรหัสกันบันทึกซ้ำ รายการที่ถูกปฏิเสธจะไม่ถูกเขียนทับ ต้องตรวจสอบเอง</p>
    </Panel>
  );
}
