import { CheckCheck, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { formatDateTime } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useListParams, usePaged } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface N { id: string; title: string; message: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; link: string | null; readAt: string | null; createdAt: string }
const TONE = { INFO: 'info', WARNING: 'warn', CRITICAL: 'bad' } as const;
const SEV = { INFO: 'แจ้งเพื่อทราบ', WARNING: 'เตือน', CRITICAL: 'เร่งด่วน' };

export function NotificationsPage() {
  const nav = useNavigate();
  const { canAny } = useAuth();
  const lp = useListParams();
  const q = usePaged<N>('notifications', '/notifications', { page: lp.page, pageSize: 50, unread: lp.get('unread') || undefined });
  const readAll = useAction(() => api.post('/notifications/read-all'), { success: 'อ่านทั้งหมดแล้ว', invalidate: ['notifications'] });
  const read = useAction((id: string) => api.post(`/notifications/${id}/read`), { invalidate: ['notifications'] });
  const scan = useAction(() => api.post<{ alerts: number; created: number }>('/notifications/scan'), {
    invalidate: ['notifications'], onSuccess: (r) => toast.success(`ตรวจสอบแล้ว พบ ${r.alerts} รายการ สร้างแจ้งเตือนใหม่ ${r.created}`),
  });
  return (
    <>
      <PageHeader title="การแจ้งเตือน" subtitle="เอกสารแรงงาน/ใบอนุญาตเรือใกล้หมดอายุ ตามรอบที่ตั้งค่า (ตรวจอัตโนมัติทุก 6 ชม.)" actions={<>
        {canAny('settings.manage', 'employee_doc.manage') && <Button variant="outline" onClick={() => scan.mutate(undefined)} loading={scan.isPending}><RefreshCw /> ตรวจสอบตอนนี้</Button>}
        <Button variant="outline" onClick={() => readAll.mutate(undefined)}><CheckCheck /> อ่านทั้งหมด</Button>
      </>} />
      <div className="mb-3"><Checkbox label="เฉพาะที่ยังไม่อ่าน" checked={lp.get('unread') === 'true'} onChange={(e) => lp.set({ unread: e.target.checked ? 'true' : undefined })} /></div>
      <QueryView q={q}>
        {(d) => (
          <Panel bodyClass="p-0">
            {d.items.length ? (
              <ul className="divide-y divide-line">
                {d.items.map((n) => (
                  <li key={n.id} className={cn('flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-slate-50', !n.readAt && 'bg-accent-soft/50')}
                    onClick={() => { if (!n.readAt) read.mutate(n.id); if (n.link) nav(n.link); }}>
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className={cn(!n.readAt && 'font-semibold')}>{n.title}</span><Badge tone={TONE[n.severity]}>{SEV[n.severity]}</Badge></div>
                      <div className="text-sm text-muted">{n.message}</div>
                    </div>
                    <div className="shrink-0 text-xs text-muted">{formatDateTime(n.createdAt)}</div>
                  </li>
                ))}
              </ul>
            ) : <Empty title="ไม่มีการแจ้งเตือน" />}
          </Panel>
        )}
      </QueryView>
    </>
  );
}
