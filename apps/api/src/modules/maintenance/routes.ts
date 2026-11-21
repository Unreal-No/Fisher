import type { FastifyInstance } from 'fastify';
import {
  attachmentSchema, engineHourSchema, MAINT_STATUS, maintenanceCompleteSchema, maintenanceOrderSchema, maintenancePartSchema,
  maintenancePlanSchema, reasonSchema, toISODate, type MaintStatus,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { assertVesselScope, d, idParam, num, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { cancelOrder, completeOrder, createOrder, issuePart, logEngineHours, plansWithDue, startOrder, updateOrder } from './service';

const vesselSel = { select: { id: true, code: true, name: true, status: true } } as const;

export default async function maintenanceRoutes(app: FastifyInstance) {
  // ---------- plans ----------
  app.get('/plans', { preHandler: app.can('maintenance.view') }, async (req) => {
    const f = req.query as { vesselId?: string; dueOnly?: string };
    if (f.vesselId) assertVesselScope(req, f.vesselId);
    const rows = await plansWithDue({ vesselId: f.vesselId, vesselIds: scopeIds(req), activeOnly: f.dueOnly === 'true' });
    return f.dueOnly === 'true' ? rows.filter((r) => r.due.state === 'DUE_SOON' || r.due.state === 'OVERDUE') : rows;
  });
  const planData = (b: Partial<ReturnType<typeof maintenancePlanSchema.parse>>) => ({ ...b, lastDoneAt: b.lastDoneAt === undefined ? undefined : d(b.lastDoneAt) });
  app.post('/plans', { preHandler: app.can('maintenance.edit') }, async (req, reply) => {
    const b = parse(maintenancePlanSchema, req.body);
    assertVesselScope(req, b.vesselId);
    const p = await prisma.maintenancePlan.create({ data: planData(b) as Prisma.MaintenancePlanUncheckedCreateInput });
    await audit(prisma, req, { action: 'CREATE', entityType: 'MaintenancePlan', entityId: p.id, after: p });
    return reply.status(201).send(p);
  });
  app.put('/plans/:id', { preHandler: app.can('maintenance.edit') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.maintenancePlan.findUnique({ where: { id } });
    if (!before) throw notFound('แผนบำรุงรักษา');
    assertVesselScope(req, before.vesselId);
    const b = parse(maintenancePlanSchema, req.body);
    if (b.vesselId !== before.vesselId) throw badRequest('เปลี่ยนเรือของแผนไม่ได้');
    const after = await prisma.maintenancePlan.update({ where: { id }, data: planData(b) as Prisma.MaintenancePlanUncheckedUpdateInput });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'MaintenancePlan', entityId: id, before, after });
    return after;
  });

  // ---------- engine hours ----------
  app.get('/engine-hours', { preHandler: app.can('maintenance.view') }, async (req) => {
    const f = req.query as { vesselId?: string };
    if (!f.vesselId) throw badRequest('ต้องระบุเรือ');
    assertVesselScope(req, f.vesselId);
    return prisma.engineHourLog.findMany({ where: { vesselId: f.vesselId }, orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }], take: 200 });
  });
  app.post('/engine-hours', { preHandler: app.can('maintenance.create') }, async (req, reply) => {
    const b = parse(engineHourSchema, req.body);
    assertVesselScope(req, b.vesselId);
    if (new Date(b.recordedAt).getTime() > Date.now() + 3600_000) throw badRequest('เวลาต้องไม่เกินปัจจุบัน');
    const row = await prisma.$transaction(async (tx) => {
      const r = await logEngineHours(tx, req.user!.id, { ...b, recordedAt: new Date(b.recordedAt), source: 'MANUAL' });
      await audit(tx, req, { action: b.isReset ? 'METER_RESET' : 'CREATE', entityType: 'EngineHourLog', entityId: r.id, after: r, note: b.notes });
      return r;
    });
    return reply.status(201).send(row);
  });

  // ---------- orders ----------
  app.get('/orders', { preHandler: app.can('maintenance.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const scope = scopeIds(req);
    const where: Prisma.MaintenanceOrderWhereInput = {
      ...(f.vesselId ? { vesselId: f.vesselId } : scope ? { vesselId: { in: scope } } : {}),
      ...((MAINT_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as MaintStatus } : f.open === 'true' ? { status: { in: ['OPEN', 'IN_PROGRESS'] } } : {}),
      ...(f.from || f.to ? { reportedAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00+07:00`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999+07:00`) } : {}) } } : {}),
      ...(q.q ? { OR: [{ orderNo: { contains: q.q, mode: 'insensitive' } }, { title: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.maintenanceOrder.findMany({ where, orderBy: { reportedAt: 'desc' }, ...paging(q), include: { vessel: vesselSel, provider: { select: { code: true, name: true } } } }),
      prisma.maintenanceOrder.count({ where }),
    ]);
    return paged(items.map((o) => ({ ...o, totalCost: Math.round((num(o.laborCost) + num(o.externalCost) + num(o.partsCost)) * 100) / 100 })), total, q);
  });
  app.get('/orders/:id', { preHandler: app.can('maintenance.view') }, async (req) => {
    const id = idParam(req);
    const o = await prisma.maintenanceOrder.findUnique({
      where: { id },
      include: { vessel: vesselSel, plan: true, provider: { select: { id: true, code: true, name: true } }, attachments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!o) throw notFound('ใบสั่งซ่อม');
    assertVesselScope(req, o.vesselId);
    const parts = await prisma.stockMovement.findMany({
      where: { refType: 'MAINTENANCE', refId: id },
      include: { item: { select: { code: true, name: true, unit: true } }, warehouse: { select: { code: true, name: true } } },
      orderBy: { movedAt: 'asc' },
    });
    return { ...o, parts, totalCost: Math.round((num(o.laborCost) + num(o.externalCost) + num(o.partsCost)) * 100) / 100 };
  });
  app.post('/orders', { preHandler: app.can('maintenance.create') }, async (req, reply) => reply.status(201).send(await createOrder(req, parse(maintenanceOrderSchema, req.body))));
  app.patch('/orders/:id', { preHandler: app.can('maintenance.edit') }, async (req) => updateOrder(req, idParam(req), parse(maintenanceOrderSchema.partial(), req.body)));
  app.post('/orders/:id/start', { preHandler: app.can('maintenance.edit') }, async (req) => startOrder(req, idParam(req)));
  app.post('/orders/:id/parts', { preHandler: app.can('maintenance.edit') }, async (req, reply) => reply.status(201).send(await issuePart(req, idParam(req), parse(maintenancePartSchema, req.body))));
  app.post('/orders/:id/complete', { preHandler: app.can('maintenance.edit') }, async (req) => completeOrder(req, idParam(req), parse(maintenanceCompleteSchema, req.body)));
  app.post('/orders/:id/cancel', { preHandler: app.can('maintenance.edit') }, async (req) => cancelOrder(req, idParam(req), parse(reasonSchema, req.body).reason));
  app.post('/orders/:id/attachments', { preHandler: app.can('maintenance.create') }, async (req, reply) => {
    const id = idParam(req);
    const o = await prisma.maintenanceOrder.findUnique({ where: { id } });
    if (!o) throw notFound('ใบสั่งซ่อม');
    assertVesselScope(req, o.vesselId);
    const b = parse(attachmentSchema, req.body);
    if (!(await prisma.fileObject.findFirst({ where: { id: b.fileId, deletedAt: null } }))) throw badRequest('ไม่พบไฟล์');
    const a = await prisma.maintenanceAttachment.create({ data: { orderId: id, fileId: b.fileId, note: b.note ?? null, createdById: req.user!.id } });
    await audit(prisma, req, { action: 'CREATE', entityType: 'MaintenanceAttachment', entityId: a.id, note: id });
    return reply.status(201).send(a);
  });

  // ---------- cost report (completed orders) ----------
  app.get('/report', { preHandler: app.can('maintenance.view') }, async (req) => {
    const f = req.query as { from?: string; to?: string; groupBy?: string };
    const scope = scopeIds(req);
    const from = new Date(`${f.from ?? toISODate(new Date(Date.now() - 365 * 86400_000))}T00:00:00+07:00`);
    const to = new Date(`${f.to ?? toISODate()}T23:59:59.999+07:00`);
    const g = ['vessel', 'category', 'month'].includes(f.groupBy ?? '') ? f.groupBy! : 'vessel';
    const key = {
      vessel: Prisma.sql`v.id::text, v.code || ' ' || v.name`,
      category: Prisma.sql`o.category::text, o.category::text`,
      month: Prisma.sql`to_char(o.completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM'), to_char(o.completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')`,
    }[g as 'vessel'];
    const rows = await prisma.$queryRaw<{ key: string; label: string; orders: bigint; labor: string; external: string; parts: string }[]>`
      SELECT k.key, k.label, COUNT(*) AS orders, SUM(o.labor_cost) AS labor, SUM(o.external_cost) AS external, SUM(o.parts_cost) AS parts
      FROM maintenance_orders o JOIN vessels v ON v.id = o.vessel_id
      CROSS JOIN LATERAL (SELECT ${key}) AS k(key, label)
      WHERE o.status = 'COMPLETED' AND o.completed_at BETWEEN ${from} AND ${to}
        ${scope ? Prisma.sql`AND o.vessel_id = ANY(${scope}::uuid[])` : Prisma.empty}
      GROUP BY k.key, k.label ORDER BY ${g === 'month' ? Prisma.sql`k.key` : Prisma.sql`SUM(o.labor_cost + o.external_cost + o.parts_cost) DESC`}`;
    const items = rows.map((r) => {
      const labor = num(r.labor), external = num(r.external), parts = num(r.parts);
      return { key: r.key, label: r.label, orders: Number(r.orders), labor, external, parts, total: Math.round((labor + external + parts) * 100) / 100 };
    });
    return { groupBy: g, items, total: Math.round(items.reduce((a, i) => a + i.total, 0) * 100) / 100 };
  });
}
