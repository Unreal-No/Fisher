import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bucket, scanExpirations } from '../src/modules/notifications/service';
import { departedTrip, fixtures, iso, login, createUser, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

describe('vessels', () => {
  it('creates with auto code, validates, rejects duplicate registration, audits', async () => {
    const r = await admin.post('/vessels', { name: 'ส.ทดสอบ', registrationNo: 'DUP-1', vesselType: 'อวนลาก', lengthM: '18.5' });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^V-\d{3}$/);
    expect(r.body.lengthM).toBe('18.5');
    expect((await admin.post('/vessels', { name: 'x', registrationNo: 'DUP-1', vesselType: 'y' })).status).toBe(409);
    const bad = await admin.post('/vessels', { name: '', registrationNo: 'R', vesselType: 'y', mmsi: '12' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fieldErrors)).toEqual(expect.arrayContaining(['name', 'mmsi']));
    expect(await prisma.auditLog.count({ where: { entityType: 'Vessel', entityId: r.body.id, action: 'CREATE' } })).toBe(1);
  });

  it('blocks deletion while a trip is open; soft-deletes otherwise', async () => {
    const f = await fixtures(admin);
    const t = await admin.post('/trips', { vesselId: f.vessel.id });
    expect((await admin.del(`/vessels/${f.vessel.id}`)).status).toBe(409);
    await admin.post(`/trips/${t.body.id}/cancel`, { reason: 'ทดสอบ' });
    expect((await admin.del(`/vessels/${f.vessel.id}`)).status).toBe(200);
    expect((await admin.get(`/vessels/${f.vessel.id}`)).status).toBe(404);
    expect(await prisma.vessel.findUnique({ where: { id: f.vessel.id } })).not.toBeNull();
  });
});

describe('employees & documents', () => {
  it('auto code, history, checklist, renewal chain', async () => {
    const types = (await admin.get('/document-types')).body as { id: string; code: string }[];
    const wp = types.find((t) => t.code === 'WORK_PERMIT')!;
    const e = (await admin.post('/employees', { firstName: 'Min', lastName: 'Thu', nationality: 'MM', position: 'DECKHAND', startDate: iso(-10) })).body;
    expect(e.code).toMatch(/^EMP-\d{5}$/);
    const noExpiry = await admin.post(`/employees/${e.id}/documents`, { documentTypeId: wp.id, documentNo: 'WP1' });
    expect(noExpiry.status).toBe(400);
    const d1 = (await admin.post(`/employees/${e.id}/documents`, { documentTypeId: wp.id, documentNo: 'WP1', expiryDate: iso(10) })).body;
    const renewed = await admin.post(`/employees/${e.id}/documents/${d1.id}/renew`, { documentNo: 'WP2', expiryDate: iso(400) });
    expect(renewed.status).toBe(201);
    expect((await admin.post(`/employees/${e.id}/documents/${d1.id}/renew`, { expiryDate: iso(500) })).status).toBe(409);
    const detail = (await admin.get(`/employees/${e.id}`)).body;
    const old = detail.documents.find((x: { id: string }) => x.id === d1.id);
    expect(old.status).toBe('REPLACED');
    expect(old.replacedById).toBe(renewed.body.id);
    const wpCheck = detail.checklist.find((c: { code: string }) => c.code === 'WORK_PERMIT');
    expect(wpCheck.state).toBe('VALID');
    expect(detail.checklist.find((c: { code: string }) => c.code === 'PASSPORT').state).toBe('MISSING');
    expect(detail.history[0].eventType).toBe('HIRED');

    await admin.patch(`/employees/${e.id}`, { position: 'ENGINEER' });
    const h = (await admin.get(`/employees/${e.id}`)).body.history;
    expect(h.some((x: { eventType: string; toValue: string }) => x.eventType === 'POSITION_CHANGE' && x.toValue === 'ENGINEER')).toBe(true);
  });

  it('vessel assignment keeps one open assignment', async () => {
    const f = await fixtures(admin);
    const v2 = (await admin.post('/vessels', { name: 'ลำ 2', registrationNo: 'R-ASSIGN-2', vesselType: 'อวนล้อม' })).body;
    await admin.post(`/employees/${f.crew.id}/assign-vessel`, { vesselId: f.vessel.id, startDate: iso(-5) });
    await admin.post(`/employees/${f.crew.id}/assign-vessel`, { vesselId: v2.id, startDate: iso(0) });
    const a = await prisma.vesselAssignment.findMany({ where: { employeeId: f.crew.id }, orderBy: { createdAt: 'asc' } });
    expect(a).toHaveLength(2);
    expect(a[0]!.endDate).not.toBeNull();
    expect(a[1]!.endDate).toBeNull();
    await expect(
      prisma.vesselAssignment.create({ data: { employeeId: f.crew.id, vesselId: f.vessel.id, position: 'DECKHAND', startDate: new Date() } }),
    ).rejects.toThrow();
  });

  it('cannot delete or resign an employee on an active trip', async () => {
    const f = await fixtures(admin);
    await departedTrip(admin, f);
    expect((await admin.patch(`/employees/${f.crew.id}`, { status: 'RESIGNED' })).status).toBe(409);
    expect((await admin.del(`/employees/${f.crew.id}`)).status).toBe(409);
  });
});

describe('expiry notifications', () => {
  it('buckets by configured thresholds', () => {
    expect(bucket(-1, [90, 60, 30, 7])).toBe('expired');
    expect(bucket(25, [90, 60, 30, 7])).toBe(30);
    expect(bucket(5, [90, 60, 30, 7])).toBe(7);
    expect(bucket(120, [90, 60, 30, 7])).toBeNull();
  });

  it('creates reminders once per threshold (dedupe)', async () => {
    const types = (await admin.get('/document-types')).body as { id: string; code: string }[];
    const e = (await admin.post('/employees', { firstName: 'Exp', lastName: 'Test', nationality: 'KH', position: 'DECKHAND', startDate: iso(-10) })).body;
    await admin.post(`/employees/${e.id}/documents`, { documentTypeId: types.find((t) => t.code === 'VISA')!.id, expiryDate: iso(20) });
    const r1 = await scanExpirations();
    const r2 = await scanExpirations();
    expect(r1.created).toBeGreaterThan(0);
    expect(r2.created).toBe(0);
    const n = await admin.get('/notifications');
    expect(n.body.unreadCount).toBeGreaterThan(0);
    expect(n.body.items.some((x: { title: string }) => x.title.includes('การตรวจลงตรา'))).toBe(true);
    await admin.post('/notifications/read-all');
    expect((await admin.get('/notifications')).body.unreadCount).toBe(0);
  });
});
