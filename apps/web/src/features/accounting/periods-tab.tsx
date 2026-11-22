import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDateTime } from '@fisher/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { QueryView, Spinner } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { useAction, type useListParams } from '@/lib/hooks';
import { INV } from './lookups';
import { FiscalStatusBadge } from './status';
import type { Checklist, FiscalPeriod } from './types';
import { JOURNAL_SOURCE_TH } from '@fisher/shared';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
type LP = ReturnType<typeof useListParams>;

function ChecklistView({ c }: { c: Checklist }) {
  return (
    <div className="space-y-3 text-sm">
      <p className={c.ok ? 'text-ok' : 'text-bad'}>{c.ok ? 'พร้อมปิดงวด' : 'ยังปิดงวดไม่ได้'}</p>
      <div>
        <div className="font-medium">รายการร่างที่ยังไม่ผ่าน ({c.drafts.length})</div>
        {c.drafts.length ? <ul className="mt-1 list-disc pl-5">{c.drafts.map((d) => <li key={d.id}>{d.entryNo} — {d.memo}</li>)}</ul> : <p className="text-muted">ไม่มี</p>}
      </div>
      <div>
        <div className="font-medium">เอกสารรอลงบัญชีอัตโนมัติ ({c.pending})</div>
        {c.pending > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(c.pendingByType).map(([k, n]) => <Badge key={k} tone="warn">{JOURNAL_SOURCE_TH[k as keyof typeof JOURNAL_SOURCE_TH] ?? k}: {n}</Badge>)}
          </div>
        ) : <p className="text-muted">ไม่มี</p>}
      </div>
    </div>
  );
}

export function PeriodsTab({ lp, canApprove }: { lp: LP; canApprove: boolean }) {
  const thisYear = new Date().getFullYear();
  const year = Number(lp.get('year') || thisYear);
  const q = useQuery({ queryKey: ['accounting', 'periods', year], queryFn: () => api.get<FiscalPeriod[]>('/accounting/periods', { year }) });
  const [check, setCheck] = useState<FiscalPeriod | null>(null);
  const [blocked, setBlocked] = useState<{ p: FiscalPeriod; c: Checklist } | null>(null);
  const [closing, setClosing] = useState<FiscalPeriod | null>(null);
  const [reopen, setReopen] = useState<FiscalPeriod | null>(null);
  const path = (p: FiscalPeriod) => `/accounting/periods/${p.year}/${p.month}`;
  const cl = useQuery({ queryKey: ['accounting', 'checklist', check?.year, check?.month], queryFn: () => api.get<Checklist>(`${path(check!)}/checklist`), enabled: !!check });
  const close = useAction((p: FiscalPeriod) => api.post(`${path(p)}/close`, {}).then(() => p), {
    success: 'ปิดงวดแล้ว', invalidate: INV, silentError: true, onSuccess: () => setClosing(null),
  });
  const doClose = (p: FiscalPeriod) => close.mutate(p, {
    onError: (e) => {
      setClosing(null);
      if (e instanceof ApiError && e.code === 'PERIOD_NOT_READY' && e.details) setBlocked({ p, c: e.details as Checklist });
      else import('sonner').then(({ toast }) => toast.error(e instanceof ApiError ? e.message : 'เกิดข้อผิดพลาด'));
    },
  });
  const doReopen = useAction((v: { p: FiscalPeriod; reason: string }) => api.post(`${path(v.p)}/reopen`, { reason: v.reason }), {
    success: 'เปิดงวดแล้ว', invalidate: INV, onSuccess: () => setReopen(null),
  });
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);
  if (!years.includes(year)) years.push(year);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted" htmlFor="fy">ปี</label>
        <Select id="fy" className="w-auto" options={years.sort((a, b) => b - a).map((y) => ({ value: String(y), label: `พ.ศ. ${y + 543}` }))} value={String(year)} onChange={(e) => lp.set({ year: e.target.value })} />
      </div>
      <Panel title={`งวดบัญชี พ.ศ. ${year + 543}`} bodyClass="p-0">
        <QueryView q={q}>
          {(rows) => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600">
                  <tr><th className="px-4 py-2">งวด</th><th className="px-2">สถานะ</th><th className="px-2 text-right">ร่าง</th><th className="px-2 text-right">ผ่านแล้ว</th><th className="px-2">ปิดโดย</th><th className="px-2" /></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.month} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-4 py-2">{MONTHS[p.month - 1]} {p.year + 543}</td>
                      <td className="px-2 py-2"><FiscalStatusBadge s={p.status} /></td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.drafts}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.posted}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {p.status === 'CLOSED' && p.closedAt ? `${p.closedByName ?? '-'} (${formatDateTime(p.closedAt)})` : '-'}
                        {p.status === 'OPEN' && p.reopenedAt && <span className="block text-xs text-muted">เปิดงวดใหม่ {formatDateTime(p.reopenedAt)}: {p.reopenReason}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {p.status === 'OPEN' && <Button size="sm" variant="outline" onClick={() => setCheck(p)}>ตรวจก่อนปิด</Button>}{' '}
                        {p.status === 'OPEN' && canApprove && <Button size="sm" onClick={() => setClosing(p)}>ปิดงวด</Button>}
                        {p.status === 'CLOSED' && canApprove && <Button size="sm" variant="outline" onClick={() => setReopen(p)}>เปิดงวด</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryView>
      </Panel>
      <Dialog open={!!check} onOpenChange={(o) => !o && setCheck(null)} title={check ? `ตรวจก่อนปิด ${MONTHS[check.month - 1]} ${check.year + 543}` : ''} footer={<Button onClick={() => setCheck(null)}>ปิด</Button>}>
        {cl.isLoading ? <Spinner /> : cl.data ? <ChecklistView c={cl.data} /> : null}
      </Dialog>
      <Dialog open={!!blocked} onOpenChange={(o) => !o && setBlocked(null)} title="ปิดงวดไม่ได้" footer={<Button onClick={() => setBlocked(null)}>ปิด</Button>}>
        {blocked && <ChecklistView c={blocked.c} />}
      </Dialog>
      <ConfirmDialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)} title="ปิดงวดบัญชี" loading={close.isPending}
        message={closing ? `ปิดงวด ${MONTHS[closing.month - 1]} ${closing.year + 543} — หลังปิดจะบันทึก/ผ่านรายการในงวดนี้ไม่ได้` : ''} onConfirm={() => closing && doClose(closing)} />
      <ConfirmDialog open={!!reopen} onOpenChange={(o) => !o && setReopen(null)} title="เปิดงวดบัญชี" requireReason danger loading={doReopen.isPending}
        message={reopen ? `เปิดงวด ${MONTHS[reopen.month - 1]} ${reopen.year + 543} อีกครั้ง` : ''} onConfirm={(r) => reopen && doReopen.mutate({ p: reopen, reason: r })} />
    </div>
  );
}
