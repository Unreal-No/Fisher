import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  inventoryItemSchema, STOCK_MOVE_TYPE, stockAdjustSchema, stockIssueSchema, stockReceiptSchema, stockTransferSchema,
  SUPPLY_CATEGORY, warehouseSchema, type StockMoveType, type SupplyCategory,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { assertVesselScope, idParam, nextSeq, num, paged, paging, parse, parseList } from '../../lib/http';
import { prisma, type Prisma } from '../../lib/prisma';
import { has } from '../../plugins/auth';
import { lockBalance, postMovement } from './stock';

const r2 = (v: number) => Math.round(v * 100) / 100;

export default async function inventoryRoutes(app: FastifyInstance) {
  // ---------- warehouses ----------
  app.get('/warehouses', { preHandler: app.canAny('inventory.view', 'purchase.view') }, async () =>
    prisma.warehouse.findMany({ orderBy: { code: 'asc' } }),
  );
  app.post('/warehouses', { preHandler: app.can('inventory.edit') }, async (req, reply) => {
    const w = await prisma.warehouse.create({ data: parse(warehouseSchema, req.body) });
    await audit(prisma, req, { action: 'CREATE', entityType: 'Warehouse', entityId: w.id, after: w });
    return reply.status(201).send(w);
  });
  app.patch('/warehouses/:id', { preHandler: app.can('inventory.edit') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.warehouse.findUnique({ where: { id } });
    if (!before) throw notFound('คลังสินค้า');
    const after = await prisma.warehouse.update({ where: { id }, data: parse(warehouseSchema.partial(), req.body) });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'Warehouse', entityId: id, before, after });
    return after;
  });

  // ---------- items ----------
  app.get('/items', { preHandler: app.canAny('inventory.view', 'purchase.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.InventoryItemWhereInput = {
      deletedAt: null,
      ...((SUPPLY_CATEGORY as readonly string[]).includes(f.category ?? '') ? { category: f.category as SupplyCategory } : {}),
      ...(f.active === 'true' ? { isActive: true } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const pg = f.all === 'true' ? { take: 2000 } : paging(q);
    const [rows, total] = await Promise.all([
      prisma.inventoryItem.findMany({ where, orderBy: { code: 'asc' }, ...pg, include: { balances: { select: { quantity: true, avgCost: true } } } }),
      prisma.inventoryItem.count({ where }),
    ]);
    const items = rows.map(({ balances, ...i }) => {
      const qty = balances.reduce((a, b) => a + num(b.quantity), 0);
      const value = balances.reduce((a, b) => a + num(b.quantity) * num(b.avgCost), 0);
      return { ...i, onHand: Math.round(qty * 1000) / 1000, stockValue: r2(value), belowMin: i.minStock !== null && qty < num(i.minStock) };
    });
    return paged(items, total, q);
  });
  app.get('/items/:id', { preHandler: app.can('inventory.view') }, async (req) => {
    const id = idParam(req);
    const item = await prisma.inventoryItem.findFirst({
      where: { id, deletedAt: null },
      include: { balances: { include: { warehouse: { select: { id: true, code: true, name: true } } } } },
    });
    if (!item) throw notFound('สินค้า');
    return item;
  });
  app.post('/items', { preHandler: app.can('inventory.edit') }, async (req, reply) => {
    const b = parse(inventoryItemSchema, req.body);
    const item = await prisma.$transaction(async (tx) => {
      const code = b.code || `ITM-${String(await nextSeq(tx, 'ITEM', 'ALL')).padStart(5, '0')}`;
      const i = await tx.inventoryItem.create({ data: { ...b, code } });
      await audit(tx, req, { action: 'CREATE', entityType: 'InventoryItem', entityId: i.id, after: i });
      return i;
    });
    return reply.status(201).send(item);
  });
  app.patch('/items/:id', { preHandler: app.can('inventory.edit') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.inventoryItem.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('สินค้า');
    const b = parse(inventoryItemSchema.partial(), req.body);
    const after = await prisma.inventoryItem.update({ where: { id }, data: { ...b, code: b.code || undefined } });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'InventoryItem', entityId: id, before, after });
    return after;
  });
  app.delete('/items/:id', { preHandler: app.can('inventory.edit') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.inventoryItem.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('สินค้า');
    const used = await prisma.stockMovement.count({ where: { itemId: id } });
    await prisma.inventoryItem.update({ where: { id }, data: used ? { isActive: false } : { deletedAt: new Date(), code: `${before.code}#${Date.now()}` } });
    await audit(prisma, req, { action: used ? 'DEACTIVATE' : 'DELETE', entityType: 'InventoryItem', entityId: id, before });
    return { ok: true, deactivated: !!used };
  });

  // ---------- balances & ledger ----------
  app.get('/balances', { preHandler: app.can('inventory.view') }, async (req) => {
    const f = req.query as { warehouseId?: string; belowMin?: string; q?: string };
    const rows = await prisma.stockBalance.findMany({
      where: {
        ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
        item: { deletedAt: null, ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { code: { contains: f.q, mode: 'insensitive' } }] } : {}) },
      },
      include: { item: { select: { id: true, code: true, name: true, unit: true, category: true, minStock: true } }, warehouse: { select: { id: true, code: true, name: true } } },
      orderBy: [{ item: { code: 'asc' } }],
      take: 5000,
    });
    const items = rows
      .map((r) => ({ ...r, value: r2(num(r.quantity) * num(r.avgCost)), belowMin: r.item.minStock !== null && num(r.quantity) < num(r.item.minStock) }))
      .filter((r) => (f.belowMin === 'true' ? r.belowMin : true));
    return { items, totalValue: r2(items.reduce((a, r) => a + r.value, 0)) };
  });
  app.get('/movements', { preHandler: app.can('inventory.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.StockMovementWhereInput = {
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      ...(f.tripId ? { tripId: f.tripId } : {}),
      ...((STOCK_MOVE_TYPE as readonly string[]).includes(f.type ?? '') ? { type: f.type as StockMoveType } : {}),
      ...(f.from || f.to
        ? { movedAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00+07:00`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999+07:00`) } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where, orderBy: [{ movedAt: 'desc' }, { createdAt: 'desc' }], ...paging(q),
        include: { item: { select: { code: true, name: true, unit: true } }, warehouse: { select: { code: true, name: true } }, vessel: { select: { code: true, name: true } } },
      }),
      prisma.stockMovement.count({ where }),
    ]);
    return paged(items, total, q);
  });

  // ---------- postings ----------
  app.post('/receipts', { preHandler: app.can('inventory.edit') }, async (req, reply) => {
    const b = parse(stockReceiptSchema, req.body); // receipt without PO (opening balance, donation, return)
    const m = await prisma.$transaction(async (tx) => {
      const mv = await postMovement(tx, {
        type: 'RECEIPT', warehouseId: b.warehouseId, itemId: b.itemId, quantity: b.quantity, unitCost: b.unitCost,
        movedAt: new Date(b.movedAt), refType: 'MANUAL', notes: b.notes, userId: req.user!.id,
      });
      await audit(tx, req, { action: 'CREATE', entityType: 'StockMovement', entityId: mv.id, after: mv, note: b.notes });
      return mv;
    });
    return reply.status(201).send(m);
  });

  /** Issue to a vessel; with tripId the cost is booked on the trip as a ledger-linked trip supply. */
  app.post('/issues', { preHandler: app.can('inventory.edit') }, async (req, reply) => {
    const b = parse(stockIssueSchema, req.body);
    assertVesselScope(req, b.vesselId);
    const vessel = await prisma.vessel.findFirst({ where: { id: b.vesselId, deletedAt: null } });
    if (!vessel) throw notFound('เรือ');
    if (b.tripId) {
      const trip = await prisma.fishingTrip.findUnique({ where: { id: b.tripId } });
      if (!trip || trip.vesselId !== b.vesselId) throw badRequest('เที่ยวเรือไม่ตรงกับเรือที่เลือก');
      if (['CLOSED', 'CANCELLED'].includes(trip.status)) throw badRequest('เที่ยวเรือปิดหรือยกเลิกแล้ว');
    }
    let allowNegative: { reason: string } | null = null;
    if (b.override) {
      if (!has(req, 'inventory.approve')) throw forbidden('ต้องมีสิทธิ์อนุมัติจึงจะจ่ายเกินสต็อกได้');
      if (!b.overrideReason) throw badRequest('กรุณาระบุเหตุผลการจ่ายเกินสต็อก');
      allowNegative = { reason: b.overrideReason };
    }
    const m = await prisma.$transaction(async (tx) => {
      const bal = await lockBalance(tx, b.warehouseId, b.itemId);
      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: b.itemId } });
      const supply = b.tripId
        ? await tx.tripSupply.create({
            data: {
              tripId: b.tripId, category: item.category, description: `${item.name} (เบิกจากคลัง)`, quantity: b.quantity, unit: item.unit,
              unitCost: bal.avg, totalCost: r2(b.quantity * bal.avg), notes: b.notes, createdById: req.user!.id,
            },
          })
        : null;
      const mv = await postMovement(tx, {
        type: 'ISSUE', warehouseId: b.warehouseId, itemId: b.itemId, quantity: -b.quantity, movedAt: new Date(b.movedAt), refType: 'ISSUE',
        vesselId: b.vesselId, tripId: b.tripId ?? null, tripSupplyId: supply?.id ?? null, notes: b.notes, allowNegative, userId: req.user!.id,
      });
      await audit(tx, req, { action: 'CREATE', entityType: 'StockMovement', entityId: mv.id, after: mv, note: b.tripId ?? undefined });
      if (allowNegative && num(mv.balanceAfter) < 0)
        await audit(tx, req, { action: 'OVERRIDE', entityType: 'StockMovement', entityId: mv.id, note: allowNegative.reason });
      return mv;
    });
    return reply.status(201).send(m);
  });

  app.post('/transfers', { preHandler: app.can('inventory.edit') }, async (req, reply) => {
    const b = parse(stockTransferSchema, req.body);
    const pair = randomUUID();
    const res = await prisma.$transaction(async (tx) => {
      // lock both rows in a stable order to avoid deadlocks
      for (const w of [b.fromWarehouseId, b.toWarehouseId].sort()) await lockBalance(tx, w, b.itemId);
      const out = await postMovement(tx, {
        type: 'TRANSFER_OUT', warehouseId: b.fromWarehouseId, itemId: b.itemId, quantity: -b.quantity, movedAt: new Date(b.movedAt),
        refType: 'TRANSFER', transferPairId: pair, notes: b.notes, userId: req.user!.id,
      });
      const inn = await postMovement(tx, {
        type: 'TRANSFER_IN', warehouseId: b.toWarehouseId, itemId: b.itemId, quantity: b.quantity, unitCost: num(out.unitCost),
        movedAt: new Date(b.movedAt), refType: 'TRANSFER', transferPairId: pair, notes: b.notes, userId: req.user!.id,
      });
      await audit(tx, req, { action: 'TRANSFER', entityType: 'StockMovement', entityId: out.id, after: { out, in: inn } });
      return { out, in: inn };
    });
    return reply.status(201).send(res);
  });

  app.post('/adjustments', { preHandler: app.can('inventory.edit') }, async (req, reply) => {
    const b = parse(stockAdjustSchema, req.body);
    const m = await prisma.$transaction(async (tx) => {
      const bal = await lockBalance(tx, b.warehouseId, b.itemId);
      const delta = Math.round((b.countedQty - bal.qty) * 1000) / 1000;
      if (delta === 0) throw conflict('NO_DIFFERENCE', 'ยอดที่ตรวจนับเท่ากับยอดในระบบ ไม่ต้องปรับ');
      const mv = await postMovement(tx, {
        type: 'ADJUSTMENT', warehouseId: b.warehouseId, itemId: b.itemId, quantity: delta, movedAt: new Date(b.movedAt), refType: 'ADJUSTMENT',
        notes: b.reason, userId: req.user!.id,
      });
      await audit(tx, req, { action: 'ADJUST', entityType: 'StockMovement', entityId: mv.id, after: mv, note: b.reason });
      return mv;
    });
    return reply.status(201).send(m);
  });
}
