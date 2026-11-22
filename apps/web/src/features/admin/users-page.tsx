import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { KeyRound, Pencil, Plus, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { formatDateTime, resetPasswordSchema, userCreateSchema } from '@fisher/shared';
import { FilterBar, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAction, useListParams, usePaged } from '@/lib/hooks';
import { useVessels } from '@/lib/lookups';

interface U {
  id: string; username: string; fullName: string; email: string | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null; lockedUntil: string | null; totpEnabledAt: string | null;
  roles: { role: { id: string; code: string; name: string } }[]; vessels: { vessel: { id: string; code: string; name: string } }[];
}
interface Role { id: string; code: string; name: string; description: string | null; permissions: string[]; userCount: number; isSystem: boolean }
export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });

const c = createColumnHelper<U>();

export function UsersPage() {
  const lp = useListParams();
  const q = usePaged<U>('users', '/users', lp.params);
  const [edit, setEdit] = useState<U | 'new' | null>(null);
  const [reset, setReset] = useState<U | null>(null);
  const [reset2fa, setReset2fa] = useState<U | null>(null);
  const doReset2fa = useAction((id: string) => api.post(`/users/${id}/reset-2fa`), { success: 'รีเซ็ต 2FA แล้ว', invalidate: ['users'], onSuccess: () => setReset2fa(null) });
  const columns = [
    c.accessor('username', { header: 'ชื่อผู้ใช้', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    c.accessor('fullName', { header: 'ชื่อ-สกุล' }),
    c.accessor('roles', { header: 'บทบาท', cell: (i) => <span className="flex flex-wrap gap-1">{i.getValue().map((r) => <Badge key={r.role.id}>{r.role.name}</Badge>)}</span> }),
    c.accessor('vessels', { header: 'ขอบเขตเรือ', cell: (i) => (i.getValue().length ? i.getValue().map((v) => v.vessel.name).join(', ') : 'ทุกลำ') }),
    c.accessor('lastLoginAt', { header: 'เข้าใช้ล่าสุด', cell: (i) => formatDateTime(i.getValue()) }),
    c.accessor('isActive', { header: 'สถานะ', cell: ({ row: { original: u } }) => (!u.isActive ? <Badge>ปิดใช้งาน</Badge> : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <Badge tone="bad">ถูกล็อก</Badge> : <Badge tone="ok">ใช้งาน</Badge>) }),
    c.accessor('totpEnabledAt', { header: '2FA', cell: (i) => (i.getValue() ? <Badge tone="ok">เปิด</Badge> : <Badge>ปิด</Badge>) }),
    c.display({ id: 'a', header: '', meta: { align: 'right' }, cell: ({ row: { original: u } }) => (
      <span className="inline-flex"><Button variant="ghost" size="icon" aria-label="แก้ไข" onClick={() => setEdit(u)}><Pencil /></Button><Button variant="ghost" size="icon" aria-label="รีเซ็ตรหัสผ่าน" onClick={() => setReset(u)}><KeyRound /></Button>{u.totpEnabledAt && <Button variant="ghost" size="icon" aria-label="รีเซ็ต 2FA" title="รีเซ็ต 2FA" onClick={() => setReset2fa(u)}><ShieldOff /></Button>}</span>
    ) }),
  ];
  return (
    <>
      <PageHeader title="ผู้ใช้งาน" subtitle="บัญชีผู้ใช้ บทบาท และขอบเขตข้อมูลตามเรือ" actions={<Button onClick={() => setEdit('new')}><Plus /> เพิ่มผู้ใช้</Button>} />
      <FilterBar><SearchInput value={lp.get('q')} onChange={(v) => lp.set({ q: v })} /></FilterBar>
      <DataTable columns={columns} data={q.data?.items} total={q.data?.total} page={lp.page} onPageChange={(p) => lp.set({ page: p }, false)} loading={q.isFetching} error={q.error} />
      {edit && <UserDialog user={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {reset2fa && (
        <ConfirmDialog open onOpenChange={(o) => !o && setReset2fa(null)} title={`รีเซ็ต 2FA ${reset2fa.username}`} danger confirmText="รีเซ็ต 2FA" loading={doReset2fa.isPending}
          message="ผู้ใช้ต้องตั้งค่า 2FA ใหม่ และจะถูกออกจากระบบทุกอุปกรณ์" onConfirm={() => doReset2fa.mutate(reset2fa.id)} />
      )}
      {reset && <ResetDialog user={reset} onClose={() => setReset(null)} />}
    </>
  );
}

function UserDialog({ user, onClose }: { user?: U; onClose: () => void }) {
  const roles = useRoles();
  const vessels = useVessels();
  const schema = user ? userCreateSchema.omit({ password: true }) : userCreateSchema;
  const f = useForm({
    resolver: zodResolver(schema as typeof userCreateSchema),
    defaultValues: {
      username: user?.username ?? '', fullName: user?.fullName ?? '', email: user?.email ?? '', password: '',
      roleIds: user?.roles.map((r) => r.role.id) ?? [], vesselIds: user?.vessels.map((v) => v.vessel.id) ?? [], isActive: user?.isActive ?? true,
    },
  });
  const save = useAction(
    (v: Record<string, unknown>) => (user ? api.patch(`/users/${user.id}`, { fullName: v.fullName, email: v.email, roleIds: v.roleIds, vesselIds: v.vesselIds, isActive: v.isActive }) : api.post('/users', v)),
    { success: 'บันทึกผู้ใช้แล้ว', invalidate: ['users'], onSuccess: onClose },
  );
  const e = f.formState.errors;
  const toggle = (field: 'roleIds' | 'vesselIds', id: string) => {
    const cur = f.getValues(field) as string[];
    f.setValue(field, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], { shouldValidate: true });
  };
  const roleIds = f.watch('roleIds') as string[];
  const vesselIds = f.watch('vesselIds') as string[];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={user ? `แก้ไขผู้ใช้ ${user.username}` : 'เพิ่มผู้ใช้'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v as Record<string, unknown>))}>บันทึก</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={2}>
          <Field label="ชื่อผู้ใช้" required error={e.username?.message}><Input disabled={!!user} autoComplete="off" {...f.register('username')} /></Field>
          <Field label="ชื่อ-สกุล" required error={e.fullName?.message}><Input {...f.register('fullName')} /></Field>
          <Field label="อีเมล" error={e.email?.message}><Input type="email" {...f.register('email')} /></Field>
          {!user && <Field label="รหัสผ่านเริ่มต้น" required error={e.password?.message} hint="ผู้ใช้ต้องเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก"><Input type="password" autoComplete="new-password" {...f.register('password')} /></Field>}
          <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
        </FormGrid>
        <Field label="บทบาท" required error={e.roleIds?.message}>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {roles.data?.map((r) => <Checkbox key={r.id} label={r.name} checked={roleIds.includes(r.id)} onChange={() => toggle('roleIds', r.id)} />)}
          </div>
        </Field>
        <Field label="จำกัดการเข้าถึงเฉพาะเรือ" hint="ไม่เลือก = เห็นข้อมูลทุกลำ (เหมาะกับไต้ก๋งให้เลือกเฉพาะเรือของตน)">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {vessels.data?.map((v) => <Checkbox key={v.id} label={`${v.code} ${v.name}`} checked={vesselIds.includes(v.id)} onChange={() => toggle('vesselIds', v.id)} />)}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: U; onClose: () => void }) {
  const f = useForm({ resolver: zodResolver(resetPasswordSchema), defaultValues: { newPassword: '' } });
  const save = useAction((v: unknown) => api.post(`/users/${user.id}/reset-password`, v), { success: 'รีเซ็ตรหัสผ่านแล้ว ผู้ใช้ต้องเปลี่ยนเมื่อเข้าระบบ', invalidate: ['users'], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`รีเซ็ตรหัสผ่าน ${user.username}`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>รีเซ็ต</Button></>}>
      <Field label="รหัสผ่านชั่วคราว" error={f.formState.errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...f.register('newPassword')} /></Field>
      <p className="mt-2 text-xs text-muted">ระบบจะออกจากระบบทุกอุปกรณ์ของผู้ใช้นี้</p>
    </Dialog>
  );
}
