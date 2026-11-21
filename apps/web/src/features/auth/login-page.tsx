import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { loginSchema } from '@fisher/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [err, setErr] = useState('');
  const f = useForm({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });
  if (me) return <Navigate to={from} replace />;

  const submit = f.handleSubmit(async (v) => {
    setErr('');
    try {
      await api.post('/auth/login', v);
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav(from, { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'เข้าสู่ระบบไม่สำเร็จ');
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_480px]">
      <div className="hidden flex-col justify-between bg-navy-900 p-10 text-slate-300 lg:flex">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" className="size-9" alt="" />
          <span className="text-lg font-semibold text-white">Fisher ERP</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-snug text-white">ระบบบริหารจัดการกองเรือประมง</h1>
          <p className="mt-3 text-sm leading-relaxed">
            ทะเบียนเรือ · เที่ยวเรือออก-เข้า · บันทึกสัตว์น้ำ · ลูกเรือและเอกสารแรงงาน · แจ้งเตือนเอกสารหมดอายุ
          </p>
        </div>
        <div className="text-xs text-slate-500">ข้อมูลส่วนบุคคลได้รับการคุ้มครองตามนโยบายความเป็นส่วนตัวขององค์กร</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
          <div>
            <h2 className="text-xl font-semibold text-navy-900">เข้าสู่ระบบ</h2>
            <p className="text-sm text-muted">กรอกชื่อผู้ใช้และรหัสผ่านที่ได้รับจากผู้ดูแลระบบ</p>
          </div>
          {err && <div className="rounded border border-red-200 bg-bad-soft px-3 py-2 text-sm text-bad">{err}</div>}
          <Field label="ชื่อผู้ใช้" error={f.formState.errors.username?.message}>
            <Input autoComplete="username" autoFocus {...f.register('username')} />
          </Field>
          <Field label="รหัสผ่าน" error={f.formState.errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...f.register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>
            เข้าสู่ระบบ
          </Button>
        </form>
      </div>
    </div>
  );
}
