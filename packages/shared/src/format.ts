// Display helpers. DB stores Gregorian UTC; UI shows Thai Buddhist Era in Asia/Bangkok.
export const TZ = 'Asia/Bangkok';
const LOCALE = 'th-TH-u-ca-buddhist';

type DateIn = Date | string | number | null | undefined;
const toDate = (d: DateIn) => (d === null || d === undefined || d === '' ? null : new Date(d));

const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const monthFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, month: 'short', year: '2-digit' });

/** 21 พ.ย. 2569 */
export function formatDate(d: DateIn): string {
  const x = toDate(d);
  return x && !isNaN(x.getTime()) ? dateFmt.format(x) : '-';
}
/** 21 พ.ย. 2569 14:05 */
export function formatDateTime(d: DateIn): string {
  const x = toDate(d);
  return x && !isNaN(x.getTime()) ? dateTimeFmt.format(x).replace(' เวลา', '') : '-';
}
export function formatMonth(d: DateIn): string {
  const x = toDate(d);
  return x ? monthFmt.format(x) : '-';
}
/** Buddhist Era year for a date (Asia/Bangkok). */
export function beYear(d: Date = new Date()): number {
  const y = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric' }).format(d));
  return y + 543;
}
/** YYYY-MM-DD in Asia/Bangkok (for date-only fields / <input type=date>). */
export function toISODate(d: DateIn = new Date()): string {
  const x = toDate(d) ?? new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
}
/** Whole days from `from` (default today) until `d`. Negative = past. */
export function daysUntil(d: DateIn, from: Date = new Date()): number | null {
  const x = toDate(d);
  if (!x) return null;
  const a = Date.parse(toISODate(from));
  const b = Date.parse(toISODate(x));
  return Math.round((b - a) / 86_400_000);
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
export function formatNumber(v: unknown, digits = 0): string {
  const n = num(v);
  return n === null || isNaN(n)
    ? '-'
    : n.toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const formatMoney = (v: unknown) => formatNumber(v, 2);
export const formatKg = (v: unknown) => formatNumber(v, Number(v) % 1 === 0 ? 0 : 2);

/** Mask sensitive identifiers: AB1234567 -> AB*****67 */
export function maskId(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  if (v.length <= 4) return '*'.repeat(v.length);
  return v.slice(0, 2) + '*'.repeat(v.length - 4) + v.slice(-2);
}
