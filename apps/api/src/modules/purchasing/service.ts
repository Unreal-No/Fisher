// PR → PO → Goods receipt. Approvals are segregated (creator cannot approve own document).
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { beYear, type goodsReceiptSchema, type purchaseOrderSchema, type purchaseRequestSchema } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { assertVesselScope, d, nextSeq, num } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import { postMovement } from '../inventory/stock';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
type PrInput = z.output<typeof purchaseRequestSchema>;
type PoInput = z.output<typeof purchaseOrderSchema>;

async function docNo(tx: Tx, key: 'PR' | 'PO' | 'GR') {
  const y = beYear();
  return `${key}-${y}-${String(await nextSeq(tx, key, String(y))).padStart(4, '0')}`;
}
const assertStatus = (cur: string, allowed: string[], what: string) => {
  if (!allowed.includes(cur)) throw conflict('INVALID_STATUS', `ไม่สามารถ${what}ในสถานะปัจจุบัน`, { status: cur });
};
const notSelf = (req: FastifyRequest, creatorId: string | null) => {
  if (creatorId && creatorId === req.user!.id) throw forbidden('ไม่สามารถอนุมัติเอกสารที่ตนเองสร้างได้ (แบ่งแยกหน้าที่)');
};

async function checkRefs(req: FastifyRequest, b: { vesselId?: string | null; tripId?: string | null; items: { itemId?: string | null }[] }) {
  if (b.vesselId) assertVesselScope(req, b.vesselId);
  if (b.tripId) {
    const t = await prisma.fishingTrip.findUnique({ where: { id: b.tripId } });
    if (!t || (b.vesselId && t.vesselId !== b.vesselId)) throw badRequest('เที่ยวเรือไม่ตรงกับเรือที่เลือก');
    if (['CLOSED', 'CANCELLED'].includes(t.status)) throw badRequest('เที่ยวเรือปิดหรือยกเลิกแล้ว');
  }
  const ids = [...new Set(b.items.map((i) => i.itemId).filter(Boolean) as string[])];
  if (ids.length) {
    const n = await prisma.inventoryItem.count({ where: { id: { in: ids }, deletedAt: null, isActive: true } });
    if (n !== ids.length) throw badRequest('มีรหัสสินค้าที่ไม่ถูกต้องหรือถูกปิดใช้งาน');
  }
}

// ---------- purchase requests ----------
export async function savePr(req: FastifyRequest, b: PrInput, id?: string) {
  await checkRefs(req, b);
  return prisma.$transaction(async (tx) => {
    const data = { neededBy: d(b.neededBy), vesselId: b.vesselId ?? null, tripId: b.tripId ?? null, notes: b.notes ?? null };
    const items = b.items.map((i) => ({ itemId: i.itemId ?? null, description: i.description, quantity: i.quantity, unit: i.unit, estUnitCost: i.estUnitCost ?? null, notes: i.notes ?? null }));
    if (!id) {
      const pr = await tx.purchaseRequest.create({ data: { ...data, prNo: await docNo(tx, 'PR'), requestedById: req.user!.id, items: { create: items } }, include: { items: true } });
      await audit(tx, req, { action: 'CREATE', entityType: 'PurchaseRequest', entityId: pr.id, after: pr });
      return pr;
    }
    const before = await tx.purchaseRequest.findUnique({ where: { id }, include: { items: true } });
    if (!before) throw notFound('ใบขอซื้อ');
    assertStatus(before.status, ['DRAFT'], 'แก้ไขใบขอซื้อ');
    await tx.purchaseRequestItem.deleteMany({ where: { prId: id } });
    const pr = await tx.purchaseRequest.update({ where: { id }, data: { ...data, items: { create: items } }, include: { items: true } });
    await audit(tx, req, { action: 'UPDATE', entityType: 'PurchaseRequest', entityId: id, before, after: pr });
    return pr;
  });
}

export async function prAction(req: FastifyRequest, id: string, action: 'submit' | 'approve' | 'reject' | 'cancel', note?: string | null) {
  const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
  if (!pr) throw notFound('ใบขอซื้อ');
  const rules = {
    submit: { from: ['DRAFT'], to: 'SUBMITTED', what: 'ส่งขออนุมัติ' },
    approve: { from: ['SUBMITTED'], to: 'APPROVED', what: 'อนุมัติ' },
    reject: { from: ['SUBMITTED'], to: 'REJECTED', what: 'ไม่อนุมัติ' },
    cancel: { from: ['DRAFT', 'SUBMITTED', 'APPROVED'], to: 'CANCELLED', what: 'ยกเลิก' },
  } as const;
  const r = rules[action];
  assertStatus(pr.status, [...r.from], r.what);
  if (action === 'approve' || action === 'reject') notSelf(req, pr.requestedById);
  if ((action === 'reject' || action === 'cancel') && !note) throw badRequest('กรุณาระบุเหตุผล');
  return prisma.$transaction(async (tx) => {
    const after = await tx.purchaseRequest.update({
      where: { id },
      data: {
        status: r.to,
        ...(action === 'submit' ? { submittedAt: new Date() } : { decidedById: req.user!.id, decidedAt: new Date(), decisionNote: note ?? null }),
      },
    });
    await audit(tx, req, { action: 'STATUS_CHANGE', entityType: 'PurchaseRequest', entityId: id, before: { status: pr.status }, after: { status: r.to }, note });
    return after;
  });
}

// ---------- purchase orders ----------
function totals(b: PoInput) {
  const lines = b.items.map((i) => ({ ...i, lineTotal: r2(i.quantity * i.unitPrice) }));
  const subtotal = r2(lines.reduce((a, l) => a + l.lineTotal, 0));
  const discount = r2(b.discount ?? 0);
  if (discount > subtotal) throw badRequest('ส่วนลดต้องไม่เกินยอดรวม');
  const vatAmount = r2(((subtotal - discount) * b.vatRate) / 100);
  return { lines, subtotal, discount, vatAmount, total: r2(subtotal - discount + vatAmount) };
}

export async function savePo(req: FastifyRequest, b: PoInput, id?: string) {
  await checkRefs(req, b);
  const [supplier, wh] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: b.supplierId, deletedAt: null, isActive: true } }),
    prisma.warehouse.findFirst({ where: { id: b.warehouseId, isActive: true } }),
  ]);
  if (!supplier) throw badRequest('ผู้ขายไม่ถูกต้องหรือถูกปิดใช้งาน');
  if (!wh) throw badRequest('คลังรับสินค้าไม่ถูกต้อง');
  const itemCats = new Map(
    (await prisma.inventoryItem.findMany({ where: { id: { in: b.items.map((i) => i.itemId).filter(Boolean) as string[] } } })).map((i) => [i.id, i.category]),
  );
  const t = totals(b);
  return prisma.$transaction(async (tx) => {
    const head = {
      supplierId: b.supplierId, orderDate: d(b.orderDate), expectedDate: d(b.expectedDate), warehouseId: b.warehouseId,
      vesselId: b.vesselId ?? null, tripId: b.tripId ?? null, subtotal: t.subtotal, discount: t.discount, vatRate: b.vatRate,
      vatAmount: t.vatAmount, total: t.total, notes: b.notes ?? null,
    };
    const items = t.lines.map((l) => ({
      itemId: l.itemId ?? null, category: l.itemId ? itemCats.get(l.itemId)! : l.category, description: l.description,
      quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
    }));
    if (!id) {
      if (b.prId) {
        const pr = await tx.purchaseRequest.findUnique({ where: { id: b.prId } });
        if (!pr) throw notFound('ใบขอซื้อ');
        assertStatus(pr.status, ['APPROVED'], 'ออกใบสั่งซื้อจากใบขอซื้อ');
        await tx.purchaseRequest.update({ where: { id: b.prId }, data: { status: 'ORDERED' } });
      }
      const po = await tx.purchaseOrder.create({
        data: { ...head, prId: b.prId ?? null, poNo: await docNo(tx, 'PO'), createdById: req.user!.id, items: { create: items } },
        include: { items: true },
      });
      await audit(tx, req, { action: 'CREATE', entityType: 'PurchaseOrder', entityId: po.id, after: po });
      return po;
    }
    const before = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!before) throw notFound('ใบสั่งซื้อ');
    assertStatus(before.status, ['DRAFT'], 'แก้ไขใบสั่งซื้อ');
    await tx.purchaseOrderItem.deleteMany({ where: { poId: id } });
    const po = await tx.purchaseOrder.update({ where: { id }, data: { ...head, version: { increment: 1 }, items: { create: items } }, include: { items: true } });
    await audit(tx, req, { action: 'UPDATE', entityType: 'PurchaseOrder', entityId: id, before, after: po });
    return po;
  });
}

export async function poAction(req: FastifyRequest, id: string, action: 'approve' | 'cancel' | 'close', note?: string | null) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { receipts: { select: { id: true } } } });
  if (!po) throw notFound('ใบสั่งซื้อ');
  if (action === 'approve') {
    assertStatus(po.status, ['DRAFT'], 'อนุมัติใบสั่งซื้อ');
    notSelf(req, po.createdById);
  }
  if (action === 'cancel') {
    assertStatus(po.status, ['DRAFT', 'APPROVED'], 'ยกเลิกใบสั่งซื้อ (ยกเลิกได้เฉพาะที่ยังไม่รับของ)');
    if (po.receipts.length) throw conflict('HAS_RECEIPTS', 'ใบสั่งซื้อมีการรับของแล้ว ให้ปิดแทนการยกเลิก');
  }
  if (action === 'close') assertStatus(po.status, ['PARTIALLY_RECEIVED'], 'ปิดใบสั่งซื้อ');
  if (action !== 'approve' && !note) throw badRequest('กรุณาระบุเหตุผล');
  const to = { approve: 'APPROVED', cancel: 'CANCELLED', close: 'CLOSED' }[action] as 'APPROVED';
  return prisma.$transaction(async (tx) => {
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: to, version: { increment: 1 },
        ...(action === 'approve' ? { approvedById: req.user!.id, approvedAt: new Date() } : { closedAt: new Date(), closeReason: note }),
      },
    });
    if (action === 'cancel' && po.prId) await tx.purchaseRequest.update({ where: { id: po.prId }, data: { status: 'APPROVED' } });
    await audit(tx, req, { action: 'STATUS_CHANGE', entityType: 'PurchaseOrder', entityId: id, before: { status: po.status }, after: { status: to }, note });
    return after;
  });
}

/**
 * Goods receipt: stock lines → RECEIPT movement at net unit cost (header discount allocated pro-rata, VAT excluded);
 * non-stock lines on a PO tied to a trip → trip supply (cost booked on the trip).
 */
export async function receive(req: FastifyRequest, poId: string, b: z.output<typeof goodsReceiptSchema>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${poId}::uuid FOR UPDATE`;
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    if (!po) throw notFound('ใบสั่งซื้อ');
    assertStatus(po.status, ['APPROVED', 'PARTIALLY_RECEIVED'], 'รับสินค้า (ใบสั่งซื้อต้องอนุมัติแล้ว)');
    const warehouseId = b.warehouseId ?? po.warehouseId;
    const factor = num(po.subtotal) > 0 ? 1 - num(po.discount) / num(po.subtotal) : 1;
    const seen = new Set<string>();
    const gr = await tx.goodsReceipt.create({
      data: {
        grNo: await docNo(tx, 'GR'), poId, warehouseId, receivedAt: new Date(b.receivedAt), supplierInvoiceNo: b.supplierInvoiceNo ?? null,
        fileId: b.fileId ?? null, notes: b.notes ?? null, createdById: req.user!.id,
      },
    });
    for (const line of b.lines) {
      if (seen.has(line.poItemId)) throw badRequest('มีรายการซ้ำในการรับของ');
      seen.add(line.poItemId);
      const pi = po.items.find((i) => i.id === line.poItemId);
      if (!pi) throw badRequest('รายการไม่อยู่ในใบสั่งซื้อนี้');
      const remaining = r3(num(pi.quantity) - num(pi.receivedQty));
      if (line.quantity > remaining) throw conflict('OVER_RECEIPT', `${pi.description}: รับได้ไม่เกิน ${remaining} ${pi.unit}`);
      const unitCost = r4(num(pi.unitPrice) * factor);
      let stockMovementId: string | null = null;
      let tripSupplyId: string | null = null;
      if (pi.itemId) {
        const mv = await postMovement(tx, {
          type: 'RECEIPT', warehouseId, itemId: pi.itemId, quantity: line.quantity, unitCost, movedAt: new Date(b.receivedAt),
          refType: 'GR', refId: gr.id, notes: `${po.poNo} / ${gr.grNo}`, userId: req.user!.id,
        });
        stockMovementId = mv.id;
      } else if (po.tripId) {
        const ts = await tx.tripSupply.create({
          data: {
            tripId: po.tripId, category: pi.category, description: `${pi.description} (${po.poNo})`, quantity: line.quantity, unit: pi.unit,
            unitCost, totalCost: r2(line.quantity * unitCost), notes: gr.grNo, createdById: req.user!.id,
          },
        });
        tripSupplyId = ts.id;
      }
      await tx.goodsReceiptItem.create({
        data: { grId: gr.id, poItemId: pi.id, quantity: line.quantity, unitCost, lineTotal: r2(line.quantity * unitCost), stockMovementId, tripSupplyId },
      });
      await tx.purchaseOrderItem.update({ where: { id: pi.id }, data: { receivedQty: { increment: line.quantity } } });
    }
    const items = await tx.purchaseOrderItem.findMany({ where: { poId } });
    const done = items.every((i) => num(i.receivedQty) >= num(i.quantity));
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: done ? 'RECEIVED' : 'PARTIALLY_RECEIVED', version: { increment: 1 } } });
    const full = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: gr.id }, include: { items: true } });
    await audit(tx, req, { action: 'RECEIVE', entityType: 'PurchaseOrder', entityId: poId, after: full });
    return full;
  });
}
