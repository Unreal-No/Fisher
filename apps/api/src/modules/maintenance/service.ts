// Maintenance: plans (due by days and/or engine hours), engine-hour meter log, work orders with parts from stock.
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  AT_SEA_STATUSES, beYear, daysUntil, formatDate, toISODate, type DueState, type maintenanceCompleteSchema, type maintenanceOrderSchema,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { assertVesselScope, nextSeq, num } from '../../lib/http';
import { prisma, type DbOrTx, type Tx } from '../../lib/prisma';
import { getSettings } from '../../lib/settings';
import { postMovement } from '../inventory/stock';

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------- engine hours ----------
export async function currentEngineHours(db: DbOrTx, vesselId: string, at?: Date) {
  const last = await db.engineHourLog.findFirst({
    where: { vesselId, ...(at ? { recordedAt: { lte: at } } : {}) },
    orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
  });
  return last ? num(last.hours) : null;
}

/** Meter readings may not go backwards unless flagged as a reset (engine/meter replaced). */
export async function logEngineHours(
  tx: Tx,
  userId: string,
  e: { vesselId: string; recordedAt: Date; hours: number; source: 'MANUAL' | 'TRIP_DEPARTURE' | 'TRIP_ARRIVAL' | 'MAINTENANCE'; isReset?: boolean; tripId?: string | null; orderId?: string | null; notes?: string | null },
) {
  const prev = await currentEngineHours(tx, e.vesselId, e.recordedAt);
  if (prev !== null && e.hours < prev && !e.isReset)
    throw conflict('ENGINE_HOURS_DECREASE', `ชั่วโมงเครื่อง (${e.hours}) ต่ำกว่าค่าก่อนหน้า (${prev}) — หากเปลี่ยนเครื่อง/มิเตอร์ ให้บันทึกเป็นการรีเซ็ตพร้อมเหตุผล`);
  if (e.isReset && !e.notes) throw badRequest('กรุณาระบุเหตุผลการรีเซ็ตมิเตอร์');
  // a back-dated reading must also not exceed the next later reading (unless that one is a reset)
  const next = await tx.engineHourLog.findFirst({ where: { vesselId: e.vesselId, recordedAt: { gt: e.recordedAt } }, orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }] });
  if (next && !next.isReset && e.hours > num(next.hours))
    throw conflict('ENGINE_HOURS_DECREASE', `ชั่วโมงเครื่อง (${e.hours}) สูงกว่าค่าที่บันทึกภายหลัง (${num(next.hours)}) — ตรวจสอบวันเวลาที่บันทึก`);
  return tx.engineHourLog.create({
    data: {
      vesselId: e.vesselId, recordedAt: e.recordedAt, hours: e.hours, source: e.source, isReset: !!e.isReset, tripId: e.tripId ?? null,
      orderId: e.orderId ?? null, notes: e.notes ?? null, createdById: userId,
    },
  });
}

// ---------- plans ----------
interface PlanLite {
  intervalDays: number | null;
  intervalEngineHours: number | null;
  lastDoneAt: Date | null;
  lastDoneEngineHours: unknown;
}
export function planDue(p: PlanLite, currentHours: number | null, cfg: { days: number; hours: number }, today = new Date()) {
  const nextDueDate = p.intervalDays && p.lastDoneAt ? new Date(p.lastDoneAt.getTime() + p.intervalDays * 86400_000) : null;
  const nextDueHours = p.intervalEngineHours && p.lastDoneEngineHours != null ? num(p.lastDoneEngineHours) + p.intervalEngineHours : null;
  const daysLeft = nextDueDate ? daysUntil(nextDueDate, today) : null;
  const hoursLeft = nextDueHours !== null && currentHours !== null ? r2(nextDueHours - currentHours) : null;
  let state: DueState = 'OK';
  if (nextDueDate === null && nextDueHours === null) state = 'NO_BASELINE';
  else if ((daysLeft !== null && daysLeft < 0) || (hoursLeft !== null && hoursLeft <= 0)) state = 'OVERDUE';
  else if ((daysLeft !== null && daysLeft <= cfg.days) || (hoursLeft !== null && hoursLeft <= cfg.hours)) state = 'DUE_SOON';
  return { nextDueDate, nextDueHours, daysLeft, hoursLeft, state };
}

export async function plansWithDue(where: { vesselIds?: string[]; vesselId?: string; activeOnly?: boolean }) {
  const s = await getSettings(prisma);
  const cfg = { days: s.maintenanceReminderDays, hours: s.maintenanceReminderHours };
  const plans = await prisma.maintenancePlan.findMany({
    where: {
      ...(where.vesselId ? { vesselId: where.vesselId } : where.vesselIds ? { vesselId: { in: where.vesselIds } } : {}),
      ...(where.activeOnly ? { isActive: true } : {}),
      vessel: { deletedAt: null },
    },
    include: { vessel: { select: { id: true, code: true, name: true } } },
    orderBy: [{ vesselId: 'asc' }, { name: 'asc' }],
  });
  const hours = new Map<string, number | null>();
  for (const vid of new Set(plans.map((p) => p.vesselId))) hours.set(vid, await currentEngineHours(prisma, vid));
  return plans.map((p) => ({ ...p, currentEngineHours: hours.get(p.vesselId) ?? null, due: planDue(p, hours.get(p.vesselId) ?? null, cfg) }));
}

/** Reminders for plans due soon/overdue (dedupe per plan + state + due point). */
export async function scanMaintenanceDue() {
  const due = (await plansWithDue({ activeOnly: true })).filter((p) => p.due.state === 'DUE_SOON' || p.due.state === 'OVERDUE');
  if (!due.length) return { due: 0, created: 0 };
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, roles: { some: { role: { permissions: { some: { permission: { code: 'maintenance.view' } } } } } } },
    select: { id: true },
  });
  const res = await prisma.notification.createMany({
    data: due.flatMap((p) => {
      const when = [p.due.nextDueDate ? `ครบ ${formatDate(p.due.nextDueDate)}` : '', p.due.nextDueHours !== null ? `ที่ ${p.due.nextDueHours} ชม.เครื่อง` : ''].filter(Boolean).join(' / ');
      return users.map((u) => ({
        userId: u.id, type: 'MAINTENANCE_DUE', severity: p.due.state === 'OVERDUE' ? ('CRITICAL' as const) : ('WARNING' as const),
        title: `${p.due.state === 'OVERDUE' ? 'เกินกำหนด' : 'ใกล้ถึงกำหนด'}ซ่อมบำรุง: ${p.name}`,
        message: `${p.vessel.code} ${p.vessel.name} · ${when}`,
        link: `/maintenance?tab=plans&vesselId=${p.vesselId}`, entityType: 'MaintenancePlan', entityId: p.id,
        dedupeKey: `maint:${p.id}:${p.due.state}:${p.due.nextDueDate?.toISOString().slice(0, 10) ?? ''}:${p.due.nextDueHours ?? ''}`,
      }));
    }),
    skipDuplicates: true,
  });
  return { due: due.length, created: res.count };
}

// ---------- orders ----------
async function lockOrder(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM maintenance_orders WHERE id = ${id}::uuid FOR UPDATE`;
  const o = await tx.maintenanceOrder.findUnique({ where: { id } });
  if (!o) throw notFound('ใบสั่งซ่อม');
  return o;
}
const assertOpen = (status: string, what: string) => {
  if (!['OPEN', 'IN_PROGRESS'].includes(status)) throw conflict('INVALID_STATUS', `ไม่สามารถ${what}ในสถานะปัจจุบัน`, { status });
};

/** Put the vessel back to AT_PORT when no other out-of-service order is still in progress. */
async function releaseVessel(tx: Tx, vesselId: string, exceptOrderId: string) {
  const others = await tx.maintenanceOrder.count({ where: { vesselId, id: { not: exceptOrderId }, status: 'IN_PROGRESS', takesOutOfService: true } });
  const v = await tx.vessel.findUniqueOrThrow({ where: { id: vesselId } });
  if (!others && v.status === 'MAINTENANCE') await tx.vessel.update({ where: { id: vesselId }, data: { status: 'AT_PORT' } });
}

async function checkRefs(vesselId: string, planId?: string | null, providerId?: string | null) {
  const v = await prisma.vessel.findFirst({ where: { id: vesselId, deletedAt: null } });
  if (!v) throw notFound('เรือ');
  if (planId) {
    const p = await prisma.maintenancePlan.findUnique({ where: { id: planId } });
    if (!p || p.vesselId !== vesselId) throw badRequest('แผนบำรุงรักษาไม่ตรงกับเรือ');
  }
  if (providerId) {
    const s = await prisma.supplier.findFirst({ where: { id: providerId, deletedAt: null } });
    if (!s) throw badRequest('ไม่พบผู้ให้บริการ');
  }
}

export async function createOrder(req: FastifyRequest, b: z.output<typeof maintenanceOrderSchema>) {
  assertVesselScope(req, b.vesselId);
  await checkRefs(b.vesselId, b.planId, b.providerId);
  return prisma.$transaction(async (tx) => {
    const y = beYear();
    const o = await tx.maintenanceOrder.create({
      data: {
        orderNo: `MO-${y}-${String(await nextSeq(tx, 'MO', String(y))).padStart(4, '0')}`, vesselId: b.vesselId, planId: b.planId ?? null,
        title: b.title, category: b.category, type: b.type, priority: b.priority, reportedAt: new Date(b.reportedAt),
        takesOutOfService: b.takesOutOfService, providerId: b.providerId ?? null, description: b.description ?? null, createdById: req.user!.id,
      },
    });
    await audit(tx, req, { action: 'CREATE', entityType: 'MaintenanceOrder', entityId: o.id, after: o });
    return o;
  });
}

export async function updateOrder(req: FastifyRequest, id: string, b: Partial<z.output<typeof maintenanceOrderSchema>>) {
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    assertVesselScope(req, o.vesselId);
    assertOpen(o.status, 'แก้ไขใบสั่งซ่อม');
    if (b.vesselId && b.vesselId !== o.vesselId) throw badRequest('เปลี่ยนเรือของใบสั่งซ่อมไม่ได้');
    if (o.status === 'IN_PROGRESS' && b.takesOutOfService !== undefined && b.takesOutOfService !== o.takesOutOfService)
      throw conflict('INVALID_STATUS', 'เปลี่ยนการหยุดเรือได้เฉพาะก่อนเริ่มซ่อม');
    await checkRefs(o.vesselId, b.planId, b.providerId);
    const after = await tx.maintenanceOrder.update({
      where: { id },
      data: {
        title: b.title, category: b.category, type: b.type, priority: b.priority, planId: b.planId, providerId: b.providerId,
        takesOutOfService: b.takesOutOfService, description: b.description, version: { increment: 1 },
        ...(b.reportedAt ? { reportedAt: new Date(b.reportedAt) } : {}),
      },
    });
    await audit(tx, req, { action: 'UPDATE', entityType: 'MaintenanceOrder', entityId: id, before: o, after });
    return after;
  });
}

export async function startOrder(req: FastifyRequest, id: string) {
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    assertVesselScope(req, o.vesselId);
    if (o.status !== 'OPEN') throw conflict('INVALID_STATUS', 'เริ่มซ่อมได้เฉพาะใบสั่งซ่อมที่รอดำเนินการ');
    if (o.takesOutOfService) {
      const atSea = await tx.fishingTrip.findFirst({ where: { vesselId: o.vesselId, status: { in: AT_SEA_STATUSES } } });
      if (atSea) throw conflict('VESSEL_AT_SEA', `เรืออยู่ระหว่างเที่ยว ${atSea.tripNo} ไม่สามารถหยุดเรือเพื่อซ่อมได้`);
      await tx.vessel.update({ where: { id: o.vesselId }, data: { status: 'MAINTENANCE' } });
    }
    const after = await tx.maintenanceOrder.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 } } });
    await audit(tx, req, { action: 'STATUS_CHANGE', entityType: 'MaintenanceOrder', entityId: id, before: { status: o.status }, after: { status: 'IN_PROGRESS' } });
    return after;
  });
}

export async function issuePart(req: FastifyRequest, id: string, b: { warehouseId: string; itemId: string; quantity: number; notes?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    assertVesselScope(req, o.vesselId);
    assertOpen(o.status, 'เบิกอะไหล่');
    const mv = await postMovement(tx, {
      type: 'ISSUE', warehouseId: b.warehouseId, itemId: b.itemId, quantity: -b.quantity, movedAt: new Date(), refType: 'MAINTENANCE',
      refId: id, vesselId: o.vesselId, notes: b.notes ?? o.orderNo, userId: req.user!.id,
    });
    await tx.maintenanceOrder.update({ where: { id }, data: { partsCost: { increment: -num(mv.totalCost) }, version: { increment: 1 } } });
    await audit(tx, req, { action: 'ISSUE_PART', entityType: 'MaintenanceOrder', entityId: id, after: mv });
    return mv;
  });
}

export async function completeOrder(req: FastifyRequest, id: string, b: z.output<typeof maintenanceCompleteSchema>) {
  if (b.providerId) await checkRefs((await prisma.maintenanceOrder.findUniqueOrThrow({ where: { id } })).vesselId, null, b.providerId);
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    assertVesselScope(req, o.vesselId);
    assertOpen(o.status, 'ปิดงานซ่อม');
    let completedAt = new Date(b.completedAt);
    if (completedAt.getTime() > Date.now() + 3600_000) throw badRequest('วันที่เสร็จต้องไม่เกินปัจจุบัน');
    if (o.startedAt && completedAt < o.startedAt) {
      // datetime inputs have minute precision: tolerate the same minute, otherwise reject
      if (o.startedAt.getTime() - completedAt.getTime() >= 60_000) throw badRequest('วันที่เสร็จต้องหลังวันที่เริ่มซ่อม');
      completedAt = o.startedAt;
    }
    if (b.engineHours != null)
      await logEngineHours(tx, req.user!.id, { vesselId: o.vesselId, recordedAt: completedAt, hours: b.engineHours, source: 'MAINTENANCE', orderId: id, notes: o.orderNo });
    const after = await tx.maintenanceOrder.update({
      where: { id },
      data: {
        status: 'COMPLETED', completedAt, startedAt: o.startedAt ?? completedAt, engineHours: b.engineHours ?? null, findings: b.findings ?? null,
        laborCost: b.laborCost ?? 0, externalCost: b.externalCost ?? 0, providerId: b.providerId ?? o.providerId, invoiceNo: b.invoiceNo ?? null,
        version: { increment: 1 },
      },
    });
    if (o.planId) {
      const hours = b.engineHours ?? (await currentEngineHours(tx, o.vesselId, completedAt));
      await tx.maintenancePlan.update({
        where: { id: o.planId },
        data: { lastDoneAt: new Date(`${toISODate(completedAt)}T00:00:00.000Z`), ...(hours !== null ? { lastDoneEngineHours: hours } : {}) },
      });
    }
    if (o.takesOutOfService) await releaseVessel(tx, o.vesselId, id);
    await audit(tx, req, { action: 'COMPLETE', entityType: 'MaintenanceOrder', entityId: id, before: o, after });
    return after;
  });
}

export async function cancelOrder(req: FastifyRequest, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    assertVesselScope(req, o.vesselId);
    assertOpen(o.status, 'ยกเลิกใบสั่งซ่อม');
    if (num(o.partsCost) > 0) throw conflict('HAS_PARTS', 'มีการเบิกอะไหล่แล้ว ให้ปิดงานแทนการยกเลิก');
    const after = await tx.maintenanceOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, version: { increment: 1 } } });
    if (o.takesOutOfService && o.status === 'IN_PROGRESS') await releaseVessel(tx, o.vesselId, id);
    await audit(tx, req, { action: 'CANCEL', entityType: 'MaintenanceOrder', entityId: id, note: reason });
    return after;
  });
}
