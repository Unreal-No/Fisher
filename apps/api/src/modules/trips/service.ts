// Fishing trip workflow. All multi-step changes run in one DB transaction + audit + status history.
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  ACTIVE_TRIP_STATUSES, AT_SEA_STATUSES, beYear, canTransition, PLAN_EDITABLE_STATUSES,
  type arriveSchema, type CrewDocIssue, type departSchema, type tripCreateSchema, type TripSettlement, type TripStatus,
  type tripUpdateSchema,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { assertVesselScope, dt, nextSeq, num } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import { has } from '../../plugins/auth';
import { checklist } from '../employees/docs';
import { fullName } from '../employees/service';
import { tripRevenue } from '../sales/service';
import { logEngineHours } from '../maintenance/service';

export async function getTrip(req: FastifyRequest, id: string, db: Tx | typeof prisma = prisma) {
  const t = await db.fishingTrip.findUnique({ where: { id } });
  if (!t) throw notFound('เที่ยวเรือ');
  assertVesselScope(req, t.vesselId);
  return t;
}

export function assertStatus(t: { status: TripStatus }, allowed: TripStatus[], action: string) {
  if (!allowed.includes(t.status))
    throw conflict('INVALID_TRIP_STATUS', `ไม่สามารถ${action}ในสถานะปัจจุบันของเที่ยวเรือ`, { status: t.status });
}

async function logStatus(tx: Tx, req: FastifyRequest, tripId: string, from: TripStatus | null, to: TripStatus, note?: string | null) {
  await tx.tripStatusHistory.create({ data: { tripId, fromStatus: from, toStatus: to, note: note ?? null, changedById: req.user!.id } });
}

/** Map DB-level conflicts (partial unique index / optimistic version) to business errors. */
export function mapDbConflict(e: unknown): never {
  const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : '';
  if (code === 'P2002') throw conflict('VESSEL_HAS_ACTIVE_TRIP', 'เรือลำนี้มีเที่ยวที่กำลังดำเนินการอยู่แล้ว');
  if (code === 'P2025') throw conflict('STALE_DATA', 'ข้อมูลถูกแก้ไขโดยผู้ใช้อื่น กรุณาโหลดหน้าใหม่');
  throw e;
}

async function assertNoActiveTrip(tx: Tx, vesselId: string, exceptId?: string) {
  const other = await tx.fishingTrip.findFirst({
    where: { vesselId, status: { in: ACTIVE_TRIP_STATUSES }, allowConcurrent: false, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (other) throw conflict('VESSEL_HAS_ACTIVE_TRIP', `เรือลำนี้มีเที่ยว ${other.tripNo} ที่ยังดำเนินการอยู่`, { tripId: other.id });
}

export async function createTrip(req: FastifyRequest, b: z.output<typeof tripCreateSchema>) {
  assertVesselScope(req, b.vesselId);
  const vessel = await prisma.vessel.findFirst({ where: { id: b.vesselId, deletedAt: null } });
  if (!vessel) throw notFound('เรือ');
  if (vessel.status === 'INACTIVE') throw unprocessable('VESSEL_INACTIVE', 'เรือเลิกใช้งานแล้ว');
  if (b.allowConcurrent) {
    if (!has(req, 'trip.approve')) throw forbidden('ต้องมีสิทธิ์อนุมัติจึงจะเปิดเที่ยวซ้อนได้');
    if (!b.overrideReason) throw badRequest('กรุณาระบุเหตุผลการเปิดเที่ยวซ้อน');
  }
  return prisma.$transaction(async (tx) => {
    const year = beYear();
    const seq = await nextSeq(tx, 'TRIP', String(year));
    const trip = await tx.fishingTrip.create({
      data: {
        tripNo: `TRP-${year}-${String(seq).padStart(4, '0')}`,
        vesselId: b.vesselId,
        captainId: b.captainId ?? vessel.captainId,
        plannedDepartureAt: dt(b.plannedDepartureAt),
        plannedReturnAt: dt(b.plannedReturnAt),
        departurePort: b.departurePort ?? vessel.homePort,
        fishingArea: b.fishingArea,
        notes: b.notes,
        allowConcurrent: !!b.allowConcurrent,
        concurrentReason: b.allowConcurrent ? b.overrideReason : null,
        createdById: req.user!.id,
      },
    });
    await logStatus(tx, req, trip.id, null, 'DRAFT');
    await audit(tx, req, { action: 'CREATE', entityType: 'FishingTrip', entityId: trip.id, after: trip });
    if (b.allowConcurrent) await audit(tx, req, { action: 'OVERRIDE', entityType: 'FishingTrip', entityId: trip.id, note: `concurrent: ${b.overrideReason}` });
    return trip;
  });
}

export async function updatePlan(req: FastifyRequest, id: string, b: z.output<typeof tripUpdateSchema>) {
  const before = await getTrip(req, id);
  assertStatus(before, PLAN_EDITABLE_STATUSES, 'แก้ไขแผนเที่ยวเรือ');
  return prisma.$transaction(async (tx) => {
    const after = await tx.fishingTrip.update({
      where: { id },
      data: { ...b, plannedDepartureAt: dt(b.plannedDepartureAt), plannedReturnAt: dt(b.plannedReturnAt), version: { increment: 1 } },
    });
    await audit(tx, req, { action: 'UPDATE', entityType: 'FishingTrip', entityId: id, before, after });
    return after;
  });
}

/** Generic status transitions (not depart/arrive/close/cancel which have their own rules). */
export async function transition(req: FastifyRequest, id: string, to: TripStatus, note?: string | null) {
  const t = await getTrip(req, id);
  if (!canTransition(t.status, to)) throw conflict('INVALID_TRANSITION', 'ไม่สามารถเปลี่ยนสถานะตามที่ขอได้', { from: t.status, to });
  if (t.status === 'PENDING_SETTLEMENT' && to === 'ARRIVED' && !has(req, 'trip.approve')) throw forbidden();
  return prisma
    .$transaction(async (tx) => {
      if (to === 'PREPARING' && !t.allowConcurrent) await assertNoActiveTrip(tx, t.vesselId, id);
      const u = await tx.fishingTrip.update({ where: { id }, data: { status: to, version: { increment: 1 } } });
      await logStatus(tx, req, id, t.status, to, note);
      await audit(tx, req, { action: 'STATUS_CHANGE', entityType: 'FishingTrip', entityId: id, before: { status: t.status }, after: { status: to }, note });
      return u;
    })
    .catch(mapDbConflict);
}

export async function setCrew(req: FastifyRequest, id: string, members: { employeeId: string; role: string; notes?: string | null }[]) {
  const t = await getTrip(req, id);
  assertStatus(t, PLAN_EDITABLE_STATUSES, 'แก้ไขรายชื่อลูกเรือ');
  const ids = [...new Set(members.map((m) => m.employeeId))];
  if (ids.length !== members.length) throw badRequest('มีรายชื่อลูกเรือซ้ำ');
  const emps = await prisma.employee.findMany({ where: { id: { in: ids }, deletedAt: null } });
  if (emps.length !== ids.length) throw badRequest('ไม่พบพนักงานบางรายการ');
  const inactive = emps.filter((e) => e.status !== 'ACTIVE');
  if (inactive.length) throw unprocessable('EMPLOYEE_NOT_ACTIVE', `พนักงานไม่อยู่ในสถานะปฏิบัติงาน: ${inactive.map(fullName).join(', ')}`);
  return prisma.$transaction(async (tx) => {
    const before = await tx.tripCrew.findMany({ where: { tripId: id } });
    await tx.tripCrew.deleteMany({ where: { tripId: id, employeeId: { notIn: ids } } });
    for (const m of members) {
      await tx.tripCrew.upsert({
        where: { tripId_employeeId: { tripId: id, employeeId: m.employeeId } },
        create: { tripId: id, employeeId: m.employeeId, role: m.role as never, notes: m.notes ?? null },
        update: { role: m.role as never, notes: m.notes ?? null },
      });
    }
    await tx.fishingTrip.update({ where: { id }, data: { version: { increment: 1 } } });
    await audit(tx, req, {
      action: 'UPDATE_CREW', entityType: 'FishingTrip', entityId: id,
      before: before.map((c) => c.employeeId), after: ids,
    });
    return tx.tripCrew.findMany({ where: { tripId: id } });
  });
}

/** Departure readiness: crew status, double-booking, required documents. */
export async function crewCheck(tripId: string, at: Date): Promise<{ ok: boolean; issues: CrewDocIssue[] }> {
  const trip = await prisma.fishingTrip.findUniqueOrThrow({
    where: { id: tripId },
    include: { crew: { include: { employee: { include: { documents: true } } } } },
  });
  const people = trip.crew.map((c) => c.employee);
  if (trip.captainId && !people.some((p) => p.id === trip.captainId)) {
    const cap = await prisma.employee.findUnique({ where: { id: trip.captainId }, include: { documents: true } });
    if (cap) people.push(cap);
  }
  const [types, busy] = await Promise.all([
    prisma.documentType.findMany(),
    prisma.tripCrew.findMany({
      where: { employeeId: { in: people.map((p) => p.id) }, tripId: { not: tripId }, trip: { status: { in: AT_SEA_STATUSES } } },
      include: { trip: { select: { tripNo: true } } },
    }),
  ]);
  const ret = trip.plannedReturnAt ?? new Date(at.getTime() + 30 * 86400_000);
  const issues: CrewDocIssue[] = [];
  for (const e of people) {
    const name = fullName(e);
    if (e.status !== 'ACTIVE' || e.deletedAt)
      issues.push({ employeeId: e.id, employeeName: name, documentType: '-', problem: 'NOT_ACTIVE', blocking: true });
    for (const b of busy.filter((x) => x.employeeId === e.id))
      issues.push({ employeeId: e.id, employeeName: name, documentType: b.trip.tripNo, problem: 'ON_OTHER_TRIP', blocking: true });
    for (const c of checklist(e.nationality, e.documents, types, at)) {
      const expiry = c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : null;
      if (c.state === 'MISSING') issues.push({ employeeId: e.id, employeeName: name, documentType: c.nameTh, problem: 'MISSING', blocking: true });
      else if (c.state === 'EXPIRED') issues.push({ employeeId: e.id, employeeName: name, documentType: c.nameTh, problem: 'EXPIRED', expiryDate: expiry, blocking: true });
      else if (c.expiryDate && c.expiryDate < ret)
        issues.push({ employeeId: e.id, employeeName: name, documentType: c.nameTh, problem: 'EXPIRING', expiryDate: expiry, blocking: false });
    }
  }
  return { ok: !issues.some((i) => i.blocking), issues };
}

export async function depart(req: FastifyRequest, id: string, b: z.output<typeof departSchema>) {
  const t = await getTrip(req, id);
  assertStatus(t, ['PREPARING'], 'ยืนยันออกเรือ');
  const departedAt = new Date(b.departedAt);
  if (departedAt.getTime() > Date.now() + 3600_000) throw badRequest('เวลาออกเรือต้องไม่เกินเวลาปัจจุบัน');
  const [vessel, crewCount] = await Promise.all([
    prisma.vessel.findUniqueOrThrow({ where: { id: t.vesselId } }),
    prisma.tripCrew.count({ where: { tripId: id } }),
  ]);
  if (!t.captainId) throw unprocessable('NO_CAPTAIN', 'กรุณากำหนดไต้ก๋ง/นายเรือ');
  if (crewCount === 0) throw unprocessable('NO_CREW', 'กรุณาเพิ่มรายชื่อลูกเรืออย่างน้อย 1 คน');
  if (vessel.status === 'MAINTENANCE' || vessel.status === 'INACTIVE')
    throw unprocessable('VESSEL_NOT_READY', 'เรืออยู่ระหว่างซ่อมบำรุงหรือเลิกใช้งาน');

  const check = await crewCheck(id, departedAt);
  if (vessel.licenseExpiry && vessel.licenseExpiry < departedAt)
    check.issues.push({ employeeId: '-', employeeName: vessel.name, documentType: 'ใบอนุญาตทำการประมง', problem: 'EXPIRED', expiryDate: vessel.licenseExpiry.toISOString().slice(0, 10), blocking: true });
  const blocking = check.issues.filter((i) => i.blocking);
  if (blocking.length) {
    if (!b.override) throw new AppError(422, 'DEPARTURE_CHECK_FAILED', 'ตรวจพบปัญหาเอกสาร/ลูกเรือ ไม่สามารถออกเรือได้', check.issues);
    if (!has(req, 'trip.approve')) throw forbidden('ต้องมีสิทธิ์อนุมัติจึงจะข้ามเงื่อนไขการออกเรือได้');
    if (!b.overrideReason) throw badRequest('กรุณาระบุเหตุผลในการข้ามเงื่อนไข');
  }

  return prisma.$transaction(async (tx) => {
    const atSea = await tx.fishingTrip.findFirst({ where: { vesselId: t.vesselId, id: { not: id }, status: { in: AT_SEA_STATUSES } } });
    if (atSea) throw conflict('VESSEL_AT_SEA', `เรือกำลังอยู่ในเที่ยว ${atSea.tripNo}`);
    const u = await tx.fishingTrip.update({
      where: { id, version: t.version },
      data: {
        status: 'DEPARTED',
        departedAt,
        departurePort: b.departurePort,
        departureLat: b.departureLat,
        departureLng: b.departureLng,
        fuelAtDepartureL: b.fuelAtDepartureL,
        fuelAtDepartureMeasurement: b.fuelAtDepartureMeasurement,
        engineHoursAtDeparture: b.engineHoursAtDeparture,
        conditionNote: b.conditionNote,
        departureOverrideReason: blocking.length ? b.overrideReason : null,
        version: { increment: 1 },
      },
    });
    const crew = await tx.tripCrew.findMany({ where: { tripId: id } });
    for (const c of crew) {
      await tx.tripCrew.update({
        where: { id: c.id },
        data: { docCheck: check.issues.filter((i) => i.employeeId === c.employeeId) as never },
      });
    }
    await tx.vessel.update({ where: { id: t.vesselId }, data: { status: 'AT_SEA' } });
    if (b.engineHoursAtDeparture != null)
      await logEngineHours(tx, req.user!.id, { vesselId: t.vesselId, recordedAt: departedAt, hours: b.engineHoursAtDeparture, source: 'TRIP_DEPARTURE', tripId: id, notes: t.tripNo });
    await logStatus(tx, req, id, t.status, 'DEPARTED');
    await audit(tx, req, { action: 'DEPART', entityType: 'FishingTrip', entityId: id, before: t, after: u });
    if (blocking.length)
      await audit(tx, req, { action: 'OVERRIDE', entityType: 'FishingTrip', entityId: id, after: blocking, note: b.overrideReason });
    return { trip: u, issues: check.issues };
    }).catch(mapDbConflict);
}

export async function arrive(req: FastifyRequest, id: string, b: z.output<typeof arriveSchema>) {
  const t = await getTrip(req, id);
  assertStatus(t, AT_SEA_STATUSES, 'บันทึกเข้าท่า');
  const arrivedAt = new Date(b.arrivedAt);
  if (t.departedAt && arrivedAt < t.departedAt) throw badRequest('เวลาเข้าท่าต้องหลังเวลาออกเรือ');
  if (arrivedAt.getTime() > Date.now() + 3600_000) throw badRequest('เวลาเข้าท่าต้องไม่เกินเวลาปัจจุบัน');
  if (b.engineHoursAtArrival != null && t.engineHoursAtDeparture !== null && b.engineHoursAtArrival < Number(t.engineHoursAtDeparture))
    throw badRequest('ชั่วโมงเครื่องตอนเข้าท่าต้องไม่น้อยกว่าตอนออกเรือ');
  return prisma.$transaction(async (tx) => {
    const u = await tx.fishingTrip.update({
      where: { id, version: t.version },
      data: {
        status: 'ARRIVED',
        arrivedAt,
        arrivalPort: b.arrivalPort,
        arrivalLat: b.arrivalLat,
        arrivalLng: b.arrivalLng,
        fuelAtArrivalL: b.fuelAtArrivalL,
        fuelAtArrivalMeasurement: b.fuelAtArrivalMeasurement,
        engineHoursAtArrival: b.engineHoursAtArrival,
        notes: b.notes ?? t.notes,
        version: { increment: 1 },
      },
    });
    const stillAtSea = await tx.fishingTrip.count({ where: { vesselId: t.vesselId, id: { not: id }, status: { in: AT_SEA_STATUSES } } });
    if (!stillAtSea) await tx.vessel.update({ where: { id: t.vesselId }, data: { status: 'AT_PORT' } });
    if (b.engineHoursAtArrival != null)
      await logEngineHours(tx, req.user!.id, { vesselId: t.vesselId, recordedAt: arrivedAt, hours: b.engineHoursAtArrival, source: 'TRIP_ARRIVAL', tripId: id, notes: t.tripNo });
    await logStatus(tx, req, id, t.status, 'ARRIVED');
    await audit(tx, req, { action: 'ARRIVE', entityType: 'FishingTrip', entityId: id, before: t, after: u });
    return u;
    }).catch(mapDbConflict);
}

/** Trip-based crew pay (daily / per-trip / share / catch) from approved or paid payroll periods. Live — payroll may be approved after the trip closes. */
export async function tripCrewCost(tripId: string) {
  const crew = await prisma.payrollItem.aggregate({
    where: { tripId, code: { in: ['DAILY_WAGE', 'TRIP_PAY', 'REVENUE_SHARE', 'CATCH_PAY'] }, record: { period: { status: { in: ['APPROVED', 'PAID'] } } } },
    _sum: { amount: true },
  });
  return Math.round(num(crew._sum.amount) * 100) / 100;
}

export async function settlement(tripId: string): Promise<TripSettlement> {
  const [t, bySpecies, losses, fuel, supplies, expenses] = await Promise.all([
    prisma.fishingTrip.findUniqueOrThrow({ where: { id: tripId } }),
    prisma.catchRecord.groupBy({ by: ['speciesId'], where: { tripId, voidedAt: null }, _sum: { weightKg: true } }),
    prisma.catchLoss.aggregate({ where: { tripId }, _sum: { weightKg: true } }),
    prisma.tripFuel.findMany({ where: { tripId } }),
    prisma.tripSupply.aggregate({ where: { tripId }, _sum: { totalCost: true } }),
    prisma.tripExpense.groupBy({ by: ['isEstimate'], where: { tripId }, _sum: { amount: true } }),
  ]);
  const species = await prisma.fishSpecies.findMany({ where: { id: { in: bySpecies.map((s) => s.speciesId) } }, select: { id: true, nameTh: true } });
  const catchBySpecies = bySpecies
    .map((s) => ({ speciesId: s.speciesId, nameTh: species.find((x) => x.id === s.speciesId)?.nameTh ?? '-', weightKg: num(s._sum.weightKg) }))
    .sort((a, b) => b.weightKg - a.weightKg);
  const catchKg = catchBySpecies.reduce((a, s) => a + s.weightKg, 0);
  const loadedL = fuel.reduce((a, f) => a + num(f.liters), 0);
  const fuelCost = fuel.reduce((a, f) => a + num(f.totalCost), 0);
  const dep = t.fuelAtDepartureL === null ? null : num(t.fuelAtDepartureL);
  const arr = t.fuelAtArrivalL === null ? null : num(t.fuelAtArrivalL);
  const consumed = dep !== null && arr !== null ? Math.round((dep + loadedL - arr) * 100) / 100 : null;
  const isEstimated =
    t.fuelAtDepartureMeasurement === 'ESTIMATED' || t.fuelAtArrivalMeasurement === 'ESTIMATED' || fuel.some((f) => f.measurement === 'ESTIMATED');
  const exp = num(expenses.find((e) => !e.isEstimate)?._sum.amount);
  const estExp = num(expenses.find((e) => e.isEstimate)?._sum.amount);
  const suppliesCost = num(supplies._sum.totalCost);
  const totalCost = fuelCost + suppliesCost + exp + estExp;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const sales = (await tripRevenue([tripId])).get(tripId) ?? { soldKg: 0, revenue: 0 };
  const crewCost = await tripCrewCost(tripId);
  const engineHours =
    t.engineHoursAtDeparture !== null && t.engineHoursAtArrival !== null ? r2(num(t.engineHoursAtArrival) - num(t.engineHoursAtDeparture)) : null;
  return {
    tripId,
    days: t.departedAt && t.arrivedAt ? r2((t.arrivedAt.getTime() - t.departedAt.getTime()) / 86400_000) : null,
    catchKg: r2(catchKg),
    catchBySpecies,
    lossKg: num(losses._sum.weightKg),
    fuel: { atDepartureL: dep, loadedL: r2(loadedL), atArrivalL: arr, consumedL: consumed, isEstimated, cost: r2(fuelCost) },
    engineHours,
    litersPerEngineHour: consumed !== null && engineHours ? r2(consumed / engineHours) : null,
    suppliesCost: r2(suppliesCost),
    expenses: r2(exp),
    estimatedExpenses: r2(estExp),
    totalCost: r2(totalCost),
    fuelCostPerKg: catchKg > 0 ? r2(fuelCost / catchKg) : null,
    costPerKg: catchKg > 0 ? r2(totalCost / catchKg) : null,
    soldKg: Math.round(sales.soldKg * 1000) / 1000,
    revenue: r2(sales.revenue),
    grossProfit: r2(sales.revenue - totalCost),
    crewCost,
    profitAfterCrew: r2(sales.revenue - totalCost - crewCost),
  };
}

export async function closeTrip(req: FastifyRequest, id: string, note?: string | null) {
  const t = await getTrip(req, id);
  assertStatus(t, ['PENDING_SETTLEMENT'], 'ปิดเที่ยวเรือ');
  const snap = await settlement(id);
  return prisma.$transaction(async (tx) => {
    const u = await tx.fishingTrip.update({
      where: { id, version: t.version },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: req.user!.id, settlementSnapshot: snap as never, version: { increment: 1 } },
    });
    await logStatus(tx, req, id, t.status, 'CLOSED', note);
    await audit(tx, req, { action: 'CLOSE', entityType: 'FishingTrip', entityId: id, after: snap, note });
    return u;
    }).catch(mapDbConflict);
}

export async function cancelTrip(req: FastifyRequest, id: string, reason: string) {
  const t = await getTrip(req, id);
  assertStatus(t, ['DRAFT', 'PREPARING'], 'ยกเลิกเที่ยวเรือ (ยกเลิกได้เฉพาะก่อนออกเรือ)');
  return prisma.$transaction(async (tx) => {
    const u = await tx.fishingTrip.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } },
    });
    await logStatus(tx, req, id, t.status, 'CANCELLED', reason);
    await audit(tx, req, { action: 'CANCEL', entityType: 'FishingTrip', entityId: id, note: reason });
    return u;
  });
}
