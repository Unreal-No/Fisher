// Accounts payable: supplier bills (clear goods receipts / accruals) and payments with withholding tax.
import type { FastifyRequest } from 'fastify';
import { beYear, toISODate, type vendorBillSchema, type vendorPaymentSchema } from '@fisher/shared';
import type { z } from 'zod';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { d, nextSeq, num } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import { r2 } from './ledger';

type BillIn = z.output<typeof vendorBillSchema>;
type PaymentIn = z.output<typeof vendorPaymentSchema>;

const seqNo = async (tx: Tx, prefix: string, key: string) => {
  const y = beYear();
  return `${prefix}-${y}-${String(await nextSeq(tx, key, String(y))).padStart(4, '0')}`;
};

/** Goods receipts of a supplier not yet on a (non-void) bill, with their value. */
export async function unbilledReceipts(db: Tx | typeof prisma, supplierId: string, includeIds: string[] = []) {
  const grs = await db.goodsReceipt.findMany({
    where: {
      po: { supplierId },
      OR: [{ billLines: { none: { bill: { status: { not: 'VOID' } } } } }, { id: { in: includeIds } }],
    },
    include: { items: { select: { lineTotal: true } }, po: { select: { poNo: true } } },
    orderBy: { receivedAt: 'asc' },
  });
  return grs.map((g) => ({ id: g.id, grNo: g.grNo, poNo: g.po.poNo, receivedAt: g.receivedAt, supplierInvoiceNo: g.supplierInvoiceNo, amount: r2(g.items.reduce((s, i) => s + num(i.lineTotal), 0)) }));
}

async function buildLines(tx: Tx, b: BillIn, billId?: string) {
  const grIds = b.lines.filter((l) => l.kind === 'GR').map((l) => l.goodsReceiptId!);
  if (new Set(grIds).size !== grIds.length) throw badRequest('ใบรับสินค้าซ้ำในใบแจ้งหนี้');
  if (grIds.length) await tx.$queryRaw`SELECT id FROM goods_receipts WHERE id = ANY(${grIds}::uuid[]) FOR UPDATE`;
  const currentGr = billId ? (await tx.vendorBillLine.findMany({ where: { billId, kind: 'GR' }, select: { goodsReceiptId: true } })).map((x) => x.goodsReceiptId!) : [];
  const open = await unbilledReceipts(tx, b.supplierId, currentGr);
  const accIds = b.lines.filter((l) => l.kind === 'EXPENSE').map((l) => l.accountId!);
  const accounts = await tx.account.findMany({ where: { id: { in: accIds } } });
  const tripIds = b.lines.map((l) => l.tripId).filter(Boolean) as string[];
  const trips = tripIds.length ? await tx.fishingTrip.findMany({ where: { id: { in: tripIds } }, select: { id: true, vesselId: true } }) : [];
  return b.lines.map((l, i) => {
    if (l.kind === 'GR') {
      const g = open.find((x) => x.id === l.goodsReceiptId);
      if (!g) throw conflict('GR_NOT_BILLABLE', 'ใบรับสินค้าไม่ใช่ของผู้ขายนี้ หรือออกใบแจ้งหนี้ไปแล้ว');
      return { lineNo: i + 1, kind: 'GR' as const, goodsReceiptId: g.id, accountId: null, description: l.description ?? `${g.grNo} (${g.poNo})`, amount: g.amount, vesselId: null, tripId: null };
    }
    const a = accounts.find((x) => x.id === l.accountId);
    if (!a || !a.isPostable || !a.isActive) throw badRequest('บัญชีของรายการต้องเป็นบัญชีที่รับรายการและเปิดใช้งาน');
    const trip = trips.find((t) => t.id === l.tripId);
    if (l.tripId && !trip) throw badRequest('ไม่พบเที่ยวเรือ');
    if (trip && l.vesselId && trip.vesselId !== l.vesselId) throw badRequest('เที่ยวไม่ใช่ของเรือที่ระบุ');
    return { lineNo: i + 1, kind: 'EXPENSE' as const, goodsReceiptId: null, accountId: a.id, description: l.description ?? null, amount: r2(l.amount!), vesselId: trip?.vesselId ?? l.vesselId ?? null, tripId: l.tripId ?? null };
  });
}

function totals(lines: { amount: number }[], vatRate: number) {
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const vatAmount = r2((subtotal * vatRate) / 100);
  return { subtotal, vatAmount, total: r2(subtotal + vatAmount) };
}

export async function saveBill(req: FastifyRequest, b: BillIn, id?: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: b.supplierId, deletedAt: null } });
  if (!supplier) throw notFound('ผู้ขาย');
  return prisma.$transaction(async (tx) => {
    let before = null;
    if (id) {
      await tx.$queryRaw`SELECT id FROM vendor_bills WHERE id = ${id}::uuid FOR UPDATE`;
      before = await tx.vendorBill.findUnique({ where: { id } });
      if (!before) throw notFound('ใบแจ้งหนี้ผู้ขาย');
      if (before.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'แก้ไขได้เฉพาะใบแจ้งหนี้ร่าง');
      if (before.supplierId !== b.supplierId) throw badRequest('เปลี่ยนผู้ขายไม่ได้');
    }
    const dup = await tx.vendorBill.findFirst({ where: { supplierId: b.supplierId, supplierInvoiceNo: b.supplierInvoiceNo, status: { not: 'VOID' }, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw conflict('DUPLICATE_INVOICE', `ใบกำกับ ${b.supplierInvoiceNo} ของผู้ขายนี้บันทึกแล้ว (${dup.billNo})`);
    const lines = await buildLines(tx, b, id);
    const t = totals(lines, b.vatRate);
    const due = b.dueDate ?? (supplier.paymentTermDays != null ? toISODate(new Date(Date.parse(`${b.billDate}T12:00:00+07:00`) + supplier.paymentTermDays * 86400_000)) : null);
    const head = { supplierInvoiceNo: b.supplierInvoiceNo, billDate: d(b.billDate), dueDate: d(due), vatRate: b.vatRate, notes: b.notes ?? null, ...t };
    let bill;
    if (id) {
      await tx.vendorBillLine.deleteMany({ where: { billId: id } });
      bill = await tx.vendorBill.update({ where: { id }, data: { ...head, version: { increment: 1 }, lines: { create: lines } }, include: { lines: true } });
    } else {
      bill = await tx.vendorBill.create({
        data: { ...head, billNo: await seqNo(tx, 'AP', 'APBILL'), supplierId: b.supplierId, createdById: req.user!.id, lines: { create: lines } },
        include: { lines: true },
      });
    }
    await audit(tx, req, { action: id ? 'UPDATE' : 'CREATE', entityType: 'VendorBill', entityId: bill.id, before: before ?? undefined, after: bill });
    return bill;
  });
}

async function lockBill(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM vendor_bills WHERE id = ${id}::uuid FOR UPDATE`;
  const b = await tx.vendorBill.findUnique({ where: { id }, include: { lines: true } });
  if (!b) throw notFound('ใบแจ้งหนี้ผู้ขาย');
  return b;
}

export async function approveBill(req: FastifyRequest, id: string) {
  return prisma.$transaction(async (tx) => {
    const b = await lockBill(tx, id);
    if (b.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'อนุมัติได้เฉพาะใบแจ้งหนี้ร่าง');
    if (b.createdById === req.user!.id) throw forbidden('ผู้บันทึกอนุมัติใบแจ้งหนี้ของตัวเองไม่ได้ (แบ่งแยกหน้าที่)');
    // a goods receipt may have been billed on another bill meanwhile
    const grIds = b.lines.filter((l) => l.goodsReceiptId).map((l) => l.goodsReceiptId!);
    if (grIds.length) {
      await tx.$queryRaw`SELECT id FROM goods_receipts WHERE id = ANY(${grIds}::uuid[]) FOR UPDATE`;
      const other = await tx.vendorBillLine.findFirst({ where: { goodsReceiptId: { in: grIds }, billId: { not: id }, bill: { status: 'APPROVED' } }, include: { bill: { select: { billNo: true } } } });
      if (other) throw conflict('GR_NOT_BILLABLE', `ใบรับสินค้าถูกตั้งหนี้แล้วใน ${other.bill.billNo}`);
    }
    const after = await tx.vendorBill.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: req.user!.id } });
    await audit(tx, req, { action: 'APPROVE', entityType: 'VendorBill', entityId: id, before: { status: b.status }, after: { status: after.status, total: after.total } });
    return after;
  });
}

export async function voidBill(req: FastifyRequest, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const b = await lockBill(tx, id);
    if (b.status === 'VOID') throw conflict('INVALID_STATUS', 'ใบแจ้งหนี้นี้ยกเลิกแล้ว');
    if (num(b.paidAmount) > 0) throw conflict('HAS_PAYMENTS', 'มีการจ่ายชำระแล้ว ยกเลิกการจ่ายก่อน');
    const after = await tx.vendorBill.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
    await audit(tx, req, { action: 'VOID', entityType: 'VendorBill', entityId: id, before: { status: b.status }, after: { status: 'VOID' }, note: reason });
    return after;
  });
}

export async function createPayment(req: FastifyRequest, b: PaymentIn) {
  const paidAt = new Date(b.paidAt);
  if (paidAt.getTime() > Date.now() + 3600_000) throw badRequest('วันที่จ่ายต้องไม่เกินปัจจุบัน');
  if (b.method === 'CASH' && b.bankAccountId) throw badRequest('จ่ายเงินสดไม่ต้องเลือกบัญชีธนาคาร');
  return prisma.$transaction(async (tx) => {
    if (b.bankAccountId) {
      const ba = await tx.bankAccount.findUnique({ where: { id: b.bankAccountId } });
      if (!ba || !ba.isActive) throw badRequest('บัญชีธนาคารไม่พร้อมใช้งาน');
    }
    const ids = b.allocations.map((a) => a.billId);
    if (new Set(ids).size !== ids.length) throw badRequest('ใบแจ้งหนี้ซ้ำในการจ่าย');
    await tx.$queryRaw`SELECT id FROM vendor_bills WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const bills = await tx.vendorBill.findMany({ where: { id: { in: ids } } });
    for (const a of b.allocations) {
      const bill = bills.find((x) => x.id === a.billId);
      if (!bill || bill.supplierId !== b.supplierId) throw badRequest('ใบแจ้งหนี้ไม่ใช่ของผู้ขายนี้');
      if (bill.status !== 'APPROVED') throw conflict('INVALID_STATUS', `${bill.billNo} ยังไม่อนุมัติหรือถูกยกเลิก`);
      const outstanding = r2(num(bill.total) - num(bill.paidAmount));
      if (a.amount > outstanding + 0.004) throw conflict('OVERPAY', `${bill.billNo} ค้างจ่าย ${outstanding} บาท`);
    }
    const gross = r2(b.allocations.reduce((s, a) => s + a.amount, 0));
    const rate = b.whtRate ?? 0;
    const whtAmount = rate > 0 ? r2(((b.whtBase ?? 0) * rate) / 100) : 0;
    if (whtAmount >= gross) throw badRequest('ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดจ่าย');
    if ((b.whtBase ?? 0) > gross + 0.004) throw badRequest('ฐานภาษีหัก ณ ที่จ่ายต้องไม่เกินยอดที่ชำระ');
    const p = await tx.vendorPayment.create({
      data: {
        paymentNo: await seqNo(tx, 'PV', 'APPAY'), supplierId: b.supplierId, paidAt, method: b.method, bankAccountId: b.bankAccountId ?? null,
        reference: b.reference ?? null, grossAmount: gross, whtRate: rate > 0 ? rate : null, whtBase: rate > 0 ? b.whtBase! : null, whtAmount,
        netAmount: r2(gross - whtAmount), notes: b.notes ?? null, createdById: req.user!.id,
        allocations: { create: b.allocations.map((a) => ({ billId: a.billId, amount: r2(a.amount) })) },
      },
      include: { allocations: true },
    });
    for (const a of b.allocations) await tx.vendorBill.update({ where: { id: a.billId }, data: { paidAmount: { increment: r2(a.amount) } } });
    await audit(tx, req, { action: 'CREATE', entityType: 'VendorPayment', entityId: p.id, after: p });
    return p;
  });
}

export async function voidPayment(req: FastifyRequest, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM vendor_payments WHERE id = ${id}::uuid FOR UPDATE`;
    const p = await tx.vendorPayment.findUnique({ where: { id }, include: { allocations: true } });
    if (!p) throw notFound('การจ่ายชำระ');
    if (p.status !== 'POSTED') throw conflict('INVALID_STATUS', 'รายการนี้ยกเลิกแล้ว');
    const ids = p.allocations.map((a) => a.billId);
    await tx.$queryRaw`SELECT id FROM vendor_bills WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    for (const a of p.allocations) await tx.vendorBill.update({ where: { id: a.billId }, data: { paidAmount: { decrement: num(a.amount) } } });
    const after = await tx.vendorPayment.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason, voidedById: req.user!.id } });
    await audit(tx, req, { action: 'VOID', entityType: 'VendorPayment', entityId: id, before: { status: p.status }, after: { status: 'VOID' }, note: reason });
    return after;
  });
}

/** Outstanding approved bills by days past due as of a date. */
export async function apAging(asOf: string) {
  const bills = await prisma.vendorBill.findMany({ where: { status: 'APPROVED', billDate: { lte: d(asOf) } }, include: { supplier: { select: { id: true, code: true, name: true } } } });
  const day = Date.parse(asOf);
  const rows = new Map<string, { supplierId: string; code: string; name: string; current: number; d30: number; d60: number; d90: number; over90: number; total: number }>();
  for (const b of bills) {
    const out = r2(num(b.total) - num(b.paidAmount));
    if (out <= 0) continue;
    const late = b.dueDate ? Math.floor((day - b.dueDate.getTime()) / 86400_000) : 0;
    const r = rows.get(b.supplierId) ?? { supplierId: b.supplierId, code: b.supplier.code, name: b.supplier.name, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
    const k = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90';
    r[k] = r2(r[k] + out);
    r.total = r2(r.total + out);
    rows.set(b.supplierId, r);
  }
  const items = [...rows.values()].sort((a, b) => b.total - a.total);
  return { asOf, items, total: r2(items.reduce((s, i) => s + i.total, 0)) };
}
