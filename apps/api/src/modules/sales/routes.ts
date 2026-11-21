import type { FastifyInstance } from 'fastify';
import { customerSchema, PAYMENT_STATUS, reasonSchema, SALES_STATUS, salesInvoiceSchema, salesPaymentSchema, salesReturnSchema, type SalesStatus } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { d, idParam, nextSeq, num, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { lotNo, lotRows } from './lots';
import { addPayment, addReturn, confirmInvoice, outstanding, paymentStatus, saveInvoice, voidInvoice, voidPayment } from './service';

const r2 = (v: number) => Math.round(v * 100) / 100;
const invInclude = {
  customer: { select: { id: true, code: true, name: true, taxId: true, branch: true, address: true, phone: true } },
  items: { include: { species: { select: { code: true, nameTh: true } }, grade: { select: { code: true, nameTh: true } }, trip: { select: { id: true, tripNo: true, vessel: { select: { code: true, name: true } } } } } },
  payments: { orderBy: { paidAt: 'asc' as const } },
  returns: { include: { items: true }, orderBy: { returnDate: 'asc' as const } },
} satisfies Prisma.SalesInvoiceInclude;
const withStatus = <T extends { total: unknown; paidAmount: unknown; creditedAmount: unknown; status: string }>(i: T) => ({
  ...i, outstanding: i.status === 'CONFIRMED' ? outstanding(i) : 0, paymentStatus: i.status === 'CONFIRMED' ? paymentStatus(i) : null,
});

export default async function salesRoutes(app: FastifyInstance) {
  // ---------- customers ----------
  app.get('/customers', { preHandler: app.can('sales.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(f.active === 'true' ? { isActive: true } : {}),
      ...(q.q ? { OR: ['name', 'code', 'taxId', 'phone'].map((k) => ({ [k]: { contains: q.q, mode: 'insensitive' } })) } : {}),
    };
    const pg = f.all === 'true' ? { take: 2000 } : paging(q);
    const [items, total] = await Promise.all([prisma.customer.findMany({ where, orderBy: { code: 'asc' }, ...pg }), prisma.customer.count({ where })]);
    return paged(items, total, q);
  });
  app.post('/customers', { preHandler: app.can('sales.create') }, async (req, reply) => {
    const b = parse(customerSchema, req.body);
    const c = await prisma.$transaction(async (tx) => {
      const code = b.code || `CUS-${String(await nextSeq(tx, 'CUSTOMER', 'ALL')).padStart(4, '0')}`;
      const x = await tx.customer.create({ data: { ...b, code } });
      await audit(tx, req, { action: 'CREATE', entityType: 'Customer', entityId: x.id, after: x });
      return x;
    });
    return reply.status(201).send(c);
  });
  app.patch('/customers/:id', { preHandler: app.can('sales.create') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('ลูกค้า');
    const b = parse(customerSchema.partial(), req.body);
    const after = await prisma.customer.update({ where: { id }, data: { ...b, code: b.code || undefined } });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'Customer', entityId: id, before, after });
    return after;
  });

  // ---------- lots (what can be sold) ----------
  app.get('/lots', { preHandler: app.canAny('sales.view', 'catch.view') }, async (req) => {
    const f = req.query as { tripId?: string; speciesId?: string; availableOnly?: string };
    const scope = scopeIds(req);
    const trips = await prisma.fishingTrip.findMany({
      where: { ...(f.tripId ? { id: f.tripId } : { status: { in: ['ARRIVED', 'PENDING_SETTLEMENT', 'CLOSED'] } }), ...(scope ? { vesselId: { in: scope } } : {}) },
      select: { id: true, tripNo: true, status: true, arrivedAt: true, vessel: { select: { code: true, name: true } } },
      orderBy: { arrivedAt: 'desc' },
      take: 300,
    });
    const rows = await lotRows(prisma, { tripIds: trips.map((t) => t.id), speciesId: f.speciesId });
    const [species, grades] = await Promise.all([prisma.fishSpecies.findMany({ select: { id: true, code: true, nameTh: true, defaultPrice: true } }), prisma.catchGrade.findMany({ select: { id: true, code: true, nameTh: true } })]);
    return rows
      .filter((r) => (f.availableOnly === 'true' ? r.availableKg > 0 : true))
      .map((r) => {
        const t = trips.find((x) => x.id === r.tripId)!;
        const s = species.find((x) => x.id === r.speciesId);
        const g = grades.find((x) => x.id === r.gradeId);
        return { ...r, lotNo: lotNo(t.tripNo, s?.code ?? '?', g?.code), trip: t, species: s, grade: g ?? null, sellable: ['ARRIVED', 'PENDING_SETTLEMENT', 'CLOSED'].includes(t.status) };
      })
      .sort((a, b) => (b.trip.arrivedAt?.getTime() ?? 0) - (a.trip.arrivedAt?.getTime() ?? 0) || a.lotNo.localeCompare(b.lotNo));
  });

  // ---------- invoices ----------
  app.get('/invoices', { preHandler: app.can('sales.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const ps = (PAYMENT_STATUS as readonly string[]).includes(f.paymentStatus ?? '') ? f.paymentStatus : undefined;
    const where: Prisma.SalesInvoiceWhereInput = {
      ...((SALES_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as SalesStatus } : {}),
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(f.tripId ? { items: { some: { tripId: f.tripId } } } : {}),
      ...(f.from || f.to ? { invoiceDate: { ...(f.from ? { gte: d(f.from) } : {}), ...(f.to ? { lte: d(f.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ orderNo: { contains: q.q, mode: 'insensitive' } }, { invoiceNo: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const rows = await prisma.salesInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, include: { customer: { select: { code: true, name: true } } }, ...(ps ? { skip: 0, take: 2000 } : paging(q)) });
    const items = rows.map(withStatus).filter((i) => (ps ? i.status === 'CONFIRMED' && i.paymentStatus === ps : true));
    return ps ? paged(items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), items.length, q) : paged(items, await prisma.salesInvoice.count({ where }), q);
  });
  app.get('/invoices/:id', { preHandler: app.can('sales.view') }, async (req) => {
    const inv = await prisma.salesInvoice.findUnique({ where: { id: idParam(req) }, include: invInclude });
    if (!inv) throw notFound('ใบขาย');
    return withStatus(inv);
  });
  app.post('/invoices', { preHandler: app.can('sales.create') }, async (req, reply) => reply.status(201).send(await saveInvoice(req, parse(salesInvoiceSchema, req.body))));
  app.put('/invoices/:id', { preHandler: app.can('sales.create') }, async (req) => saveInvoice(req, parse(salesInvoiceSchema, req.body), idParam(req)));
  app.post('/invoices/:id/confirm', { preHandler: app.can('sales.create') }, async (req) => confirmInvoice(req, idParam(req)));
  app.post('/invoices/:id/void', { preHandler: app.can('sales.approve') }, async (req) => voidInvoice(req, idParam(req), parse(reasonSchema, req.body).reason));
  app.post('/invoices/:id/payments', { preHandler: app.canAny('sales.create', 'finance.edit') }, async (req, reply) =>
    reply.status(201).send(await addPayment(req, idParam(req), parse(salesPaymentSchema, req.body))),
  );
  app.post('/payments/:id/void', { preHandler: app.canAny('sales.approve', 'finance.approve') }, async (req) => voidPayment(req, idParam(req), parse(reasonSchema, req.body).reason));
  app.post('/invoices/:id/returns', { preHandler: app.can('sales.approve') }, async (req, reply) =>
    reply.status(201).send(await addReturn(req, idParam(req), parse(salesReturnSchema, req.body))),
  );

  // ---------- receivables (aging by due date) ----------
  app.get('/receivables', { preHandler: app.canAny('sales.view', 'finance.view') }, async () => {
    const invs = await prisma.salesInvoice.findMany({
      where: { status: 'CONFIRMED' },
      include: { customer: { select: { id: true, code: true, name: true } } },
      orderBy: { invoiceDate: 'asc' },
    });
    const today = d(new Date().toISOString().slice(0, 10)).getTime();
    const open = invs
      .map((i) => ({ ...i, outstanding: outstanding(i), overdueDays: Math.floor((today - (i.dueDate ?? i.invoiceDate).getTime()) / 86400_000) }))
      .filter((i) => i.outstanding > 0);
    const bucket = (days: number) => (days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90p');
    const by = new Map<string, { customer: (typeof open)[number]['customer']; total: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90p: number; invoices: number }>();
    for (const i of open) {
      const c = by.get(i.customerId) ?? { customer: i.customer, total: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0, invoices: 0 };
      c.total = r2(c.total + i.outstanding);
      c[bucket(i.overdueDays)] = r2(c[bucket(i.overdueDays)] + i.outstanding);
      c.invoices++;
      by.set(i.customerId, c);
    }
    return {
      totalOutstanding: r2(open.reduce((a, i) => a + i.outstanding, 0)),
      byCustomer: [...by.values()].sort((a, b) => b.total - a.total),
      invoices: open.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, dueDate: i.dueDate, customer: i.customer, total: i.total, outstanding: i.outstanding, overdueDays: i.overdueDays })),
    };
  });

  // ---------- revenue report (net fish revenue ex-VAT, after discounts and credit notes) ----------
  app.get('/report', { preHandler: app.can('sales.view') }, async (req) => {
    const f = req.query as { from?: string; to?: string; groupBy?: string };
    const from = d(f.from ?? `${new Date().toISOString().slice(0, 7)}-01`);
    const to = d(f.to ?? new Date().toISOString().slice(0, 10));
    const g = ['customer', 'species', 'vessel', 'trip', 'month'].includes(f.groupBy ?? '') ? f.groupBy! : 'species';
    const key = {
      customer: Prisma.sql`c.id::text, c.code || ' ' || c.name`,
      species: Prisma.sql`fs.id::text, fs.name_th`,
      vessel: Prisma.sql`v.id::text, v.code || ' ' || v.name`,
      trip: Prisma.sql`t.id::text, t.trip_no`,
      month: Prisma.sql`to_char(inv.invoice_date, 'YYYY-MM'), to_char(inv.invoice_date, 'YYYY-MM')`,
    }[g as 'species'];
    const rows = await prisma.$queryRaw<{ key: string; label: string; kg: string; revenue: string; invoices: bigint }[]>`
      SELECT k.key, k.label, SUM(si.weight_kg - si.returned_kg) AS kg,
        SUM(si.line_total - si.discount_share - si.returned_amount) AS revenue, COUNT(DISTINCT inv.id) AS invoices
      FROM sales_items si
      JOIN sales_invoices inv ON inv.id = si.invoice_id
      JOIN customers c ON c.id = inv.customer_id
      JOIN fish_species fs ON fs.id = si.species_id
      JOIN vessels v ON v.id = si.vessel_id
      JOIN fishing_trips t ON t.id = si.trip_id
      CROSS JOIN LATERAL (SELECT ${key}) AS k(key, label)
      WHERE inv.status = 'CONFIRMED' AND inv.invoice_date BETWEEN ${from} AND ${to}
      GROUP BY k.key, k.label ORDER BY ${g === 'month' ? Prisma.sql`k.key` : Prisma.sql`revenue DESC`}`;
    const items = rows.map((r) => ({ key: r.key, label: r.label, weightKg: num(r.kg), revenue: num(r.revenue), invoices: Number(r.invoices), avgPrice: num(r.kg) > 0 ? r2(num(r.revenue) / num(r.kg)) : null }));
    return { groupBy: g, items, totalRevenue: r2(items.reduce((a, i) => a + i.revenue, 0)), totalKg: Math.round(items.reduce((a, i) => a + i.weightKg, 0) * 1000) / 1000 };
  });
}
