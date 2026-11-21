import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { maskId, type employeeSchema } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { d, nextSeq } from '../../lib/http';
import { prisma, type Tx } from '../../lib/prisma';
import { has } from '../../plugins/auth';

type EmployeeData = z.output<typeof employeeSchema>;
type Partial_ = Partial<EmployeeData>;

export const fullName = (e: { firstName: string; lastName: string; nickname?: string | null }) =>
  `${e.firstName} ${e.lastName}${e.nickname ? ` (${e.nickname})` : ''}`;

/** PDPA: mask identifiers unless caller has employee.sensitive. */
export function maskEmployee<T extends Record<string, unknown>>(req: FastifyRequest, e: T): T {
  if (has(req, 'employee.sensitive')) return e;
  const out: Record<string, unknown> = { ...e };
  for (const k of ['nationalIdNo', 'bankAccountNo', 'documentNo']) if (k in out) out[k] = maskId(out[k] as string);
  if (Array.isArray(out.documents))
    out.documents = (out.documents as Record<string, unknown>[]).map((x) => ({ ...x, documentNo: maskId(x.documentNo as string) }));
  if ('dateOfBirth' in out && !has(req, 'employee.edit')) out.dateOfBirth = null;
  return out as T;
}

function toData(b: Partial_) {
  const { dateOfBirth, startDate, ...rest } = b;
  return { ...rest, dateOfBirth: d(dateOfBirth), startDate: d(startDate) };
}

const TRACKED: (keyof EmployeeData)[] = ['status', 'position', 'payType', 'baseRate'];
const EVENT: Record<string, string> = { status: 'STATUS_CHANGE', position: 'POSITION_CHANGE', payType: 'PAY_CHANGE', baseRate: 'PAY_CHANGE' };

export async function createEmployee(req: FastifyRequest, b: EmployeeData) {
  return prisma.$transaction(async (tx) => {
    const code = b.code || `EMP-${String(await nextSeq(tx, 'EMPLOYEE', 'ALL')).padStart(5, '0')}`;
    const e = await tx.employee.create({
      data: { ...b, dateOfBirth: d(b.dateOfBirth), startDate: d(b.startDate), code, createdById: req.user!.id },
    });
    await tx.employmentHistory.create({
      data: { employeeId: e.id, eventType: 'HIRED', effectiveDate: e.startDate, toValue: e.position, createdById: req.user!.id },
    });
    await audit(tx, req, { action: 'CREATE', entityType: 'Employee', entityId: e.id, after: e });
    return e;
  });
}

export async function updateEmployee(req: FastifyRequest, id: string, b: Partial_) {
  const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound('พนักงาน');
  return prisma.$transaction(async (tx) => {
    const data = toData(b);
    const leaving = b.status && ['RESIGNED', 'TERMINATED'].includes(b.status) && !['RESIGNED', 'TERMINATED'].includes(before.status);
    if (leaving) {
      await assertNotOnActiveTrip(tx, id);
      await closeAssignment(tx, id, new Date());
    }
    const after = await tx.employee.update({
      where: { id },
      data: {
        ...data,
        code: b.code || undefined,
        ...(leaving ? { endDate: new Date(), currentVesselId: null } : {}),
        ...(b.status === 'ACTIVE' && before.endDate ? { endDate: null } : {}),
      },
    });
    for (const k of TRACKED) {
      const from = before[k as keyof typeof before];
      const to = after[k as keyof typeof after];
      if (b[k] !== undefined && String(from ?? '') !== String(to ?? '')) {
        await tx.employmentHistory.create({
          data: {
            employeeId: id, eventType: EVENT[k]!, effectiveDate: new Date(),
            fromValue: from === null ? null : String(from), toValue: to === null ? null : String(to), createdById: req.user!.id,
          },
        });
      }
    }
    await audit(tx, req, { action: 'UPDATE', entityType: 'Employee', entityId: id, before, after });
    return after;
  });
}

export async function assertNotOnActiveTrip(tx: Tx, employeeId: string) {
  const t = await tx.tripCrew.findFirst({
    where: { employeeId, trip: { status: { in: ['PREPARING', 'DEPARTED', 'AT_SEA', 'RETURNING'] } } },
    include: { trip: { select: { tripNo: true } } },
  });
  if (t) throw conflict('EMPLOYEE_ON_TRIP', `พนักงานอยู่ในเที่ยวเรือ ${t.trip.tripNo}`);
}

async function closeAssignment(tx: Tx, employeeId: string, endDate: Date) {
  await tx.vesselAssignment.updateMany({ where: { employeeId, endDate: null }, data: { endDate } });
}

export async function assignVessel(
  req: FastifyRequest,
  employeeId: string,
  b: { vesselId?: string | null; startDate: string; position?: string; notes?: string | null },
) {
  const e = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!e) throw notFound('พนักงาน');
  if (b.vesselId === e.currentVesselId) return e;
  return prisma.$transaction(async (tx) => {
    await assertNotOnActiveTrip(tx, employeeId);
    const start = d(b.startDate);
    await closeAssignment(tx, employeeId, start);
    if (b.vesselId) {
      const v = await tx.vessel.findFirst({ where: { id: b.vesselId, deletedAt: null } });
      if (!v) throw notFound('เรือ');
      await tx.vesselAssignment.create({
        data: {
          employeeId, vesselId: b.vesselId, startDate: start, position: (b.position ?? e.position) as never,
          notes: b.notes ?? null, createdById: req.user!.id,
        },
      });
    }
    const after = await tx.employee.update({ where: { id: employeeId }, data: { currentVesselId: b.vesselId ?? null } });
    await tx.employmentHistory.create({
      data: {
        employeeId, eventType: 'VESSEL_ASSIGN', effectiveDate: start, fromValue: e.currentVesselId, toValue: b.vesselId ?? null,
        notes: b.notes ?? null, createdById: req.user!.id,
      },
    });
    await audit(tx, req, { action: 'ASSIGN_VESSEL', entityType: 'Employee', entityId: employeeId, before: { vesselId: e.currentVesselId }, after: { vesselId: b.vesselId } });
    return after;
  });
}
