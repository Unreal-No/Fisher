import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatDateTime } from '@fisher/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Checkbox, Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

interface Status { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean }
interface Setup { secret: string; otpauthUrl: string; qrSvg: string }

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('คัดลอกแล้ว');
  } catch {
    toast.error('คัดลอกไม่สำเร็จ');
  }
}

function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Fisher ERP - รหัสกู้คืน 2FA (ใช้ได้รหัสละ 1 ครั้ง)\n\n${text}\n`], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fisher-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && saved) onClose(); }} title="รหัสกู้คืน" size="sm"
      description="เก็บไว้ในที่ปลอดภัย รหัสแต่ละตัวใช้ได้ครั้งเดียว และจะแสดงเพียงครั้งนี้เท่านั้น"
      footer={<Button disabled={!saved} onClick={onClose}>ปิด</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 rounded border border-line bg-slate-50 p-3 font-mono text-sm">
          {codes.map((c) => <span key={c}>{c}</span>)}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => copy(text)}><Copy /> คัดลอก</Button>
          <Button variant="outline" size="sm" onClick={download}><Download /> ดาวน์โหลด .txt</Button>
        </div>
        <Checkbox label="บันทึกรหัสไว้แล้ว" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      </div>
    </Dialog>
  );
}

function EnableDialog({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const start = useAction((password: string) => api.post<Setup>('/auth/2fa/setup', { password }), { onSuccess: setSetup });
  const enable = useAction((code: string) => api.post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code }), { onSuccess: (r) => onDone(r.recoveryCodes) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="เปิดใช้งาน 2FA" size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          {!setup ? (
            <Button loading={start.isPending} disabled={!password} onClick={() => start.mutate(password)}>ถัดไป</Button>
          ) : (
            <Button loading={enable.isPending} disabled={!/^\d{6}$/.test(code)} onClick={() => enable.mutate(code)}>ยืนยันและเปิดใช้งาน</Button>
          )}
        </>
      }>
      {!setup ? (
        <form onSubmit={(e) => { e.preventDefault(); if (password) start.mutate(password); }}>
          <Field label="ยืนยันรหัสผ่านของคุณ" required>
            <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </form>
      ) : (
        <div className="space-y-4 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>ติดตั้งแอปยืนยันตัวตน เช่น Google Authenticator, Microsoft Authenticator หรือแอป TOTP อื่น</li>
            <li>สแกน QR code ด้านล่าง หรือกรอกรหัสลับด้วยตนเอง</li>
            <li>กรอกรหัส 6 หลักที่แอปแสดงเพื่อยืนยัน</li>
          </ol>
          <div className="flex justify-center">
            <div className="size-48 rounded border border-line bg-white p-2 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-slate-50 px-2 py-1.5 font-mono text-sm">{setup.secret}</code>
            <Button variant="outline" size="sm" onClick={() => copy(setup.secret)}><Copy /> คัดลอก</Button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code)) enable.mutate(code); }}>
            <Field label="รหัส 6 หลัก" required>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </form>
        </div>
      )}
    </Dialog>
  );
}

function PasswordCodeDialog({ title, confirmText, danger, path, onClose, onDone }: {
  title: string; confirmText: string; danger?: boolean; path: string; onClose: () => void; onDone: (r: { recoveryCodes?: string[] }) => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const m = useAction(() => api.post<{ recoveryCodes?: string[] }>(path, { password, code: code.trim() }), { onSuccess: onDone });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button variant={danger ? 'danger' : 'primary'} loading={m.isPending} disabled={!password || !code.trim()} onClick={() => m.mutate()}>{confirmText}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (password && code.trim()) m.mutate(); }}>
        <Field label="รหัสผ่านปัจจุบัน" required><Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="รหัส 6 หลักจากแอป หรือรหัสกู้คืน" required><Input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}

export function TwoFactorSection() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['2fa'], queryFn: () => api.get<Status>('/auth/2fa') });
  const [dlg, setDlg] = useState<'enable' | 'regen' | 'disable' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const refreshAll = () => Promise.all([qc.invalidateQueries({ queryKey: ['2fa'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
  const d = s.data;
  return (
    <>
      <Panel title="การยืนยันตัวตนสองขั้นตอน (2FA)" className="max-w-lg" actions={d && (d.enabled ? <Badge tone="ok"><ShieldCheck className="size-3" /> เปิดใช้งาน</Badge> : <Badge tone="warn"><ShieldAlert className="size-3" /> ยังไม่เปิดใช้งาน</Badge>)}>
        {s.isLoading && <p className="text-sm text-muted">กำลังโหลด...</p>}
        {s.error && <p className="text-sm text-bad">โหลดสถานะ 2FA ไม่สำเร็จ</p>}
        {d && !d.enabled && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">เพิ่มความปลอดภัยด้วยรหัสจากแอปยืนยันตัวตนทุกครั้งที่เข้าสู่ระบบ</p>
            <Button onClick={() => setDlg('enable')}>เปิดใช้งาน</Button>
          </div>
        )}
        {d?.enabled && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
              <dt className="text-muted">เปิดใช้งานเมื่อ</dt><dd>{formatDateTime(d.enabledAt)}</dd>
              <dt className="text-muted">รหัสกู้คืนคงเหลือ</dt><dd>{d.recoveryCodesLeft} รหัส</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDlg('regen')}>สร้างรหัสกู้คืนใหม่</Button>
              <Button variant="danger" disabled={d.required} onClick={() => setDlg('disable')}>ปิดใช้งาน</Button>
            </div>
            {d.required && <p className="text-xs text-muted">บทบาทของคุณถูกกำหนดให้ต้องใช้ 2FA จึงไม่สามารถปิดใช้งานได้</p>}
          </div>
        )}
      </Panel>
      {dlg === 'enable' && <EnableDialog onClose={() => setDlg(null)} onDone={(c) => { setDlg(null); setCodes(c); void refreshAll(); }} />}
      {dlg === 'regen' && <PasswordCodeDialog title="สร้างรหัสกู้คืนใหม่" confirmText="สร้างรหัสใหม่" path="/auth/2fa/recovery-codes" onClose={() => setDlg(null)} onDone={(r) => { setDlg(null); setCodes(r.recoveryCodes ?? []); void refreshAll(); }} />}
      {dlg === 'disable' && <PasswordCodeDialog title="ปิดใช้งาน 2FA" confirmText="ปิดใช้งาน" danger path="/auth/2fa/disable" onClose={() => setDlg(null)} onDone={() => { setDlg(null); toast.success('ปิดใช้งาน 2FA แล้ว'); void refreshAll(); }} />}
      {codes && <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />}
    </>
  );
}
