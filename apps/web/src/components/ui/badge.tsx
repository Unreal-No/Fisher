import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-slate-50 text-slate-700 ring-slate-200',
      info: 'bg-accent-soft text-blue-800 ring-blue-200',
      ok: 'bg-ok-soft text-ok ring-green-200',
      warn: 'bg-warn-soft text-warn ring-amber-200',
      bad: 'bg-bad-soft text-bad ring-red-200',
      navy: 'bg-navy-800 text-white ring-navy-800',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export type Tone = NonNullable<VariantProps<typeof badge>['tone']>;
export const Badge = ({ tone, className, children }: { tone?: Tone; className?: string; children: ReactNode }) => (
  <span className={cn(badge({ tone }), className)}>{children}</span>
);
