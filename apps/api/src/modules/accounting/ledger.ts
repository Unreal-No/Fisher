// Double-entry core: fiscal periods, entry creation/posting/reversal. DB triggers enforce balance + immutability too.
import { beYear } from '@fisher/shared';
import { badRequest, conflict } from '../../lib/errors';
import { nextSeq, num } from '../../lib/http';
import type { DbOrTx, Tx } from '../../lib/prisma';

export const r2 = (v: number) => Math.round(v * 100) / 100;
export interface LineIn {
  accountId: string;
  debit?: number | null;
  credit?: number | null;
  description?: string | null;
  vesselId?: string | null;
  tripId?: string | null;
}
export interface SourceRef {
  type: string;
  id: string;
  event: string;
  ref?: string | null;
}

const ymd = (date: string) => date.split('-').map(Number) as [number, number, number];
const thaiPeriod = (y: number, m: number) => `${String(m).padStart(2, '0')}/${y + 543}`;

/** Fiscal periods are calendar months, created on first use. */
export async function ensurePeriod(db: DbOrTx, date: string) {
  const [y, m] = ymd(date);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return db.fiscalPeriod.upsert({
    where: { year_month: { year: y, month: m } },
    create: { year: y, month: m, startDate: new Date(Date.UTC(y, m - 1, 1)), endDate: new Date(Date.UTC(y, m - 1, last)) },
    update: {},
  });
}
export async function assertOpen(db: DbOrTx, date: string) {
  const p = await ensurePeriod(db, date);
  if (p.status === 'CLOSED') throw conflict('PERIOD_CLOSED', `งวดบัญชี ${thaiPeriod(p.year, p.month)} ปิดแล้ว — เปิดงวดก่อนหรือใช้วันที่ในงวดที่เปิดอยู่`);
  return p;
}

/** Validates accounts (postable, active) and dimensions; fills vessel from trip. Returns normalized non-zero lines. */
export async function normalizeLines(db: DbOrTx, lines: LineIn[]) {
  const out = lines
    .map((l) => ({ ...l, debit: r2(l.debit ?? 0), credit: r2(l.credit ?? 0) }))
    .filter((l) => l.debit > 0 || l.credit > 0);
  for (const l of out) if (l.debit > 0 && l.credit > 0) throw badRequest('แต่ละบรรทัดต้องมีเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง');
  const accounts = await db.account.findMany({ where: { id: { in: [...new Set(out.map((l) => l.accountId))] } } });
  for (const l of out) {
    const a = accounts.find((x) => x.id === l.accountId);
    if (!a) throw badRequest('ไม่พบบัญชีที่เลือก');
    if (!a.isPostable) throw badRequest(`บัญชี ${a.code} ${a.nameTh} เป็นบัญชีคุม บันทึกรายการไม่ได้`);
    if (!a.isActive) throw badRequest(`บัญชี ${a.code} ${a.nameTh} ปิดใช้งานแล้ว`);
  }
  const tripIds = [...new Set(out.map((l) => l.tripId).filter(Boolean))] as string[];
  if (tripIds.length) {
    const trips = await db.fishingTrip.findMany({ where: { id: { in: tripIds } }, select: { id: true, vesselId: true, tripNo: true } });
    for (const l of out) {
      if (!l.tripId) continue;
      const t = trips.find((x) => x.id === l.tripId);
      if (!t) throw badRequest('ไม่พบเที่ยวเรือที่ระบุ');
      if (l.vesselId && l.vesselId !== t.vesselId) throw badRequest(`เที่ยว ${t.tripNo} ไม่ใช่ของเรือที่ระบุ`);
      l.vesselId = t.vesselId;
    }
  }
  const dr = r2(out.reduce((s, l) => s + l.debit, 0));
  const cr = r2(out.reduce((s, l) => s + l.credit, 0));
  if (out.length < 2) throw badRequest('ต้องมีอย่างน้อย 2 บรรทัดที่มีจำนวนเงิน');
  if (dr !== cr || dr <= 0) throw badRequest(`เดบิต (${dr}) ต้องเท่ากับเครดิต (${cr})`);
  return { lines: out, total: dr };
}

const lineRows = (lines: Awaited<ReturnType<typeof normalizeLines>>['lines']) =>
  lines.map((l, i) => ({
    lineNo: i + 1, accountId: l.accountId, debit: l.debit, credit: l.credit,
    description: l.description ?? null, vesselId: l.vesselId ?? null, tripId: l.tripId ?? null,
  }));

/** Create an entry (always inserted as DRAFT; `postBy` posts it in the same transaction). */
export async function createEntry(
  tx: Tx,
  userId: string,
  e: { entryDate: string; memo: string; reference?: string | null; lines: LineIn[]; source?: SourceRef; reversalOfId?: string },
  postBy?: string,
) {
  const { lines, total } = await normalizeLines(tx, e.lines);
  if (postBy) await assertOpen(tx, e.entryDate);
  else await ensurePeriod(tx, e.entryDate);
  const be = beYear(new Date(`${e.entryDate}T12:00:00+07:00`));
  const entryNo = `JV-${be}-${String(await nextSeq(tx, 'JV', String(be))).padStart(5, '0')}`;
  const entry = await tx.journalEntry.create({
    data: {
      entryNo, entryDate: new Date(`${e.entryDate}T00:00:00.000Z`), memo: e.memo, reference: e.reference ?? null,
      sourceType: e.source?.type ?? null, sourceId: e.source?.id ?? null, sourceEvent: e.source?.event ?? null, sourceRef: e.source?.ref ?? null,
      totalDebit: total, totalCredit: total, reversalOfId: e.reversalOfId ?? null, createdById: userId,
      lines: { create: lineRows(lines) },
    },
  });
  if (!postBy) return entry;
  return tx.journalEntry.update({ where: { id: entry.id }, data: { status: 'POSTED', postedAt: new Date(), postedById: postBy } });
}

export async function replaceDraft(tx: Tx, id: string, e: { entryDate: string; memo: string; reference?: string | null; lines: LineIn[] }) {
  const { lines, total } = await normalizeLines(tx, e.lines);
  await ensurePeriod(tx, e.entryDate);
  await tx.journalLine.deleteMany({ where: { entryId: id } });
  return tx.journalEntry.update({
    where: { id },
    data: {
      entryDate: new Date(`${e.entryDate}T00:00:00.000Z`), memo: e.memo, reference: e.reference ?? null, totalDebit: total, totalCredit: total,
      lines: { create: lineRows(lines) },
    },
  });
}

export async function lockEntry(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM journal_entries WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.journalEntry.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
}

/** Mirror a posted entry (debit ↔ credit) on `entryDate`, post it, and mark the original REVERSED. */
export async function reverseEntry(tx: Tx, userId: string, origId: string, entryDate: string, reason: string, source?: SourceRef) {
  const orig = await lockEntry(tx, origId);
  if (!orig) throw badRequest('ไม่พบรายการบัญชี');
  if (orig.status !== 'POSTED') throw conflict('INVALID_STATUS', `กลับรายการได้เฉพาะรายการที่ผ่านรายการแล้ว (${orig.entryNo})`);
  const origDate = orig.entryDate.toISOString().slice(0, 10);
  if (entryDate < origDate) throw badRequest('วันที่กลับรายการต้องไม่ก่อนวันที่ของรายการเดิม');
  const rev = await createEntry(
    tx, userId,
    {
      entryDate, memo: `กลับรายการ ${orig.entryNo}: ${reason}`, reference: orig.reference, reversalOfId: orig.id,
      lines: orig.lines.map((l) => ({ accountId: l.accountId, debit: num(l.credit), credit: num(l.debit), description: l.description, vesselId: l.vesselId, tripId: l.tripId })),
      source,
    },
    userId,
  );
  await tx.journalEntry.update({ where: { id: orig.id }, data: { status: 'REVERSED', reversedAt: new Date(), reverseReason: reason } });
  return rev;
}
