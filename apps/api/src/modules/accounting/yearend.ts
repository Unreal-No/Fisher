// Year-end close: revenue/expense balances of the year are closed to retained earnings with an entry dated 31 Dec,
// then every month of the year is closed. Reopening reverses that entry and reopens December only.
import type { FastifyRequest } from 'fastify';
import { audit } from '../../lib/audit';
import { AppError, conflict } from '../../lib/errors';
import { num } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { depreciationOwed } from './assets';
import { collectPending, loadMapping } from './autopost';
import { createEntry, ensurePeriod, r2, reverseEntry, type LineIn } from './ledger';

const NOT_YE = Prisma.sql`(e.source_type IS NULL OR e.source_type <> 'YEAR_END')`;

export async function yearChecklist(year: number) {
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const end = new Date(`${year}-12-31T00:00:00Z`);
  const [drafts, pending, owed, fy, prevOpen, dec] = await Promise.all([
    prisma.journalEntry.count({ where: { status: 'DRAFT', entryDate: { gte: start, lte: end } } }),
    collectPending(prisma, new Date(`${year}-12-31T23:59:59.999+07:00`)),
    depreciationOwed(prisma, year),
    prisma.fiscalYear.findUnique({ where: { year } }),
    // earlier years with ledger activity that are not closed yet
    prisma.$queryRaw<{ y: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM e.entry_date)::int AS y FROM journal_entries e
      WHERE e.status IN ('POSTED', 'REVERSED') AND EXTRACT(YEAR FROM e.entry_date) < ${year}
        AND NOT EXISTS (SELECT 1 FROM fiscal_years f WHERE f.year = EXTRACT(YEAR FROM e.entry_date)::int AND f.status = 'CLOSED')
      ORDER BY 1`,
    prisma.fiscalPeriod.findUnique({ where: { year_month: { year, month: 12 } } }),
  ]);
  const pendingInYear = pending.filter((p) => p.date <= `${year}-12-31`).length;
  return {
    year, status: fy?.status ?? 'OPEN', closedAt: fy?.closedAt ?? null, closingEntryId: fy?.closingEntryId ?? null,
    drafts, pending: pendingInYear, depreciationOwed: r2(owed), openEarlierYears: prevOpen.map((p) => p.y), decemberClosed: dec?.status === 'CLOSED',
    ok: !drafts && !pendingInYear && owed <= 0 && !prevOpen.length && dec?.status !== 'CLOSED',
  };
}

export async function closeYear(req: FastifyRequest, year: number) {
  const chk = await yearChecklist(year);
  if (chk.status === 'CLOSED') throw conflict('INVALID_STATUS', `ปี ${year + 543} ปิดบัญชีแล้ว`);
  if (!chk.ok) {
    const why = [
      chk.drafts && `รายการร่าง ${chk.drafts}`, chk.pending && `เอกสารรอลงบัญชี ${chk.pending}`, chk.depreciationOwed > 0 && `ค่าเสื่อมยังไม่ครบ ${chk.depreciationOwed} บาท`,
      chk.openEarlierYears.length && `ปีก่อนยังไม่ปิด (${chk.openEarlierYears.map((y) => y + 543).join(', ')})`, chk.decemberClosed && 'งวดธันวาคมปิดอยู่ (เปิดก่อนเพื่อลงรายการปิดบัญชี)',
    ].filter(Boolean);
    throw conflict('YEAR_NOT_READY', `ปิดบัญชีสิ้นปีไม่ได้: ${why.join(', ')}`, chk);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fisher-year-end'))`;
    const fy = await tx.fiscalYear.upsert({ where: { year }, create: { year }, update: {} });
    if (fy.status === 'CLOSED') throw conflict('INVALID_STATUS', 'ปีนี้ปิดบัญชีแล้ว');
    const bals = await tx.$queryRaw<{ account_id: string; bal: string }[]>`
      SELECT l.account_id, SUM(l.debit - l.credit) AS bal
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE e.status IN ('POSTED', 'REVERSED') AND ${NOT_YE} AND a.type IN ('REVENUE', 'EXPENSE')
        AND e.entry_date BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date
      GROUP BY l.account_id HAVING SUM(l.debit - l.credit) <> 0`;
    let entryId: string | null = null;
    let net = 0;
    if (bals.length) {
      const re = (await loadMapping(tx)).get('RETAINED_EARNINGS');
      if (!re) throw new AppError(422, 'MAPPING_MISSING', 'ยังไม่ได้กำหนดบัญชีกำไร (ขาดทุน) สะสม');
      net = r2(bals.reduce((s, b) => s + num(b.bal), 0)); // debit-positive: > 0 means loss
      const lines: LineIn[] = bals.map((b) => (num(b.bal) > 0 ? { accountId: b.account_id, credit: num(b.bal) } : { accountId: b.account_id, debit: -num(b.bal) }));
      if (net !== 0) lines.push(net > 0 ? { accountId: re, debit: net, description: 'ขาดทุนสุทธิประจำปี' } : { accountId: re, credit: -net, description: 'กำไรสุทธิประจำปี' });
      const n = await tx.journalEntry.count({ where: { sourceType: 'YEAR_END', sourceId: fy.id } });
      const e = await createEntry(
        tx, req.user!.id,
        { entryDate: `${year}-12-31`, memo: `ปิดบัญชีรายได้-ค่าใช้จ่ายประจำปี ${year + 543} เข้ากำไร (ขาดทุน) สะสม`, reference: `YE-${year}`, lines, source: { type: 'YEAR_END', id: fy.id, event: `CLOSE-${n + 1}`, ref: `YE-${year}` } },
        req.user!.id,
      );
      entryId = e.id;
    }
    for (let m = 1; m <= 12; m++) {
      const p = await ensurePeriod(tx, `${year}-${String(m).padStart(2, '0')}-01`);
      if (p.status !== 'CLOSED') await tx.fiscalPeriod.update({ where: { id: p.id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: req.user!.id } });
    }
    const after = await tx.fiscalYear.update({ where: { id: fy.id }, data: { status: 'CLOSED', closingEntryId: entryId, closedAt: new Date(), closedById: req.user!.id } });
    await audit(tx, req, { action: 'CLOSE', entityType: 'FiscalYear', entityId: fy.id, after: { year, netProfit: -net, closingEntryId: entryId } });
    return { ...after, netProfit: r2(-net) };
  });
}

export async function reopenYear(req: FastifyRequest, year: number, reason: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fisher-year-end'))`;
    const fy = await tx.fiscalYear.findUnique({ where: { year } });
    if (!fy || fy.status !== 'CLOSED') throw conflict('INVALID_STATUS', 'ปีนี้ยังไม่ได้ปิดบัญชี');
    const later = await tx.fiscalYear.findFirst({ where: { year: { gt: year }, status: 'CLOSED' } });
    if (later) throw conflict('LATER_YEAR_CLOSED', `ต้องเปิดปี ${later.year + 543} ก่อน`);
    const dec = await ensurePeriod(tx, `${year}-12-01`);
    await tx.fiscalPeriod.update({ where: { id: dec.id }, data: { status: 'OPEN', reopenedAt: new Date(), reopenReason: reason } });
    if (fy.closingEntryId) {
      const n = await tx.journalEntry.count({ where: { sourceType: 'YEAR_END', sourceId: fy.id } });
      await reverseEntry(tx, req.user!.id, fy.closingEntryId, `${year}-12-31`, `เปิดปีบัญชี ${year + 543}: ${reason}`, { type: 'YEAR_END', id: fy.id, event: `REOPEN-${n}`, ref: `YE-${year}` });
    }
    const after = await tx.fiscalYear.update({ where: { id: fy.id }, data: { status: 'OPEN', closingEntryId: null, reopenedAt: new Date(), reopenReason: reason } });
    await audit(tx, req, { action: 'REOPEN', entityType: 'FiscalYear', entityId: fy.id, after: { year, status: 'OPEN' }, note: reason });
    return after;
  });
}
