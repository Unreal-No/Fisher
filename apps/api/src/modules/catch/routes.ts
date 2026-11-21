// Catch & species. Catch weight is caught weight (never auto-treated as sold).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CATCH_EDITABLE_STATUSES, catchCreateSchema, catchLossSchema, catchUpdateSchema, reasonSchema, speciesSchema,
} from '@fisher/shared';
import { audit, diff } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { d, dt, idParam, num, paged, paging, parse, parseList, scopeIds, vesselWhere } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { assertLotsAvailable, lockLots } from '../sales/lots';
import { assertStatus, getTrip } from '../trips/service';

const include = {
  species: { select: { id: true, code: true, nameTh: true, category: true } },
  grade: { select: { id: true, code: true, nameTh: true } },
  trip: { select: { id: true, tripNo: true, status: true } },
  vessel: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CatchRecordInclude;

function filters(req: FastifyRequest): Prisma.CatchRecordWhereInput {
  const f = req.query as Record<string, string | undefined>;
  return {
    ...vesselWhere(req),
    ...(f.tripId ? { tripId: f.tripId } : {}),
    ...(f.vesselId ? { vesselId: f.vesselId } : {}),
    ...(f.speciesId ? { speciesId: f.speciesId } : {}),
    ...(f.includeVoided === 'true' ? {} : { voidedAt: null }),
    ...(f.from || f.to ? { catchDate: { ...(f.from ? { gte: d(f.from) } : {}), ...(f.to ? { lte: d(f.to) } : {}) } } : {}),
  };
}

async function checkRefs(speciesId?: string, gradeId?: string | null) {
  if (speciesId) {
    const s = await prisma.fishSpecies.findFirst({ where: { id: speciesId, deletedAt: null, isActive: true } });
    if (!s) throw badRequest('ไม่พบชนิดสัตว์น้ำ หรือถูกปิดใช้งาน');
  }
  if (gradeId) {
    const g = await prisma.catchGrade.findFirst({ where: { id: gradeId, isActive: true } });
    if (!g) throw badRequest('ไม่พบเกรด');
  }
}

export default async function catchRoutes(app: FastifyInstance) {
  // ---------- species & grades ----------
  app.get('/species', async (req) => {
    const f = req.query as { active?: string; q?: string };
    return prisma.fishSpecies.findMany({
      where: {
        deletedAt: null,
        ...(f.active === 'true' ? { isActive: true } : {}),
        ...(f.q ? { OR: [{ nameTh: { contains: f.q } }, { nameEn: { contains: f.q, mode: 'insensitive' } }, { code: { contains: f.q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { nameTh: 'asc' }],
    });
  });
  app.post('/species', { preHandler: app.can('species.manage') }, async (req, reply) => {
    const b = parse(speciesSchema, req.body);
    const s = await prisma.fishSpecies.create({ data: b });
    await audit(prisma, req, { action: 'CREATE', entityType: 'FishSpecies', entityId: s.id, after: s });
    return reply.status(201).send(s);
  });
  app.patch('/species/:id', { preHandler: app.can('species.manage') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.fishSpecies.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('ชนิดสัตว์น้ำ');
    const after = await prisma.fishSpecies.update({ where: { id }, data: parse(speciesSchema.partial(), req.body) });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'FishSpecies', entityId: id, before, after });
    return after;
  });
  app.delete('/species/:id', { preHandler: app.can('species.manage') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.fishSpecies.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('ชนิดสัตว์น้ำ');
    const used = await prisma.catchRecord.count({ where: { speciesId: id } });
    // referenced species are deactivated, not removed (traceability)
    await prisma.fishSpecies.update({
      where: { id },
      data: used ? { isActive: false } : { deletedAt: new Date(), code: `${before.code}#${Date.now()}` },
    });
    await audit(prisma, req, { action: used ? 'DEACTIVATE' : 'DELETE', entityType: 'FishSpecies', entityId: id, before });
    return { ok: true, deactivated: !!used };
  });
  app.get('/grades', async () => prisma.catchGrade.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }));

  // ---------- catch records ----------
  app.get('/records', { preHandler: app.can('catch.view') }, async (req) => {
    const q = parseList(req);
    const where = filters(req);
    const sortable = ['catchDate', 'weightKg', 'createdAt'];
    const orderBy = [{ [sortable.includes(q.sort ?? '') ? q.sort! : 'catchDate']: q.order }, { createdAt: 'desc' as const }];
    const [items, total, sum] = await Promise.all([
      prisma.catchRecord.findMany({ where, include, orderBy, ...paging(q) }),
      prisma.catchRecord.count({ where }),
      prisma.catchRecord.aggregate({ where, _sum: { weightKg: true, basketCount: true } }),
    ]);
    return { ...paged(items, total, q), totalKg: num(sum._sum.weightKg), totalBaskets: num(sum._sum.basketCount) };
  });

  app.get('/records/:id', { preHandler: app.can('catch.view') }, async (req) => {
    const r = await prisma.catchRecord.findUnique({
      where: { id: idParam(req) },
      include: { ...include, adjustments: { orderBy: { adjustedAt: 'desc' } }, losses: true },
    });
    if (!r) throw notFound('รายการสัตว์น้ำ');
    await getTrip(req, r.tripId);
    return r;
  });

  /** Idempotent by clientRequestId (offline queue retries return the original record). */
  app.post('/records', { preHandler: app.can('catch.create') }, async (req, reply) => {
    const b = parse(catchCreateSchema, req.body);
    if (b.clientRequestId) {
      const dup = await prisma.catchRecord.findUnique({ where: { clientRequestId: b.clientRequestId }, include });
      if (dup) return reply.status(200).send({ ...dup, duplicate: true });
    }
    const trip = await getTrip(req, b.tripId);
    assertStatus(trip, CATCH_EDITABLE_STATUSES, 'บันทึกสัตว์น้ำ (ต้องออกเรือแล้วและยังไม่ปิดเที่ยว)');
    await checkRefs(b.speciesId, b.gradeId);
    try {
      const rec = await prisma.$transaction(async (tx) => {
        const r = await tx.catchRecord.create({
          data: { ...b, catchDate: d(b.catchDate), vesselId: trip.vesselId, createdById: req.user!.id },
          include,
        });
        await audit(tx, req, { action: 'CREATE', entityType: 'CatchRecord', entityId: r.id, after: r, note: trip.id });
        return r;
      });
      return reply.status(201).send(rec);
    } catch (e) {
      if (b.clientRequestId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const dup = await prisma.catchRecord.findUniqueOrThrow({ where: { clientRequestId: b.clientRequestId }, include });
        return reply.status(200).send({ ...dup, duplicate: true });
      }
      throw e;
    }
  });

  /** Adjustments require a reason and keep a full change history. Optimistic locking via version. */
  app.patch('/records/:id', { preHandler: app.can('catch.edit') }, async (req) => {
    const id = idParam(req);
    const { version, reason, ...b } = parse(catchUpdateSchema, req.body);
    const before = await prisma.catchRecord.findUnique({ where: { id } });
    if (!before || before.voidedAt) throw notFound('รายการสัตว์น้ำ');
    const trip = await getTrip(req, before.tripId);
    assertStatus(trip, CATCH_EDITABLE_STATUSES, 'แก้ไขรายการสัตว์น้ำ');
    if (before.version !== version) throw conflict('STALE_DATA', 'รายการถูกแก้ไขโดยผู้ใช้อื่น กรุณาโหลดใหม่');
    await checkRefs(b.speciesId, b.gradeId);
    const data = { ...b, catchDate: d(b.catchDate) };
    const changes = diff(before as never, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
    if (!Object.keys(changes).length) throw badRequest('ไม่มีข้อมูลที่เปลี่ยนแปลง');
    const lotKeys = [{ tripId: before.tripId, speciesId: before.speciesId }, ...(b.speciesId ? [{ tripId: before.tripId, speciesId: b.speciesId }] : [])];
    return prisma.$transaction(async (tx) => {
      await lockLots(tx, lotKeys);
      const after = await tx.catchRecord.update({ where: { id, version }, data: { ...data, version: { increment: 1 } }, include });
      await assertLotsAvailable(tx, lotKeys); // cannot reduce below what has been sold
      await tx.catchAdjustment.create({ data: { catchRecordId: id, changes: changes as never, reason, adjustedById: req.user!.id } });
      await audit(tx, req, { action: 'ADJUST', entityType: 'CatchRecord', entityId: id, before: changes, note: reason });
      return after;
    });
  });

  app.post('/records/:id/void', { preHandler: app.can('catch.delete') }, async (req) => {
    const id = idParam(req);
    const { reason } = parse(reasonSchema, req.body);
    const before = await prisma.catchRecord.findUnique({ where: { id } });
    if (!before || before.voidedAt) throw notFound('รายการสัตว์น้ำ');
    const trip = await getTrip(req, before.tripId);
    assertStatus(trip, CATCH_EDITABLE_STATUSES, 'ยกเลิกรายการสัตว์น้ำ');
    await prisma.$transaction(async (tx) => {
      await lockLots(tx, [{ tripId: before.tripId, speciesId: before.speciesId }]);
      await tx.catchRecord.update({
        where: { id }, data: { voidedAt: new Date(), voidReason: reason, voidedById: req.user!.id, version: { increment: 1 } },
      });
      await assertLotsAvailable(tx, [{ tripId: before.tripId, speciesId: before.speciesId }]);
      await tx.catchAdjustment.create({ data: { catchRecordId: id, changes: { voided: { from: false, to: true } }, reason, adjustedById: req.user!.id } });
      await audit(tx, req, { action: 'VOID', entityType: 'CatchRecord', entityId: id, before, note: reason });
    });
    return { ok: true };
  });

  // ---------- losses / spoilage ----------
  app.get('/losses', { preHandler: app.can('catch.view') }, async (req) => {
    const f = req.query as { tripId?: string };
    const scope = scopeIds(req);
    return prisma.catchLoss.findMany({
      where: { ...(f.tripId ? { tripId: f.tripId } : {}), ...(scope ? { trip: { vesselId: { in: scope } } } : {}) },
      include: { species: { select: { nameTh: true } }, trip: { select: { tripNo: true } } },
      orderBy: { recordedAt: 'desc' },
      take: 500,
    });
  });
  app.post('/losses', { preHandler: app.can('catch.create') }, async (req, reply) => {
    const b = parse(catchLossSchema, req.body);
    const trip = await getTrip(req, b.tripId);
    assertStatus(trip, CATCH_EDITABLE_STATUSES, 'บันทึกการสูญเสีย');
    await checkRefs(b.speciesId);
    if (b.catchRecordId) {
      const r = await prisma.catchRecord.findFirst({ where: { id: b.catchRecordId, tripId: b.tripId, voidedAt: null } });
      if (!r) throw badRequest('รายการสัตว์น้ำอ้างอิงไม่ถูกต้อง');
    }
    const loss = await prisma.$transaction(async (tx) => {
      await lockLots(tx, [{ tripId: b.tripId, speciesId: b.speciesId }]);
      const l = await tx.catchLoss.create({ data: { ...b, recordedAt: dt(b.recordedAt), createdById: req.user!.id } });
      await assertLotsAvailable(tx, [{ tripId: b.tripId, speciesId: b.speciesId }]);
      await audit(tx, req, { action: 'CREATE', entityType: 'CatchLoss', entityId: l.id, after: l, note: b.tripId });
      return l;
    });
    return reply.status(201).send(loss);
  });

  // ---------- summary report ----------
  app.get('/summary', { preHandler: app.can('catch.view') }, async (req) => {
    const f = req.query as { groupBy?: string };
    const where = filters(req);
    const groupBy = (['species', 'vessel', 'trip', 'month'].includes(f.groupBy ?? '') ? f.groupBy : 'species') as string;
    if (groupBy === 'month') {
      const q = req.query as Record<string, string | undefined>;
      const scope = scopeIds(req);
      const rows = await prisma.$queryRaw<{ month: Date; kg: string; n: bigint }[]>`
        SELECT date_trunc('month', catch_date)::date AS month, SUM(weight_kg) AS kg, COUNT(*) AS n
        FROM catch_records
        WHERE voided_at IS NULL
          ${q.from ? Prisma.sql`AND catch_date >= ${d(q.from)}` : Prisma.empty}
          ${q.to ? Prisma.sql`AND catch_date <= ${d(q.to)}` : Prisma.empty}
          ${q.vesselId ? Prisma.sql`AND vessel_id = ${q.vesselId}::uuid` : Prisma.empty}
          ${q.speciesId ? Prisma.sql`AND species_id = ${q.speciesId}::uuid` : Prisma.empty}
          ${scope ? Prisma.sql`AND vessel_id = ANY(${scope}::uuid[])` : Prisma.empty}
        GROUP BY 1 ORDER BY 1`;
      return rows.map((r) => ({ key: r.month.toISOString().slice(0, 7), label: r.month.toISOString().slice(0, 7), weightKg: num(r.kg), count: Number(r.n) }));
    }
    const field = ({ species: 'speciesId', vessel: 'vesselId', trip: 'tripId' } as const)[groupBy as 'species']!;
    const rows = await prisma.catchRecord.groupBy({ by: [field], where, _sum: { weightKg: true, basketCount: true }, _count: true });
    const ids = rows.map((r) => r[field] as string);
    const labels: Record<string, string> =
      groupBy === 'species'
        ? Object.fromEntries((await prisma.fishSpecies.findMany({ where: { id: { in: ids } } })).map((s) => [s.id, s.nameTh]))
        : groupBy === 'vessel'
          ? Object.fromEntries((await prisma.vessel.findMany({ where: { id: { in: ids } } })).map((v) => [v.id, v.name]))
          : Object.fromEntries((await prisma.fishingTrip.findMany({ where: { id: { in: ids } } })).map((t) => [t.id, t.tripNo]));
    return rows
      .map((r) => ({ key: r[field] as string, label: labels[r[field] as string] ?? '-', weightKg: num(r._sum.weightKg), baskets: num(r._sum.basketCount), count: r._count }))
      .sort((a, b) => b.weightKg - a.weightKg);
  });
}
