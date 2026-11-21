import type { FastifyInstance } from 'fastify';
import { goodsReceiptSchema, noteSchema, PO_STATUS, PR_STATUS, purchaseOrderSchema, purchaseRequestSchema, reasonSchema, supplierSchema, type PoStatus, type PrStatus } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { d, idParam, nextSeq, num, paged, paging, parse, parseList } from '../../lib/http';
import { prisma, type Prisma } from '../../lib/prisma';
import { poAction, prAction, receive, savePo, savePr } from './service';

const dateRange = (f: { from?: string; to?: string }) =>
  f.from || f.to ? { ...(f.from ? { gte: d(f.from) } : {}), ...(f.to ? { lte: d(f.to) } : {}) } : undefined;

export default async function purchasingRoutes(app: FastifyInstance) {
  // ---------- suppliers ----------
  app.get('/suppliers', { preHandler: app.can('purchase.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      ...(f.active === 'true' ? { isActive: true } : {}),
      ...(q.q ? { OR: ['name', 'code', 'taxId', 'phone'].map((k) => ({ [k]: { contains: q.q, mode: 'insensitive' } })) } : {}),
    };
    const pg = f.all === 'true' ? { take: 2000 } : paging(q);
    const [items, total] = await Promise.all([prisma.supplier.findMany({ where, orderBy: { code: 'asc' }, ...pg }), prisma.supplier.count({ where })]);
    return paged(items, total, q);
  });
  app.post('/suppliers', { preHandler: app.can('purchase.create') }, async (req, reply) => {
    const b = parse(supplierSchema, req.body);
    const s = await prisma.$transaction(async (tx) => {
      const code = b.code || `SUP-${String(await nextSeq(tx, 'SUPPLIER', 'ALL')).padStart(4, '0')}`;
      const c = await tx.supplier.create({ data: { ...b, code } });
      await audit(tx, req, { action: 'CREATE', entityType: 'Supplier', entityId: c.id, after: c });
      return c;
    });
    return reply.status(201).send(s);
  });
  app.patch('/suppliers/:id', { preHandler: app.can('purchase.create') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('ผู้ขาย');
    const b = parse(supplierSchema.partial(), req.body);
    const after = await prisma.supplier.update({ where: { id }, data: { ...b, code: b.code || undefined } });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'Supplier', entityId: id, before, after });
    return after;
  });

  // ---------- purchase requests ----------
  app.get('/requests', { preHandler: app.can('purchase.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.PurchaseRequestWhereInput = {
      ...((PR_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as PrStatus } : {}),
      ...(q.q ? { prNo: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.purchaseRequest.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q), include: { items: true, _count: { select: { orders: true } } } }),
      prisma.purchaseRequest.count({ where }),
    ]);
    return paged(items, total, q);
  });
  app.get('/requests/:id', { preHandler: app.can('purchase.view') }, async (req) => {
    const pr = await prisma.purchaseRequest.findUnique({ where: { id: idParam(req) }, include: { items: true, orders: { select: { id: true, poNo: true, status: true } } } });
    if (!pr) throw notFound('ใบขอซื้อ');
    return pr;
  });
  app.post('/requests', { preHandler: app.can('purchase.create') }, async (req, reply) => reply.status(201).send(await savePr(req, parse(purchaseRequestSchema, req.body))));
  app.put('/requests/:id', { preHandler: app.can('purchase.create') }, async (req) => savePr(req, parse(purchaseRequestSchema, req.body), idParam(req)));
  app.post('/requests/:id/submit', { preHandler: app.can('purchase.create') }, async (req) => prAction(req, idParam(req), 'submit'));
  app.post('/requests/:id/approve', { preHandler: app.can('purchase.approve') }, async (req) => prAction(req, idParam(req), 'approve', parse(noteSchema, req.body).note));
  app.post('/requests/:id/reject', { preHandler: app.can('purchase.approve') }, async (req) => prAction(req, idParam(req), 'reject', parse(reasonSchema, req.body).reason));
  app.post('/requests/:id/cancel', { preHandler: app.can('purchase.create') }, async (req) => prAction(req, idParam(req), 'cancel', parse(reasonSchema, req.body).reason));

  // ---------- purchase orders ----------
  const poInclude = {
    supplier: { select: { id: true, code: true, name: true } },
    items: { orderBy: { id: 'asc' as const } },
    receipts: { include: { items: true }, orderBy: { receivedAt: 'asc' as const } },
    pr: { select: { id: true, prNo: true } },
  } satisfies Prisma.PurchaseOrderInclude;
  app.get('/orders', { preHandler: app.can('purchase.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.PurchaseOrderWhereInput = {
      ...((PO_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as PoStatus } : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(dateRange(f) ? { orderDate: dateRange(f) } : {}),
      ...(q.q ? { OR: [{ poNo: { contains: q.q, mode: 'insensitive' } }, { supplier: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' }, ...paging(q), include: { supplier: { select: { code: true, name: true } } } }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return paged(items, total, q);
  });
  app.get('/orders/:id', { preHandler: app.can('purchase.view') }, async (req) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: idParam(req) }, include: poInclude });
    if (!po) throw notFound('ใบสั่งซื้อ');
    return po;
  });
  app.post('/orders', { preHandler: app.can('purchase.create') }, async (req, reply) => reply.status(201).send(await savePo(req, parse(purchaseOrderSchema, req.body))));
  app.put('/orders/:id', { preHandler: app.can('purchase.create') }, async (req) => savePo(req, parse(purchaseOrderSchema, req.body), idParam(req)));
  app.post('/orders/:id/approve', { preHandler: app.can('purchase.approve') }, async (req) => poAction(req, idParam(req), 'approve'));
  app.post('/orders/:id/cancel', { preHandler: app.can('purchase.create') }, async (req) => poAction(req, idParam(req), 'cancel', parse(reasonSchema, req.body).reason));
  app.post('/orders/:id/close', { preHandler: app.can('purchase.approve') }, async (req) => poAction(req, idParam(req), 'close', parse(reasonSchema, req.body).reason));
  app.post('/orders/:id/receive', { preHandler: app.can('inventory.edit') }, async (req, reply) =>
    reply.status(201).send(await receive(req, idParam(req), parse(goodsReceiptSchema, req.body))),
  );

  // ---------- summary (committed purchases, excl. draft/cancelled) ----------
  app.get('/summary', { preHandler: app.can('purchase.view') }, async (req) => {
    const f = req.query as { from?: string; to?: string };
    const from = d(f.from ?? new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10));
    const to = d(f.to ?? new Date().toISOString().slice(0, 10));
    const [bySupplier, monthly] = await Promise.all([
      prisma.$queryRaw<{ supplier_id: string; code: string; name: string; orders: bigint; total: string; vat: string }[]>`
        SELECT s.id AS supplier_id, s.code, s.name, COUNT(*) AS orders, SUM(po.total) AS total, SUM(po.vat_amount) AS vat
        FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status NOT IN ('DRAFT','CANCELLED') AND po.order_date BETWEEN ${from} AND ${to}
        GROUP BY s.id, s.code, s.name ORDER BY SUM(po.total) DESC`,
      prisma.$queryRaw<{ month: Date; orders: bigint; total: string }[]>`
        SELECT date_trunc('month', po.order_date)::date AS month, COUNT(*) AS orders, SUM(po.total) AS total
        FROM purchase_orders po WHERE po.status NOT IN ('DRAFT','CANCELLED') AND po.order_date BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      bySupplier: bySupplier.map((r) => ({ supplierId: r.supplier_id, code: r.code, name: r.name, orders: Number(r.orders), total: num(r.total), vat: num(r.vat) })),
      monthly: monthly.map((m) => ({ month: m.month.toISOString().slice(0, 7), orders: Number(m.orders), total: num(m.total) })),
    };
  });
}
