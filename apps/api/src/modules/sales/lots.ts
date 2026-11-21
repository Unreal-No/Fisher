// Fish lots = trip × species × grade (virtual). Availability = caught − sold, also capped at species level by losses.
// Every change that can reduce availability (sale confirm, catch edit/void, loss) takes a transaction-scoped
// advisory lock per trip×species and re-checks, so lots can never be oversold.
import { conflict } from '../../lib/errors';
import { num } from '../../lib/http';
import type { DbOrTx, Tx } from '../../lib/prisma';

export interface LotKey {
  tripId: string;
  speciesId: string;
}
export const lotNo = (tripNo: string, speciesCode: string, gradeCode?: string | null) => `${tripNo}/${speciesCode}/${gradeCode ?? '-'}`;

export async function lockLots(tx: Tx, keys: LotKey[]) {
  const uniq = [...new Set(keys.map((k) => `${k.tripId}:${k.speciesId}`))].sort();
  for (const k of uniq) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'lot:' + k}))`;
}

export interface LotRow {
  tripId: string;
  speciesId: string;
  gradeId: string | null;
  caughtKg: number;
  soldKg: number;
  /** min(lot caught − lot sold, species caught − species losses − species sold) */
  availableKg: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const gk = (t: string, s: string, g: string | null) => `${t}|${s}|${g ?? ''}`;

export async function lotRows(db: DbOrTx, where: { tripIds?: string[]; speciesId?: string }): Promise<LotRow[]> {
  const f = { ...(where.tripIds ? { tripId: { in: where.tripIds } } : {}), ...(where.speciesId ? { speciesId: where.speciesId } : {}) };
  const [caught, sold, losses] = await Promise.all([
    db.catchRecord.groupBy({ by: ['tripId', 'speciesId', 'gradeId'], where: { ...f, voidedAt: null }, _sum: { weightKg: true } }),
    db.salesItem.groupBy({ by: ['tripId', 'speciesId', 'gradeId'], where: { ...f, invoice: { status: 'CONFIRMED' } }, _sum: { weightKg: true } }),
    db.catchLoss.groupBy({ by: ['tripId', 'speciesId'], where: f, _sum: { weightKg: true } }),
  ]);
  const map = new Map<string, LotRow>();
  const get = (t: string, s: string, g: string | null) => {
    const k = gk(t, s, g);
    if (!map.has(k)) map.set(k, { tripId: t, speciesId: s, gradeId: g, caughtKg: 0, soldKg: 0, availableKg: 0 });
    return map.get(k)!;
  };
  for (const c of caught) get(c.tripId, c.speciesId, c.gradeId).caughtKg += num(c._sum.weightKg);
  for (const s of sold) get(s.tripId, s.speciesId, s.gradeId).soldKg += num(s._sum.weightKg);
  const speciesAvail = new Map<string, number>();
  for (const r of map.values()) {
    const k = `${r.tripId}|${r.speciesId}`;
    speciesAvail.set(k, (speciesAvail.get(k) ?? 0) + r.caughtKg - r.soldKg);
  }
  for (const l of losses) {
    const k = `${l.tripId}|${l.speciesId}`;
    speciesAvail.set(k, (speciesAvail.get(k) ?? 0) - num(l._sum.weightKg));
  }
  return [...map.values()].map((r) => ({
    ...r,
    caughtKg: r3(r.caughtKg),
    soldKg: r3(r.soldKg),
    availableKg: r3(Math.min(r.caughtKg - r.soldKg, speciesAvail.get(`${r.tripId}|${r.speciesId}`) ?? 0)),
  }));
}

/** Throws 409 LOT_OVERSOLD if any lot of the given trip×species pairs went negative (call after the change, inside the tx). */
export async function assertLotsAvailable(tx: Tx, keys: LotKey[]) {
  if (!keys.length) return;
  const tripIds = [...new Set(keys.map((k) => k.tripId))];
  const species = new Set(keys.map((k) => `${k.tripId}|${k.speciesId}`));
  const bad = (await lotRows(tx, { tripIds })).filter((r) => species.has(`${r.tripId}|${r.speciesId}`) && r.availableKg < -0.0005);
  if (bad.length)
    throw conflict('LOT_OVERSOLD', 'น้ำหนักที่ขาย/สูญเสียเกินกว่าน้ำหนักที่จับได้ของล็อต', bad.map((b) => ({ ...b, shortKg: -b.availableKg })));
}
