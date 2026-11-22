// Users, roles/permissions, audit log, settings, document types.
import type { FastifyInstance } from 'fastify';
import {
  documentTypeSchema, PERMISSIONS, resetPasswordSchema, rolePermissionsSchema, settingsSchema,
  userCreateSchema, userUpdateSchema,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { idParam, paged, paging, parse, parseList, str } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { getSettings, invalidateSettingsCache } from '../../lib/settings';
import { hashPassword } from '../auth/routes';

const userSelect = {
  id: true, username: true, fullName: true, email: true, isActive: true, mustChangePassword: true,
  lastLoginAt: true, lockedUntil: true, employeeId: true, createdAt: true, totpEnabledAt: true,
  roles: { select: { role: { select: { id: true, code: true, name: true } } } },
  vessels: { select: { vessel: { select: { id: true, code: true, name: true } } } },
} as const;

export default async function adminRoutes(app: FastifyInstance) {
  // ---------- users ----------
  app.get('/users', { preHandler: app.can('user.manage') }, async (req) => {
    const q = parseList(req);
    const where = {
      deletedAt: null,
      ...(q.q ? { OR: [{ username: { contains: q.q, mode: 'insensitive' as const } }, { fullName: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: { username: 'asc' }, ...paging(q) }),
      prisma.user.count({ where }),
    ]);
    return paged(items, total, q);
  });

  app.post('/users', { preHandler: app.can('user.manage') }, async (req, reply) => {
    const b = parse(userCreateSchema, req.body);
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          username: b.username.toLowerCase(), fullName: b.fullName, email: b.email ?? null,
          passwordHash: await hashPassword(b.password), isActive: b.isActive, mustChangePassword: true,
          employeeId: b.employeeId ?? null,
          roles: { create: b.roleIds.map((roleId) => ({ roleId })) },
          vessels: { create: b.vesselIds.map((vesselId) => ({ vesselId })) },
        },
        select: userSelect,
      });
      await audit(tx, req, { action: 'CREATE', entityType: 'User', entityId: u.id, after: u });
      return u;
    });
    return reply.status(201).send(user);
  });

  app.patch('/users/:id', { preHandler: app.can('user.manage') }, async (req) => {
    const id = idParam(req);
    const b = parse(userUpdateSchema, req.body);
    if (id === req.user!.id && b.isActive === false) throw badRequest('ไม่สามารถปิดใช้งานบัญชีตนเองได้');
    return prisma.$transaction(async (tx) => {
      const before = await tx.user.findFirst({ where: { id, deletedAt: null }, select: userSelect });
      if (!before) throw notFound('ผู้ใช้');
      if (b.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: b.roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      if (b.vesselIds) {
        await tx.userVessel.deleteMany({ where: { userId: id } });
        await tx.userVessel.createMany({ data: b.vesselIds.map((vesselId) => ({ userId: id, vesselId })) });
      }
      const after = await tx.user.update({
        where: { id },
        data: { fullName: b.fullName, email: b.email, isActive: b.isActive, employeeId: b.employeeId },
        select: userSelect,
      });
      if (b.isActive === false) await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req, { action: 'UPDATE', entityType: 'User', entityId: id, before, after });
      return after;
    });
  });

  app.post('/users/:id/reset-password', { preHandler: app.can('user.manage') }, async (req) => {
    const id = idParam(req);
    const b = parse(resetPasswordSchema, req.body);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(b.newPassword), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req, { action: 'PASSWORD_RESET', entityType: 'User', entityId: id });
    });
    return { ok: true };
  });

  /** Lost phone: an administrator removes the user's second factor; the user must enrol again. */
  app.post('/users/:id/reset-2fa', { preHandler: app.can('user.manage') }, async (req) => {
    const id = idParam(req);
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw notFound('ผู้ใช้');
      await tx.user.update({ where: { id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.loginChallenge.deleteMany({ where: { userId: id } });
      await audit(tx, req, { action: '2FA_RESET', entityType: 'User', entityId: id });
    });
    return { ok: true };
  });

  // ---------- roles ----------
  app.get('/permissions', { preHandler: app.canAny('role.manage', 'user.manage') }, async () =>
    Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description })),
  );

  app.get('/roles', { preHandler: app.canAny('role.manage', 'user.manage') }, async () => {
    const roles = await prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem,
      userCount: r._count.users, permissions: r.permissions.map((p) => p.permission.code),
    }));
  });

  app.put('/roles/:id/permissions', { preHandler: app.can('role.manage') }, async (req) => {
    const id = idParam(req);
    const b = parse(rolePermissionsSchema, req.body);
    const role = await prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw notFound('บทบาท');
    if (role.code === 'SUPER_ADMIN') throw forbidden('ไม่สามารถแก้ไขสิทธิ์ของผู้ดูแลระบบสูงสุด');
    const perms = await prisma.permission.findMany({ where: { code: { in: b.permissions } } });
    if (perms.length !== new Set(b.permissions).size) throw badRequest('มีรหัสสิทธิ์ที่ไม่รู้จัก');
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
      await audit(tx, req, {
        action: 'UPDATE', entityType: 'Role', entityId: id,
        before: role.permissions.map((p) => p.permission.code), after: b.permissions,
      });
    });
    return { ok: true };
  });

  // ---------- audit ----------
  app.get('/audit-logs', { preHandler: app.can('audit.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where = {
      ...(str(f.entityType) ? { entityType: f.entityType } : {}),
      ...(str(f.entityId) ? { entityId: f.entityId } : {}),
      ...(str(f.action) ? { action: f.action } : {}),
      ...(str(f.userId) ? { userId: f.userId } : {}),
      ...(str(f.from) || str(f.to)
        ? { at: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999+07:00`) } : {}) } }
        : {}),
      ...(q.q ? { OR: [{ username: { contains: q.q } }, { note: { contains: q.q } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, ...paging(q) }),
      prisma.auditLog.count({ where }),
    ]);
    return paged(items, total, q);
  });

  // ---------- settings ----------
  app.get('/settings', async () => getSettings(prisma));
  app.patch('/settings', { preHandler: app.can('settings.manage') }, async (req) => {
    const b = parse(settingsSchema, req.body);
    if (b.require2faRoles?.length) {
      const known = new Set((await prisma.role.findMany({ select: { code: true } })).map((r) => r.code));
      const bad = b.require2faRoles.filter((c) => !known.has(c));
      if (bad.length) throw badRequest(`ไม่พบบทบาท: ${bad.join(', ')}`);
    }
    const before = await getSettings(prisma);
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(b)) {
        if (value === undefined) continue;
        const v = key === 'docReminderDays' ? [...new Set(value as number[])].sort((a, c) => c - a) : value;
        await tx.appSetting.upsert({
          where: { key }, create: { key, value: v as never, updatedById: req.user!.id }, update: { value: v as never, updatedById: req.user!.id },
        });
      }
      await audit(tx, req, { action: 'UPDATE', entityType: 'Settings', before, after: b });
    });
    invalidateSettingsCache();
    return getSettings(prisma);
  });

  // ---------- document types (HR checklist config) ----------
  app.get('/document-types', async () => prisma.documentType.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }));
  app.post('/document-types', { preHandler: app.canAny('settings.manage', 'employee_doc.manage') }, async (req, reply) => {
    const b = parse(documentTypeSchema, req.body);
    const dt = await prisma.documentType.create({ data: { ...b, nameEn: b.nameEn ?? null } });
    await audit(prisma, req, { action: 'CREATE', entityType: 'DocumentType', entityId: dt.id, after: dt });
    return reply.status(201).send(dt);
  });
  app.patch('/document-types/:id', { preHandler: app.canAny('settings.manage', 'employee_doc.manage') }, async (req) => {
    const id = idParam(req);
    const b = parse(documentTypeSchema.partial(), req.body);
    const before = await prisma.documentType.findUnique({ where: { id } });
    if (!before) throw notFound('ประเภทเอกสาร');
    const after = await prisma.documentType.update({ where: { id }, data: b });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'DocumentType', entityId: id, before, after });
    return after;
  });
}
