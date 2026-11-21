import { Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Input } from './ui/input';

export function SearchInput({ value, onChange, placeholder = 'ค้นหา...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onChange(v), 350);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="pl-8" />
    </div>
  );
}

export const FilterBar = ({ children }: { children: ReactNode }) => (
  <div className="mb-3 flex flex-wrap items-center gap-2 [&_select]:w-auto [&_select]:min-w-36">{children}</div>
);
