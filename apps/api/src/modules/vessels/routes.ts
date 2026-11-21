import type { FastifyInstance } from 'fastify';
import { ACTIVE_TRIP_STATUSES, VESSEL_STATUS, vesselDocSchema, vesselSchema, type VesselStatus } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { assertVesselScope, d, idParam, nextSeq, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { prisma, type Prisma } from '../../lib/prisma';

const listInclude = {
  captain: { select: { id: true, code: true, firstName: true, lastName: true } },
  trips: { where: { status: { in: ACTIVE_TRIP_STATUSES } }, select: { id: true, tripNo: true, status: true }, take: 1 },
  _count: { select: { crewEmployees: { where: { deletedAt: null, status: 'ACTIVE' as const } } } },
} satisfies Prisma.VesselInclude;

function toData(b: ReturnType<typeof vesselSchema.parse>) {
  const { licenseExpiry, registrationExpiry, ...rest } = b;
  return { ...rest, licenseExpiry: d(licenseExpiry), registrationExpiry: d(registrationExpiry) };
}

async function getVessel(req: Parameters<typeof assertVesselScope>[0], id: string) {
  assertVesselScope(req, id);
  const v = await prisma.vessel.findFirst({ where: { id, deletedAt: null } });
  if (!v) throw notFound('เรือ');
  return v;
}

export default async function vesselRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.can('vessel.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as { status?: string; all?: string };
    const scope = scopeIds(req);
    const where: Prisma.VesselWhereInput = {
      deletedAt: null,
      ...(scope ? { id: { in: scope } } : {}),
      ...((VESSEL_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as VesselStatus } : {}),
      ...(q.q
        ? { OR: ['name', 'code', 'registrationNo'].map((k) => ({ [k]: { contains: q.q, mode: 'insensitive' } })) }
        : {}),
    };
    const sortable = ['code', 'name', 'status', 'licenseExpiry', 'createdAt'];
    const orderBy = { [sortable.includes(q.sort ?? '') ? q.sort! : 'code']: q.sort ? q.order : 'asc' };
    const pg = f.all === 'true' ? { take: 500 } : paging(q);
    const [items, total] = await Promise.all([
      prisma.vessel.findMany({ where, include: listInclude, orderBy, ...pg }),
      prisma.vessel.count({ where }),
    ]);
    return paged(
      items.map(({ trips, _count, ...v }) => ({ ...v, activeTrip: trips[0] ?? null, crewCount: _count.crewEmployees })),
      total,
      q,
    );
  });

  app.get('/:id', { preHandler: app.can('vessel.view') }, async (req) => {
    const id = idParam(req);
    await getVessel(req, id);
    const [v, stats, catchAgg, fuelAgg] = await Promise.all([
      prisma.vessel.findUniqueOrThrow({
        where: { id },
        include: {
          ...listInclude,
          documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
          crewEmployees: {
            where: { deletedAt: null },
            select: { id: true, code: true, firstName: true, lastName: true, position: true, status: true, nationality: true },
            orderBy: { code: 'asc' },
          },
          gpsDevices: { select: { id: true, source: true, identifier: true, name: true, isActive: true, lastSeenAt: true } },
        },
      }),
      prisma.fishingTrip.groupBy({ by: ['status'], where: { vesselId: id }, _count: true }),
      prisma.catchRecord.aggregate({ where: { vesselId: id, voidedAt: null }, _sum: { weightKg: true } }),
      prisma.tripFuel.aggregate({ where: { trip: { vesselId: id } }, _sum: { liters: true, totalCost: true } }),
    ]);
    const { trips, _count, ...rest } = v;
    return {
      ...rest,
      activeTrip: trips[0] ?? null,
      crewCount: _count.crewEmployees,
      stats: {
        tripsByStatus: Object.fromEntries(stats.map((s) => [s.status, s._count])),
        totalCatchKg: catchAgg._sum.weightKg ?? 0,
        fuelLiters: fuelAgg._sum.liters ?? 0,
        fuelCost: fuelAgg._sum.totalCost ?? 0,
      },
    };
  });

  app.get('/:id/trips', { preHandler: app.can('trip.view') }, async (req) => {
    const id = idParam(req);
    await getVessel(req, id);
    const q = parseList(req);
    const where = { vesselId: id };
    const [items, total] = await Promise.all([
      prisma.fishingTrip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: { id: true, tripNo: true, status: true, departedAt: true, arrivedAt: true, captain: { select: { firstName: true, lastName: true } } },
        ...paging(q),
      }),
      prisma.fishingTrip.count({ where }),
    ]);
    return paged(items, total, q);
  });

  app.get('/:id/history', { preHandler: app.can('vessel.view') }, async (req) => {
    const id = idParam(req);
    await getVessel(req, id);
    return prisma.auditLog.findMany({ where: { entityType: { in: ['Vessel', 'VesselDocument'] }, OR: [{ entityId: id }, { note: id }] }, orderBy: { at: 'desc' }, take: 100 });
  });

  app.post('/', { preHandler: app.can('vessel.create') }, async (req, reply) => {
    const b = parse(vesselSchema, req.body);
    const v = await prisma.$transaction(async (tx) => {
      const code = b.code || `V-${String(await nextSeq(tx, 'VESSEL', 'ALL')).padStart(3, '0')}`;
      const created = await tx.vessel.create({ data: { ...toData(b), code, createdById: req.user!.id } });
      await audit(tx, req, { action: 'CREATE', entityType: 'Vessel', entityId: created.id, after: created });
      return created;
    });
    return reply.status(201).send(v);
  });

  app.patch('/:id', { preHandler: app.can('vessel.edit') }, async (req) => {
    const id = idParam(req);
    const before = await getVessel(req, id);
    const b = parse(vesselSchema.partial(), req.body);
    if (b.status && b.status !== before.status) {
      const active = await prisma.fishingTrip.findFirst({ where: { vesselId: id, status: { in: ['DEPARTED', 'AT_SEA', 'RETURNING'] } } });
      if (active && b.status !== 'AT_SEA')
        throw conflict('VESSEL_AT_SEA', `เรืออยู่ระหว่างเที่ยว ${active.tripNo} ไม่สามารถเปลี่ยนสถานะได้`);
    }
    return prisma.$transaction(async (tx) => {
      const after = await tx.vessel.update({ where: { id }, data: { ...toData(b as never), code: b.code || undefined } });
      await audit(tx, req, { action: 'UPDATE', entityType: 'Vessel', entityId: id, before, after });
      return after;
    });
  });

  app.delete('/:id', { preHandler: app.can('vessel.delete') }, async (req) => {
    const id = idParam(req);
    const before = await getVessel(req, id);
    const trips = await prisma.fishingTrip.count({ where: { vesselId: id, status: { notIn: ['CLOSED', 'CANCELLED'] } } });
    if (trips) throw conflict('VESSEL_HAS_OPEN_TRIPS', 'เรือยังมีเที่ยวที่ยังไม่ปิด ไม่สามารถลบได้');
    await prisma.$transaction(async (tx) => {
      // keep history: soft delete + free unique codes for reuse
      await tx.vessel.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'INACTIVE', registrationNo: `${before.registrationNo}#deleted-${Date.now()}`, mmsi: null },
      });
      await audit(tx, req, { action: 'DELETE', entityType: 'Vessel', entityId: id, before });
    });
    return { ok: true };
  });

  // ---------- vessel documents ----------
  app.post('/:id/documents', { preHandler: app.can('vessel.edit') }, async (req, reply) => {
    const id = idParam(req);
    await getVessel(req, id);
    const b = parse(vesselDocSchema, req.body);
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.vesselDocument.create({
        data: { ...b, vesselId: id, issueDate: d(b.issueDate), expiryDate: d(b.expiryDate), createdById: req.user!.id },
      });
      await audit(tx, req, { action: 'CREATE', entityType: 'VesselDocument', entityId: created.id, after: created, note: id });
      return created;
    });
    return reply.status(201).send(doc);
  });

  app.delete('/:id/documents/:docId', { preHandler: app.can('vessel.edit') }, async (req) => {
    const { id, docId } = req.params as { id: string; docId: string };
    await getVessel(req, id);
    const doc = await prisma.vesselDocument.findFirst({ where: { id: docId, vesselId: id, deletedAt: null } });
    if (!doc) throw notFound('เอกสาร');
    await prisma.$transaction(async (tx) => {
      await tx.vesselDocument.update({ where: { id: docId }, data: { deletedAt: new Date() } });
      await audit(tx, req, { action: 'DELETE', entityType: 'VesselDocument', entityId: docId, before: doc, note: id });
    });
    return { ok: true };
  });
}
