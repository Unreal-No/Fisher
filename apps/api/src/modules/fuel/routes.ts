import type { FastifyInstance } from 'fastify';
import { FUEL_TXN_TYPE, fuelAdjustSchema, fuelIssueSchema, fuelReceiptSchema, fuelTankSchema, type FuelTxnType } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { idParam, num, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { adjust, fuelReport, issue, receive } from './service';

const range = (f: { from?: string; to?: string }) => ({
  from: f.from ? new Date(`${f.from}T00:00:00+07:00`) : new Date(Date.now() - 90 * 86400_000),
  to: f.to ? new Date(`${f.to}T23:59:59.999+07:00`) : new Date(),
});

const between = (f: { from?: string; to?: string }) => {
  const r = range(f);
  return { gte: r.from, lte: r.to };
};

export default async function fuelRoutes(app: FastifyInstance) {
  // ---------- tanks ----------
  app.get('/tanks', { preHandler: app.can('fuel.view') }, async () => prisma.fuelTank.findMany({ orderBy: { code: 'asc' } }));
  app.post('/tanks', { preHandler: app.can('fuel.edit') }, async (req, reply) => {
    const b = parse(fuelTankSchema, req.body);
    const t = await prisma.fuelTank.create({ data: b });
    await audit(prisma, req, { action: 'CREATE', entityType: 'FuelTank', entityId: t.id, after: t });
    return reply.status(201).send(t);
  });
  app.patch('/tanks/:id', { preHandler: app.can('fuel.edit') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.fuelTank.findUnique({ where: { id } });
    if (!before) throw notFound('ถังน้ำมัน');
    // balance/avg cost are ledger-derived and cannot be edited here
    const after = await prisma.fuelTank.update({ where: { id }, data: parse(fuelTankSchema.partial(), req.body) });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'FuelTank', entityId: id, before, after });
    return after;
  });

  // ---------- ledger ----------
  app.get('/transactions', { preHandler: app.can('fuel.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const scope = scopeIds(req);
    const where: Prisma.FuelTransactionWhereInput = {
      ...(f.tankId ? { tankId: f.tankId } : {}),
      ...(f.vesselId ? { vesselId: f.vesselId } : {}),
      ...((FUEL_TXN_TYPE as readonly string[]).includes(f.type ?? '') ? { type: f.type as FuelTxnType } : {}),
      ...(f.from || f.to ? { txnDate: between(f) } : {}),
      ...(scope ? { OR: [{ vesselId: { in: scope } }, { vesselId: null }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.fuelTransaction.findMany({
        where, orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }], ...paging(q),
        include: { tank: { select: { code: true, name: true } }, vessel: { select: { code: true, name: true } }, tripFuel: { select: { trip: { select: { id: true, tripNo: true } } } } },
      }),
      prisma.fuelTransaction.count({ where }),
    ]);
    return paged(items, total, q);
  });
  app.post('/receipts', { preHandler: app.can('fuel.edit') }, async (req, reply) => reply.status(201).send(await receive(req, parse(fuelReceiptSchema, req.body))));
  app.post('/issues', { preHandler: app.can('fuel.edit') }, async (req, reply) => reply.status(201).send(await issue(req, parse(fuelIssueSchema, req.body))));
  app.post('/adjustments', { preHandler: app.can('fuel.edit') }, async (req, reply) => reply.status(201).send(await adjust(req, parse(fuelAdjustSchema, req.body))));

  // ---------- fuel loaded onto vessels (all trips) ----------
  app.get('/entries', { preHandler: app.can('fuel.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const scope = scopeIds(req);
    const where: Prisma.TripFuelWhereInput = {
      trip: { ...(f.vesselId ? { vesselId: f.vesselId } : {}), ...(scope ? { vesselId: { in: scope } } : {}) },
      ...(f.from || f.to ? { recordedAt: between(f) } : {}),
    };
    const [items, total, sum] = await Promise.all([
      prisma.tripFuel.findMany({
        where, orderBy: { recordedAt: 'desc' }, ...paging(q),
        include: { trip: { select: { id: true, tripNo: true, vessel: { select: { code: true, name: true } } } }, fuelTxn: { select: { txnNo: true } } },
      }),
      prisma.tripFuel.count({ where }),
      prisma.tripFuel.aggregate({ where, _sum: { liters: true, totalCost: true } }),
    ]);
    return { ...paged(items, total, q), totalLiters: num(sum._sum.liters), totalCost: num(sum._sum.totalCost) };
  });

  // ---------- reports ----------
  app.get('/report', { preHandler: app.can('fuel.view') }, async (req) => {
    const f = req.query as { from?: string; to?: string; vesselId?: string };
    const scope = scopeIds(req);
    const ids = f.vesselId ? (scope && !scope.includes(f.vesselId) ? [] : [f.vesselId]) : scope;
    const r = range(f);
    const [report, monthly] = await Promise.all([
      fuelReport(r.from, r.to, ids),
      prisma.$queryRaw<{ month: Date; liters: string; cost: string }[]>`
        SELECT date_trunc('month', tf.recorded_at AT TIME ZONE 'Asia/Bangkok')::date AS month, SUM(tf.liters) AS liters, SUM(COALESCE(tf.total_cost, 0)) AS cost
        FROM trip_fuel tf JOIN fishing_trips t ON t.id = tf.trip_id
        WHERE tf.recorded_at >= ${new Date(r.to.getTime() - 365 * 86400_000)} AND tf.recorded_at <= ${r.to}
          ${ids ? Prisma.sql`AND t.vessel_id = ANY(${ids}::uuid[])` : Prisma.empty}
        GROUP BY 1 ORDER BY 1`,
    ]);
    return { ...report, monthly: monthly.map((m) => ({ month: m.month.toISOString().slice(0, 7), liters: num(m.liters), cost: num(m.cost) })) };
  });
}
