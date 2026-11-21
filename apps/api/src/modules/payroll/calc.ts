// Pure payroll helpers (no DB) — unit-testable.
import { toISODate } from '@fisher/shared';

export interface RuleLite {
  id: string;
  name: string;
  method: 'MONTHLY' | 'DAILY' | 'PER_TRIP' | 'REVENUE_SHARE' | 'CATCH_BASED';
  vesselId: string | null;
  position: string | null;
  employeeId: string | null;
  rate: number;
  basis: 'GROSS_REVENUE' | 'NET_PROFIT' | 'CAUGHT_KG' | 'SOLD_KG' | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Most specific active rule for a method: employee (8) > vessel (4) > position (2) > global (0); ties → latest effectiveFrom. */
export function pickRule(rules: RuleLite[], method: RuleLite['method'], emp: { id: string; position: string }, vesselId: string | null, at: Date) {
  const day = toISODate(at);
  let best: { r: RuleLite; score: number } | null = null;
  for (const r of rules) {
    if (r.method !== method) continue;
    if (toISODate(r.effectiveFrom) > day || (r.effectiveTo && toISODate(r.effectiveTo) < day)) continue;
    if (r.employeeId && r.employeeId !== emp.id) continue;
    if (r.vesselId && r.vesselId !== vesselId) continue;
    if (r.position && r.position !== emp.position) continue;
    const score = (r.employeeId ? 8 : 0) + (r.vesselId ? 4 : 0) + (r.position ? 2 : 0);
    if (!best || score > best.score || (score === best.score && r.effectiveFrom > best.r.effectiveFrom)) best = { r, score };
  }
  return best?.r ?? null;
}

const DAY = 86400_000;
/** Inclusive whole days between two Bangkok calendar dates (YYYY-MM-DD). */
export const dayCount = (from: string, to: string) => (to < from ? 0 : Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1);
const maxS = (a: string, b: string) => (a > b ? a : b);
const minS = (a: string, b: string) => (a < b ? a : b);

/** Inclusive overlap in days of [a0,a1] and [b0,b1] (YYYY-MM-DD strings). */
export const overlapDays = (a0: string, a1: string, b0: string, b1: string) => dayCount(maxS(a0, b0), minS(a1, b1));

/**
 * Monthly salary prorated per calendar month: rate × employed days in that month ∩ period / days in month.
 * A full calendar month pays exactly `rate`.
 */
export function monthlyAmount(rate: number, periodStart: string, periodEnd: string, employedFrom: string, employedTo: string | null) {
  const from = maxS(periodStart, employedFrom);
  const to = minS(periodEnd, employedTo ?? periodEnd);
  if (to < from) return { amount: 0, parts: [] as { month: string; days: number; daysInMonth: number }[] };
  const parts: { month: string; days: number; daysInMonth: number }[] = [];
  let cursor = from;
  let amount = 0;
  while (cursor <= to) {
    const [y, m] = cursor.split('-').map(Number) as [number, number];
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${cursor.slice(0, 7)}-${String(daysInMonth).padStart(2, '0')}`;
    const segEnd = minS(monthEnd, to);
    const days = dayCount(cursor, segEnd);
    parts.push({ month: cursor.slice(0, 7), days, daysInMonth });
    amount += (rate * days) / daysInMonth;
    cursor = new Date(Date.parse(segEnd) + DAY).toISOString().slice(0, 10);
  }
  return { amount: Math.round(amount * 100) / 100, parts };
}

export interface DeductionPlan {
  advanceId: string;
  kind: 'ADVANCE' | 'LOAN';
  outstanding: number;
  installment: number | null;
}
/** Advances/loans recovered oldest-first without making net negative. */
export function planRecoveries(available: number, debts: DeductionPlan[]) {
  let left = Math.max(0, available);
  const out: { advanceId: string; kind: 'ADVANCE' | 'LOAN'; amount: number; limited: boolean }[] = [];
  for (const d of debts) {
    const due = d.kind === 'LOAN' ? Math.min(d.installment ?? d.outstanding, d.outstanding) : d.outstanding;
    const amt = Math.round(Math.min(due, left) * 100) / 100;
    if (amt > 0) out.push({ advanceId: d.advanceId, kind: d.kind, amount: amt, limited: amt < due });
    else if (due > 0) out.push({ advanceId: d.advanceId, kind: d.kind, amount: 0, limited: true });
    left = Math.round((left - amt) * 100) / 100;
  }
  return out;
}
