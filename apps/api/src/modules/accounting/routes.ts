import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ACCOUNT_MAP_KEY, accountMappingSchema, accountSchema, JOURNAL_SOURCE, JOURNAL_STATUS, journalReverseSchema, journalSchema, reasonSchema,
  toISODate, type JournalStatus,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { idParam, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { Prisma, prisma, type DbOrTx } from '../../lib/prisma';
import { collectPending, countBy, runAutoPost } from './autopost';
import { assertOpen, createEntry, ensurePeriod, lockEntry, normalizeLines, replaceDraft, reverseEntry } from './ledger';
import { balanceSheet, generalLedger, profitLoss, trialBalance } from './reports';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dq = (v: unknown, def: string) => (typeof v === 'string' && ISO.test(v) ? v : def);
const today = () => toISODate();
const yearStart = () => `${today().slice(0, 4)}-01-01`;
const endOfDayBkk = (d: string) => new Date(`${d}T23:59:59.999+07:00`);
const accSel = { select: { id: true, code: true, nameTh: true } } as const;

async function userNames(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

/** UI link to the document behind an automatic entry. */
async function sourceLink(db: DbOrTx, type: string | null, id: string | null): Promise<string | null> {
  if (!type || !id) return null;
  switch (type) {
    case 'SALES_INVOICE': return `/sales/invoices/${id}`;
    case 'SALES_PAYMENT': { const p = await db.salesPayment.findUnique({ where: { id }, select: { invoiceId: true } }); return p ? `/sales/invoices/${p.invoiceId}` : null; }
    case 'SALES_RETURN': { const r = await db.salesReturn.findUnique({ where: { id }, select: { invoiceId: true } }); return r ? `/sales/invoices/${r.invoiceId}` : null; }
    case 'GOODS_RECEIPT': { const g = await db.goodsReceipt.findUnique({ where: { id }, select: { poId: true } }); return g ? `/purchasing/orders/${g.poId}` : null; }
    case 'STOCK_MOVEMENT': return '/inventory';
    case 'FUEL_TXN': return '/fuel';
    case 'TRIP_FUEL': { const x = await db.tripFuel.findUnique({ where: { id }, select: { tripId: true } }); return x ? `/trips/${x.tripId}` : null; }
    case 'TRIP_SUPPLY': { const x = await db.tripSupply.findUnique({ where: { id }, select: { tripId: true } }); return x ? `/trips/${x.tripId}` : null; }
    case 'TRIP_EXPENSE': { const x = await db.tripExpense.findUnique({ where: { id }, select: { tripId: true } }); return x ? `/trips/${x.tripId}` : null; }
    case 'MAINTENANCE_ORDER': return `/maintenance/orders/${id}`;
    case 'PAYROLL_PERIOD': return `/payroll/periods/${id}`;
    case 'EMPLOYEE_ADVANCE': return '/payroll?tab=advances';
    default: return null;
  }
}

function periodBounds(req: FastifyRequest) {
  const { year, month } = req.params as { year: string; month: string };
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12) throw badRequest('งวดไม่ถูกต้อง');
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { y, m, start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

async function closeChecklist(start: string, end: string) {
  const [drafts, pending] = await Promise.all([
    prisma.journalEntry.findMany({ where: { status: 'DRAFT', entryDate: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) } }, select: { id: true, entryNo: true, memo: true } }),
    collectPending(prisma, endOfDayBkk(end)),
  ]);
  const pendingInPeriod = pending.filter((p) => p.date <= end);
  return { drafts, pending: pendingInPeriod.length, pendingByType: countBy(pendingInPeriod.map((p) => p.type)), ok: !drafts.length && !pendingInPeriod.length };
}

export default async function accountingRoutes(app: FastifyInstance) {
  // company-level data: vessel-scoped users have no access
  app.addHook('preHandler', async (req) => {
    if (scopeIds(req)) throw forbidden('ข้อมูลบัญชีเป็นข้อมูลระดับบริษัท ผู้ใช้ที่จำกัดเฉพาะเรือเข้าถึงไม่ได้');
  });

  // ---------- chart of accounts ----------
  app.get('/accounts', { preHandler: app.can('finance.view') }, async () => {
    const [accounts, used, maps] = await Promise.all([
      prisma.account.findMany({ orderBy: { code: 'asc' } }),
      prisma.journalLine.groupBy({ by: ['accountId'], _count: { _all: true } }),
      prisma.accountMapping.findMany(),
    ]);
    return accounts.map((a) => ({
      ...a,
      lineCount: used.find((u) => u.accountId === a.id)?._count._all ?? 0,
      mappedAs: maps.filter((m) => m.accountId === a.id).map((m) => m.key),
    }));
  });
  async function checkParent(parentId: string | null | undefined, type: string, selfId?: string) {
    if (!parentId) return;
    const p = await prisma.account.findUnique({ where: { id: parentId } });
    if (!p) throw badRequest('ไม่พบบัญชีคุม');
    if (p.type !== type) throw badRequest('บัญชีคุมต้องเป็นหมวดเดียวกัน');
    if (p.isPostable) throw badRequest('บัญชีคุมต้องเป็นบัญชีที่ไม่รับรายการ (header)');
    for (let cur: typeof p | null = p; cur; cur = cur.parentId ? await prisma.account.findUnique({ where: { id: cur.parentId } }) : null)
      if (cur.id === selfId) throw badRequest('เลือกบัญชีย่อยของตัวเองเป็นบัญชีคุมไม่ได้');
  }
  app.post('/accounts', { preHandler: app.can('finance.approve') }, async (req, reply) => {
    const b = parse(accountSchema, req.body);
    await checkParent(b.parentId, b.type);
    if (await prisma.account.findUnique({ where: { code: b.code } })) throw conflict('DUPLICATE', `รหัสบัญชี ${b.code} มีอยู่แล้ว`);
    const a = await prisma.$transaction(async (tx) => {
      const a = await tx.account.create({ data: { ...b, parentId: b.parentId ?? null } });
      await audit(tx, req, { action: 'CREATE', entityType: 'Account', entityId: a.id, after: a });
      return a;
    });
    return reply.status(201).send(a);
  });
  app.put('/accounts/:id', { preHandler: app.can('finance.approve') }, async (req) => {
    const id = idParam(req);
    const b = parse(accountSchema, req.body);
    const before = await prisma.account.findUnique({ where: { id } });
    if (!before) throw notFound('บัญชี');
    const used = await prisma.journalLine.count({ where: { accountId: id } });
    if (used && (b.type !== before.type || b.normalBalance !== before.normalBalance || b.code !== before.code))
      throw conflict('ACCOUNT_IN_USE', 'บัญชีมีรายการแล้ว เปลี่ยนรหัส/หมวด/ด้านปกติไม่ได้');
    if (used && before.isPostable && !b.isPostable) throw conflict('ACCOUNT_IN_USE', 'บัญชีมีรายการแล้ว เปลี่ยนเป็นบัญชีคุมไม่ได้');
    if (b.isPostable && (await prisma.account.count({ where: { parentId: id } }))) throw badRequest('บัญชีที่มีบัญชีย่อยต้องเป็นบัญชีคุม');
    if (!b.isActive && (await prisma.accountMapping.count({ where: { accountId: id } }))) throw conflict('ACCOUNT_MAPPED', 'บัญชีนี้ใช้ในการลงบัญชีอัตโนมัติ เปลี่ยนการตั้งค่าก่อนปิดใช้งาน');
    await checkParent(b.parentId, b.type, id);
    return prisma.$transaction(async (tx) => {
      const after = await tx.account.update({ where: { id }, data: { ...b, parentId: b.parentId ?? null } });
      await audit(tx, req, { action: 'UPDATE', entityType: 'Account', entityId: id, before, after });
      return after;
    });
  });

  // ---------- account mapping for automatic posting ----------
  app.get('/mappings', { preHandler: app.can('finance.view') }, async () => {
    const rows = await prisma.accountMapping.findMany({ include: { account: accSel } });
    return ACCOUNT_MAP_KEY.map((key) => ({ key, account: rows.find((r) => r.key === key)?.account ?? null }));
  });
  app.put('/mappings', { preHandler: app.can('finance.approve') }, async (req) => {
    const { mappings } = parse(accountMappingSchema, req.body);
    const ids = Object.values(mappings) as string[];
    const accs = await prisma.account.findMany({ where: { id: { in: ids } } });
    for (const [key, accountId] of Object.entries(mappings)) {
      const a = accs.find((x) => x.id === accountId);
      if (!a || !a.isPostable || !a.isActive) throw badRequest(`บัญชีของ ${key} ต้องเป็นบัญชีที่รับรายการและเปิดใช้งาน`);
    }
    return prisma.$transaction(async (tx) => {
      const before = await tx.accountMapping.findMany();
      for (const [key, accountId] of Object.entries(mappings))
        await tx.accountMapping.upsert({ where: { key }, create: { key, accountId: accountId!, updatedById: req.user!.id }, update: { accountId: accountId!, updatedById: req.user!.id } });
      await audit(tx, req, { action: 'UPDATE', entityType: 'AccountMapping', before: Object.fromEntries(before.map((m) => [m.key, m.accountId])), after: mappings });
      return { ok: true };
    });
  });

  // ---------- fiscal periods ----------
  app.get('/periods', { preHandler: app.can('finance.view') }, async (req) => {
    const y = Number((req.query as { year?: string }).year) || Number(today().slice(0, 4));
    const [rows, counts] = await Promise.all([
      prisma.fiscalPeriod.findMany({ where: { year: y } }),
      prisma.$queryRaw<{ m: number; status: string; n: bigint }[]>`
        SELECT EXTRACT(MONTH FROM entry_date)::int AS m, status, COUNT(*) AS n FROM journal_entries
        WHERE EXTRACT(YEAR FROM entry_date) = ${y} GROUP BY 1, 2`,
    ]);
    const names = await userNames(rows.map((r) => r.closedById));
    return Array.from({ length: 12 }, (_, i) => {
      const p = rows.find((r) => r.month === i + 1);
      const c = (s: string) => Number(counts.find((x) => x.m === i + 1 && x.status === s)?.n ?? 0);
      return {
        year: y, month: i + 1, status: p?.status ?? 'OPEN', closedAt: p?.closedAt ?? null, closedByName: names.get(p?.closedById ?? '') ?? null,
        reopenedAt: p?.reopenedAt ?? null, reopenReason: p?.reopenReason ?? null, drafts: c('DRAFT'), posted: c('POSTED') + c('REVERSED'),
      };
    });
  });
  app.get('/periods/:year/:month/checklist', { preHandler: app.can('finance.view') }, async (req) => {
    const { start, end } = periodBounds(req);
    return closeChecklist(start, end);
  });
  app.post('/periods/:year/:month/close', { preHandler: app.can('finance.approve') }, async (req) => {
    const { y, m, start, end } = periodBounds(req);
    const chk = await closeChecklist(start, end);
    if (!chk.ok)
      throw conflict('PERIOD_NOT_READY', `ปิดงวดไม่ได้: รายการร่าง ${chk.drafts.length} รายการ, เอกสารรอลงบัญชี ${chk.pending} รายการ`, chk);
    return prisma.$transaction(async (tx) => {
      const p = await ensurePeriod(tx, start);
      if (p.status === 'CLOSED') throw conflict('INVALID_STATUS', 'งวดนี้ปิดแล้ว');
      const after = await tx.fiscalPeriod.update({ where: { id: p.id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: req.user!.id } });
      await audit(tx, req, { action: 'CLOSE', entityType: 'FiscalPeriod', entityId: p.id, after: { year: y, month: m, status: 'CLOSED' } });
      return after;
    });
  });
  app.post('/periods/:year/:month/reopen', { preHandler: app.can('finance.approve') }, async (req) => {
    const { y, m, start } = periodBounds(req);
    const { reason } = parse(reasonSchema, req.body);
    return prisma.$transaction(async (tx) => {
      const p = await ensurePeriod(tx, start);
      if (p.status !== 'CLOSED') throw conflict('INVALID_STATUS', 'งวดนี้ยังไม่ปิด');
      const after = await tx.fiscalPeriod.update({ where: { id: p.id }, data: { status: 'OPEN', reopenedAt: new Date(), reopenReason: reason } });
      await audit(tx, req, { action: 'REOPEN', entityType: 'FiscalPeriod', entityId: p.id, after: { year: y, month: m, status: 'OPEN' }, note: reason });
      return after;
    });
  });

  // ---------- journal entries ----------
  app.get('/journals', { preHandler: app.can('finance.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const from = dq(f.from, '');
    const to = dq(f.to, '');
    const where: Prisma.JournalEntryWhereInput = {
      ...((JOURNAL_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as JournalStatus } : {}),
      ...(f.source === 'MANUAL' ? { sourceType: null } : (JOURNAL_SOURCE as readonly string[]).includes(f.source ?? '') ? { sourceType: f.source } : {}),
      ...(from || to ? { entryDate: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) } } : {}),
      ...(f.accountId ? { lines: { some: { accountId: f.accountId } } } : {}),
      ...(q.q ? { OR: [{ entryNo: { contains: q.q, mode: 'insensitive' } }, { memo: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { sourceRef: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.journalEntry.findMany({ where, orderBy: [{ entryDate: 'desc' }, { entryNo: 'desc' }], ...paging(q) }),
      prisma.journalEntry.count({ where }),
    ]);
    return paged(items, total, q);
  });
  app.get('/journals/:id', { preHandler: app.can('finance.view') }, async (req) => {
    const e = await prisma.journalEntry.findUnique({
      where: { id: idParam(req) },
      include: {
        lines: { orderBy: { lineNo: 'asc' }, include: { account: accSel, vessel: { select: { id: true, code: true, name: true } }, trip: { select: { id: true, tripNo: true } } } },
        reversalOf: { select: { id: true, entryNo: true } },
        reversedBy: { select: { id: true, entryNo: true } },
      },
    });
    if (!e) throw notFound('รายการบัญชี');
    const names = await userNames([e.createdById, e.postedById]);
    return { ...e, createdByName: names.get(e.createdById ?? '') ?? null, postedByName: names.get(e.postedById ?? '') ?? null, sourceLink: await sourceLink(prisma, e.sourceType, e.sourceId) };
  });
  app.post('/journals', { preHandler: app.can('finance.edit') }, async (req, reply) => {
    const b = parse(journalSchema, req.body);
    const e = await prisma.$transaction(async (tx) => {
      const e = await createEntry(tx, req.user!.id, { entryDate: b.entryDate, memo: b.memo, reference: b.reference, lines: b.lines });
      await audit(tx, req, { action: 'CREATE', entityType: 'JournalEntry', entityId: e.id, after: { ...e, lines: b.lines } });
      return e;
    });
    return reply.status(201).send(e);
  });
  app.put('/journals/:id', { preHandler: app.can('finance.edit') }, async (req) => {
    const id = idParam(req);
    const b = parse(journalSchema, req.body);
    return prisma.$transaction(async (tx) => {
      const before = await lockEntry(tx, id);
      if (!before) throw notFound('รายการบัญชี');
      if (before.status !== 'DRAFT' || before.sourceType) throw conflict('INVALID_STATUS', 'แก้ไขได้เฉพาะรายการร่างที่บันทึกเอง');
      const after = await replaceDraft(tx, id, b);
      await audit(tx, req, { action: 'UPDATE', entityType: 'JournalEntry', entityId: id, before, after: { ...after, lines: b.lines } });
      return after;
    });
  });
  app.post('/journals/:id/post', { preHandler: app.can('finance.approve') }, async (req) => {
    const id = idParam(req);
    return prisma.$transaction(async (tx) => {
      const e = await lockEntry(tx, id);
      if (!e) throw notFound('รายการบัญชี');
      if (e.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'ผ่านรายการได้เฉพาะรายการร่าง');
      if (e.createdById === req.user!.id) throw forbidden('ผู้บันทึกผ่านรายการของตัวเองไม่ได้ (แบ่งแยกหน้าที่)');
      const date = e.entryDate.toISOString().slice(0, 10);
      await assertOpen(tx, date);
      // accounts may have been deactivated since the draft was saved
      await normalizeLines(tx, e.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit), vesselId: l.vesselId, tripId: l.tripId })));
      const after = await tx.journalEntry.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedById: req.user!.id } });
      await audit(tx, req, { action: 'POST', entityType: 'JournalEntry', entityId: id, before: { status: e.status }, after: { status: after.status } });
      return after;
    });
  });
  app.post('/journals/:id/void', { preHandler: app.can('finance.edit') }, async (req) => {
    const id = idParam(req);
    const { reason } = parse(reasonSchema, req.body);
    return prisma.$transaction(async (tx) => {
      const e = await lockEntry(tx, id);
      if (!e) throw notFound('รายการบัญชี');
      if (e.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'ยกเลิกได้เฉพาะรายการร่าง (รายการที่ผ่านแล้วให้กลับรายการ)');
      const after = await tx.journalEntry.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
      await audit(tx, req, { action: 'VOID', entityType: 'JournalEntry', entityId: id, before: { status: e.status }, after: { status: after.status }, note: reason });
      return after;
    });
  });
  app.post('/journals/:id/reverse', { preHandler: app.can('finance.approve') }, async (req, reply) => {
    const id = idParam(req);
    const b = parse(journalReverseSchema, req.body);
    const e = await prisma.journalEntry.findUnique({ where: { id } });
    if (!e) throw notFound('รายการบัญชี');
    if (e.sourceType) throw conflict('AUTO_ENTRY', 'รายการนี้มาจากเอกสารต้นทาง — ให้ยกเลิกที่เอกสาร แล้วระบบจะกลับรายการให้');
    const rev = await prisma.$transaction(async (tx) => {
      const rev = await reverseEntry(tx, req.user!.id, id, b.entryDate, b.reason);
      await audit(tx, req, { action: 'REVERSE', entityType: 'JournalEntry', entityId: id, after: { reversal: rev.entryNo }, note: b.reason });
      return rev;
    });
    return reply.status(201).send(rev);
  });

  // ---------- automatic posting ----------
  app.get('/auto-post/pending', { preHandler: app.can('finance.view') }, async (req) => {
    const to = dq((req.query as { to?: string }).to, today());
    const all = await collectPending(prisma, endOfDayBkk(to));
    return {
      to, total: all.length, byType: countBy(all.map((d) => d.type)),
      items: all.slice(0, 300).map((d) => ({ type: d.type, id: d.id, event: d.event, date: d.date, ref: d.ref, memo: d.memo, amount: d.amount, reversal: !!d.reverses })),
    };
  });
  app.post('/auto-post', { preHandler: app.can('finance.approve') }, async (req) => {
    const to = dq((req.body as { to?: string } | undefined)?.to, today());
    return runAutoPost(req, endOfDayBkk(to));
  });

  // ---------- reports ----------
  app.get('/reports/trial-balance', { preHandler: app.can('finance.view') }, async (req) => {
    const f = req.query as Record<string, string | undefined>;
    return trialBalance(dq(f.from, yearStart()), dq(f.to, today()));
  });
  app.get('/reports/profit-loss', { preHandler: app.can('finance.view') }, async (req) => {
    const f = req.query as Record<string, string | undefined>;
    return profitLoss(dq(f.from, yearStart()), dq(f.to, today()), f.vesselId || undefined);
  });
  app.get('/reports/balance-sheet', { preHandler: app.can('finance.view') }, async (req) => {
    const f = req.query as Record<string, string | undefined>;
    return balanceSheet(dq(f.asOf, today()));
  });
  app.get('/reports/general-ledger', { preHandler: app.can('finance.view') }, async (req) => {
    const f = req.query as Record<string, string | undefined>;
    if (!f.accountId) throw badRequest('ต้องระบุบัญชี');
    if (!(await prisma.account.findUnique({ where: { id: f.accountId } }))) throw notFound('บัญชี');
    return generalLedger(f.accountId, dq(f.from, yearStart()), dq(f.to, today()), f.vesselId || undefined);
  });
}
