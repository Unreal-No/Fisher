import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from './button';

export const Spinner = ({ label = 'กำลังโหลด...' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
    <Loader2 className="size-4 animate-spin" /> {label}
  </div>
);
export const Empty = ({ title = 'ไม่มีข้อมูล', children }: { title?: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted">
    <Inbox className="size-8 text-slate-300" />
    <div className="font-medium text-slate-600">{title}</div>
    {children}
  </div>
);
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'เกิดข้อผิดพลาด';
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm">
      <AlertTriangle className="size-8 text-bad" />
      <div className="text-bad">{msg}</div>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>ลองใหม่</Button>}
    </div>
  );
}
/** Renders loading / error / content for a react-query result */
export function QueryView<T>({ q, children }: { q: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; children: (d: T) => ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data === undefined) return null;
  return <>{children(q.data)}</>;
}
