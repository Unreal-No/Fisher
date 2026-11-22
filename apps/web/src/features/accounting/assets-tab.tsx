import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ASSET_CATEGORY_TH, ASSET_STATUS_TH, formatDate, formatMoney, toOptions } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import type { useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { AssetDialog, DepreciationDialog, monthBE } from './asset-dialogs';
import { AssetStatusBadge } from './status';
import type { AssetReconcile, AssetRow, DepRun } from './types';

const PAGE = 20;
type LP = ReturnType<typeof useListParams>;
const c = createColumnHelper<AssetRow>();
const th = 'px-3 py-2';

export function AssetsTab({ lp, canEdit, canApprove }: { lp: LP; canEdit: boolean; canApprove: boolean }) {
  const nav = useNavigate();
  const vessels = useVessels();
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const params = { status: lp.get('status') || undefined, vesselId: lp.get('vessel') || undefined, q: lp.get('q') || undefined, page: lp.page, pageSize: PAGE };
  const list = useQuery({
    queryKey: ['accounting', 'assets', params],
    queryFn: () => api.get<{ items: AssetRow[]; total: number }>('/accounting/assets', params),
    placeholderData: keepPreviousData,
  });
  const runs = useQuery({ queryKey: ['accounting', 'dep-runs'], queryFn: () => api.get<DepRun[]>('/accounting/depreciation/runs') });
  const rec = useQuery({ queryKey: ['accounting', 'assets-reconcile'], queryFn: () => api.get<AssetReconcile[]>('/accounting/assets-reconcile') });
  const cols = [
    c.accessor('assetNo', { header: 'เลขที่', cell: (i) => <span className="font-medium text-accent">{i.getValue()}</span> }),
    c.accessor('name', { header: 'ชื่อทรัพย์สิน', meta: { className: 'max-w-xs truncate' } }),
    c.accessor('category', { header: 'หมวด', cell: (i) => ASSET_CATEGORY_TH[i.getValue()] }),
    c.display({ id: 'vessel', header: 'เรือ', cell: ({ row: { original: r } }) => r.vessel?.name ?? '-' }),
    c.accessor('acquisitionDate', { header: 'วันที่ได้มา', cell: (i) => formatDate(i.getValue()) }),
    c.accessor('cost', { header: 'ราคาทุน', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    c.accessor('accumulatedDepreciation', { header: 'ค่าเสื่อมสะสม', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    c.accessor('bookValue', { header: 'มูลค่าตามบัญชี', meta: { align: 'right' }, cell: (i) => formatMoney(i.getValue()) }),
    c.accessor('status', { header: 'สถานะ', cell: (i) => <AssetStatusBadge s={i.getValue()} /> }),
  ];
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <FilterBar>
          <SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} placeholder="ค้นหาเลขที่/ชื่อ..." />
          <Select options={toOptions(ASSET_STATUS_TH)} placeholder="ทุกสถานะ" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} />
          <Select options={vesselOptions(vessels.data)} placeholder="ทุกลำ" value={lp.get('vessel')} onChange={(e) => lp.set({ vessel: e.target.value })} />
          {canEdit && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus /> เพิ่มทรัพย์สิน</Button>}
        </FilterBar>
        <DataTable columns={cols} data={list.data?.items} total={list.data?.total} page={lp.page} pageSize={PAGE} onPageChange={(p) => lp.set({ page: p }, false)}
          loading={list.isFetching} error={list.error} onRowClick={(r) => nav(`/accounting/assets/${r.id}`)} />
      </div>
      <Panel title="ค่าเสื่อมราคา" bodyClass="p-0" actions={canApprove ? <Button size="sm" disabled={!runs.data} onClick={() => setRunning(true)}>คิดค่าเสื่อม</Button> : undefined}>
        <QueryView q={runs}>
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>งวด</th><th className={`${th} text-right`}>จำนวนทรัพย์สิน</th><th className={`${th} text-right`}>ค่าเสื่อมรวม</th><th className={th}>รายการบัญชี</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">ยังไม่เคยคิดค่าเสื่อม</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="whitespace-nowrap px-3 py-1.5">{monthBE(r.year, r.month)}</td><td className="px-3 text-right tabular-nums">{r._count.lines}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.total)}</td>
                      <td className="px-3">{r.entryId ? <Link className="text-accent hover:underline" to={`/accounting/journals/${r.entryId}`}>ดูรายการบัญชี</Link> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryView>
      </Panel>
      <Panel title="เทียบทะเบียนกับบัญชี" bodyClass="p-0">
        <QueryView q={rec}>
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>บัญชี</th><th className={`${th} text-right`}>ทะเบียนทรัพย์สิน</th><th className={`${th} text-right`}>บัญชีแยกประเภท</th><th className={`${th} text-right`}>ผลต่าง</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">ไม่มีข้อมูล</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id} className={`border-t border-line ${r.difference ? 'bg-bad-soft' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-1.5">{r.code} {r.nameTh}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.register)}</td><td className="px-3 text-right tabular-nums">{formatMoney(r.ledger)}</td>
                      <td className={`px-3 text-right tabular-nums ${r.difference ? 'font-semibold text-bad' : ''}`}>{formatMoney(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryView>
      </Panel>
      {creating && <AssetDialog onClose={() => setCreating(false)} onSaved={(id) => id && nav(`/accounting/assets/${id}`)} />}
      {running && runs.data && <DepreciationDialog runs={runs.data} onClose={() => setRunning(false)} />}
    </div>
  );
}
