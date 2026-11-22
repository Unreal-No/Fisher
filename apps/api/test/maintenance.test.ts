import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planDue, scanMaintenanceDue } from '../src/modules/maintenance/service';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let captain: Agent;
let vesselId: string;
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
  f = await fixtures(admin);
  vesselId = f.vessel.id;
  await createUser('cap', 'CAPTAIN', { vesselIds: [vesselId] });
  captain = await login(app, 'cap');
});
afterAll(() => app.close());

describe('due calculation', () => {
  it('by days and/or engine hours', () => {
    const today = new Date('2026-11-21T03:00:00Z');
    const cfg = { days: 14, hours: 50 };
    expect(planDue({ intervalDays: 90, intervalEngineHours: null, lastDoneAt: new Date('2026-09-01'), lastDoneEngineHours: null }, null, cfg, today).state).toBe('DUE_SOON');
    expect(planDue({ intervalDays: 30, intervalEngineHours: null, lastDoneAt: new Date('2026-09-01'), lastDoneEngineHours: null }, null, cfg, today).state).toBe('OVERDUE');
    expect(planDue({ intervalDays: null, intervalEngineHours: 250, lastDoneAt: null, lastDoneEngineHours: 1000 }, 1100, cfg, today)).toMatchObject({ state: 'OK', hoursLeft: 150, nextDueHours: 1250 });
    expect(planDue({ intervalDays: null, intervalEngineHours: 250, lastDoneAt: null, lastDoneEngineHours: 1000 }, 1260, cfg, today).state).toBe('OVERDUE');
    expect(planDue({ intervalDays: 30, intervalEngineHours: null, lastDoneAt: null, lastDoneEngineHours: null }, 1, cfg, today).state).toBe('NO_BASELINE');
  });
});

describe('engine hours & plans', () => {
  it('meter cannot go backwards without reset reason; trips log readings', async () => {
    expect((await captain.post('/maintenance/engine-hours', { vesselId, recordedAt: ago(48), hours: 1200 })).status).toBe(201);
    const back = await captain.post('/maintenance/engine-hours', { vesselId, recordedAt: ago(24), hours: 1100 });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('ENGINE_HOURS_DECREASE');
    expect((await captain.post('/maintenance/engine-hours', { vesselId, recordedAt: ago(24), hours: 5, isReset: true })).status).toBe(400);
    expect((await captain.post('/maintenance/engine-hours', { vesselId, recordedAt: ago(24), hours: 5, isReset: true, notes: 'เปลี่ยนมิเตอร์' })).status).toBe(201);
    const logs = (await captain.get(`/maintenance/engine-hours?vesselId=${vesselId}`)).body;
    expect(Number(logs[0].hours)).toBe(5);
    const other = await fixtures(admin);
    expect((await captain.get(`/maintenance/engine-hours?vesselId=${other.vessel.id}`)).status).toBe(403);
  });

  it('plans: validation, due list, reminders dedupe', async () => {
    expect((await admin.post('/maintenance/plans', { vesselId, name: 'x', category: 'ENGINE' })).status).toBe(400); // no interval
    const p = await admin.post('/maintenance/plans', { vesselId, name: 'เปลี่ยนน้ำมันเครื่อง', category: 'ENGINE', intervalEngineHours: 250, lastDoneEngineHours: 0 });
    expect(p.status).toBe(201);
    await admin.post('/maintenance/plans', { vesselId, name: 'ตรวจอุปกรณ์ชูชีพ', category: 'SAFETY', intervalDays: 30, lastDoneAt: iso(-40) });
    const due = (await admin.get(`/maintenance/plans?vesselId=${vesselId}&dueOnly=true`)).body;
    expect(due.map((x: { name: string }) => x.name)).toEqual(['ตรวจอุปกรณ์ชูชีพ']); // 5h of 250 → OK; 40d of 30 → overdue
    expect(due[0].due.state).toBe('OVERDUE');
    const r1 = await scanMaintenanceDue();
    expect(r1.due).toBe(1);
    expect((await scanMaintenanceDue()).created).toBe(0);
  });
});

describe('work orders', () => {
  it('lifecycle: out-of-service status, parts from stock, completion updates plan and engine hours', async () => {
    const wh = (await admin.post('/inventory/warehouses', { code: 'W1', name: 'คลัง' })).body.id;
    const filter = (await admin.post('/inventory/items', { name: 'ไส้กรองน้ำมันเครื่อง', category: 'SPARE_PART', unit: 'ชิ้น' })).body.id;
    await admin.post('/inventory/receipts', { warehouseId: wh, itemId: filter, quantity: 5, unitCost: 300, movedAt: ago(5), notes: 'ยอดยกมา' });
    const plan = (await admin.get(`/maintenance/plans?vesselId=${vesselId}`)).body.find((x: { name: string }) => x.name === 'ตรวจอุปกรณ์ชูชีพ');

    const o = await captain.post('/maintenance/orders', { vesselId, planId: plan.id, title: 'ตรวจเสื้อชูชีพ', category: 'SAFETY', type: 'PREVENTIVE', reportedAt: ago(2), takesOutOfService: true });
    expect(o.status).toBe(201);
    expect(o.body.orderNo).toMatch(/^MO-\d{4}-\d{4}$/);
    expect((await captain.post(`/maintenance/orders/${o.body.id}/start`)).status).toBe(403); // captain can report, not manage
    expect((await admin.post(`/maintenance/orders/${o.body.id}/start`)).status).toBe(200);
    expect((await prisma.vessel.findUniqueOrThrow({ where: { id: vesselId } })).status).toBe('MAINTENANCE');

    const part = await admin.post(`/maintenance/orders/${o.body.id}/parts`, { warehouseId: wh, itemId: filter, quantity: 2 });
    expect(part.status).toBe(201);
    expect((await admin.post(`/maintenance/orders/${o.body.id}/parts`, { warehouseId: wh, itemId: filter, quantity: 10 })).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await admin.post(`/maintenance/orders/${o.body.id}/cancel`, { reason: 'x' })).body.error.code).toBe('HAS_PARTS');

    // completion time entered at minute precision (seconds truncated) in the same minute as the start is accepted
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    expect((await admin.post(`/maintenance/orders/${o.body.id}/complete`, { completedAt: ago(1), engineHours: 20 })).status).toBe(400);
    const done = await admin.post(`/maintenance/orders/${o.body.id}/complete`, { completedAt: minute, engineHours: 20, findings: 'เปลี่ยน 2 ตัว', laborCost: 500, externalCost: 0 });
    expect(done.status).toBe(200);
    const detail = (await admin.get(`/maintenance/orders/${o.body.id}`)).body;
    expect(detail).toMatchObject({ status: 'COMPLETED', partsCost: '600', totalCost: 1100 });
    expect(detail.parts).toHaveLength(1);
    expect((await prisma.vessel.findUniqueOrThrow({ where: { id: vesselId } })).status).toBe('AT_PORT');
    const p2 = (await admin.get(`/maintenance/plans?vesselId=${vesselId}`)).body.find((x: { id: string }) => x.id === plan.id);
    expect(p2.due.state).toBe('OK');
    expect(Number(p2.lastDoneEngineHours)).toBe(20);
    const latest = (await admin.get(`/maintenance/engine-hours?vesselId=${vesselId}`)).body[0];
    expect(latest).toMatchObject({ source: 'MAINTENANCE', hours: '20' });

    const rep = (await admin.get('/maintenance/report?groupBy=category')).body;
    expect(rep.items[0]).toMatchObject({ key: 'SAFETY', orders: 1, total: 1100 });
  });

  it('cannot take a vessel at sea out of service; trip engine hours are logged', async () => {
    const t = await departedTrip(admin, f);
    const o = (await admin.post('/maintenance/orders', { vesselId, title: 'ซ่อมกว้าน', category: 'HYDRAULIC', type: 'CORRECTIVE', reportedAt: ago(1), takesOutOfService: true })).body;
    const r = await admin.post(`/maintenance/orders/${o.id}/start`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('VESSEL_AT_SEA');
    expect((await admin.post(`/maintenance/orders/${o.id}/cancel`, { reason: 'ซ่อมหลังเข้าท่า' })).body.status).toBe('CANCELLED');
    // back-dated arrival reading higher than a later maintenance reading is rejected
    const bad = await admin.post(`/trips/${t.id}/arrive`, { arrivedAt: ago(0.2), arrivalPort: 'สงขลา', fuelAtArrivalL: 10, engineHoursAtArrival: 60 });
    expect(bad.body.error.code).toBe('ENGINE_HOURS_DECREASE');
    await admin.post(`/trips/${t.id}/arrive`, { arrivedAt: new Date().toISOString(), arrivalPort: 'สงขลา', fuelAtArrivalL: 10, engineHoursAtArrival: 60 });
    const logs = (await admin.get(`/maintenance/engine-hours?vesselId=${vesselId}`)).body;
    expect(logs[0]).toMatchObject({ source: 'TRIP_ARRIVAL', hours: '60', tripId: t.id });
  });
});
