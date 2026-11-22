// Payroll calculation, approval (applies advance recoveries), payment and cancellation.
// Every generated line keeps its formula/inputs in `calc` so a payslip can be explained.
import type { FastifyRequest } from 'fastify';
import { beYear, EARNING_CODES, toISODate, type PayItemCode } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { nextSeq, num } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import { getSettings } from '../../lib/settings';
import { settlement } from '../trips/service';
import { monthlyAmount, overlapDays, pickRule, planRecoveries, type RuleLite } from './calc';

const r2 = (v: number) => Math.round(v * 100) / 100;
const isEarning = (c: string) => (EARNING_CODES as readonly string[]).includes(c);
export const ACTIVE_PERIOD = ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID'] as const;
export const COMMITTED_PERIOD = ['APPROVED', 'PAID'] as const;

interface Line {
  code: PayItemCode;
  description: string;
  quantity?: number | null;
  rate?: number | null;
  amount: number;
  tripId?: string | null;
  ruleId?: string | null;
  advanceId?: string | null;
  calc?: Record<string, unknown>;
}

export async function newPeriodCode(tx: Tx) {
  const y = beYear();
  return `PAY-${y}-${String(await nextSeq(tx, 'PAYROLL', String(y))).padStart(3, '0')}`;
}
export async function newAdvanceNo(tx: Tx) {
  const y = beYear();
  return `ADV-${y}-${String(await nextSeq(tx, 'ADVANCE', String(y))).padStart(4, '0')}`;
}

export async function lockPeriod(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM payroll_periods WHERE id = ${id}::uuid FOR UPDATE`;
  const p = await tx.payrollPeriod.findUnique({ where: { id } });
  if (!p) throw notFound('งวดเงินเดือน');
  return p;
}

/** (Re)calculate a DRAFT/CALCULATED period. Returns employees that could not be calculated, with reasons. */
export async function calculatePeriod(req: FastifyRequest, periodId: string) {
  const settings = await getSettings(prisma);
  return prisma.$transaction(
    async (tx) => {
      const period = await lockPeriod(tx, periodId);
      if (!['DRAFT', 'CALCULATED'].includes(period.status)) throw conflict('INVALID_STATUS', 'คำนวณได้เฉพาะงวดที่ยังไม่อนุมัติ');
      const ps = toISODate(period.startDate);
      const pe = toISODate(period.endDate);
      const today = toISODate(new Date());
      const startTs = new Date(`${ps}T00:00:00+07:00`);
      const endTs = new Date(`${pe}T23:59:59.999+07:00`);
      await tx.payrollRecord.deleteMany({ where: { periodId } });

      const rules: RuleLite[] = (await tx.compensationRule.findMany({ where: { isActive: true } })).map((r) => ({ ...r, rate: num(r.rate) }));
      const trips = await tx.fishingTrip.findMany({
        where: {
          ...(period.vesselId ? { vesselId: period.vesselId } : {}),
          status: { notIn: ['DRAFT', 'PREPARING', 'CANCELLED'] },
          departedAt: { lte: endTs },
          OR: [{ arrivedAt: null }, { arrivedAt: { gte: startTs } }, { closedAt: { gte: startTs, lte: endTs } }],
        },
        select: { id: true, tripNo: true, vesselId: true, departedAt: true, arrivedAt: true, closedAt: true, crew: { select: { employeeId: true, role: true } } },
      });
      const settlements = new Map<string, Awaited<ReturnType<typeof settlement>>>();
      const getSettlement = async (id: string) => {
        if (!settlements.has(id)) settlements.set(id, await settlement(id));
        return settlements.get(id)!;
      };
      const crewIds = [...new Set(trips.flatMap((t) => t.crew.map((c) => c.employeeId)))];
      const adjustments = await tx.payrollAdjustment.findMany({ where: { periodId }, orderBy: { createdAt: 'asc' } });
      const employees = await tx.employee.findMany({
        where: {
          deletedAt: null,
          OR: [
            {
              startDate: { lte: period.endDate },
              AND: [
                { OR: [{ endDate: null }, { endDate: { gte: period.startDate } }] },
                ...(period.vesselId ? [{ OR: [{ currentVesselId: period.vesselId }, { id: { in: crewIds } }] }] : []),
              ],
            },
            { id: { in: adjustments.map((a) => a.employeeId) } },
          ],
        },
        orderBy: { code: 'asc' },
      });
      const empIds = employees.map((e) => e.id);
      // an employee may appear in only one active period per date range
      const overlapping = await tx.payrollRecord.findMany({
        where: {
          employeeId: { in: empIds },
          period: { id: { not: periodId }, status: { in: [...ACTIVE_PERIOD] }, startDate: { lte: period.endDate }, endDate: { gte: period.startDate } },
        },
        select: { employeeId: true, period: { select: { code: true } } },
      });
      // per-trip lines already included in another active period (e.g. period with different dates)
      const paidTrip = await tx.payrollItem.findMany({
        where: {
          tripId: { in: trips.map((t) => t.id) },
          code: { in: ['TRIP_PAY', 'REVENUE_SHARE', 'CATCH_PAY'] },
          record: { employeeId: { in: empIds }, period: { id: { not: periodId }, status: { in: [...ACTIVE_PERIOD] } } },
        },
        select: { tripId: true, code: true, record: { select: { employeeId: true } } },
      });
      const alreadyPaid = (empId: string, tripId: string, code: PayItemCode) =>
        paidTrip.some((p) => p.tripId === tripId && p.code === code && p.record.employeeId === empId);
      const advances = await tx.employeeAdvance.findMany({
        where: { employeeId: { in: empIds }, status: 'OPEN', advanceDate: { lte: period.endDate } },
        orderBy: [{ advanceDate: 'asc' }, { createdAt: 'asc' }],
      });

      const skipped: { employeeId: string; name: string; reason: string }[] = [];
      let totals = { gross: 0, deduction: 0, net: 0, records: 0 };
      for (const e of employees) {
        const name = `${e.code} ${e.firstName} ${e.lastName}`;
        const ov = overlapping.find((o) => o.employeeId === e.id);
        if (ov) {
          skipped.push({ employeeId: e.id, name, reason: `อยู่ในงวด ${ov.period.code} ที่ช่วงวันทับกันแล้ว` });
          continue;
        }
        const lines: Line[] = [];
        const warnings = new Set<string>();
        const fallback = (m: string) => (e.payType === m && e.baseRate ? num(e.baseRate) : null);
        const homeVessel = period.vesselId ?? e.currentVesselId;

        // ---- MONTHLY: prorated per calendar month by employed days ----
        if (!period.vesselId || e.currentVesselId === period.vesselId) {
          const rule = pickRule(rules, 'MONTHLY', { id: e.id, position: e.position }, homeVessel, period.endDate);
          const rate = rule?.rate ?? fallback('MONTHLY');
          if (rate) {
            const m = monthlyAmount(rate, ps, pe, toISODate(e.startDate), e.endDate ? toISODate(e.endDate) : null);
            if (m.amount > 0)
              lines.push({
                code: 'SALARY',
                description: `เงินเดือน ${m.parts.map((p) => `${p.month} (${p.days}/${p.daysInMonth} วัน)`).join(', ')}`,
                rate, amount: m.amount, ruleId: rule?.id ?? null,
                calc: { formula: 'อัตรา × วันทำงานในเดือน ÷ จำนวนวันของเดือน', rate, parts: m.parts, source: rule ? `กฎ: ${rule.name}` : 'อัตราในทะเบียนพนักงาน' },
              });
          }
        }

        // ---- trip-based: rule matched by the role held on that trip ----
        for (const t of trips) {
          const crew = t.crew.find((c) => c.employeeId === e.id);
          if (!crew || !t.departedAt) continue;
          const who = { id: e.id, position: crew.role };
          const src = (r: RuleLite | null) => (r ? `กฎ: ${r.name}` : 'อัตราในทะเบียนพนักงาน');

          const dRule = pickRule(rules, 'DAILY', who, t.vesselId, t.departedAt);
          const dRate = dRule?.rate ?? fallback('DAILY');
          if (dRate) {
            const dep = toISODate(t.departedAt);
            const arr = t.arrivedAt ? toISODate(t.arrivedAt) : pe < today ? pe : today;
            const days = overlapDays(dep, arr, ps, pe);
            if (days > 0)
              lines.push({
                code: 'DAILY_WAGE', description: `ค่าจ้างรายวัน ${t.tripNo} (${days} วัน)`, quantity: days, rate: dRate, amount: r2(days * dRate), tripId: t.id, ruleId: dRule?.id ?? null,
                calc: { formula: 'วันในทะเลที่อยู่ในงวด (นับวันออกและวันเข้า) × อัตรา/วัน', departed: dep, until: arr, atSea: !t.arrivedAt, days, rate: dRate, source: src(dRule) },
              });
          }

          if (t.arrivedAt && t.arrivedAt >= startTs && t.arrivedAt <= endTs && !alreadyPaid(e.id, t.id, 'TRIP_PAY')) {
            const rule = pickRule(rules, 'PER_TRIP', who, t.vesselId, t.arrivedAt);
            const rate = rule?.rate ?? fallback('PER_TRIP');
            if (rate)
              lines.push({
                code: 'TRIP_PAY', description: `ค่าจ้างเหมาเที่ยว ${t.tripNo}`, quantity: 1, rate, amount: r2(rate), tripId: t.id, ruleId: rule?.id ?? null,
                calc: { formula: 'เหมาต่อเที่ยว (เรือเข้าท่าในงวด)', arrivedAt: t.arrivedAt, rate, source: src(rule) },
              });
          }

          if (t.closedAt && t.closedAt >= startTs && t.closedAt <= endTs) {
            const sRule = pickRule(rules, 'REVENUE_SHARE', who, t.vesselId, t.closedAt);
            if (sRule && !alreadyPaid(e.id, t.id, 'REVENUE_SHARE')) {
              const st = await getSettlement(t.id);
              const onProfit = sRule.basis === 'NET_PROFIT';
              const base = onProfit ? Math.max(0, st.grossProfit) : st.revenue;
              lines.push({
                code: 'REVENUE_SHARE', description: `ส่วนแบ่ง ${sRule.rate}% ของ${onProfit ? 'กำไรขั้นต้น' : 'ยอดขาย'} ${t.tripNo}`,
                quantity: base, rate: sRule.rate, amount: r2((base * sRule.rate) / 100), tripId: t.id, ruleId: sRule.id,
                calc: { formula: `${onProfit ? 'กำไรขั้นต้นของเที่ยว (ถ้าติดลบ = 0)' : 'ยอดขายสุทธิของเที่ยว'} × ร้อยละ`, revenue: st.revenue, totalCost: st.totalCost, grossProfit: st.grossProfit, base, percent: sRule.rate, source: src(sRule) },
              });
            }
            const cRule = pickRule(rules, 'CATCH_BASED', who, t.vesselId, t.closedAt);
            if (cRule && !alreadyPaid(e.id, t.id, 'CATCH_PAY')) {
              const st = await getSettlement(t.id);
              const sold = cRule.basis === 'SOLD_KG';
              const kg = sold ? st.soldKg : st.catchKg;
              lines.push({
                code: 'CATCH_PAY', description: `ค่าจ้างตาม${sold ? 'น้ำหนักขาย' : 'น้ำหนักจับ'} ${t.tripNo} (${kg} กก.)`,
                quantity: kg, rate: cRule.rate, amount: r2(kg * cRule.rate), tripId: t.id, ruleId: cRule.id,
                calc: { formula: 'น้ำหนัก (กก.) × บาท/กก.', kg, rate: cRule.rate, source: src(cRule) },
              });
            }
          }
        }

        // ---- manual adjustments ----
        for (const a of adjustments.filter((x) => x.employeeId === e.id))
          lines.push({ code: a.code, description: a.description, amount: num(a.amount), calc: { source: 'รายการปรับปรุงในงวด', adjustmentId: a.id } });

        if (!lines.length) continue;
        const gross = r2(lines.filter((l) => isEarning(l.code)).reduce((s, l) => s + l.amount, 0));
        const otherDed = r2(lines.filter((l) => !isEarning(l.code)).reduce((s, l) => s + l.amount, 0));
        if (otherDed > gross) {
          skipped.push({ employeeId: e.id, name, reason: `รายการหัก (${otherDed}) มากกว่ารายได้ (${gross}) — ยอดสุทธิติดลบไม่ได้` });
          continue;
        }

        // ---- advances / loans: oldest first, never below zero net ----
        const plan = planRecoveries(
          gross - otherDed,
          advances
            .filter((a) => a.employeeId === e.id)
            .map((a) => ({ advanceId: a.id, kind: a.kind, outstanding: r2(num(a.amount) - num(a.recoveredAmount)), installment: a.installment ? num(a.installment) : null })),
        );
        for (const p of plan) {
          if (p.limited) warnings.add('RECOVERY_LIMITED');
          if (p.amount <= 0) continue;
          const adv = advances.find((a) => a.id === p.advanceId)!;
          const outstanding = r2(num(adv.amount) - num(adv.recoveredAmount));
          lines.push({
            code: p.kind === 'LOAN' ? 'LOAN_REPAYMENT' : 'ADVANCE_RECOVERY', description: `${p.kind === 'LOAN' ? 'หักผ่อนเงินกู้' : 'หักเงินเบิกล่วงหน้า'} ${adv.advanceNo}`,
            amount: p.amount, advanceId: adv.id,
            calc: { outstandingBefore: outstanding, installment: adv.installment === null ? null : num(adv.installment), outstandingAfter: r2(outstanding - p.amount), limitedByNet: p.limited },
          });
        }
        const deduction = r2(lines.filter((l) => !isEarning(l.code)).reduce((s, l) => s + l.amount, 0));
        const net = r2(gross - deduction);
        if (gross > 0 && (deduction / gross) * 100 > settings.payrollDeductionWarnPercent) warnings.add('DEDUCTION_OVER_LIMIT');
        if (!gross) warnings.add('NO_EARNINGS');

        await tx.payrollRecord.create({
          data: {
            periodId, employeeId: e.id, vesselId: homeVessel ?? null, position: e.position, gross, deduction, net,
            warnings: warnings.size ? [...warnings] : undefined,
            items: {
              create: lines.map((l) => ({
                code: l.code, description: l.description, quantity: l.quantity ?? null, rate: l.rate ?? null, amount: l.amount,
                tripId: l.tripId ?? null, ruleId: l.ruleId ?? null, advanceId: l.advanceId ?? null, calc: (l.calc ?? undefined) as never,
              })),
            },
          },
        });
        totals = { gross: r2(totals.gross + gross), deduction: r2(totals.deduction + deduction), net: r2(totals.net + net), records: totals.records + 1 };
      }
      const after = await tx.payrollPeriod.update({
        where: { id: periodId },
        data: { status: 'CALCULATED', totalGross: totals.gross, totalDeduction: totals.deduction, totalNet: totals.net, calculatedAt: new Date(), calculatedById: req.user!.id },
      });
      await audit(tx, req, { action: 'CALCULATE', entityType: 'PayrollPeriod', entityId: periodId, after: { ...totals, skipped } });
      return { period: after, ...totals, skipped };
    },
    { timeout: 60_000 },
  );
}

/** Approve: segregation of duties, re-check overlap, then apply advance/loan recoveries (rows locked). */
export async function approvePeriod(req: FastifyRequest, periodId: string) {
  return prisma.$transaction(async (tx) => {
    const p = await lockPeriod(tx, periodId);
    if (p.status !== 'CALCULATED') throw conflict('INVALID_STATUS', 'อนุมัติได้เฉพาะงวดที่คำนวณแล้ว');
    if (p.calculatedById === req.user!.id) throw forbidden('ผู้คำนวณไม่สามารถอนุมัติงวดเดียวกันได้ (แบ่งแยกหน้าที่)');
    const clash = await tx.payrollRecord.findFirst({
      where: {
        employeeId: { in: (await tx.payrollRecord.findMany({ where: { periodId }, select: { employeeId: true } })).map((r) => r.employeeId) },
        period: { id: { not: periodId }, status: { in: [...COMMITTED_PERIOD] }, startDate: { lte: p.endDate }, endDate: { gte: p.startDate } },
      },
      select: { period: { select: { code: true } } },
    });
    if (clash) throw conflict('PERIOD_OVERLAP', `มีพนักงานอยู่ในงวด ${clash.period.code} ที่อนุมัติแล้วและช่วงวันทับกัน กรุณาคำนวณใหม่`);
    const items = await tx.payrollItem.findMany({ where: { record: { periodId }, advanceId: { not: null } }, orderBy: { id: 'asc' } });
    for (const it of items) {
      await tx.$queryRaw`SELECT id FROM employee_advances WHERE id = ${it.advanceId}::uuid FOR UPDATE`;
      const a = await tx.employeeAdvance.findUniqueOrThrow({ where: { id: it.advanceId! } });
      const outstanding = r2(num(a.amount) - num(a.recoveredAmount));
      if (a.status !== 'OPEN' || num(it.amount) > outstanding + 0.004)
        throw conflict('ADVANCE_CHANGED', `ยอดค้างของ ${a.advanceNo} เปลี่ยนไปแล้ว กรุณาคำนวณงวดใหม่`);
      const recovered = r2(num(a.recoveredAmount) + num(it.amount));
      await tx.employeeAdvance.update({ where: { id: a.id }, data: { recoveredAmount: recovered, status: recovered >= num(a.amount) - 0.004 ? 'SETTLED' : 'OPEN' } });
    }
    const after = await tx.payrollPeriod.update({ where: { id: periodId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: req.user!.id } });
    await audit(tx, req, { action: 'APPROVE', entityType: 'PayrollPeriod', entityId: periodId, before: { status: p.status }, after: { status: after.status, totalNet: after.totalNet, recoveries: items.length } });
    return after;
  });
}

export async function payPeriod(req: FastifyRequest, periodId: string, b: { paidAt: string; method: string; reference?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const p = await lockPeriod(tx, periodId);
    if (p.status !== 'APPROVED') throw conflict('INVALID_STATUS', 'บันทึกจ่ายได้เฉพาะงวดที่อนุมัติแล้ว');
    const paidAt = new Date(b.paidAt);
    if (paidAt.getTime() > Date.now() + 3600_000) throw badRequest('วันที่จ่ายต้องไม่เกินปัจจุบัน');
    const after = await tx.payrollPeriod.update({
      where: { id: periodId },
      data: { status: 'PAID', paidAt, payMethod: b.method as never, payReference: b.reference ?? null },
    });
    await audit(tx, req, { action: 'PAY', entityType: 'PayrollPeriod', entityId: periodId, before: { status: p.status }, after: { status: 'PAID', paidAt, method: b.method, reference: b.reference } });
    return after;
  });
}

/** Cancel before payment. An approved period gives back the advance recoveries it applied. */
export async function cancelPeriod(req: FastifyRequest, periodId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const p = await lockPeriod(tx, periodId);
    if (p.status === 'PAID') throw conflict('INVALID_STATUS', 'งวดที่จ่ายแล้วยกเลิกไม่ได้');
    if (p.status === 'CANCELLED') throw conflict('INVALID_STATUS', 'งวดนี้ถูกยกเลิกแล้ว');
    let reversed = 0;
    if (p.status === 'APPROVED') {
      const items = await tx.payrollItem.findMany({ where: { record: { periodId }, advanceId: { not: null } }, orderBy: { id: 'asc' } });
      for (const it of items) {
        await tx.$queryRaw`SELECT id FROM employee_advances WHERE id = ${it.advanceId}::uuid FOR UPDATE`;
        const a = await tx.employeeAdvance.findUniqueOrThrow({ where: { id: it.advanceId! } });
        const recovered = r2(num(a.recoveredAmount) - num(it.amount));
        if (recovered < -0.004) throw conflict('ADVANCE_CHANGED', `ยอดหักของ ${a.advanceNo} ไม่ตรงกับบัญชีเงินเบิก`);
        await tx.employeeAdvance.update({ where: { id: a.id }, data: { recoveredAmount: Math.max(0, recovered), status: 'OPEN' } });
        reversed++;
      }
    }
    const after = await tx.payrollPeriod.update({ where: { id: periodId }, data: { status: 'CANCELLED', cancelReason: reason } });
    await audit(tx, req, { action: 'CANCEL', entityType: 'PayrollPeriod', entityId: periodId, before: { status: p.status }, after: { status: 'CANCELLED', reversedRecoveries: reversed }, note: reason });
    return after;
  });
}

/** Any change to inputs of a calculated period sends it back to DRAFT (must recalculate before approval). */
export async function markDirty(tx: Tx, periodId: string) {
  const p = await lockPeriod(tx, periodId);
  if (!['DRAFT', 'CALCULATED'].includes(p.status)) throw conflict('INVALID_STATUS', 'แก้ไขได้เฉพาะงวดที่ยังไม่อนุมัติ');
  if (p.status === 'CALCULATED') await tx.payrollPeriod.update({ where: { id: periodId }, data: { status: 'DRAFT' } });
  return p;
}
