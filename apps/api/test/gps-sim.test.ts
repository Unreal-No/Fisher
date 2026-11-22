import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { haversineKm } from '../src/modules/gps/geo';
import { ingest } from '../src/modules/gps/service';
import { fishingGround, HOME_PORT, runSimulatorTick, simStep } from '../src/modules/gps/simulator';
import { createUser, departedTrip, fixtures, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

describe('simulated AIS/VMS feed', () => {
  it('backfills a voyage since departure, then advances minute by minute; vessels in port send heartbeats', async () => {
    const f = await fixtures(admin); // trip departs 48 h ago
    const trip = await departedTrip(admin, f);
    const port = await fixtures(admin); // no trip: in port
    const now = new Date();
    const r1 = await runSimulatorTick(now);
    expect(r1.vessels).toBe(2);
    const n1 = await prisma.gpsPosition.count({ where: { vesselId: f.vessel.id } });
    expect(n1).toBeGreaterThan(48 * 6 - 5); // 10-minute backfill
    expect(await prisma.gpsPosition.count({ where: { vesselId: f.vessel.id, isDemo: false } })).toBe(0);
    expect(await prisma.gpsPosition.count({ where: { vesselId: port.vessel.id } })).toBe(1);

    // the track has the shape of a fishing trip: leaves port, reaches the ground, anchors at night
    const tr = (await admin.get(`/gps/track?vesselId=${f.vessel.id}&from=${new Date(now.getTime() - 50 * 3600_000).toISOString()}&to=${now.toISOString()}`)).body;
    expect(tr.analysis.summary.km).toBeGreaterThan(50);
    expect(tr.analysis.stops.length).toBeGreaterThanOrEqual(1);
    expect(tr.analysis.stops.some((s: { hours: number }) => s.hours >= 6)).toBe(true); // a night at anchor
    const last = await prisma.gpsPosition.findFirstOrThrow({ where: { vesselId: f.vessel.id }, orderBy: { recordedAt: 'desc' } });
    const ground = fishingGround(f.vessel.id);
    expect(haversineKm(Number(last.lat), Number(last.lng), ground.lat, ground.lng)).toBeLessThan(20);

    // next minute: one more point; heartbeat not due yet
    const r2 = await runSimulatorTick(new Date(now.getTime() + 61_000));
    expect(r2.written).toBe(1);

    // trip returning: a day of steps from the ground brings the vessel back to port, stationary
    let st = { lat: ground.lat, lng: ground.lng, t: now };
    let p = simStep(st, 10, { vesselId: f.vessel.id, status: 'RETURNING', home: HOME_PORT });
    expect(p.speedKnots).toBe(8);
    for (let i = 0; i < 144; i++) {
      p = simStep(st, 10, { vesselId: f.vessel.id, status: 'RETURNING', home: HOME_PORT });
      st = { lat: p.lat, lng: p.lng, t: p.recordedAt };
    }
    expect(haversineKm(st.lat, st.lng, HOME_PORT.lat, HOME_PORT.lng)).toBeLessThan(0.5);
    expect(p.speedKnots).toBe(0);
    expect(trip.id).toBeTruthy();

    // real data takes over: a registered device or a real fix stops the simulator for that vessel, and the track
    // shows only the real points (no zig-zag between simulated and real positions)
    expect((await admin.post('/gps/devices', { source: 'DEDICATED', identifier: 'IMEI-REAL-1', vesselId: port.vessel.id })).body.apiKey).toBeTruthy();
    const dev = await prisma.gpsDevice.create({ data: { identifier: 'IMEI-REAL-2', source: 'DEDICATED', vesselId: f.vessel.id, isActive: false } });
    const t0 = now.getTime() - 3 * 3600_000;
    await ingest({ id: dev.id, vesselId: f.vessel.id, source: 'DEDICATED' }, Array.from({ length: 12 }, (_, i) => ({
      recordedAt: new Date(t0 + i * 10 * 60_000), lat: 9.5 + i * 0.01, lng: 99.9, speedKnots: 4, headingDeg: 0,
    })));
    const r3 = await runSimulatorTick(new Date(now.getTime() + 20 * 60_000));
    expect(r3).toMatchObject({ vessels: 0, skippedReal: 2, written: 0 });
    const tr2 = (await admin.get(`/gps/track?vesselId=${f.vessel.id}&from=${new Date(now.getTime() - 50 * 3600_000).toISOString()}&to=${now.toISOString()}`)).body;
    expect(tr2.total).toBe(12);
    expect(tr2.demoHidden).toBe(n1); // the extra minute is after `to`
    expect(tr2.points.every((x: { isDemo: boolean }) => !x.isDemo)).toBe(true);
    expect(tr2.analysis.summary.km).toBeLessThan(20);
  });
});
