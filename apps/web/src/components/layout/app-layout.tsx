import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronRight, CloudOff, KeyRound, LogOut, Menu, RefreshCw, UserCircle2, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import * as queue from '@/lib/offline-queue';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from '../ui/dropdown';
import { CRUMB, NAV } from './nav';

function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}

function SyncStatus() {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const refresh = () => void queue.list().then((l) => setPending(l.length));
    refresh();
    const stop = queue.startAutoSync();
    const unsub = queue.subscribe(refresh);
    return () => {
      stop();
      unsub();
    };
  }, []);
  if (online && !pending) return null;
  return (
    <Link to="/catch?tab=queue" className={cn('flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium', online ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad')}>
      {online ? <RefreshCw className="size-3.5" /> : <CloudOff className="size-3.5" />}
      {online ? `รอซิงก์ ${pending} รายการ` : `ออฟไลน์${pending ? ` · ค้าง ${pending}` : ''}`}
    </Link>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return <span className="text-sm font-medium text-ink">แดชบอร์ด</span>;
  return (
    <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label="breadcrumb">
      <Link to="/" className="text-muted hover:text-ink">หน้าหลัก</Link>
      {parts.map((p, i) => {
        const to = '/' + parts.slice(0, i + 1).join('/');
        const label = CRUMB[p] ?? (p.length > 20 ? 'รายละเอียด' : p);
        const last = i === parts.length - 1;
        return (
          <span key={to} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="size-3.5 shrink-0 text-slate-400" />
            {last || ['admin', 'requests', 'orders', 'invoices', 'periods', 'slips', 'journals', 'bills', 'assets', 'bank-recs'].includes(p) ? <span className={cn('truncate', last && 'font-medium text-ink')}>{label}</span> : <Link to={to} className="truncate text-muted hover:text-ink">{label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}

export function AppLayout() {
  const { me, can, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const unread = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get<{ unreadCount: number }>('/notifications', { pageSize: 1 }),
    refetchInterval: 120_000,
  });

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 text-slate-300">
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <img src="/icon.svg" alt="" className="size-7" />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">Fisher ERP</div>
          <div className="text-[11px] text-slate-400">ระบบบริหารจัดการประมง</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || can(...i.perm));
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.group}</div>
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === '/'}
                  className={({ isActive }) =>
                    cn('flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-white/5 hover:text-white', isActive && 'bg-white/10 font-medium text-white')
                  }
                >
                  <i.icon className="size-4" /> {i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-4 py-2 text-[11px] text-slate-500">v0.9.0</div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <aside className="hidden w-60 shrink-0 lg:block print:hidden">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
          <button className="absolute left-64 top-3 ml-2 rounded bg-white p-1" onClick={() => setOpen(false)} aria-label="ปิดเมนู">
            <X className="size-5" />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-3 sm:px-5 print:hidden">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="เมนู">
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <SyncStatus />
          <Button variant="ghost" size="icon" className="relative" onClick={() => nav('/notifications')} aria-label="การแจ้งเตือน">
            <Bell />
            {!!unread.data?.unreadCount && (
              <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-[10px] font-semibold leading-4 text-white">
                {unread.data.unreadCount > 99 ? '99+' : unread.data.unreadCount}
              </span>
            )}
          </Button>
          <Dropdown
            trigger={
              <Button variant="ghost" className="gap-2 px-2">
                <UserCircle2 className="!size-5" />
                <span className="hidden max-w-40 truncate text-sm sm:inline">{me?.fullName}</span>
              </Button>
            }
          >
            <DropdownLabel>
              {me?.username} · {me?.roles.map((r) => r.name).join(', ')}
            </DropdownLabel>
            <DropdownSeparator />
            <DropdownItem onSelect={() => nav('/account')}>
              <KeyRound /> เปลี่ยนรหัสผ่าน
            </DropdownItem>
            <DropdownItem danger onSelect={() => void logout().then(() => nav('/login'))}>
              <LogOut /> ออกจากระบบ
            </DropdownItem>
          </Dropdown>
        </header>
        <main className="flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto max-w-[1440px] p-3 sm:p-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
