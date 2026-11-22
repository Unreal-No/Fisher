import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ADVANCE_STATUS, advanceSchema, compensationRuleSchema, PAYROLL_STATUS, payrollAdjustmentSchema, payrollPaySchema, payrollPeriodSchema,
  reasonSchema, type AdvanceStatus, type PayrollStatus,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { assertVesselScope, d, idParam, num, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { has } from '../../plugins/auth';
import { Prisma, prisma } from '../../lib/prisma';
import { getSettings } from '../../lib/settings';
import { maskEmployee } from '../employees/service';
import { approvePeriod, calculatePeriod, cancelPeriod, markDirty, newAdvanceNo, newPeriodCode, payPeriod } from './service';

const empSel = { select: { id: true, code: true, firstName: true, lastName: true, position: true, nationality: true } } as const;
const vesselSel = { select: { id: true, code: true, name: true } } as const;

/** Scoped users (vessel-limited) only see payroll of their vessels; company-wide periods are hidden from them. */
const periodScope = (req: FastifyRequest): Prisma.PayrollPeriodWhereInput => {
  const s = scopeIds(req);
  return s ? { vesselId: { in: s } } : {};
};
async function userNames(ids: (string | null)[]) {
  const list = ids.filter((x): x is string => !!x);
  const rows = list.length ? await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.fullName]));
}
async function getPeriod(req: FastifyRequest, id: string) {
  const p = await prisma.payrollPeriod.findFirst({ where: { id, ...periodScope(req) } });
  if (!p) throw notFound('งวดเงินเดือน');
  return p;
}

export default async function payrollRoutes(app: FastifyInstance) {
  // ---------- compensation rules ----------
  app.get('/rules', { preHandler: app.can('payroll.view') }, async (req) => {
    const f = req.query as { active?: string };
    return prisma.compensationRule.findMany({
      where: f.active === 'true' ? { isActive: true } : {},
      orderBy: [{ isActive: 'desc' }, { method: 'asc' }, { effectiveFrom: 'desc' }],
      include: { vessel: vesselSel, employee: empSel },
    });
  });
  const ruleData = (b: ReturnType<typeof compensationRuleSchema.parse>) => ({ ...b, effectiveFrom: d(b.effectiveFrom), effectiveTo: d(b.effectiveTo ?? null) });
  app.post('/rules', { preHandler: app.can('payroll.edit') }, async (req, reply) => {
    const b = parse(compensationRuleSchema, req.body);
    if (b.vesselId) assertVesselScope(req, b.vesselId);
    const r = await prisma.$transaction(async (tx) => {
      const r = await tx.compensationRule.create({ data: ruleData(b) as Prisma.CompensationRuleUncheckedCreateInput });
      await audit(tx, req, { action: 'CREATE', entityType: 'CompensationRule', entityId: r.id, after: r });
      return r;
    });
    return reply.status(201).send(r);
  });
  app.put('/rules/:id', { preHandler: app.can('payroll.edit') }, async (req) => {
    const id = idParam(req);
    const b = parse(compensationRuleSchema, req.body);
    if (b.vesselId) assertVesselScope(req, b.vesselId);
    return prisma.$transaction(async (tx) => {
      const before = await tx.compensationRule.findUnique({ where: { id } });
      if (!before) throw notFound('กฎค่าตอบแทน');
      const after = await tx.compensationRule.update({ where: { id }, data: ruleData(b) as Prisma.CompensationRuleUncheckedUpdateInput });
      await audit(tx, req, { action: 'UPDATE', entityType: 'CompensationRule', entityId: id, before, after });
      return after;
    });
  });

  // ---------- advances & loans ----------
  app.get('/advances', { preHandler: app.can('payroll.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const s = scopeIds(req);
    const where: Prisma.EmployeeAdvanceWhereInput = {
      ...((ADVANCE_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as AdvanceStatus } : {}),
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
      ...(s ? { employee: { currentVesselId: { in: s } } } : {}),
      ...(q.q ? { OR: [{ advanceNo: { contains: q.q, mode: 'insensitive' } }, { employee: { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }] } }] } : {}),
    };
    const [items, total, open] = await Promise.all([
      prisma.employeeAdvance.findMany({ where, orderBy: [{ advanceDate: 'desc' }, { createdAt: 'desc' }], include: { employee: empSel }, ...paging(q) }),
      prisma.employeeAdvance.count({ where }),
      prisma.employeeAdvance.aggregate({ where: { ...where, status: 'OPEN' }, _sum: { amount: true, recoveredAmount: true } }),
    ]);
    return { ...paged(items.map((a) => ({ ...a, outstanding: (num(a.amount) - num(a.recoveredAmount)).toFixed(2) })), total, q), outstandingTotal: (num(open._sum.amount) - num(open._sum.recoveredAmount)).toFixed(2) };
  });
  app.post('/advances', { preHandler: app.can('payroll.edit') }, async (req, reply) => {
    const b = parse(advanceSchema, req.body);
    const emp = await prisma.employee.findFirst({ where: { id: b.employeeId, deletedAt: null } });
    if (!emp) throw notFound('พนักงาน');
    if (emp.currentVesselId) assertVesselScope(req, emp.currentVesselId);
    else if (scopeIds(req)) throw forbidden('ไม่มีสิทธิ์เข้าถึงพนักงานนี้');
    if (b.installment != null && b.installment > b.amount) throw badRequest('ยอดผ่อนต่องวดต้องไม่เกินยอดกู้');
    const row = await prisma.$transaction(async (tx) => {
      const a = await tx.employeeAdvance.create({
        data: { ...b, installment: b.kind === 'LOAN' ? b.installment : null, advanceDate: d(b.advanceDate), advanceNo: await newAdvanceNo(tx), createdById: req.user!.id },
      });
      await audit(tx, req, { action: 'CREATE', entityType: 'EmployeeAdvance', entityId: a.id, after: a });
      return a;
    });
    return reply.status(201).send(row);
  });
  app.post('/advances/:id/cancel', { preHandler: app.can('payroll.approve') }, async (req) => {
    const id = idParam(req);
    const { reason } = parse(reasonSchema, req.body);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_advances WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.employeeAdvance.findUnique({ where: { id }, include: { employee: { select: { currentVesselId: true } } } });
      if (!a) throw notFound('รายการเงินเบิก');
      if (a.employee.currentVesselId) assertVesselScope(req, a.employee.currentVesselId);
      if (a.status !== 'OPEN' || num(a.recoveredAmount) > 0) throw conflict('INVALID_STATUS', 'ยกเลิกได้เฉพาะรายการที่ยังไม่เคยถูกหักคืน');
      const after = await tx.employeeAdvance.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason } });
      await audit(tx, req, { action: 'CANCEL', entityType: 'EmployeeAdvance', entityId: id, before: { status: a.status }, after: { status: after.status }, note: reason });
      return after;
    });
  });

  // ---------- periods ----------
  app.get('/periods', { preHandler: app.can('payroll.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.PayrollPeriodWhereInput = {
      ...periodScope(req),
      ...((PAYROLL_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as PayrollStatus } : {}),
      ...(f.vesselId ? { vesselId: f.vesselId } : {}),
      ...(q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.payrollPeriod.findMany({ where, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], include: { vessel: vesselSel, _count: { select: { records: true } } }, ...paging(q) }),
      prisma.payrollPeriod.count({ where }),
    ]);
    return paged(items, total, q);
  });
  app.post('/periods', { preHandler: app.can('payroll.edit') }, async (req, reply) => {
    const b = parse(payrollPeriodSchema, req.body);
    if (b.vesselId) assertVesselScope(req, b.vesselId);
    else if (scopeIds(req)) throw forbidden('ผู้ใช้ที่จำกัดเฉพาะเรือต้องเลือกเรือของงวด');
    const p = await prisma.$transaction(async (tx) => {
      const p = await tx.payrollPeriod.create({
        data: { ...b, startDate: d(b.startDate), endDate: d(b.endDate), payDate: d(b.payDate ?? null), code: await newPeriodCode(tx), createdById: req.user!.id },
      });
      await audit(tx, req, { action: 'CREATE', entityType: 'PayrollPeriod', entityId: p.id, after: p });
      return p;
    });
    return reply.status(201).send(p);
  });
  app.get('/periods/:id', { preHandler: app.can('payroll.view') }, async (req) => {
    const p = await prisma.payrollPeriod.findFirst({
      where: { id: idParam(req), ...periodScope(req) },
      include: {
        vessel: vesselSel,
        records: { orderBy: { employee: { code: 'asc' } }, include: { employee: empSel, vessel: vesselSel } },
        adjustments: { orderBy: { createdAt: 'asc' }, include: { employee: empSel } },
      },
    });
    if (!p) throw notFound('งวดเงินเดือน');
    const users = await userNames([p.createdById, p.calculatedById, p.approvedById]);
    return {
      ...p,
      createdByName: users.get(p.createdById ?? '') ?? null,
      calculatedByName: users.get(p.calculatedById ?? '') ?? null,
      approvedByName: users.get(p.approvedById ?? '') ?? null,
      needsRecalc: p.status === 'DRAFT' && p.calculatedAt !== null,
    };
  });
  app.put('/periods/:id', { preHandler: app.can('payroll.edit') }, async (req) => {
    const id = idParam(req);
    const before = await getPeriod(req, id);
    const b = parse(payrollPeriodSchema, req.body);
    if ((b.vesselId ?? null) !== before.vesselId) throw badRequest('เปลี่ยนเรือของงวดไม่ได้ — ยกเลิกแล้วสร้างงวดใหม่');
    return prisma.$transaction(async (tx) => {
      await markDirty(tx, id);
      const after = await tx.payrollPeriod.update({ where: { id }, data: { name: b.name, startDate: d(b.startDate), endDate: d(b.endDate), payDate: d(b.payDate ?? null), notes: b.notes ?? null } });
      await audit(tx, req, { action: 'UPDATE', entityType: 'PayrollPeriod', entityId: id, before, after });
      return after;
    });
  });
  app.post('/periods/:id/calculate', { preHandler: app.can('payroll.edit') }, async (req) => {
    await getPeriod(req, idParam(req));
    return calculatePeriod(req, idParam(req));
  });
  app.post('/periods/:id/approve', { preHandler: app.can('payroll.approve') }, async (req) => {
    await getPeriod(req, idParam(req));
    return approvePeriod(req, idParam(req));
  });
  app.post('/periods/:id/pay', { preHandler: app.can('payroll.approve') }, async (req) => {
    await getPeriod(req, idParam(req));
    return payPeriod(req, idParam(req), parse(payrollPaySchema, req.body));
  });
  app.post('/periods/:id/cancel', { preHandler: app.can('payroll.approve') }, async (req) => {
    await getPeriod(req, idParam(req));
    return cancelPeriod(req, idParam(req), parse(reasonSchema, req.body).reason);
  });

  // ---------- adjustments (bonus / other earning / other deduction) ----------
  app.post('/periods/:id/adjustments', { preHandler: app.can('payroll.edit') }, async (req, reply) => {
    const id = idParam(req);
    const period = await getPeriod(req, id);
    const b = parse(payrollAdjustmentSchema, req.body);
    const emp = await prisma.employee.findFirst({ where: { id: b.employeeId, deletedAt: null } });
    if (!emp) throw notFound('พนักงาน');
    if (period.vesselId && emp.currentVesselId !== period.vesselId && !(await prisma.tripCrew.findFirst({ where: { employeeId: emp.id, trip: { vesselId: period.vesselId } } })))
      throw badRequest('พนักงานไม่ได้สังกัดเรือของงวดนี้');
    const row = await prisma.$transaction(async (tx) => {
      await markDirty(tx, id);
      const a = await tx.payrollAdjustment.create({ data: { ...b, periodId: id, createdById: req.user!.id } });
      await audit(tx, req, { action: 'CREATE', entityType: 'PayrollAdjustment', entityId: a.id, after: a });
      return a;
    });
    return reply.status(201).send(row);
  });
  // adjustments are draft inputs of an unapproved period; removal is audited
  app.delete('/periods/:id/adjustments/:adjId', { preHandler: app.can('payroll.edit') }, async (req) => {
    const id = idParam(req);
    const { adjId } = req.params as { adjId: string };
    await getPeriod(req, id);
    return prisma.$transaction(async (tx) => {
      await markDirty(tx, id);
      const a = await tx.payrollAdjustment.findFirst({ where: { id: adjId, periodId: id } });
      if (!a) throw notFound('รายการปรับปรุง');
      await tx.payrollAdjustment.delete({ where: { id: adjId } });
      await audit(tx, req, { action: 'DELETE', entityType: 'PayrollAdjustment', entityId: adjId, before: a });
      return { ok: true };
    });
  });

  // ---------- payslip ----------
  app.get('/periods/:id/records/:recordId', { preHandler: app.can('payroll.view') }, async (req) => {
    const { id, recordId } = req.params as { id: string; recordId: string };
    const period = await prisma.payrollPeriod.findFirst({ where: { id, ...periodScope(req) }, include: { vessel: vesselSel } });
    if (!period) throw notFound('งวดเงินเดือน');
    const rec = await prisma.payrollRecord.findFirst({
      where: { id: recordId, periodId: id },
      include: {
        vessel: vesselSel,
        items: { orderBy: [{ code: 'asc' }, { id: 'asc' }] },
        employee: { select: { id: true, code: true, firstName: true, lastName: true, firstNameEn: true, lastNameEn: true, position: true, nationality: true, bankName: true, bankAccountNo: true } },
      },
    });
    if (!rec) throw notFound('สลิปเงินเดือน');
    const tripIds = [...new Set(rec.items.map((i) => i.tripId).filter(Boolean))] as string[];
    const trips = tripIds.length ? await prisma.fishingTrip.findMany({ where: { id: { in: tripIds } }, select: { id: true, tripNo: true } }) : [];
    const { companyName } = await getSettings(prisma);
    return { companyName, period, record: { ...rec, employee: maskEmployee(req, rec.employee) }, trips };
  });

  // ---------- bank transfer file (generic CSV; bank-specific formats are not claimed) ----------
  app.get('/periods/:id/bank-file', { preHandler: app.can('payroll.approve') }, async (req, reply) => {
    if (!has(req, 'employee.sensitive')) throw forbidden('ต้องมีสิทธิ์ดูข้อมูลส่วนบุคคลเพื่อส่งออกเลขบัญชี');
    const period = await getPeriod(req, idParam(req));
    if (!['APPROVED', 'PAID'].includes(period.status)) throw conflict('INVALID_STATUS', 'ส่งออกไฟล์โอนได้เฉพาะงวดที่อนุมัติแล้ว');
    const recs = await prisma.payrollRecord.findMany({
      where: { periodId: period.id, net: { gt: 0 } },
      orderBy: { employee: { code: 'asc' } },
      include: { employee: { select: { code: true, firstName: true, lastName: true, bankName: true, bankAccountNo: true } } },
    });
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /^[=+\-@]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [['employee_code', 'name', 'bank_name', 'account_no', 'amount', 'reference']];
    for (const r of recs)
      rows.push([r.employee.code, `${r.employee.firstName} ${r.employee.lastName}`, r.employee.bankName ?? '', (r.employee.bankAccountNo ?? '').replace(/[^0-9]/g, ''), num(r.net).toFixed(2), period.code]);
    const missing = recs.filter((r) => !r.employee.bankAccountNo).length;
    await audit(prisma, req, { action: 'EXPORT', entityType: 'PayrollPeriod', entityId: period.id, after: { rows: recs.length, missingAccount: missing } });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${period.code}-bank.csv"`);
    reply.header('x-missing-accounts', String(missing));
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
  });

  // ---------- employee history ----------
  app.get('/employees/:id/history', { preHandler: app.can('payroll.view') }, async (req) => {
    const employeeId = idParam(req);
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true, currentVesselId: true } });
    if (!emp) throw notFound('พนักงาน');
    if (emp.currentVesselId) assertVesselScope(req, emp.currentVesselId);
    else if (scopeIds(req)) throw forbidden('ไม่มีสิทธิ์เข้าถึงพนักงานนี้');
    const [records, advances] = await Promise.all([
      prisma.payrollRecord.findMany({
        where: { employeeId, period: periodScope(req) },
        orderBy: { period: { startDate: 'desc' } },
        take: 60,
        select: { id: true, gross: true, deduction: true, net: true, period: { select: { id: true, code: true, name: true, startDate: true, endDate: true, status: true } } },
      }),
      prisma.employeeAdvance.findMany({ where: { employeeId }, orderBy: { advanceDate: 'desc' }, take: 60 }),
    ]);
    return { records, advances };
  });

}
