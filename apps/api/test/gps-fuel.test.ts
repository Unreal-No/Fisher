import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bucket } from '../src/modules/notifications/service';
import { insideFence, haversineKm, pointInPolygon } from '../src/modules/gps/geo';
import { scanSignalLost } from '../src/modules/gps/service';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

const ingest = (url: string, payload: unknown, key?: string, method: 'POST' | 'GET' = 'POST') =>
  app.inject({ method, url: `/api/v1/gps/ingest/${url}`, headers: key ? { 'x-device-key': key } : {}, ...(payload ? { payload: payload as object } : {}) });

describe('geo helpers', () => {
  it('distance, polygon, circle', () => {
    expect(haversineKm(7.2, 100.6, 7.2, 100.6)).toBe(0);
    expect(haversineKm(7.2, 100.6, 8.2, 100.6)).toBeCloseTo(111.2, 0);
    const sq: [number, number][] = [[7, 100], [7, 101], [8, 101], [8, 100]];
    expect(pointInPolygon(7.5, 100.5, sq)).toBe(true);
    expect(pointInPolygon(9, 100.5, sq)).toBe(false);
    expect(insideFence({ type: 'CIRCLE', centerLat: 7.2, centerLng: 100.6, radiusKm: 5, polygon: null }, 7.21, 100.61)).toBe(true);
    expect(bucket(3, [7])).toBe(7);
  });
});

describe('GPS ingestion', () => {
  it('device key auth, validation, dedupe, osmand + AIS adapters, fleet status, geofence events', async () => {
    const f = await fixtures(admin);
    await admin.patch(`/vessels/${f.vessel.id}`, { mmsi: '567000123' });
    const dev = await admin.post('/gps/devices', { vesselId: f.vessel.id, source: 'DEDICATED', identifier: 'IMEI-1' });
    expect(dev.status).toBe(201);
    const key = dev.body.apiKey as string;
    expect(key).toMatch(/^gk_/);
    expect(JSON.stringify(await prisma.gpsDevice.findUnique({ where: { id: dev.body.device.id } }))).not.toContain(key);

    expect((await ingest('generic', { positions: [{ recordedAt: ago(1), lat: 7.2, lng: 100.6 }] })).statusCode).toBe(401);
    expect((await ingest('generic', { positions: [{ recordedAt: ago(1), lat: 7.2, lng: 100.6 }] }, 'gk_wrong')).statusCode).toBe(401);
    expect((await ingest('generic', { positions: [{ recordedAt: ago(1), lat: 95, lng: 100.6 }] }, key)).statusCode).toBe(400);

    // geofence around port: start inside, then leave -> EXIT event
    const fence = await admin.post('/gps/geofences', { name: 'ท่าเรือ', type: 'CIRCLE', centerLat: 7.2, centerLng: 100.6, radiusKm: 2, alertOn: 'BOTH' });
    expect(fence.status).toBe(201);
    const t1 = ago(3);
    const r1 = await ingest('generic', { positions: [{ recordedAt: t1, lat: 7.2, lng: 100.6, speedKnots: 0 }, { recordedAt: ago(4), lat: 7.0, lng: 99.0 }] }, key);
    expect(JSON.parse(r1.body)).toMatchObject({ accepted: 2, rejected: 0 });
    const dup = await ingest('generic', { positions: [{ recordedAt: t1, lat: 7.2, lng: 100.6 }] }, key);
    expect(JSON.parse(dup.body)).toMatchObject({ accepted: 0, duplicates: 1 });
    // future & null-island rejected
    const bad = await ingest('generic', { positions: [{ recordedAt: new Date(Date.now() + 3600_000).toISOString(), lat: 7, lng: 100 }, { recordedAt: ago(1), lat: 0, lng: 0 }] }, key);
    expect(JSON.parse(bad.body).rejected).toBe(2);

    // osmand GET with key in path (Traccar Client style); speed in knots
    const ts = Math.floor(Date.now() / 1000) - 60;
    const o = await app.inject({ method: 'GET', url: `/api/v1/gps/ingest/osmand/${key}?id=IMEI-1&lat=7.4&lon=100.9&timestamp=${ts}&speed=6.5&bearing=45` });
    expect(o.statusCode).toBe(200);
    expect(JSON.parse(o.body).geofenceEvents).toBe(1);
    const ev = await prisma.geofenceEvent.findFirstOrThrow({ where: { vesselId: f.vessel.id } });
    expect(ev.eventType).toBe('EXIT');
    expect(await prisma.notification.count({ where: { type: 'GEOFENCE' } })).toBeGreaterThan(0);

    // AIS feed maps by MMSI; unknown MMSI counted, not stored
    const aisDev = await admin.post('/gps/devices', { source: 'AIS', identifier: 'ais-feed' });
    const a = await ingest('ais', [{ mmsi: '567000123', lat: 7.5, lon: 101, sog: 7, cog: 90, timestamp: new Date().toISOString() }, { mmsi: '999999999', lat: 7, lon: 100 }], aisDev.body.apiKey);
    expect(JSON.parse(a.body)).toMatchObject({ accepted: 1, unknownVessel: 1 });
    // non-AIS key cannot post AIS
    expect((await ingest('ais', [{ mmsi: '567000123', lat: 7, lon: 100 }], key)).statusCode).toBe(400);

    const fleet = (await admin.get('/gps/fleet')).body;
    const v = fleet.vessels.find((x: { id: string }) => x.id === f.vessel.id);
    expect(v.link).toBe('ONLINE');
    expect(Number(v.position.lat)).toBe(7.5);
    const tr = (await admin.get(`/gps/track?vesselId=${f.vessel.id}`)).body;
    // the AIS fix is 15 km from the IMEI fix a minute earlier: both cannot be right, so the busier device wins
    expect(tr.points.length).toBe(3);
    expect(tr.devices).toBe(2);
    expect(tr.events).toHaveLength(1);
  });

  it('mobile reporting respects permission and vessel scope', async () => {
    const a = await fixtures(admin);
    const b = await fixtures(admin);
    await createUser('capgps', 'CAPTAIN', { vesselIds: [a.vessel.id] });
    const cap = await login(app, 'capgps');
    const pos = [{ recordedAt: ago(0.1), lat: 7.3, lng: 100.7 }];
    expect((await cap.post('/gps/mobile', { vesselId: a.vessel.id, positions: pos })).body.accepted).toBe(1);
    expect((await cap.post('/gps/mobile', { vesselId: b.vessel.id, positions: pos })).status).toBe(403);
    await createUser('viewgps', 'VIEWER');
    expect((await (await login(app, 'viewgps')).post('/gps/mobile', { vesselId: a.vessel.id, positions: pos })).status).toBe(403);
  });

  it('signal-lost alert for vessels at sea; demo data flagged and excluded from link status', async () => {
    const f = await fixtures(admin);
    await departedTrip(admin, f); // departed 48h ago, no positions
    expect((await scanSignalLost()).alerts).toBeGreaterThanOrEqual(1);
    const n1 = await prisma.notification.count({ where: { type: 'GPS_SIGNAL_LOST', entityId: f.vessel.id } });
    await scanSignalLost();
    expect(await prisma.notification.count({ where: { type: 'GPS_SIGNAL_LOST', entityId: f.vessel.id } })).toBe(n1); // deduped

    const demo = await admin.post('/gps/demo', { vesselId: f.vessel.id, hours: 2 });
    expect(demo.body.accepted).toBeGreaterThan(10);
    expect(await prisma.gpsPosition.count({ where: { vesselId: f.vessel.id, isDemo: false } })).toBe(0);
    const v = (await admin.get('/gps/fleet')).body.vessels.find((x: { id: string }) => x.id === f.vessel.id);
    expect(v.position.isDemo).toBe(true);
    expect(v.link).toBe('NO_DATA'); // demo never counts as a live signal
    const del = await admin.del(`/gps/demo?vesselId=${f.vessel.id}`);
    expect(del.body.deletedPositions).toBe(demo.body.accepted);
  });
});

describe('fuel tanks (moving average ledger)', () => {
  it('receipt → issue to trip → adjustment; blocks overdraw unless approved; ledger immutable', async () => {
    const f = await fixtures(admin);
    const trip = await departedTrip(admin, f);
    const tank = (await admin.post('/fuel/tanks', { code: 'T1', name: 'ถังกลาง', fuelType: 'DIESEL_B7', capacityL: 50000 })).body;
    await admin.post('/fuel/receipts', { tankId: tank.id, txnDate: ago(10), liters: 10000, unitPrice: 30 });
    await admin.post('/fuel/receipts', { tankId: tank.id, txnDate: ago(9), liters: 10000, unitPrice: 32 });
    let t = await prisma.fuelTank.findUniqueOrThrow({ where: { id: tank.id } });
    expect(Number(t.balanceL)).toBe(20000);
    expect(Number(t.avgCost)).toBe(31);

    const iss = await admin.post('/fuel/issues', { tankId: tank.id, txnDate: ago(8), liters: 3000, vesselId: f.vessel.id, tripId: trip.id });
    expect(iss.status).toBe(201);
    expect(iss.body.totalCost).toBe('-93000');
    const tf = await prisma.tripFuel.findFirstOrThrow({ where: { tripId: trip.id, fuelTxn: { isNot: null } } });
    expect(Number(tf.totalCost)).toBe(93000);
    // ledger-linked trip fuel cannot be deleted from the trip
    expect((await admin.del(`/trips/${trip.id}/fuel/${tf.id}`)).status).toBe(409);

    const over = await admin.post('/fuel/issues', { tankId: tank.id, txnDate: ago(7), liters: 50000, vesselId: f.vessel.id });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('INSUFFICIENT_FUEL');
    await createUser('fuelclerk', 'PURCHASING_OFFICER');
    const clerk = await login(app, 'fuelclerk');
    expect((await clerk.post('/fuel/issues', { tankId: tank.id, txnDate: ago(7), liters: 50000, vesselId: f.vessel.id, override: true, overrideReason: 'x' })).status).toBe(403);

    const adj = await admin.post('/fuel/adjustments', { tankId: tank.id, txnDate: ago(1), measuredBalanceL: 16900, reason: 'วัดระดับถังประจำเดือน' });
    expect(adj.status).toBe(201);
    expect(Number(adj.body.liters)).toBe(-100);
    t = await prisma.fuelTank.findUniqueOrThrow({ where: { id: tank.id } });
    expect(Number(t.balanceL)).toBe(16900);
    await expect(prisma.fuelTransaction.deleteMany({ where: { tankId: tank.id } })).rejects.toThrow();

    const ledger = (await admin.get(`/fuel/transactions?tankId=${tank.id}`)).body;
    expect(ledger.total).toBe(4);
  });

  it('report: consumption, cost per kg, engine hours, estimated flag', async () => {
    const f = await fixtures(admin);
    const t = (await admin.post('/trips', { vesselId: f.vessel.id, captainId: f.captain.id })).body;
    await admin.put(`/trips/${t.id}/crew`, { members: [{ employeeId: f.crew.id, role: 'DECKHAND' }] });
    await admin.post(`/trips/${t.id}/status`, { status: 'PREPARING' });
    await admin.post(`/trips/${t.id}/fuel`, { recordedAt: ago(30), fuelType: 'DIESEL', liters: 2000, pricePerLiter: 30 });
    await admin.post(`/trips/${t.id}/depart`, { departedAt: ago(24), departurePort: 'A', fuelAtDepartureL: 200, engineHoursAtDeparture: 1000 });
    const sp = (await admin.get('/catch/species')).body[0].id;
    await admin.post('/catch/records', { tripId: t.id, speciesId: sp, catchDate: iso(0), weightKg: 1500 });
    expect((await admin.post(`/trips/${t.id}/arrive`, { arrivedAt: ago(1), arrivalPort: 'A', fuelAtArrivalL: 400, engineHoursAtArrival: 990 })).status).toBe(400);
    await admin.post(`/trips/${t.id}/arrive`, { arrivedAt: ago(1), arrivalPort: 'A', fuelAtArrivalL: 400, fuelAtArrivalMeasurement: 'ESTIMATED', engineHoursAtArrival: 1020 });
    const s = (await admin.get(`/trips/${t.id}/settlement`)).body;
    expect(s.fuel.consumedL).toBe(1800);
    expect(s.engineHours).toBe(20);
    expect(s.litersPerEngineHour).toBe(90);
    const r = (await admin.get(`/fuel/report?vesselId=${f.vessel.id}`)).body;
    const row = r.byTrip.find((x: { tripId: string }) => x.tripId === t.id);
    expect(row).toMatchObject({ consumedL: 1800, fuelCost: 60000, catchKg: 1500, fuelCostPerKg: 40, isEstimated: true, engineHours: 20 });
    expect(r.byVessel[0].vessel.id).toBe(f.vessel.id);
  });
});
