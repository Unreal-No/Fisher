import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  assignVesselSchema, EMPLOYEE_POSITION, EMPLOYEE_STATUS, employeeDocSchema, employeeSchema, reasonSchema,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { d, idParam, paged, paging, parse, parseList } from '../../lib/http';
import { prisma, type Prisma } from '../../lib/prisma';
import { has } from '../../plugins/auth';
import { checklist, worstState } from './docs';
import { assertNotOnActiveTrip, assignVessel, createEmployee, maskEmployee, updateEmployee } from './service';

const docTypes = () => prisma.documentType.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });

async function ensureEmployee(id: string) {
  const e = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!e) throw notFound('พนักงาน');
  return e;
}

function listWhere(req: FastifyRequest, q: { q?: string }): Prisma.EmployeeWhereInput {
  const f = req.query as Record<string, string | undefined>;
  const scope = req.user!.vesselScope;
  return {
    deletedAt: null,
    ...((EMPLOYEE_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as never } : {}),
    ...((EMPLOYEE_POSITION as readonly string[]).includes(f.position ?? '') ? { position: f.position as never } : {}),
    ...(f.nationality ? { nationality: f.nationality } : {}),
    ...(f.vesselId ? { currentVesselId: f.vesselId === 'none' ? null : f.vesselId } : {}),
    ...(scope.length ? { currentVesselId: { in: scope } } : {}),
    ...(q.q
      ? {
          OR: ['firstName', 'lastName', 'firstNameEn', 'lastNameEn', 'nickname', 'code', 'phone'].map((k) => ({
            [k]: { contains: q.q, mode: 'insensitive' },
          })),
        }
      : {}),
  };
}

export default async function employeeRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: app.can('employee.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where = listWhere(req, q);
    const sortable = ['code', 'firstName', 'startDate', 'status', 'position', 'nationality'];
    const orderBy = { [sortable.includes(q.sort ?? '') ? q.sort! : 'code']: q.sort ? q.order : 'asc' };
    const pg = f.all === 'true' ? { take: 1000 } : paging(q);
    const [rows, total, types] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy,
        ...pg,
        include: {
          currentVessel: { select: { id: true, code: true, name: true } },
          documents: { where: { status: 'ACTIVE' }, select: { documentTypeId: true, expiryDate: true, status: true } },
        },
      }),
      prisma.employee.count({ where }),
      docTypes(),
    ]);
    const items = rows.map(({ documents, ...e }) => {
      const cl = checklist(e.nationality, documents, types);
      return maskEmployee(req, { ...e, docStatus: worstState(cl), docIssues: cl.filter((c) => c.state !== 'VALID' && c.state !== 'NO_EXPIRY').length });
    });
    return paged(items, total, q);
  });

  app.get('/:id', { preHandler: app.can('employee.view') }, async (req) => {
    const id = idParam(req);
    await ensureEmployee(id);
    const [e, types] = await Promise.all([
      prisma.employee.findUniqueOrThrow({
        where: { id },
        include: {
          currentVessel: { select: { id: true, code: true, name: true } },
          documents: { include: { documentType: { select: { code: true, nameTh: true, requiresExpiry: true } } }, orderBy: [{ createdAt: 'desc' }] },
          history: { orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }], take: 100 },
          assignments: { include: { vessel: { select: { id: true, code: true, name: true } } }, orderBy: { startDate: 'desc' } },
          tripCrew: {
            include: { trip: { select: { id: true, tripNo: true, status: true, departedAt: true, arrivedAt: true, vessel: { select: { name: true } } } } },
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
          user: { select: { id: true, username: true } },
        },
      }),
      docTypes(),
    ]);
    if (has(req, 'employee.sensitive'))
      await audit(prisma, req, { action: 'VIEW_SENSITIVE', entityType: 'Employee', entityId: id });
    return maskEmployee(req, { ...e, checklist: checklist(e.nationality, e.documents, types) });
  });

  app.post('/', { preHandler: app.can('employee.create') }, async (req, reply) => {
    const e = await createEmployee(req, parse(employeeSchema, req.body));
    return reply.status(201).send(maskEmployee(req, e));
  });

  app.patch('/:id', { preHandler: app.can('employee.edit') }, async (req) => {
    const b = parse(employeeSchema.partial(), req.body);
    // PDPA: callers who only see masked values must not be able to overwrite them
    if (!has(req, 'employee.sensitive')) {
      delete b.nationalIdNo;
      delete b.bankAccountNo;
    }
    return maskEmployee(req, await updateEmployee(req, idParam(req), b));
  });

  app.delete('/:id', { preHandler: app.can('employee.delete') }, async (req) => {
    const id = idParam(req);
    const before = await ensureEmployee(id);
    const trips = await prisma.tripCrew.count({ where: { employeeId: id } });
    await prisma.$transaction(async (tx) => {
      await assertNotOnActiveTrip(tx, id);
      if (trips) throw conflict('EMPLOYEE_HAS_HISTORY', 'พนักงานมีประวัติเที่ยวเรือ ให้เปลี่ยนสถานะเป็นลาออก/เลิกจ้างแทนการลบ');
      await tx.vesselAssignment.updateMany({ where: { employeeId: id, endDate: null }, data: { endDate: new Date() } });
      await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), currentVesselId: null } });
      await audit(tx, req, { action: 'DELETE', entityType: 'Employee', entityId: id, before });
    });
    return { ok: true };
  });

  app.post('/:id/assign-vessel', { preHandler: app.can('employee.edit') }, async (req) =>
    maskEmployee(req, await assignVessel(req, idParam(req), parse(assignVesselSchema, req.body))),
  );

  // ---------- documents ----------
  const docGuard = { preHandler: app.can('employee_doc.manage') };

  async function validateDoc(b: ReturnType<typeof employeeDocSchema.parse>) {
    const t = await prisma.documentType.findUnique({ where: { id: b.documentTypeId } });
    if (!t || !t.isActive) throw badRequest('ประเภทเอกสารไม่ถูกต้อง');
    if (t.requiresExpiry && !b.expiryDate) throw badRequest(`${t.nameTh} ต้องระบุวันหมดอายุ`);
    if (b.issueDate && b.expiryDate && b.expiryDate < b.issueDate) throw badRequest('วันหมดอายุต้องหลังวันออกเอกสาร');
    if (b.fileId) {
      const f = await prisma.fileObject.findUnique({ where: { id: b.fileId } });
      if (!f || f.sensitivity !== 'PERSONAL') throw badRequest('ไฟล์เอกสารต้องอัปโหลดแบบข้อมูลส่วนบุคคล');
    }
    return t;
  }
  const docData = (b: ReturnType<typeof employeeDocSchema.parse>) => ({
    ...b, issueDate: d(b.issueDate), expiryDate: d(b.expiryDate),
  });

  app.post('/:id/documents', docGuard, async (req, reply) => {
    const employeeId = idParam(req);
    await ensureEmployee(employeeId);
    const b = parse(employeeDocSchema, req.body);
    await validateDoc(b);
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.employeeDocument.create({ data: { ...docData(b), employeeId, createdById: req.user!.id } });
      await audit(tx, req, { action: 'CREATE', entityType: 'EmployeeDocument', entityId: created.id, after: created, note: employeeId });
      return created;
    });
    return reply.status(201).send(maskEmployee(req, doc));
  });

  /** Renewal keeps history: old document -> REPLACED, linked to the new one. */
  app.post('/:id/documents/:docId/renew', docGuard, async (req, reply) => {
    const { id: employeeId, docId } = req.params as { id: string; docId: string };
    const old = await prisma.employeeDocument.findFirst({ where: { id: docId, employeeId } });
    if (!old) throw notFound('เอกสาร');
    if (old.status !== 'ACTIVE') throw conflict('DOC_NOT_ACTIVE', 'เอกสารนี้ถูกต่ออายุหรือยกเลิกไปแล้ว');
    const b = parse(employeeDocSchema, { ...(req.body as object), documentTypeId: old.documentTypeId });
    await validateDoc(b);
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.employeeDocument.create({ data: { ...docData(b), employeeId, createdById: req.user!.id } });
      await tx.employeeDocument.update({ where: { id: docId }, data: { status: 'REPLACED', replacedById: created.id } });
      await audit(tx, req, { action: 'RENEW', entityType: 'EmployeeDocument', entityId: created.id, before: old, after: created, note: employeeId });
      return created;
    });
    return reply.status(201).send(maskEmployee(req, doc));
  });

  app.patch('/:id/documents/:docId', docGuard, async (req) => {
    const { id: employeeId, docId } = req.params as { id: string; docId: string };
    const old = await prisma.employeeDocument.findFirst({ where: { id: docId, employeeId } });
    if (!old) throw notFound('เอกสาร');
    const b = parse(employeeDocSchema, { ...(req.body as object), documentTypeId: old.documentTypeId });
    await validateDoc(b);
    const after = await prisma.$transaction(async (tx) => {
      const u = await tx.employeeDocument.update({ where: { id: docId }, data: docData(b) });
      await audit(tx, req, { action: 'UPDATE', entityType: 'EmployeeDocument', entityId: docId, before: old, after: u, note: employeeId });
      return u;
    });
    return maskEmployee(req, after);
  });

  app.post('/:id/documents/:docId/cancel', docGuard, async (req) => {
    const { id: employeeId, docId } = req.params as { id: string; docId: string };
    const { reason } = parse(reasonSchema, req.body);
    const old = await prisma.employeeDocument.findFirst({ where: { id: docId, employeeId, status: 'ACTIVE' } });
    if (!old) throw notFound('เอกสาร');
    await prisma.$transaction(async (tx) => {
      await tx.employeeDocument.update({ where: { id: docId }, data: { status: 'CANCELLED', notes: reason } });
      await audit(tx, req, { action: 'CANCEL', entityType: 'EmployeeDocument', entityId: docId, before: old, note: reason });
    });
    return { ok: true };
  });

  // Document expiry report (HR)
  app.get('/reports/documents', { preHandler: app.can('employee.view') }, async (req) => {
    const f = req.query as { days?: string };
    const days = Math.min(Number(f.days ?? 90) || 90, 730);
    const limit = new Date(Date.now() + days * 86400_000);
    const scope = req.user!.vesselScope;
    const docs = await prisma.employeeDocument.findMany({
      where: {
        status: 'ACTIVE',
        expiryDate: { lte: limit },
        employee: { deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'] }, ...(scope.length ? { currentVesselId: { in: scope } } : {}) },
      },
      include: {
        documentType: { select: { nameTh: true, code: true } },
        employee: { select: { id: true, code: true, firstName: true, lastName: true, nationality: true, currentVessel: { select: { name: true } } } },
      },
      orderBy: { expiryDate: 'asc' },
      take: 1000,
    });
    return docs.map((x) => maskEmployee(req, x));
  });
}
