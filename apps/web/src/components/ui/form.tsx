import type { ReactNode } from 'react';
import type { FieldErrors } from 'react-hook-form';
import { cn } from '@/lib/utils';

export function Field({ label, error, hint, required, className, children }: {
  label: string; error?: string; hint?: ReactNode; required?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="block text-[13px] font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-bad">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const FormGrid = ({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={cn('grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2', cols === 3 && 'lg:grid-cols-3', cols === 4 && 'lg:grid-cols-4')}>
    {children}
  </div>
);

export const FormSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-3">
    <h3 className="border-b border-line pb-1.5 text-sm font-semibold text-navy-800">{title}</h3>
    {children}
  </section>
);

/** error message getter for nested RHF errors */
export const errOf = (errors: FieldErrors, name: string) =>
  (name.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], errors) as { message?: string } | undefined)?.message;
