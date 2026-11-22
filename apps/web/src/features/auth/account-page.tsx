import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { changePasswordSchema } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { TwoFactorSection } from './two-factor-section';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function AccountPage() {
  const { me, refresh } = useAuth();
  const f = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '' } });
  const submit = f.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', v);
      toast.success('เปลี่ยนรหัสผ่านแล้ว');
      f.reset();
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'ไม่สำเร็จ');
    }
  });
  return (
    <>
      <PageHeader title="บัญชีของฉัน" subtitle={`${me?.fullName} (${me?.username})`} />
      {me?.mustChangePassword && (
        <div className="mb-4 rounded border border-amber-200 bg-warn-soft px-3 py-2 text-sm text-warn">กรุณาตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งานระบบ</div>
      )}
      {me?.mustEnable2fa && !me.mustChangePassword && (
        <div role="alert" className="mb-4 rounded border border-amber-300 bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
          บทบาทของคุณกำหนดให้ต้องเปิดใช้งานการยืนยันตัวตนสองขั้นตอน (2FA) ก่อนใช้งานระบบ กรุณาตั้งค่า 2FA ด้านล่างเพื่อดำเนินการต่อ
        </div>
      )}
      <div className="space-y-4">
      <Panel title="เปลี่ยนรหัสผ่าน" className="max-w-lg">
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Field label="รหัสผ่านปัจจุบัน" error={f.formState.errors.currentPassword?.message} required>
            <Input type="password" autoComplete="current-password" {...f.register('currentPassword')} />
          </Field>
          <Field label="รหัสผ่านใหม่" error={f.formState.errors.newPassword?.message} hint="อย่างน้อย 8 ตัว มีตัวพิมพ์ใหญ่ พิมพ์เล็ก และตัวเลข" required>
            <Input type="password" autoComplete="new-password" {...f.register('newPassword')} />
          </Field>
          <Button type="submit" loading={f.formState.isSubmitting}>บันทึก</Button>
        </form>
      </Panel>
      {me?.mustChangePassword ? (
        <p className="max-w-lg text-sm text-muted">ตั้งค่าการยืนยันตัวตนสองขั้นตอน (2FA) ได้หลังเปลี่ยนรหัสผ่าน</p>
      ) : (
        <TwoFactorSection />
      )}
      </div>
    </>
  );
}
