// Company fuel tanks: immutable ledger with moving-average cost. Tank row is locked (FOR UPDATE) per posting.
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { beYear, type fuelAdjustSchema, type fuelIssueSchema, type fuelReceiptSchema } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors';
import { assertVesselScope, nextSeq, num } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import { has } from '../../plugins/auth';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

async function lockTank(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM fuel_tanks WHERE id = ${id}::uuid FOR UPDATE`;
  const t = await tx.fuelTank.findUnique({ where: { id } });
  if (!t) throw notFound('ถังน้ำมัน');
  if (!t.isActive) throw badRequest('ถังน้ำมันถูกปิดใช้งาน');
  return { ...t, bal: num(t.balanceL), avg: num(t.avgCost) };
}

async function txnNo(tx: Tx) {
  const y = beYear();
  return `FUEL-${y}-${String(await nextSeq(tx, 'FUEL', String(y))).padStart(5, '0')}`;
}

export async function receive(req: FastifyRequest, b: z.output<typeof fuelReceiptSchema>) {
  return prisma.$transaction(async (tx) => {
    const t = await lockTank(tx, b.tankId);
    const bal = r2(t.bal + b.liters);
    // moving average; a negative/zero opening balance carries no cost information
    const avg = t.bal > 0 ? r4((t.bal * t.avg + b.liters * b.unitPrice) / bal) : b.unitPrice;
    if (t.capacityL && bal > num(t.capacityL)) throw badRequest(`เกินความจุถัง (${num(t.capacityL)} ลิตร)`);
    const row = await tx.fuelTransaction.create({
      data: {
        txnNo: await txnNo(tx), tankId: t.id, type: 'RECEIPT', txnDate: new Date(b.txnDate), liters: b.liters, unitCost: b.unitPrice,
        totalCost: r2(b.liters * b.unitPrice), balanceAfterL: bal, avgCostAfter: avg, supplierName: b.supplierName, docNo: b.docNo,
        fileId: b.fileId, notes: b.notes, measurement: 'MEASURED', createdById: req.user!.id,
      },
    });
    await tx.fuelTank.update({ where: { id: t.id }, data: { balanceL: bal, avgCost: avg } });
    await audit(tx, req, { action: 'CREATE', entityType: 'FuelTransaction', entityId: row.id, after: row });
    return row;
  });
}

/** Issue from tank to a vessel; if a trip is given the cost is booked on the trip (trip_fuel, ledger-linked). */
export async function issue(req: FastifyRequest, b: z.output<typeof fuelIssueSchema>) {
  assertVesselScope(req, b.vesselId);
  const vessel = await prisma.vessel.findFirst({ where: { id: b.vesselId, deletedAt: null } });
  if (!vessel) throw notFound('เรือ');
  if (b.tripId) {
    const trip = await prisma.fishingTrip.findUnique({ where: { id: b.tripId } });
    if (!trip || trip.vesselId !== b.vesselId) throw badRequest('เที่ยวเรือไม่ตรงกับเรือที่เลือก');
    if (['CLOSED', 'CANCELLED'].includes(trip.status)) throw badRequest('เที่ยวเรือปิดหรือยกเลิกแล้ว');
  }
  return prisma.$transaction(async (tx) => {
    const t = await lockTank(tx, b.tankId);
    const short = b.liters > t.bal;
    if (short) {
      if (!b.override)
        throw new AppError(422, 'INSUFFICIENT_FUEL', `น้ำมันในถังไม่พอ (คงเหลือ ${t.bal} ลิตร)`, { balanceL: t.bal });
      if (!has(req, 'fuel.approve')) throw forbidden('ต้องมีสิทธิ์อนุมัติจึงจะจ่ายเกินยอดคงเหลือได้');
      if (!b.overrideReason) throw badRequest('กรุณาระบุเหตุผลการจ่ายเกินยอด');
    }
    const cost = r2(b.liters * t.avg);
    const bal = r2(t.bal - b.liters);
    const tripFuel = b.tripId
      ? await tx.tripFuel.create({
          data: {
            tripId: b.tripId, recordedAt: new Date(b.txnDate), fuelType: t.fuelType, liters: b.liters, pricePerLiter: t.avg,
            totalCost: cost, supplierName: `ถังบริษัท ${t.code}`, measurement: b.measurement, notes: b.notes, createdById: req.user!.id,
          },
        })
      : null;
    const row = await tx.fuelTransaction.create({
      data: {
        txnNo: await txnNo(tx), tankId: t.id, type: 'ISSUE', txnDate: new Date(b.txnDate), liters: -b.liters, unitCost: t.avg,
        totalCost: -cost, balanceAfterL: bal, avgCostAfter: t.avg, vesselId: b.vesselId, tripId: b.tripId ?? null,
        tripFuelId: tripFuel?.id ?? null, measurement: b.measurement, overrideReason: short ? b.overrideReason : null,
        notes: b.notes, createdById: req.user!.id,
      },
    });
    await tx.fuelTank.update({ where: { id: t.id }, data: { balanceL: bal } });
    await audit(tx, req, { action: 'CREATE', entityType: 'FuelTransaction', entityId: row.id, after: row, note: b.tripId ?? undefined });
    if (short) await audit(tx, req, { action: 'OVERRIDE', entityType: 'FuelTransaction', entityId: row.id, note: b.overrideReason });
    return row;
  });
}

/** Dip/meter reading → ADJUSTMENT row for the difference (valued at current average cost). */
export async function adjust(req: FastifyRequest, b: z.output<typeof fuelAdjustSchema>) {
  return prisma.$transaction(async (tx) => {
    const t = await lockTank(tx, b.tankId);
    const delta = r2(b.measuredBalanceL - t.bal);
    if (delta === 0) throw badRequest('ยอดที่วัดได้เท่ากับยอดในระบบ ไม่ต้องปรับ');
    const row = await tx.fuelTransaction.create({
      data: {
        txnNo: await txnNo(tx), tankId: t.id, type: 'ADJUSTMENT', txnDate: new Date(b.txnDate), liters: delta, unitCost: t.avg,
        totalCost: r2(delta * t.avg), balanceAfterL: r2(b.measuredBalanceL), avgCostAfter: t.avg, measurement: 'MEASURED',
        notes: b.reason, createdById: req.user!.id,
      },
    });
    await tx.fuelTank.update({ where: { id: t.id }, data: { balanceL: r2(b.measuredBalanceL) } });
    await audit(tx, req, { action: 'ADJUST', entityType: 'FuelTransaction', entityId: row.id, after: row, note: b.reason });
    return row;
  });
}

/** Fuel performance per trip (arrived in range) and per vessel; consumption flagged when any input is estimated. */
export async function fuelReport(from: Date, to: Date, vesselIds?: string[]) {
  const trips = await prisma.fishingTrip.findMany({
    where: { arrivedAt: { gte: from, lte: to }, status: { notIn: ['CANCELLED'] }, ...(vesselIds ? { vesselId: { in: vesselIds } } : {}) },
    select: {
      id: true, tripNo: true, status: true, departedAt: true, arrivedAt: true, fuelAtDepartureL: true, fuelAtArrivalL: true,
      fuelAtDepartureMeasurement: true, fuelAtArrivalMeasurement: true, engineHoursAtDeparture: true, engineHoursAtArrival: true,
      vessel: { select: { id: true, code: true, name: true } },
    },
    orderBy: { arrivedAt: 'asc' },
    take: 1000,
  });
  const ids = trips.map((t) => t.id);
  const [fuel, est, catches] = await Promise.all([
    prisma.tripFuel.groupBy({ by: ['tripId'], where: { tripId: { in: ids } }, _sum: { liters: true, totalCost: true } }),
    prisma.tripFuel.groupBy({ by: ['tripId'], where: { tripId: { in: ids }, measurement: 'ESTIMATED' }, _count: true }),
    prisma.catchRecord.groupBy({ by: ['tripId'], where: { tripId: { in: ids }, voidedAt: null }, _sum: { weightKg: true } }),
  ]);
  const byTrip = trips.map((t) => {
    const f = fuel.find((x) => x.tripId === t.id);
    const loaded = num(f?._sum.liters);
    const cost = num(f?._sum.totalCost);
    const catchKg = num(catches.find((x) => x.tripId === t.id)?._sum.weightKg);
    const consumed = t.fuelAtDepartureL !== null && t.fuelAtArrivalL !== null ? r2(num(t.fuelAtDepartureL) + loaded - num(t.fuelAtArrivalL)) : null;
    const hours = t.engineHoursAtDeparture !== null && t.engineHoursAtArrival !== null ? r2(num(t.engineHoursAtArrival) - num(t.engineHoursAtDeparture)) : null;
    return {
      tripId: t.id, tripNo: t.tripNo, status: t.status, vessel: t.vessel, departedAt: t.departedAt, arrivedAt: t.arrivedAt,
      days: t.departedAt && t.arrivedAt ? r2((t.arrivedAt.getTime() - t.departedAt.getTime()) / 86400_000) : null,
      loadedL: r2(loaded), consumedL: consumed,
      isEstimated: t.fuelAtDepartureMeasurement === 'ESTIMATED' || t.fuelAtArrivalMeasurement === 'ESTIMATED' || est.some((x) => x.tripId === t.id),
      fuelCost: r2(cost), catchKg: r2(catchKg), fuelCostPerKg: catchKg > 0 ? r2(cost / catchKg) : null,
      litersPerKg: consumed !== null && catchKg > 0 ? r4(consumed / catchKg) : null,
      engineHours: hours, litersPerEngineHour: consumed !== null && hours ? r2(consumed / hours) : null,
    };
  });
  const vmap = new Map<string, { vessel: (typeof byTrip)[number]['vessel']; trips: number; loadedL: number; consumedL: number; consumedTrips: number; fuelCost: number; catchKg: number; isEstimated: boolean }>();
  for (const t of byTrip) {
    const v = vmap.get(t.vessel.id) ?? { vessel: t.vessel, trips: 0, loadedL: 0, consumedL: 0, consumedTrips: 0, fuelCost: 0, catchKg: 0, isEstimated: false };
    v.trips++;
    v.loadedL += t.loadedL;
    v.fuelCost += t.fuelCost;
    v.catchKg += t.catchKg;
    if (t.consumedL !== null) {
      v.consumedL += t.consumedL;
      v.consumedTrips++;
    }
    v.isEstimated ||= t.isEstimated;
    vmap.set(t.vessel.id, v);
  }
  const byVessel = [...vmap.values()].map((v) => ({
    ...v, loadedL: r2(v.loadedL), consumedL: r2(v.consumedL), fuelCost: r2(v.fuelCost), catchKg: r2(v.catchKg),
    fuelCostPerKg: v.catchKg > 0 ? r2(v.fuelCost / v.catchKg) : null,
  }));
  return { range: { from, to }, byTrip, byVessel };
}
