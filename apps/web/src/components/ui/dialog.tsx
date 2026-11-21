import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Field } from './form';
import { Textarea } from './input';

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-navy-950/40" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-line bg-white shadow-xl',
            { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size],
          )}
        >
          <div className="flex items-start justify-between border-b border-line px-4 py-3">
            <div>
              <D.Title className="text-base font-semibold text-navy-900">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-muted hover:bg-slate-100" aria-label="ปิด">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation with optional required reason (cancel/void flows). */
export function ConfirmDialog({ open, onOpenChange, title, message, confirmText = 'ยืนยัน', danger, requireReason, onConfirm, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; message: ReactNode; confirmText?: string; danger?: boolean;
  requireReason?: boolean; onConfirm: (reason: string) => void; loading?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) setReason(''); onOpenChange(o); }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={requireReason && !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{message}</div>
        {requireReason && (
          <Field label="เหตุผล" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
