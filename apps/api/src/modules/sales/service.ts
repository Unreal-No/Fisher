// Sales: draft order → confirmed invoice (consumes lots) → payments / credit notes / void.
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { beYear, type salesInvoiceSchema, type salesPaymentSchema, type salesReturnSchema } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { assertVesselScope, d, nextSeq, num } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import { assertLotsAvailable, lockLots, lotRows } from './lots';

const r2 = (v: number) => Math.round(v * 100) / 100;
const SELLABLE = ['ARRIVED', 'PENDING_SETTLEMENT', 'CLOSED'];
type InvoiceInput = z.output<typeof salesInvoiceSchema>;

async function docNo(tx: Tx, key: 'SO' | 'INV' | 'RC' | 'CN') {
  const y = beYear();
  return `${key}-${y}-${String(await nextSeq(tx, key, String(y))).padStart(4, '0')}`;
}
async function lockInvoice(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${id}::uuid FOR UPDATE`;
  const inv = await tx.salesInvoice.findUnique({ where: { id }, include: { items: true, payments: true, returns: true } });
  if (!inv) throw notFound('ใบขาย');
  return inv;
}
export const outstanding = (i: { total: unknown; paidAmount: unknown; creditedAmount: unknown }) =>
  r2(num(i.total) - num(i.paidAmount) - num(i.creditedAmount));
export const paymentStatus = (i: { total: unknown; paidAmount: unknown; creditedAmount: unknown }) =>
  outstanding(i) <= 0 ? 'PAID' : num(i.paidAmount) + num(i.creditedAmount) > 0 ? 'PARTIAL' : 'UNPAID';

export async function saveInvoice(req: FastifyRequest, b: InvoiceInput, id?: string) {
  const customer = await prisma.customer.findFirst({ where: { id: b.customerId, deletedAt: null, isActive: true } });
  if (!customer) throw badRequest('ลูกค้าไม่ถูกต้องหรือถูกปิดใช้งาน');
  const tripIds = [...new Set(b.items.map((i) => i.tripId))];
  const [trips, species, grades] = await Promise.all([
    prisma.fishingTrip.findMany({ where: { id: { in: tripIds } }, select: { id: true, tripNo: true, vesselId: true, status: true } }),
    prisma.fishSpecies.findMany({ where: { id: { in: b.items.map((i) => i.speciesId) } }, select: { id: true, nameTh: true } }),
    prisma.catchGrade.findMany({ select: { id: true, nameTh: true } }),
  ]);
  for (const t of trips) {
    assertVesselScope(req, t.vesselId);
    if (!SELLABLE.includes(t.status)) throw badRequest(`เที่ยว ${t.tripNo} ยังไม่เข้าท่า — ขายได้หลังเข้าท่าแล้ว`);
  }
  if (trips.length !== tripIds.length) throw badRequest('ไม่พบเที่ยวเรือบางรายการ');
  // early (non-locking) availability check for a friendly error; the authoritative check runs at confirm
  const avail = await lotRows(prisma, { tripIds });
  const need = new Map<string, number>();
  for (const l of b.items) need.set(`${l.tripId}|${l.speciesId}|${l.gradeId ?? ''}`, (need.get(`${l.tripId}|${l.speciesId}|${l.gradeId ?? ''}`) ?? 0) + l.weightKg);
  for (const [k, kg] of need) {
    const [t, s, g] = k.split('|');
    const lot = avail.find((a) => a.tripId === t && a.speciesId === s && (a.gradeId ?? '') === g);
    if (!lot || kg > lot.availableKg + 0.0005)
      throw conflict('LOT_INSUFFICIENT', `${species.find((x) => x.id === s)?.nameTh ?? ''} ${grades.find((x) => x.id === g)?.nameTh ?? ''} เที่ยว ${trips.find((x) => x.id === t)?.tripNo}: คงเหลือขายได้ ${lot?.availableKg ?? 0} กก.`);
  }
  const lines = b.items.map((l) => ({ ...l, lineTotal: r2(l.weightKg * l.unitPrice) }));
  const subtotal = r2(lines.reduce((a, l) => a + l.lineTotal, 0));
  const discount = r2(b.discount ?? 0);
  if (discount > subtotal) throw badRequest('ส่วนลดต้องไม่เกินยอดรวม');
  const additionalCost = r2(b.additionalCost ?? 0);
  const vatAmount = r2(((subtotal - discount + additionalCost) * b.vatRate) / 100);
  const total = r2(subtotal - discount + additionalCost + vatAmount);
  // allocate header discount pro-rata, remainder to the last line so shares sum exactly
  let allocated = 0;
  const items = lines.map((l, i) => {
    const share = i === lines.length - 1 ? r2(discount - allocated) : subtotal ? r2((discount * l.lineTotal) / subtotal) : 0;
    allocated = r2(allocated + share);
    const t = trips.find((x) => x.id === l.tripId)!;
    const sp = species.find((x) => x.id === l.speciesId);
    const gr = grades.find((x) => x.id === l.gradeId);
    return {
      tripId: l.tripId, vesselId: t.vesselId, speciesId: l.speciesId, gradeId: l.gradeId ?? null,
      description: l.description || `${sp?.nameTh ?? ''}${gr ? ` ${gr.nameTh}` : ''} (${t.tripNo})`,
      weightKg: l.weightKg, quantity: l.quantity ?? null, unitPrice: l.unitPrice, lineTotal: l.lineTotal, discountShare: share,
    };
  });
  const due = b.dueDate ? d(b.dueDate) : customer.creditTermDays ? new Date(d(b.invoiceDate).getTime() + customer.creditTermDays * 86400_000) : null;
  const head = { customerId: b.customerId, invoiceDate: d(b.invoiceDate), dueDate: due, subtotal, discount, additionalCost, vatRate: b.vatRate, vatAmount, total, notes: b.notes ?? null };
  return prisma.$transaction(async (tx) => {
    if (!id) {
      const inv = await tx.salesInvoice.create({ data: { ...head, orderNo: await docNo(tx, 'SO'), createdById: req.user!.id, items: { create: items } }, include: { items: true } });
      await audit(tx, req, { action: 'CREATE', entityType: 'SalesInvoice', entityId: inv.id, after: inv });
      return inv;
    }
    const before = await lockInvoice(tx, id);
    if (before.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'แก้ไขได้เฉพาะใบสั่งขายที่ยังเป็นร่าง');
    await tx.salesItem.deleteMany({ where: { invoiceId: id } });
    const inv = await tx.salesInvoice.update({ where: { id }, data: { ...head, version: { increment: 1 }, items: { create: items } }, include: { items: true } });
    await audit(tx, req, { action: 'UPDATE', entityType: 'SalesInvoice', entityId: id, before, after: inv });
    return inv;
  });
}

export async function confirmInvoice(req: FastifyRequest, id: string) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'ยืนยันได้เฉพาะใบสั่งขายที่เป็นร่าง');
    const keys = inv.items.map((i) => ({ tripId: i.tripId, speciesId: i.speciesId }));
    await lockLots(tx, keys);
    const after = await tx.salesInvoice.update({
      where: { id },
      data: { status: 'CONFIRMED', invoiceNo: await docNo(tx, 'INV'), confirmedAt: new Date(), confirmedById: req.user!.id, version: { increment: 1 } },
    });
    await assertLotsAvailable(tx, keys); // authoritative: rolls back if a concurrent sale/edit consumed the lot
    await audit(tx, req, { action: 'CONFIRM', entityType: 'SalesInvoice', entityId: id, after: { invoiceNo: after.invoiceNo, total: after.total } });
    return after;
  });
}

export async function voidInvoice(req: FastifyRequest, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status === 'VOID') throw conflict('INVALID_STATUS', 'ใบขายนี้ถูกยกเลิกแล้ว');
    if (inv.payments.some((p) => !p.voidedAt)) throw conflict('HAS_PAYMENTS', 'มีการรับชำระแล้ว ต้องยกเลิกใบเสร็จก่อน');
    if (inv.returns.length) throw conflict('HAS_CREDIT_NOTES', 'มีใบลดหนี้แล้ว ไม่สามารถยกเลิกใบแจ้งหนี้ได้');
    const after = await tx.salesInvoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason, version: { increment: 1 } } });
    await audit(tx, req, { action: 'VOID', entityType: 'SalesInvoice', entityId: id, before: { status: inv.status }, note: reason });
    return after;
  });
}

export async function addPayment(req: FastifyRequest, invoiceId: string, b: z.output<typeof salesPaymentSchema>) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== 'CONFIRMED') throw conflict('INVALID_STATUS', 'รับชำระได้เฉพาะใบแจ้งหนี้ที่ยืนยันแล้ว');
    const out = outstanding(inv);
    if (b.amount > out + 0.004) throw conflict('OVERPAYMENT', `ยอดชำระเกินยอดค้าง (${out} บาท)`);
    const p = await tx.salesPayment.create({
      data: { receiptNo: await docNo(tx, 'RC'), invoiceId, customerId: inv.customerId, paidAt: new Date(b.paidAt), amount: b.amount, method: b.method, reference: b.reference ?? null, notes: b.notes ?? null, createdById: req.user!.id },
    });
    await tx.salesInvoice.update({ where: { id: invoiceId }, data: { paidAmount: { increment: b.amount } } });
    await audit(tx, req, { action: 'CREATE', entityType: 'SalesPayment', entityId: p.id, after: p, note: invoiceId });
    return p;
  });
}

export async function voidPayment(req: FastifyRequest, paymentId: string, reason: string) {
  const p0 = await prisma.salesPayment.findUnique({ where: { id: paymentId } });
  if (!p0) throw notFound('ใบเสร็จ');
  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, p0.invoiceId);
    const p = await tx.salesPayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.voidedAt) throw conflict('ALREADY_VOID', 'ใบเสร็จนี้ถูกยกเลิกแล้ว');
    const after = await tx.salesPayment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason, voidedById: req.user!.id } });
    await tx.salesInvoice.update({ where: { id: p.invoiceId }, data: { paidAmount: { decrement: num(p.amount) } } });
    await audit(tx, req, { action: 'VOID', entityType: 'SalesPayment', entityId: paymentId, before: p, note: reason });
    return after;
  });
}

/** Credit note: line amounts are ex-VAT; the receivable is reduced by amount × (1 + VAT). Fish is not restocked. */
export async function addReturn(req: FastifyRequest, invoiceId: string, b: z.output<typeof salesReturnSchema>) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== 'CONFIRMED') throw conflict('INVALID_STATUS', 'ออกใบลดหนี้ได้เฉพาะใบแจ้งหนี้ที่ยืนยันแล้ว');
    const seen = new Set<string>();
    let net = 0;
    for (const l of b.items) {
      if (seen.has(l.salesItemId)) throw badRequest('มีรายการซ้ำ');
      seen.add(l.salesItemId);
      const it = inv.items.find((i) => i.id === l.salesItemId);
      if (!it) throw badRequest('รายการไม่อยู่ในใบแจ้งหนี้นี้');
      if (l.weightKg > num(it.weightKg) - num(it.returnedKg) + 0.0005) throw conflict('OVER_RETURN', `${it.description}: คืนได้ไม่เกิน ${r2(num(it.weightKg) - num(it.returnedKg))} กก.`);
      const maxAmt = r2(num(it.lineTotal) - num(it.discountShare) - num(it.returnedAmount));
      if (l.amount > maxAmt + 0.004) throw conflict('OVER_RETURN', `${it.description}: มูลค่าคืนได้ไม่เกิน ${maxAmt} บาท`);
      net += l.amount;
    }
    const credit = r2(net * (1 + num(inv.vatRate) / 100));
    if (credit > outstanding(inv) + 0.004)
      throw conflict('CREDIT_EXCEEDS_OUTSTANDING', `ยอดลดหนี้ (${credit}) เกินยอดค้างชำระ (${outstanding(inv)}) — หากรับชำระแล้วต้องยกเลิกใบเสร็จหรือคืนเงินก่อน`);
    const cn = await tx.salesReturn.create({
      data: {
        creditNoteNo: await docNo(tx, 'CN'), invoiceId, returnDate: d(b.returnDate), reason: b.reason, amount: credit, createdById: req.user!.id,
        items: { create: b.items.map((l) => ({ salesItemId: l.salesItemId, weightKg: l.weightKg, amount: l.amount })) },
      },
      include: { items: true },
    });
    for (const l of b.items)
      await tx.salesItem.update({ where: { id: l.salesItemId }, data: { returnedKg: { increment: l.weightKg }, returnedAmount: { increment: l.amount } } });
    await tx.salesInvoice.update({ where: { id: invoiceId }, data: { creditedAmount: { increment: credit } } });
    await audit(tx, req, { action: 'CREATE', entityType: 'SalesReturn', entityId: cn.id, after: cn, note: b.reason });
    return cn;
  });
}

/** Net fish revenue for trips (ex-VAT, after discount share and credit notes) — used by settlement & dashboard. */
export async function tripRevenue(tripIds: string[]) {
  const rows = await prisma.salesItem.findMany({
    where: { tripId: { in: tripIds }, invoice: { status: 'CONFIRMED' } },
    select: { tripId: true, weightKg: true, returnedKg: true, lineTotal: true, discountShare: true, returnedAmount: true },
  });
  const m = new Map<string, { soldKg: number; revenue: number }>();
  for (const r of rows) {
    const v = m.get(r.tripId) ?? { soldKg: 0, revenue: 0 };
    v.soldKg += num(r.weightKg) - num(r.returnedKg);
    v.revenue += num(r.lineTotal) - num(r.discountShare) - num(r.returnedAmount);
    m.set(r.tripId, v);
  }
  return m;
}
