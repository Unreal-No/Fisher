// Bank reconciliation: tick posted ledger lines of the bank's GL account that appear on the statement.
// Cleared balance (all lines ever cleared up to the statement date) must equal the statement balance to complete.
import type { FastifyRequest } from 'fastify';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { num } from '../../lib/http';
import { prisma, type DbOrTx, type Tx } from '../../lib/prisma';
import { r2 } from './ledger';

const POSTED = ['POSTED', 'REVERSED'] as const;

export async function recDetail(db: DbOrTx, id: string) {
  const rec = await db.bankReconciliation.findUnique({ where: { id }, include: { bankAccount: { include: { glAccount: { select: { id: true, code: true, nameTh: true } } } }, items: { select: { journalLineId: true } } } });
  if (!rec) throw notFound('การกระทบยอด');
  const gl = rec.bankAccount.glAccountId;
  const asOf = rec.statementDate;
  const mine = new Set(rec.items.map((i) => i.journalLineId));
  // candidates: posted lines up to the statement date not cleared by another reconciliation
  const lines = await db.journalLine.findMany({
    where: { accountId: gl, entry: { status: { in: [...POSTED] }, entryDate: { lte: asOf } }, OR: [{ recItem: null }, { recItem: { reconciliationId: id } }] },
    include: { entry: { select: { id: true, entryNo: true, entryDate: true, memo: true, sourceRef: true } } },
    orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { entryNo: 'asc' } }, { lineNo: 'asc' }],
  });
  const [book, clearedBefore] = await Promise.all([
    db.journalLine.aggregate({ where: { accountId: gl, entry: { status: { in: [...POSTED] }, entryDate: { lte: asOf } } }, _sum: { debit: true, credit: true } }),
    db.journalLine.aggregate({ where: { accountId: gl, recItem: { reconciliation: { status: 'COMPLETED', id: { not: id } } } }, _sum: { debit: true, credit: true } }),
  ]);
  const items = lines.map((l) => ({
    journalLineId: l.id, entryId: l.entry.id, entryNo: l.entry.entryNo, entryDate: l.entry.entryDate.toISOString().slice(0, 10), memo: l.entry.memo,
    sourceRef: l.entry.sourceRef, description: l.description, debit: num(l.debit), credit: num(l.credit), cleared: mine.has(l.id),
  }));
  const bookBalance = r2(num(book._sum.debit) - num(book._sum.credit));
  const clearedBalance = r2(num(clearedBefore._sum.debit) - num(clearedBefore._sum.credit) + items.filter((i) => i.cleared).reduce((s, i) => s + i.debit - i.credit, 0));
  return { ...rec, items, bookBalance, clearedBalance, difference: r2(num(rec.statementBalance) - clearedBalance), unclearedTotal: r2(bookBalance - clearedBalance) };
}

async function lockRec(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM bank_reconciliations WHERE id = ${id}::uuid FOR UPDATE`;
  const r = await tx.bankReconciliation.findUnique({ where: { id }, include: { bankAccount: true } });
  if (!r) throw notFound('การกระทบยอด');
  if (r.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'การกระทบยอดนี้เสร็จแล้ว แก้ไขไม่ได้');
  return r;
}

export async function setRecItems(req: FastifyRequest, id: string, lineIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const r = await lockRec(tx, id);
    const unique = [...new Set(lineIds)];
    const lines = await tx.journalLine.findMany({ where: { id: { in: unique } }, include: { entry: { select: { status: true, entryDate: true } }, recItem: true } });
    if (lines.length !== unique.length) throw badRequest('ไม่พบบางรายการ');
    for (const l of lines) {
      if (l.accountId !== r.bankAccount.glAccountId) throw badRequest('รายการไม่ใช่ของบัญชีธนาคารนี้');
      if (!(POSTED as readonly string[]).includes(l.entry.status) || l.entry.entryDate > r.statementDate) throw badRequest('เลือกได้เฉพาะรายการที่ผ่านแล้วและไม่เกินวันที่ใน statement');
      if (l.recItem && l.recItem.reconciliationId !== id) throw conflict('ALREADY_CLEARED', 'มีรายการที่กระทบยอดในรอบอื่นแล้ว');
    }
    await tx.bankRecItem.deleteMany({ where: { reconciliationId: id } });
    if (unique.length) await tx.bankRecItem.createMany({ data: unique.map((journalLineId) => ({ reconciliationId: id, journalLineId })) });
    await audit(tx, req, { action: 'UPDATE', entityType: 'BankReconciliation', entityId: id, after: { cleared: unique.length } });
    return recDetail(tx, id);
  });
}

export async function completeRec(req: FastifyRequest, id: string) {
  return prisma.$transaction(async (tx) => {
    await lockRec(tx, id);
    const det = await recDetail(tx, id);
    if (det.difference !== 0) throw conflict('NOT_RECONCILED', `ยอดยังต่างจาก statement ${det.difference} บาท`, { difference: det.difference });
    const after = await tx.bankReconciliation.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: req.user!.id } });
    await audit(tx, req, { action: 'COMPLETE', entityType: 'BankReconciliation', entityId: id, after: { statementBalance: after.statementBalance, cleared: det.items.filter((i) => i.cleared).length } });
    return after;
  });
}

export async function deleteDraftRec(req: FastifyRequest, id: string) {
  return prisma.$transaction(async (tx) => {
    const r = await lockRec(tx, id);
    await tx.bankReconciliation.delete({ where: { id } });
    await audit(tx, req, { action: 'DELETE', entityType: 'BankReconciliation', entityId: id, before: r });
    return { ok: true };
  });
}
