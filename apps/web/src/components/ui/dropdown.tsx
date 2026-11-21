import * as M from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Dropdown({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={4} className="z-50 min-w-44 rounded-md border border-line bg-white p-1 shadow-lg">
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
export const DropdownItem = ({ children, onSelect, danger }: { children: ReactNode; onSelect?: () => void; danger?: boolean }) => (
  <M.Item
    onSelect={onSelect}
    className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 [&_svg]:size-4', danger && 'text-bad')}
  >
    {children}
  </M.Item>
);
export const DropdownLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2 py-1 text-xs text-muted">{children}</M.Label>;
export const DropdownSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
