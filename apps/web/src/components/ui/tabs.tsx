import * as T from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export function Tabs({ tabs, value, onValueChange, defaultValue }: {
  tabs: { value: string; label: ReactNode; content: ReactNode; hidden?: boolean }[];
  value?: string; onValueChange?: (v: string) => void; defaultValue?: string;
}) {
  const visible = tabs.filter((t) => !t.hidden);
  return (
    <T.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue ?? visible[0]?.value}>
      <T.List className="-mb-px flex overflow-x-auto border-b border-line">
        {visible.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="whitespace-nowrap border-b-2 border-transparent px-3.5 py-2 text-sm text-muted hover:text-ink data-[state=active]:border-navy-800 data-[state=active]:font-semibold data-[state=active]:text-navy-900"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {visible.map((t) => (
        <T.Content key={t.value} value={t.value} className="pt-4">
          {t.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
