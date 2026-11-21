import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Flat bordered section used instead of heavy cards. */
export function Panel({ title, actions, children, className, bodyClass }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cn('rounded-md border border-line bg-white', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function DL({ items, cols = 3 }: { items: [string, ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', cols === 3 && 'lg:grid-cols-3', cols === 4 && 'lg:grid-cols-4')}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v === null || v === undefined || v === '' ? '-' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad'; icon?: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-white px-4 py-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="text-slate-400 [&_svg]:size-4">{icon}</span>
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
