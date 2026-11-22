import { createColumnHelper } from '@tanstack/react-table';
import { Info, Send } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAction, useListParams, usePaged } from '@/lib/hooks';

type Status = 'SIMULATED' | 'SENT' | 'FAILED';
interface Row { id: string; to: string; subject: string; body: string; status: Status; error: string | null; relatedType: string | null; createdAt: string; sentAt: string | null }
const c = createColumnHelper<Row>();
const STATUS_TH: Record<Status, string> = { SIMULATED: 'จำลอง', SENT: 'ส่งแล้ว', FAILED: 'ส่งไม่สำเร็จ' };
const StatusBadge = ({ s }: { s: Status }) => <Badge tone={s === 'SENT' ? 'ok' : s === 'FAILED' ? 'bad' : 'neutral'}>{STATUS_TH[s]}</Badge>;

export function OutboxPage() {
  const lp = useListParams();
  const q = usePaged<Row>('outbox', '/outbox', { page: lp.page, pageSize: 25 });
  const [view, setView] = useState<Row | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [to, setTo] = useState('');
  const send = useAction((v: string) => api.post('/outbox/test', { to: v }), { success: 'บันทึกอีเมลทดสอบแล้ว', invalidate: ['outbox'], onSuccess: () => { setTestOpen(false); setTo(''); } });
  const mode = (q.data as { mode?: string } | undefined)?.mode;
  const columns = [
    c.accessor('createdAt', { header: 'เวลา', cell: (i) => formatDateTime(i.getValue()) }),
    c.accessor('to', { header: 'ถึง' }),
    c.accessor('subject', { header: 'หัวข้อ', cell: (i) => <span className="line-clamp-1 max-w-80">{i.getValue()}</span> }),
    c.accessor('status', {
      header: 'สถานะ',
      cell: (i) => (
        <span className="inline-flex flex-col items-start gap-0.5">
          <StatusBadge s={i.getValue()} />
          {i.row.original.error && <span className="max-w-64 text-xs text-bad">{i.row.original.error}</span>}
        </span>
      ),
    }),
  ];
  return (
    <>
      <PageHeader title="อีเมลขาออก" subtitle="อีเมลที่ระบบส่งหรือบันทึกไว้" actions={<Button onClick={() => setTestOpen(true)}><Send /> ส่งอีเมลทดสอบ</Button>} />
      {mode === 'SIMULATED' && (
        <div className="mb-3 flex items-center gap-2 rounded border border-line bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <Info className="size-4 shrink-0" /> ยังไม่ได้ตั้งค่า SMTP — อีเมลถูกบันทึกไว้ที่นี่แต่ไม่ได้ส่งออกจริง
        </div>
      )}
      <DataTable columns={columns} data={q.data?.items} total={q.data?.total} page={lp.page} pageSize={25} onPageChange={(p) => lp.set({ page: p }, false)} loading={q.isFetching} error={q.error} onRowClick={setView} />
      {view && (
        <Dialog open onOpenChange={() => setView(null)} title={view.subject} description={`ถึง ${view.to} · ${formatDateTime(view.createdAt)}`} size="lg">
          <div className="space-y-2 text-sm">
            <StatusBadge s={view.status} />
            {view.error && <p className="text-bad">{view.error}</p>}
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-line bg-slate-50 p-2 font-sans text-sm">{view.body}</pre>
          </div>
        </Dialog>
      )}
      {testOpen && (
        <Dialog open onOpenChange={(o) => !o && setTestOpen(false)} title="ส่งอีเมลทดสอบ"
          footer={<><Button variant="outline" onClick={() => setTestOpen(false)}>ยกเลิก</Button><Button loading={send.isPending} disabled={!/^\S+@\S+\.\S+$/.test(to)} onClick={() => send.mutate(to)}>ส่ง</Button></>}>
          <Field label="อีเมลผู้รับ" required><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </Dialog>
      )}
    </>
  );
}
