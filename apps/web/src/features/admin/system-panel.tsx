import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatDate, formatNumber, RESET_CONFIRM_TEXT } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';

interface SystemInfo { goLiveAt: string | null; canReset: boolean; counts: { vessels: number; employees: number; trips: number; journals: number; users: number; positions: number } }
const COUNT_TH: Record<keyof SystemInfo['counts'], string> = { vessels: 'เรือ', employees: 'พนักงาน', trips: 'เที่ยวเรือ', journals: 'รายการบัญชี', users: 'ผู้ใช้', positions: 'ตำแหน่ง GPS' };

export function SystemPanel() {
  const { me } = useAuth();
  const isSuper = !!me?.roles.some((r) => r.code === 'SUPER_ADMIN');
  const q = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/system'), enabled: isSuper });
  const [dlg, setDlg] = useState<'reset' | 'live' | null>(null);
  if (!isSuper || !q.data) return null;
  const s = q.data;
  return (
    <Panel title="เริ่มใช้งานระบบ">
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-1 rounded bg-slate-50 p-2 text-xs">
          {(Object.keys(COUNT_TH) as (keyof SystemInfo['counts'])[]).map((k) => <div key={k}>{COUNT_TH[k]}: <b>{formatNumber(s.counts[k])}</b></div>)}
        </div>
        {s.goLiveAt && <p className="font-medium text-ok">เริ่มใช้งานจริงเมื่อ {formatDate(s.goLiveAt)}</p>}
        {s.canReset && (
          <div className="space-y-2 rounded border border-red-300 bg-bad-soft p-3">
            <div className="flex items-center gap-1.5 font-semibold text-bad"><AlertTriangle className="size-4" /> ล้างข้อมูลก่อนใช้งานจริง</div>
            <p><b>จะถูกลบ:</b> ข้อมูลธุรกิจทั้งหมด ได้แก่ เรือ, พนักงาน, เที่ยวเรือ, สัตว์น้ำ, ขาย, จัดซื้อ, คลัง, เงินเดือน, บัญชี, GPS, ไฟล์แนบ และผู้ใช้อื่นทุกคน</p>
            <p><b>จะคงไว้:</b> ผู้ดูแลที่กำลังใช้งาน, บทบาท/สิทธิ์, ผังบัญชี, ชนิดสัตว์น้ำ/เกรด, ประเภทเอกสาร, ตั้งค่าระบบ, ประวัติการใช้งาน</p>
            <Button variant="danger" onClick={() => setDlg('reset')}>ล้างข้อมูลทั้งหมด</Button>
          </div>
        )}
        {!s.goLiveAt && (
          <div className="space-y-2">
            <p className="text-xs text-muted">เมื่อยืนยันเริ่มใช้งานจริง จะไม่สามารถล้างข้อมูลได้อีกถาวร</p>
            <Button variant="outline" onClick={() => setDlg('live')}>ยืนยันเริ่มใช้งานจริง</Button>
          </div>
        )}
      </div>
      {dlg && <SystemDialog kind={dlg} onClose={() => setDlg(null)} />}
    </Panel>
  );
}

function SystemDialog({ kind, onClose }: { kind: 'reset' | 'live'; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const reset = kind === 'reset';
  const run = useAction(
    () => (reset ? api.post('/system/reset', { password, confirm }) : api.post('/system/go-live', { password })),
    {
      success: reset ? 'ล้างข้อมูลเรียบร้อย' : 'เริ่มใช้งานจริงแล้ว',
      onSuccess: () => { void qc.invalidateQueries(); onClose(); if (reset) nav('/'); },
    },
  );
  const ok = password.length > 0 && (!reset || confirm === RESET_CONFIRM_TEXT);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={reset ? 'ยืนยันการล้างข้อมูลทั้งหมด' : 'ยืนยันเริ่มใช้งานจริง'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button variant={reset ? 'danger' : 'primary'} loading={run.isPending} disabled={!ok} onClick={() => run.mutate(undefined)}>{reset ? 'ลบข้อมูลทั้งหมด' : 'ยืนยัน'}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-bad">{reset ? 'การลบไม่สามารถกู้คืนได้' : 'หลังยืนยัน จะล้างข้อมูลระบบไม่ได้อีกถาวร'}</p>
        <Field label="รหัสผ่านของคุณ" required><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {reset && <Field label={`พิมพ์ "${RESET_CONFIRM_TEXT}" เพื่อยืนยัน`} required><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>}
      </div>
    </Dialog>
  );
}
