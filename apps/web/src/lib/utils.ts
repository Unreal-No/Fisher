import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
/** ISO -> value for <input type="datetime-local"> in local time */
export function toLocalInput(iso?: string | Date | null) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** datetime-local value -> ISO (UTC) */
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : v);
export const dateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
export const personName = (p?: { firstName: string; lastName: string; nickname?: string | null } | null) =>
  p ? `${p.firstName} ${p.lastName}${p.nickname ? ` (${p.nickname})` : ''}` : '-';
