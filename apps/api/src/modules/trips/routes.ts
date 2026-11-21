import type { FastifyInstance } from 'fastify';
import {
  arriveSchema, departSchema, noteSchema, reasonSchema, TRIP_STATUS, tripCreateSchema, tripCrewSchema, tripExpenseSchema,
  tripFuelSchema, tripIncidentSchema, tripStatusSchema, tripSupplySchema, tripUpdateSchema, type TripStatus,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { d, dt, idParam, paged, paging, parse, parseList, vesselWhere } from '../../lib/http';
import { prisma, type Prisma } from '../../lib/prisma';
import {
  arrive, assertStatus, cancelTrip, closeTrip, createTrip, crewCheck, depart, getTrip, setCrew, settlement, transition, updatePlan,
} from './service';

const OPEN: TripStatus[] = ['DRAFT', 'PREPARING', 'DEPARTED', 'AT_SEA', 'RETURNING', 'ARRIVED', 'PENDING_SETTLEMENT'];
const AFTER_DEPARTURE: TripStatus[] = ['DEPARTED', 'AT_SEA', 'RETURNING', 'ARRIVED', 'PENDING_SETTLEMENT'];
const person = { select: { id: true, code: true, firstName: true, lastName: true, nickname: true } };
const r2 = (v: number) => Math.round(v * 100) / 100;

export default async function tripRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.can('trip.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const statuses = (f.status ?? '').split(',').filter((s) => (TRIP_STATUS as readonly string[]).includes(s)) as TripStatus[];
    const where: Prisma.FishingTripWhereInput = {
      ...vesselWhere(req),
      ...(f.vesselId ? { vesselId: f.vesselId } : {}),
      ...(statuses.length ? { status: { in: statuses } } : f.open === 'true' ? { status: { in: OPEN } } : {}),
      ...(f.from || f.to
        ? { createdAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00+07:00`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999+07:00`) } : {}) } }
        : {}),
      ...(q.q ? { OR: [{ tripNo: { contains: q.q, mode: 'insensitive' } }, { vessel: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const sortable = ['tripNo', 'departedAt', 'arrivedAt', 'status', 'createdAt'];
    const orderBy = { [sortable.includes(q.sort ?? '') ? q.sort! : 'createdAt']: q.order };
    const [rows, total] = await Promise.all([
      prisma.fishingTrip.findMany({
        where, orderBy, ...paging(q),
        include: { vessel: { select: { id: true, code: true, name: true } }, captain: person, _count: { select: { crew: true } } },
      }),
      prisma.fishingTrip.count({ where }),
    ]);
    const sums = await prisma.catchRecord.groupBy({
      by: ['tripId'], where: { tripId: { in: rows.map((r) => r.id) }, voidedAt: null }, _sum: { weightKg: true },
    });
    const items = rows.map(({ _count, ...t }) => ({
      ...t, crewCount: _count.crew, catchKg: Number(sums.find((s) => s.tripId === t.id)?._sum.weightKg ?? 0),
    }));
    return paged(items, total, q);
  });

  app.get('/:id', { preHandler: app.can('trip.view') }, async (req) => {
    const id = idParam(req);
    await getTrip(req, id);
    const t = await prisma.fishingTrip.findUniqueOrThrow({
      where: { id },
      include: {
        vessel: { select: { id: true, code: true, name: true, fuelTankCapacityL: true, homePort: true, status: true, licenseExpiry: true } },
        captain: person,
        crew: { include: { employee: { select: { ...person.select, nationality: true, position: true, status: true } } }, orderBy: { createdAt: 'asc' } },
        fuel: { orderBy: { recordedAt: 'asc' } },
        supplies: { orderBy: { createdAt: 'asc' } },
        expenses: { orderBy: { expenseDate: 'asc' } },
        incidents: { orderBy: { occurredAt: 'asc' } },
        statusHistory: { orderBy: { changedAt: 'asc' } },
      },
    });
    return t;
  });

  app.post('/', { preHandler: app.can('trip.create') }, async (req, reply) =>
    reply.status(201).send(await createTrip(req, parse(tripCreateSchema, req.body))),
  );
  app.patch('/:id', { preHandler: app.can('trip.edit') }, async (req) => updatePlan(req, idParam(req), parse(tripUpdateSchema, req.body)));
  app.post('/:id/status', { preHandler: app.can('trip.edit') }, async (req) => {
    const b = parse(tripStatusSchema, req.body);
    return transition(req, idParam(req), b.status, b.note);
  });
  app.put('/:id/crew', { preHandler: app.can('trip.edit') }, async (req) => setCrew(req, idParam(req), parse(tripCrewSchema, req.body).members));
  app.get('/:id/crew-check', { preHandler: app.can('trip.view') }, async (req) => {
    const id = idParam(req);
    await getTrip(req, id);
    const at = (req.query as { at?: string }).at;
    return crewCheck(id, at ? new Date(at) : new Date());
  });
  app.post('/:id/depart', { preHandler: app.can('trip.edit') }, async (req) => depart(req, idParam(req), parse(departSchema, req.body)));
  app.post('/:id/arrive', { preHandler: app.can('trip.edit') }, async (req) => arrive(req, idParam(req), parse(arriveSchema, req.body)));
  app.get('/:id/settlement', { preHandler: app.can('trip.view') }, async (req) => {
    const id = idParam(req);
    const t = await getTrip(req, id);
    return t.status === 'CLOSED' && t.settlementSnapshot ? t.settlementSnapshot : settlement(id);
  });
  app.post('/:id/close', { preHandler: app.can('trip.approve') }, async (req) => closeTrip(req, idParam(req), parse(noteSchema, req.body).note));
  app.post('/:id/cancel', { preHandler: app.can('trip.delete') }, async (req) => cancelTrip(req, idParam(req), parse(reasonSchema, req.body).reason));

  // ---------- line items (fuel / supplies / expenses / incidents) ----------
  type Item = 'fuel' | 'supplies' | 'expenses' | 'incidents';
  const cfg: Record<Item, { model: string; entity: string; statuses: TripStatus[]; build: (b: never) => object }> = {
    fuel: {
      model: 'tripFuel', entity: 'TripFuel', statuses: OPEN,
      build: (b: ReturnType<typeof tripFuelSchema.parse>) => ({
        ...b, recordedAt: dt(b.recordedAt), totalCost: b.pricePerLiter != null ? r2(b.liters * b.pricePerLiter) : null,
      }),
    },
    supplies: {
      model: 'tripSupply', entity: 'TripSupply', statuses: OPEN,
      build: (b: ReturnType<typeof tripSupplySchema.parse>) => ({ ...b, totalCost: b.unitCost != null ? r2(b.quantity * b.unitCost) : null }),
    },
    expenses: {
      model: 'tripExpense', entity: 'TripExpense', statuses: OPEN,
      build: (b: ReturnType<typeof tripExpenseSchema.parse>) => ({ ...b, expenseDate: d(b.expenseDate) }),
    },
    incidents: {
      model: 'tripIncident', entity: 'TripIncident', statuses: AFTER_DEPARTURE,
      build: (b: ReturnType<typeof tripIncidentSchema.parse>) => ({ ...b, occurredAt: dt(b.occurredAt) }),
    },
  };
  const schemas = { fuel: tripFuelSchema, supplies: tripSupplySchema, expenses: tripExpenseSchema, incidents: tripIncidentSchema };

  for (const item of Object.keys(cfg) as Item[]) {
    const c = cfg[item];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = () => (prisma as any)[c.model];
    app.post(`/:id/${item}`, { preHandler: app.can('trip.edit') }, async (req, reply) => {
      const tripId = idParam(req);
      const t = await getTrip(req, tripId);
      assertStatus(t, c.statuses, 'เพิ่มรายการ');
      const data = c.build(parse(schemas[item], req.body) as never);
      const row = await prisma.$transaction(async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created = await (tx as any)[c.model].create({ data: { ...data, tripId, createdById: req.user!.id } });
        await audit(tx, req, { action: 'CREATE', entityType: c.entity, entityId: created.id, after: created, note: tripId });
        return created;
      });
      return reply.status(201).send(row);
    });
    app.delete(`/:id/${item}/:itemId`, { preHandler: app.can('trip.edit') }, async (req) => {
      const { id: tripId, itemId } = req.params as { id: string; itemId: string };
      const t = await getTrip(req, tripId);
      assertStatus(t, c.statuses, 'ลบรายการ');
      const row = await model().findFirst({ where: { id: itemId, tripId } });
      if (!row) throw notFound('รายการ');
      await prisma.$transaction(async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any)[c.model].delete({ where: { id: itemId } });
        await audit(tx, req, { action: 'DELETE', entityType: c.entity, entityId: itemId, before: row, note: tripId });
      });
      return { ok: true };
    });
  }
}
