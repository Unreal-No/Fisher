import { useQuery } from '@tanstack/react-query';
import { Ban, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ASSET_CATEGORY_TH, formatDate, formatMoney } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { DL, Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AssetDialog, DisposeDialog, monthBE } from './asset-dialogs';
import { AssetStatusBadge } from './status';
import type { AssetDetail } from './types';

export function AssetPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['accounting', 'asset', id], queryFn: () => api.get<AssetDetail>(`/accounting/assets/${id}`) });
  const [dlg, setDlg] = useState<null | 'edit' | 'dispose'>(null);
  const th = 'px-4 py-2';
  return (
    <QueryView q={q}>
      {(a) => {
        const acct = (x: { code: string; nameTh: string }) => `${x.code} ${x.nameTh}`;
        return (
          <>
            <PageHeader
              title={`ทรัพย์สิน ${a.assetNo}`}
              subtitle={<span className="inline-flex flex-wrap items-center gap-2"><AssetStatusBadge s={a.status} /> {a.name} <Link className="text-accent hover:underline" to="/accounting?tab=assets">กลับไปทรัพย์สิน</Link></span>}
              actions={a.status === 'ACTIVE' ? (
                <>
                  {can('finance.edit') && <Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> แก้ไข</Button>}
                  {can('finance.approve') && <Button variant="danger-outline" onClick={() => setDlg('dispose')}><Ban /> จำหน่าย/ตัดบัญชี</Button>}
                </>
              ) : undefined}
            />
            <div className="space-y-4">
              <Panel title="ข้อมูลทรัพย์สิน">
                <DL cols={3} items={[
                  ['ชื่อ', a.name], ['หมวด', ASSET_CATEGORY_TH[a.category]], ['เรือ', a.vessel ? `${a.vessel.code} ${a.vessel.name}` : null],
                  ['วันที่ได้มา', formatDate(a.acquisitionDate)], ['เริ่มคิดค่าเสื่อม', formatDate(a.depStartDate)], ['อายุการใช้งาน', `${a.usefulLifeMonths} เดือน`],
                  ['ราคาทุน', formatMoney(a.cost)], ['มูลค่าซาก', formatMoney(a.salvageValue)], ['ค่าเสื่อมต่อเดือน', formatMoney(a.monthlyDepreciation)],
                  ['ค่าเสื่อมสะสม', formatMoney(a.accumulatedDepreciation)], ['มูลค่าตามบัญชี', <b key="b">{formatMoney(a.bookValue)}</b>], ['เลขทะเบียน/เลขเครื่อง', a.serialNo],
                  ['บัญชีทรัพย์สิน', acct(a.assetAccount)], ['บัญชีค่าเสื่อมสะสม', acct(a.accumDepAccount)], ['บัญชีค่าเสื่อมราคา', acct(a.depExpenseAccount)],
                  ['หมายเหตุ', a.notes],
                  ...(a.status === 'DISPOSED' ? [
                    ['วันที่จำหน่าย', a.disposedAt ? formatDate(a.disposedAt) : null] as [string, React.ReactNode],
                    ['รายการบัญชีจำหน่าย', a.disposalEntry ? <Link key="d" className="text-accent hover:underline" to={`/accounting/journals/${a.disposalEntry.id}`}>{a.disposalEntry.entryNo}</Link> : null] as [string, React.ReactNode],
                  ] : []),
                ]} />
              </Panel>
              <Panel title={`ประวัติค่าเสื่อมราคา (${a.depLines.length})`} bodyClass="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className={th}>งวด</th><th className={`${th} text-right`}>ค่าเสื่อม</th><th className={th}>รายการบัญชี</th></tr></thead>
                    <tbody>
                      {a.depLines.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted">ยังไม่มีการคิดค่าเสื่อม</td></tr>}
                      {a.depLines.map((l) => (
                        <tr key={`${l.run.year}-${l.run.month}`} className="border-t border-line">
                          <td className="whitespace-nowrap px-4 py-1.5">{monthBE(l.run.year, l.run.month)}</td><td className="px-4 text-right tabular-nums">{formatMoney(l.amount)}</td>
                          <td className="px-4">{l.run.entryId ? <Link className="text-accent hover:underline" to={`/accounting/journals/${l.run.entryId}`}>ดูรายการบัญชี</Link> : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
            {dlg === 'edit' && <AssetDialog asset={a} onClose={() => setDlg(null)} />}
            {dlg === 'dispose' && <DisposeDialog asset={a} onClose={() => setDlg(null)} />}
          </>
        );
      }}
    </QueryView>
  );
}
