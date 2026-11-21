import { useQuery } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useRoles } from './users-page';

const MODULE_TH: Record<string, string> = {
  dashboard: 'แดชบอร์ด', vessel: 'เรือ', trip: 'เที่ยวเรือ', catch: 'สัตว์น้ำ', species: 'ชนิดสัตว์น้ำ', gps: 'GPS', employee: 'พนักงาน',
  employee_doc: 'เอกสารพนักงาน', sales: 'ขาย', purchase: 'จัดซื้อ', inventory: 'คลัง', fuel: 'น้ำมัน', payroll: 'เงินเดือน', finance: 'บัญชี',
  report: 'รายงาน', user: 'ผู้ใช้', role: 'บทบาท', audit: 'Audit', settings: 'ตั้งค่า',
};

export function RolesPage() {
  const roles = useRoles();
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<{ code: string; description: string }[]>('/permissions') });
  const [sel, setSel] = useState<string>();
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const role = roles.data?.find((r) => r.id === sel) ?? roles.data?.[0];
  useEffect(() => setDraft(new Set(role?.permissions)), [role]);
  const save = useAction(() => api.put(`/roles/${role!.id}/permissions`, { permissions: [...draft] }), { success: 'บันทึกสิทธิ์แล้ว', invalidate: ['roles'] });
  const groups = Object.entries(
    (perms.data ?? []).reduce<Record<string, { code: string; description: string }[]>>((a, p) => ((a[p.code.split('.')[0]!] ??= []).push(p), a), {}),
  );
  const locked = role?.code === 'SUPER_ADMIN';
  return (
    <>
      <PageHeader title="บทบาทและสิทธิ์" subtitle="กำหนดสิทธิ์ ดู/สร้าง/แก้ไข/อนุมัติ/ลบ/ส่งออก ตามบทบาท" />
      <QueryView q={roles}>
        {(list) => (
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <Panel bodyClass="p-1">
              {list.map((r) => (
                <button key={r.id} onClick={() => setSel(r.id)} className={cn('flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-slate-50', role?.id === r.id && 'bg-accent-soft font-medium')}>
                  <span>{r.name}</span><span className="text-xs text-muted">{r.userCount} คน</span>
                </button>
              ))}
            </Panel>
            {role && (
              <Panel title={<span className="inline-flex items-center gap-2">{role.name} {locked && <Badge>ทุกสิทธิ์ (แก้ไขไม่ได้)</Badge>}</span>}
                actions={!locked && <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}><Save /> บันทึก</Button>}>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {groups.map(([m, ps]) => (
                    <fieldset key={m} className="rounded border border-line p-3">
                      <legend className="px-1 text-sm font-semibold text-navy-800">{MODULE_TH[m] ?? m}</legend>
                      {ps.map((p) => (
                        <label key={p.code} className="flex items-start gap-2 py-0.5 text-sm">
                          <input type="checkbox" className="mt-1 accent-navy-800" disabled={locked} checked={draft.has(p.code)}
                            onChange={(e) => { const n = new Set(draft); if (e.target.checked) n.add(p.code); else n.delete(p.code); setDraft(n); }} />
                          <span>{p.description}<span className="ml-1 font-mono text-[11px] text-muted">{p.code}</span></span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        )}
      </QueryView>
    </>
  );
}
