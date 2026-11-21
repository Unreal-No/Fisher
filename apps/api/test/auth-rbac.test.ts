import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, fixtures, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

describe('authentication', () => {
  it('rejects bad credentials and locks after 5 failures', async () => {
    await createUser('locky', 'VIEWER');
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'locky', password: 'wrong' } });
      expect(r.statusCode).toBe(401);
    }
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'locky', password: 'Test@12345' } });
    expect(r.statusCode).toBe(423);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBeGreaterThanOrEqual(5);
  });

  it('requires a session for API calls', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/vessels' });
    expect(r.statusCode).toBe(401);
  });

  it('returns me with permissions', async () => {
    const r = await admin.get('/auth/me');
    expect(r.status).toBe(200);
    expect(r.body.permissions).toContain('vessel.create');
  });

  it('rejects mutating requests without CSRF token', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'Test@12345' } });
    const sid = login.cookies.find((c) => c.name === 'fsid')!.value;
    const r = await app.inject({ method: 'POST', url: '/api/v1/vessels', headers: { cookie: `fsid=${sid}` }, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error.code).toBe('CSRF');
  });

  it('forces password change before other actions', async () => {
    await createUser('newbie', 'VIEWER', { mustChange: true });
    const a = await login(app, 'newbie');
    expect((await a.get('/vessels')).body.error.code).toBe('MUST_CHANGE_PASSWORD');
    expect((await a.post('/auth/change-password', { currentPassword: 'Test@12345', newPassword: 'Newpass@123' })).status).toBe(200);
    expect((await a.get('/vessels')).status).toBe(200);
  });

  it('logout invalidates the session', async () => {
    await createUser('bye', 'VIEWER');
    const a = await login(app, 'bye');
    await a.post('/auth/logout');
    expect((await a.get('/auth/me')).status).toBe(401);
  });
});

describe('authorization (RBAC + PDPA)', () => {
  it('viewer cannot create; masked personal data; personal files blocked', async () => {
    const f = await fixtures(admin);
    await prisma.employee.update({ where: { id: f.crew.id }, data: { nationalIdNo: '1234567890123', bankAccountNo: '9876543210' } });
    await createUser('view1', 'VIEWER');
    const viewer = await login(app, 'view1');
    expect((await viewer.post('/vessels', { name: 'x', registrationNo: 'y', vesselType: 'z' })).status).toBe(403);
    const e = await viewer.get(`/employees/${f.crew.id}`);
    expect(e.status).toBe(200);
    expect(e.body.nationalIdNo).toBe('12*********23');
    expect(e.body.bankAccountNo).toMatch(/^98\*+10$/);
    expect(e.body.documents[0].documentNo).toContain('*');

    await createUser('hr1', 'HR_OFFICER');
    const hr = await login(app, 'hr1');
    const e2 = await hr.get(`/employees/${f.crew.id}`);
    expect(e2.body.nationalIdNo).toBe('1234567890123');
    expect(await prisma.auditLog.count({ where: { action: 'VIEW_SENSITIVE', entityId: f.crew.id } })).toBe(1);

    const file = await prisma.fileObject.create({
      data: { storageKey: 'x/y.pdf', fileName: 'passport.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x', sensitivity: 'PERSONAL' },
    });
    expect((await viewer.get(`/files/${file.id}`)).status).toBe(403);
  });

  it('vessel scope restricts captain to own vessel', async () => {
    const a = await fixtures(admin);
    const b = await fixtures(admin);
    await createUser('cap1', 'CAPTAIN', { vesselIds: [a.vessel.id] });
    const cap = await login(app, 'cap1');
    const list = await cap.get('/vessels');
    expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([a.vessel.id]);
    expect((await cap.get(`/vessels/${b.vessel.id}`)).status).toBe(403);
    const trip = await admin.post('/trips', { vesselId: b.vessel.id });
    expect((await cap.get(`/trips/${trip.body.id}`)).status).toBe(403);
  });

  it('role permissions are editable except super admin', async () => {
    const roles = (await admin.get('/roles')).body as { id: string; code: string }[];
    const sa = roles.find((r) => r.code === 'SUPER_ADMIN')!;
    expect((await admin.put(`/roles/${sa.id}/permissions`, { permissions: [] })).status).toBe(403);
    const viewer = roles.find((r) => r.code === 'VIEWER')!;
    expect((await admin.put(`/roles/${viewer.id}/permissions`, { permissions: ['vessel.view'] })).status).toBe(200);
    expect((await admin.put(`/roles/${viewer.id}/permissions`, { permissions: ['nope.x'] })).status).toBe(400);
  });
});

describe('PDPA write protection', () => {
  it('users without employee.sensitive cannot overwrite masked identifiers', async () => {
    const e = (await admin.post('/employees', { firstName: 'P', lastName: 'D', nationality: 'TH', position: 'OFFICE', startDate: '2026-01-01', nationalIdNo: '1111111111111' })).body;
    const role = await prisma.role.create({ data: { code: 'EDITOR_NO_PII', name: 'x' } });
    const perms = await prisma.permission.findMany({ where: { code: { in: ['employee.view', 'employee.edit'] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    await createUser('editor', 'EDITOR_NO_PII');
    const ed = await login(app, 'editor');
    const r = await ed.patch(`/employees/${e.id}`, { nationalIdNo: '11*********11', phone: '0812345678' });
    expect(r.status).toBe(200);
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.nationalIdNo).toBe('1111111111111');
    expect(row.phone).toBe('0812345678');
  });
});
