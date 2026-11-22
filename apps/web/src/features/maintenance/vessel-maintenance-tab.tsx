import { useQuery } from '@tanstack/react-query';
import { Gauge, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatDate, formatNumber, MAINT_CATEGORY_TH } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { Empty } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EngineHourDialog, OrderDialog } from './maintenance-dialogs';
import { DueBadge, MaintStatusBadge } from './status';
import type { EngineHourLog, MaintOrderRow, MaintPlan } from './types';

export function VesselMaintenanceTab({ vesselId }: { vesselId: string }) {
  const { can } = useAuth();
  const [dlg, setDlg] = useState<null | 'hours' | 'order'>(null);
  const plans = useQuery({ queryKey: ['maintenance', 'vessel-plans', vesselId], queryFn: () => api.get<MaintPlan[]>('/maintenance/plans', { vesselId, dueOnly: 'true' }) });
  const hours = useQuery({ queryKey: ['maintenance', 'vessel-hours', vesselId], queryFn: () => api.get<EngineHourLog[]>('/maintenance/engine-hours', { vesselId }) });
  const orders = useQuery({
    queryKey: ['maintenance', 'vessel-orders', vesselId],
    queryFn: () => api.get<{ items: MaintOrderRow[] }>('/maintenance/orders', { vesselId, page: 1, pageSize: 5 }),
  });
  const latest = hours.data?.[0];
  return (
    <div className="space-y-4">
      <Panel
        title="ชั่วโมงเครื่อง"
        actions={can('maintenance.create') && <Button size="sm" variant="outline" onClick={() => setDlg('hours')}><Gauge /> บันทึกชั่วโมงเครื่อง</Button>}
      >
        {latest ? <p className="text-sm"><b className="text-lg tabular-nums">{formatNumber(latest.hours, 1)}</b> ชม. <span className="text-muted">· ล่าสุด {formatDate(latest.recordedAt)}</span></p> : <p className="text-sm text-muted">ยังไม่มีการบันทึกชั่วโมงเครื่อง</p>}
      </Panel>
      <Panel title="แผนบำรุงรักษาที่ใกล้/เกินกำหนด" bodyClass="p-0" actions={<Link className="text-sm text-accent hover:underline" to={`/maintenance?tab=plans&vesselId=${vesselId}`}>ดูทั้งหมด</Link>}>
        {plans.data?.length ? (
          <ul className="divide-y divide-line">
            {plans.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="font-medium">{p.name}</span><span className="text-muted">{MAINT_CATEGORY_TH[p.category]}</span>
                <span className="text-xs text-muted">{[p.due.nextDueDate ? formatDate(p.due.nextDueDate) : null, p.due.nextDueHours != null ? `${formatNumber(p.due.nextDueHours, 1)} ชม.` : null].filter(Boolean).join(' / ')}</span>
                <span className="ml-auto"><DueBadge s={p.due.state} /></span>
              </li>
            ))}
          </ul>
        ) : <Empty title="ไม่มีแผนที่ใกล้/เกินกำหนด" />}
      </Panel>
      <Panel
        title="ใบสั่งซ่อมล่าสุด" bodyClass="p-0"
        actions={can('maintenance.create') && <Button size="sm" onClick={() => setDlg('order')}><Plus /> แจ้งซ่อม</Button>}
      >
        {orders.data?.items.length ? (
          <ul className="divide-y divide-line">
            {orders.data.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <Link className="font-medium text-accent hover:underline" to={`/maintenance/orders/${o.id}`}>{o.orderNo}</Link>
                <span>{o.title}</span><span className="text-xs text-muted">{formatDate(o.reportedAt)}</span>
                <span className="ml-auto"><MaintStatusBadge s={o.status} /></span>
              </li>
            ))}
          </ul>
        ) : <Empty title="ยังไม่มีใบสั่งซ่อม" />}
      </Panel>
      {dlg === 'hours' && <EngineHourDialog vesselId={vesselId} onClose={() => setDlg(null)} />}
      {dlg === 'order' && <OrderDialog prefill={{ vesselId }} onClose={() => setDlg(null)} />}
    </div>
  );
}
