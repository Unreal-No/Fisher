// Simulated AIS/VMS feed (until a real provider is connected). Vessels with a trip at sea sail from their port to a
// fishing ground, trawl by day, anchor at night and head home when the trip is RETURNING; vessels in port send a
// stationary heartbeat. Every position is is_demo = true, so it is labelled "จำลอง" and never mixed with real data.
import { createHash } from 'node:crypto';
import { AT_SEA_STATUSES } from '@fisher/shared';
import { num } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import type { ParsedPosition } from './adapters';
import { bearingDeg, haversineKm, move } from './geo';
import { ingest } from './service';

export const HOME_PORT = { lat: 7.2235, lng: 100.5937, name: 'ท่าเทียบเรือประมงสงขลา' };
const TRANSIT_KN = 8;
const TRAWL_KN = 3;
const GROUND_RADIUS_KM = 12;
const BACKFILL_DAYS = 21;
const STEP_MIN = 10; // backfill resolution
const HEARTBEAT_MIN = 15;

/** deterministic 0..1 values per vessel */
function seed(id: string, i: number) {
  return createHash('sha256').update(`${id}:${i}`).digest().readUInt32BE(0) / 0xffffffff;
}
/** fishing ground 60–120 km offshore, east/south-east of the home port (Gulf of Thailand) */
export function fishingGround(vesselId: string, home = HOME_PORT) {
  const [lat, lng] = move(home.lat, home.lng, 45 + seed(vesselId, 1) * 75, 60 + seed(vesselId, 2) * 60);
  return { lat, lng };
}
const bkkHour = (t: Date) => (t.getUTCHours() + 7) % 24;

export interface SimState {
  lat: number;
  lng: number;
  t: Date;
}
/** One step of `minutes` for a vessel in the given trip status. */
export function simStep(prev: SimState, minutes: number, ctx: { vesselId: string; status: string; home: { lat: number; lng: number } }): ParsedPosition & { lat: number; lng: number } {
  const t = new Date(prev.t.getTime() + minutes * 60_000);
  const ground = fishingGround(ctx.vesselId, { ...HOME_PORT, ...ctx.home });
  const jitter = (seed(ctx.vesselId, Math.floor(t.getTime() / 600_000)) - 0.5) * 30;
  const go = (target: { lat: number; lng: number }, kn: number) => {
    const d = haversineKm(prev.lat, prev.lng, target.lat, target.lng);
    const stepKm = Math.min(d, kn * 1.852 * (minutes / 60));
    const hdg = bearingDeg(prev.lat, prev.lng, target.lat, target.lng);
    const [lat, lng] = move(prev.lat, prev.lng, hdg, stepKm);
    return { recordedAt: t, lat, lng, speedKnots: stepKm > 0 ? kn : 0, headingDeg: Math.round(hdg) };
  };
  if (ctx.status === 'RETURNING' || !AT_SEA_STATUSES.includes(ctx.status as never)) {
    if (haversineKm(prev.lat, prev.lng, ctx.home.lat, ctx.home.lng) < 0.3) return { recordedAt: t, lat: prev.lat, lng: prev.lng, speedKnots: 0, headingDeg: null };
    return go(ctx.home, TRANSIT_KN);
  }
  const dGround = haversineKm(prev.lat, prev.lng, ground.lat, ground.lng);
  if (dGround > GROUND_RADIUS_KM) return go(ground, TRANSIT_KN);
  const h = bkkHour(t);
  if (h >= 18 || h < 5) {
    // anchored / drifting at night
    const [lat, lng] = move(prev.lat, prev.lng, (jitter + 360) % 360, 0.02 * (minutes / 60));
    return { recordedAt: t, lat, lng, speedKnots: 0.2, headingDeg: null };
  }
  // trawling: wander around the ground, steer back toward its centre near the edge
  const base = dGround > GROUND_RADIUS_KM * 0.7 ? bearingDeg(prev.lat, prev.lng, ground.lat, ground.lng) : (seed(ctx.vesselId, Math.floor(t.getTime() / 7_200_000)) * 360);
  const hdg = (base + jitter + 360) % 360;
  const [lat, lng] = move(prev.lat, prev.lng, hdg, TRAWL_KN * 1.852 * (minutes / 60));
  return { recordedAt: t, lat, lng, speedKnots: TRAWL_KN, headingDeg: Math.round(hdg) };
}

async function simDevice(vesselId: string) {
  return prisma.gpsDevice.upsert({
    where: { identifier: `sim:${vesselId}` },
    create: { identifier: `sim:${vesselId}`, source: 'DEDICATED', vesselId, name: 'ตัวจำลอง AIS/VMS (ไม่ใช่ข้อมูลจริง)', isActive: false },
    update: {},
  });
}

/** Advance every vessel to `now`. Backfills from departure when a trip has no simulated track yet. */
export async function runSimulatorTick(now = new Date()) {
  const vessels = await prisma.vessel.findMany({
    where: { deletedAt: null, status: { not: 'INACTIVE' } },
    select: { id: true, trips: { where: { status: { in: [...AT_SEA_STATUSES] } }, select: { status: true, departedAt: true, departureLat: true, departureLng: true }, take: 1 } },
  });
  let written = 0;
  for (const v of vessels) {
    const trip = v.trips[0];
    const home = trip?.departureLat != null && trip.departureLng != null ? { lat: num(trip.departureLat), lng: num(trip.departureLng) } : HOME_PORT;
    const dev = await simDevice(v.id);
    const last = await prisma.gpsPosition.findFirst({ where: { deviceId: dev.id }, orderBy: { recordedAt: 'desc' } });
    const positions: ParsedPosition[] = [];
    if (!trip) {
      // in port: heartbeat
      if (!last || now.getTime() - last.recordedAt.getTime() >= HEARTBEAT_MIN * 60_000)
        positions.push({ recordedAt: now, lat: home.lat, lng: home.lng, speedKnots: 0, headingDeg: null });
    } else {
      const departed = trip.departedAt ?? now;
      const startAt = new Date(Math.max(departed.getTime(), now.getTime() - BACKFILL_DAYS * 86_400_000));
      let st: SimState = last && last.recordedAt >= startAt ? { lat: num(last.lat), lng: num(last.lng), t: last.recordedAt } : { ...home, t: startAt };
      if (!last || last.recordedAt < startAt) positions.push({ recordedAt: st.t, lat: st.lat, lng: st.lng, speedKnots: 0, headingDeg: null });
      // catch up in 10-minute steps, then the final partial step to "now"
      while (now.getTime() - st.t.getTime() >= 60_000) {
        const gapMin = (now.getTime() - st.t.getTime()) / 60_000;
        const p = simStep(st, Math.min(gapMin > 15 ? STEP_MIN : 1, gapMin), { vesselId: v.id, status: trip.status, home });
        positions.push(p);
        st = { lat: p.lat, lng: p.lng, t: p.recordedAt };
      }
    }
    for (let i = 0; i < positions.length; i += 2000) {
      const r = await ingest({ id: dev.id, vesselId: v.id, source: 'DEDICATED' }, positions.slice(i, i + 2000), { isDemo: true });
      written += r.accepted;
    }
  }
  return { vessels: vessels.length, written };
}
