import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { haversineKm } from '../src/modules/gps/geo';
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
  });
});
