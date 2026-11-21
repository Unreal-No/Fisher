// Document-status rules shared by employees, crew check, dashboard and notifications.
import { daysUntil } from '@fisher/shared';

export type DocState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';
export const EXPIRING_DAYS = 30;

export function docState(expiry: Date | null, at: Date = new Date(), warnDays = EXPIRING_DAYS): DocState {
  if (!expiry) return 'NO_EXPIRY';
  const days = daysUntil(expiry, at)!;
  if (days < 0) return 'EXPIRED';
  return days <= warnDays ? 'EXPIRING' : 'VALID';
}

export const appliesTo = (appliesTo: string, nationality: string) =>
  appliesTo === 'ALL' || (appliesTo === 'THAI' ? nationality === 'TH' : nationality !== 'TH');

interface DocLite {
  documentTypeId: string;
  expiryDate: Date | null;
  status: string;
}
interface TypeLite {
  id: string;
  code: string;
  nameTh: string;
  appliesTo: string;
  isRequired: boolean;
  requiresExpiry: boolean;
  isActive: boolean;
}

/** Checklist of required documents for one employee. */
export function checklist(nationality: string, docs: DocLite[], types: TypeLite[], at = new Date()) {
  return types
    .filter((t) => t.isActive && t.isRequired && appliesTo(t.appliesTo, nationality))
    .map((t) => {
      const current = docs
        .filter((x) => x.documentTypeId === t.id && x.status === 'ACTIVE')
        .sort((a, b) => (b.expiryDate?.getTime() ?? Infinity) - (a.expiryDate?.getTime() ?? Infinity))[0];
      const state: DocState | 'MISSING' = !current ? 'MISSING' : t.requiresExpiry ? docState(current.expiryDate, at) : 'NO_EXPIRY';
      return { documentTypeId: t.id, code: t.code, nameTh: t.nameTh, state, expiryDate: current?.expiryDate ?? null };
    });
}

/** Worst state for list badges. */
export function worstState(items: { state: string }[]): 'OK' | 'EXPIRING' | 'EXPIRED' | 'MISSING' {
  if (items.some((i) => i.state === 'EXPIRED')) return 'EXPIRED';
  if (items.some((i) => i.state === 'MISSING')) return 'MISSING';
  if (items.some((i) => i.state === 'EXPIRING')) return 'EXPIRING';
  return 'OK';
}
