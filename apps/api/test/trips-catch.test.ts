import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let speciesId: string;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
  speciesId = (await admin.get('/catch/species')).body[0].id;
});
afterAll(() => app.close());

describe('trip workflow', () => {
  it('runs departure → arrival → settlement → close with business rules', async () => {
    const f = await fixtures(admin);
    const noDocs = (await admin.post('/employees', { firstName: 'NoDoc', lastName: 'X', nationality: 'MM', position: 'DECKHAND', startDate: iso(-5) })).body;
    const t = (await admin.post('/trips', { vesselId: f.vessel.id, captainId: f.captain.id })).body;
    expect(t.tripNo).toMatch(/^TRP-\d{4}-\d{4}$/);
    expect(t.status).toBe('DRAFT');

    // cannot depart from DRAFT
    expect((await admin.post(`/trips/${t.id}/depart`, { departedAt: ago(2), departurePort: 'สงขลา', fuelAtDepartureL: 500 })).status).toBe(409);
    await admin.put(`/trips/${t.id}/crew`, { members: [{ employeeId: f.crew.id, role: 'DECKHAND' }, { employeeId: noDocs.id, role: 'DECKHAND' }] });
    expect((await admin.post(`/trips/${t.id}/status`, { status: 'PREPARING' })).status).toBe(200);

    // second trip cannot be prepared on the same vessel
    const t2 = (await admin.post('/trips', { vesselId: f.vessel.id })).body;
    const c = await admin.post(`/trips/${t2.id}/status`, { status: 'PREPARING' });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('VESSEL_HAS_ACTIVE_TRIP');

    // crew without documents blocks departure
    const dep = { departedAt: ago(48), departurePort: 'สงขลา', fuelAtDepartureL: 500 };
    const blocked = await admin.post(`/trips/${t.id}/depart`, dep);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.some((i: { employeeId: string; problem: string }) => i.employeeId === noDocs.id && i.problem === 'MISSING')).toBe(true);
    // override requires reason
    expect((await admin.post(`/trips/${t.id}/depart`, { ...dep, override: true })).status).toBe(400);
    // replace crew instead
    await admin.put(`/trips/${t.id}/crew`, { members: [{ employeeId: f.crew.id, role: 'DECKHAND' }] });
    await admin.post(`/trips/${t.id}/fuel`, { recordedAt: ago(50), fuelType: 'DIESEL_B7', liters: 1000, pricePerLiter: 32 });
    const ok = await admin.post(`/trips/${t.id}/depart`, dep);
    expect(ok.status).toBe(200);
    expect((await prisma.vessel.findUnique({ where: { id: f.vessel.id } }))!.status).toBe('AT_SEA');
    // cannot cancel after departure, cannot edit crew
    expect((await admin.post(`/trips/${t.id}/cancel`, { reason: 'x' })).status).toBe(409);
    expect((await admin.put(`/trips/${t.id}/crew`, { members: [] })).status).toBe(409);

    // catch at sea
    expect((await admin.post('/catch/records', { tripId: t.id, speciesId, catchDate: iso(-1), weightKg: 1500 })).status).toBe(201);

    // arrival validation
    expect((await admin.post(`/trips/${t.id}/arrive`, { arrivedAt: ago(72), arrivalPort: 'สงขลา', fuelAtArrivalL: 300 })).status).toBe(400);
    const arr = await admin.post(`/trips/${t.id}/arrive`, { arrivedAt: ago(1), arrivalPort: 'สงขลา', fuelAtArrivalL: 300, fuelAtArrivalMeasurement: 'ESTIMATED' });
    expect(arr.status).toBe(200);
    expect((await prisma.vessel.findUnique({ where: { id: f.vessel.id } }))!.status).toBe('AT_PORT');
    await admin.post(`/trips/${t.id}/expenses`, { category: 'UNLOADING', description: 'ค่าขนถ่าย', amount: 2000, expenseDate: iso(0) });
    await admin.post(`/trips/${t.id}/incidents`, { occurredAt: ago(10), type: 'WEATHER', severity: 'LOW', description: 'คลื่นลมแรง' });

    // settlement figures: consumed = 500 + 1000 - 300 = 1200 L (estimated), fuel cost 32,000
    const s = (await admin.get(`/trips/${t.id}/settlement`)).body;
    expect(s.catchKg).toBe(1500);
    expect(s.fuel.consumedL).toBe(1200);
    expect(s.fuel.isEstimated).toBe(true);
    expect(s.fuel.cost).toBe(32000);
    expect(s.expenses).toBe(2000);
    expect(s.totalCost).toBe(34000);
    expect(s.fuelCostPerKg).toBeCloseTo(21.33, 2);

    // close needs PENDING_SETTLEMENT and trip.approve
    expect((await admin.post(`/trips/${t.id}/close`)).status).toBe(409);
    await admin.post(`/trips/${t.id}/status`, { status: 'PENDING_SETTLEMENT' });
    await createUser('cap', 'CAPTAIN');
    const cap = await login(app, 'cap');
    expect((await cap.post(`/trips/${t.id}/close`)).status).toBe(403);
    const closed = await admin.post(`/trips/${t.id}/close`, { note: 'ตรวจแล้ว' });
    expect(closed.status).toBe(200);
    expect(closed.body.settlementSnapshot.catchKg).toBe(1500);
    const hist = await prisma.tripStatusHistory.findMany({ where: { tripId: t.id }, orderBy: { changedAt: 'asc' } });
    expect(hist.map((h) => h.toStatus)).toEqual(['DRAFT', 'PREPARING', 'DEPARTED', 'ARRIVED', 'PENDING_SETTLEMENT', 'CLOSED']);
    // closed trip is immutable for catch
    expect((await admin.post('/catch/records', { tripId: t.id, speciesId, catchDate: iso(0), weightKg: 1 })).status).toBe(409);
  });

  it('override with approval + reason allows departure and is audited', async () => {
    const f = await fixtures(admin);
    const noDocs = (await admin.post('/employees', { firstName: 'NoDoc2', lastName: 'X', nationality: 'MM', position: 'DECKHAND', startDate: iso(-5) })).body;
    const t = (await admin.post('/trips', { vesselId: f.vessel.id, captainId: f.captain.id })).body;
    await admin.put(`/trips/${t.id}/crew`, { members: [{ employeeId: noDocs.id, role: 'DECKHAND' }] });
    await admin.post(`/trips/${t.id}/status`, { status: 'PREPARING' });
    const r = await admin.post(`/trips/${t.id}/depart`, { departedAt: ago(1), departurePort: 'ปัตตานี', fuelAtDepartureL: 0, override: true, overrideReason: 'เอกสารอยู่ระหว่างต่ออายุ มีหลักฐานรับเรื่อง' });
    expect(r.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: t.id, action: 'OVERRIDE' } })).toBe(1);
    const crew = await prisma.tripCrew.findFirstOrThrow({ where: { tripId: t.id } });
    expect(Array.isArray(crew.docCheck) && (crew.docCheck as unknown[]).length).toBeTruthy();
  });

  it('database enforces one active trip per vessel', async () => {
    const f = await fixtures(admin);
    const base = { vesselId: f.vessel.id, status: 'AT_SEA' as const };
    await prisma.fishingTrip.create({ data: { ...base, tripNo: `X-${randomUUID()}` } });
    await expect(prisma.fishingTrip.create({ data: { ...base, tripNo: `X-${randomUUID()}` } })).rejects.toThrow();
  });
});

describe('catch records', () => {
  it('requires a departed trip, is idempotent, adjusts with reason & version, voids, summarises', async () => {
    const f = await fixtures(admin);
    const draft = (await admin.post('/trips', { vesselId: (await admin.post('/vessels', { name: 'D', registrationNo: 'R-DRAFT', vesselType: 'x' })).body.id })).body;
    expect((await admin.post('/catch/records', { tripId: draft.id, speciesId, catchDate: iso(0), weightKg: 10 })).status).toBe(409);

    const t = await departedTrip(admin, f);
    const clientRequestId = randomUUID();
    const body = { clientRequestId, tripId: t.id, speciesId, catchDate: iso(0), weightKg: '125.5', basketCount: 5 };
    const a = await admin.post('/catch/records', body);
    const b = await admin.post('/catch/records', body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.id).toBe(a.body.id);
    expect(a.body.vesselId).toBe(f.vessel.id);
    expect(await prisma.catchRecord.count({ where: { tripId: t.id } })).toBe(1);

    expect((await admin.patch(`/catch/records/${a.body.id}`, { version: 1, weightKg: 120 })).status).toBe(400); // reason required
    const adj = await admin.patch(`/catch/records/${a.body.id}`, { version: 1, weightKg: 120, reason: 'ชั่งซ้ำที่ท่า' });
    expect(adj.status).toBe(200);
    expect(adj.body.weightKg).toBe('120');
    expect((await admin.patch(`/catch/records/${a.body.id}`, { version: 1, weightKg: 110, reason: 'x' })).status).toBe(409);
    const detail = (await admin.get(`/catch/records/${a.body.id}`)).body;
    expect(detail.adjustments[0].changes.weightKg).toEqual({ from: '125.5', to: 120 });

    await admin.post('/catch/records', { tripId: t.id, speciesId, catchDate: iso(0), weightKg: 80 });
    const sum = (await admin.get(`/catch/summary?groupBy=species&tripId=${t.id}`)).body;
    expect(sum[0].weightKg).toBe(200);
    expect((await admin.post(`/catch/records/${a.body.id}/void`, { reason: 'บันทึกผิดเที่ยว' })).status).toBe(200);
    const list = (await admin.get(`/catch/records?tripId=${t.id}`)).body;
    expect(list.total).toBe(1);
    expect(list.totalKg).toBe(80);

    const loss = await admin.post('/catch/losses', { tripId: t.id, speciesId, lossType: 'SPOILAGE', weightKg: 5, reason: 'น้ำแข็งละลาย', recordedAt: ago(1) });
    expect(loss.status).toBe(201);
    expect((await admin.get(`/trips/${t.id}/settlement`)).body.lossKg).toBe(5);
  });

  it('dashboard figures come from records', async () => {
    const d = (await admin.get(`/dashboard/summary?from=${iso(-30)}&to=${iso(0)}`)).body;
    expect(d.catch.totalKg).toBeGreaterThan(0);
    expect(d.vessels.total).toBe(await prisma.vessel.count({ where: { deletedAt: null } }));
    expect(d.fuel.cost).not.toBeNull();
  });
});
