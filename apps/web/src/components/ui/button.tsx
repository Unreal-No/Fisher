import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-navy-800 text-white hover:bg-navy-700',
        accent: 'bg-accent text-white hover:bg-blue-700',
        outline: 'border border-line bg-white text-ink hover:bg-slate-50',
        ghost: 'text-ink hover:bg-slate-100',
        danger: 'bg-bad text-white hover:bg-red-800',
        'danger-outline': 'border border-red-200 bg-white text-bad hover:bg-bad-soft',
        link: 'text-accent underline-offset-2 hover:underline px-0 h-auto',
      },
      size: { sm: 'h-8 px-2.5 text-sm', md: 'h-9 px-3.5 text-sm', icon: 'size-8' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({ className, variant, size, asChild, loading, children, disabled, type = 'button', ...p }: ButtonProps) {
  const C = asChild ? Slot : 'button';
  return (
    <C className={cn(button({ variant, size }), className)} disabled={disabled || loading} {...(!asChild ? { type } : {})} {...p}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </C>
  );
}
