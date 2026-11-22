// GPS storage, geofence evaluation, fleet status, signal-lost alerts and clearly-flagged demo tracks.
import { formatDateTime } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { num } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { getSettings } from '../../lib/settings';
import { EventEmitter } from 'node:events';
import type { FastifyRequest } from 'fastify';
import type { ParsedPosition } from './adapters';
import { haversineKm, insideFence, move } from './geo';
import { analyzeVoyage, type NamedPlace } from './voyage';

const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 86400_000;

interface DeviceLite {
  id: string;
  vesselId: string | null;
  source: 'DEDICATED' | 'MOBILE' | 'AIS';
}

async function usersWith(perm: string) {
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, roles: { some: { role: { permissions: { some: { permission: { code: perm } } } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Last stored position per vessel (DISTINCT ON uses index vessel_id, recorded_at). */
export async function lastPositions(vesselIds: string[], includeDemo = true) {
  if (!vesselIds.length) return new Map<string, LastPos>();
  const rows = await prisma.$queryRaw<LastPos[]>`
    SELECT DISTINCT ON (vessel_id) vessel_id AS "vesselId", lat, lng, speed_knots AS "speedKnots", heading_deg AS "headingDeg",
      recorded_at AS "recordedAt", source, is_demo AS "isDemo"
    FROM gps_positions
    WHERE vessel_id = ANY(${vesselIds}::uuid[]) ${includeDemo ? Prisma.empty : Prisma.sql`AND is_demo = false`}
    ORDER BY vessel_id, recorded_at DESC`;
  return new Map(rows.map((r) => [r.vesselId, r]));
}
export interface LastPos {
  vesselId: string;
  lat: Prisma.Decimal;
  lng: Prisma.Decimal;
  speedKnots: Prisma.Decimal | null;
  headingDeg: Prisma.Decimal | null;
  recordedAt: Date;
  source: string;
  isDemo: boolean;
}

/** Compare previous vs latest position per vessel against active geofences; emit ENTER/EXIT events + alerts. */
async function evaluateGeofences(vesselId: string, prev: LastPos | undefined, latest: { lat: number; lng: number; recordedAt: Date }, isDemo: boolean) {
  if (!prev || latest.recordedAt <= prev.recordedAt) return 0;
  const fences = await prisma.geofence.findMany({ where: { isActive: true } });
  if (!fences.length) return 0;
  const vessel = await prisma.vessel.findUnique({ where: { id: vesselId }, select: { code: true, name: true } });
  let n = 0;
  for (const f of fences) {
    const was = insideFence(f, num(prev.lat), num(prev.lng));
    const is = insideFence(f, latest.lat, latest.lng);
    if (was === is) continue;
    const type = is ? 'ENTER' : 'EXIT';
    if (f.alertOn !== 'BOTH' && f.alertOn !== type) continue;
    const ev = await prisma.geofenceEvent.create({
      data: { geofenceId: f.id, vesselId, eventType: type, at: latest.recordedAt, lat: latest.lat, lng: latest.lng, isDemo },
    });
    n++;
    if (isDemo) continue; // demo data never raises operational alerts
    const users = await usersWith('gps.view');
    await prisma.notification.createMany({
      data: users.map((userId) => ({
        userId, type: 'GEOFENCE', severity: 'WARNING' as const,
        title: `${vessel?.name ?? 'เรือ'} ${type === 'ENTER' ? 'เข้าเขต' : 'ออกนอกเขต'} "${f.name}"`,
        message: `${vessel?.code ?? ''} · ${formatDateTime(latest.recordedAt)}`,
        link: `/gps?vesselId=${vesselId}`, entityType: 'Vessel', entityId: vesselId, dedupeKey: `geofence:${ev.id}`,
      })),
      skipDuplicates: true,
    });
  }
  return n;
}

/** Store positions for a device. Idempotent (unique vessel+device+time). */
/** In-process live feed for the map (single instance; see docs for multi-instance). */
export const gpsBus = new EventEmitter();
gpsBus.setMaxListeners(500);
export interface LivePosition {
  vesselId: string;
  lat: number;
  lng: number;
  speedKnots: number | null;
  headingDeg: number | null;
  recordedAt: string;
  isDemo: boolean;
  source: string;
}

export async function ingest(device: DeviceLite, positions: ParsedPosition[], opts: { isDemo?: boolean } = {}) {
  const now = Date.now();
  let rejected = 0;
  let unknownVessel = 0;
  const mmsiMap = new Map<string, string>();
  if (device.source === 'AIS') {
    const mmsis = [...new Set(positions.map((p) => p.mmsi).filter(Boolean) as string[])];
    const vs = await prisma.vessel.findMany({ where: { mmsi: { in: mmsis }, deletedAt: null }, select: { id: true, mmsi: true } });
    for (const v of vs) mmsiMap.set(v.mmsi!, v.id);
  } else if (!device.vesselId) {
    throw unprocessable('DEVICE_NOT_ASSIGNED', 'อุปกรณ์ยังไม่ได้ผูกกับเรือ');
  }
  const rows: Prisma.GpsPositionCreateManyInput[] = [];
  for (const p of positions) {
    const vesselId = device.source === 'AIS' ? mmsiMap.get(p.mmsi ?? '') : device.vesselId!;
    if (!vesselId) {
      unknownVessel++;
      continue;
    }
    const t = p.recordedAt.getTime();
    const bad =
      Number.isNaN(t) || t > now + MAX_FUTURE_MS || t < now - MAX_AGE_MS || !(Math.abs(p.lat) <= 90) || !(Math.abs(p.lng) <= 180) ||
      (p.lat === 0 && p.lng === 0); // "null island" = no fix
    if (bad) {
      rejected++;
      continue;
    }
    rows.push({
      vesselId, deviceId: device.id, recordedAt: p.recordedAt, lat: p.lat, lng: p.lng,
      speedKnots: p.speedKnots ?? null, headingDeg: p.headingDeg ?? null, signalQuality: p.signalQuality ?? null,
      source: device.source, isDemo: !!opts.isDemo,
    });
  }
  const vesselIds = [...new Set(rows.map((r) => r.vesselId))];
  const prev = await lastPositions(vesselIds);
  const res = rows.length ? await prisma.gpsPosition.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  await prisma.gpsDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  let geofenceEvents = 0;
  for (const vid of vesselIds) {
    const latest = rows.filter((r) => r.vesselId === vid).sort((a, b) => +new Date(b.recordedAt) - +new Date(a.recordedAt))[0]!;
    geofenceEvents += await evaluateGeofences(vid, prev.get(vid), { lat: Number(latest.lat), lng: Number(latest.lng), recordedAt: new Date(latest.recordedAt) }, !!opts.isDemo);
    // push to live map listeners only when this is newer than what they already have
    const p = prev.get(vid);
    if (res.count && (!p || new Date(latest.recordedAt) > p.recordedAt))
      gpsBus.emit('position', {
        vesselId: vid, lat: Number(latest.lat), lng: Number(latest.lng), speedKnots: latest.speedKnots == null ? null : Number(latest.speedKnots),
        headingDeg: latest.headingDeg == null ? null : Number(latest.headingDeg), recordedAt: new Date(latest.recordedAt).toISOString(), isDemo: !!opts.isDemo, source: device.source,
      } satisfies LivePosition);
  }
  return { accepted: res.count, duplicates: rows.length - res.count, rejected, unknownVessel, geofenceEvents };
}

export type GpsLinkState = 'ONLINE' | 'LOST' | 'NO_DATA';
export const linkState = (last: Date | undefined, lostMinutes: number, now = Date.now()): GpsLinkState =>
  !last ? 'NO_DATA' : now - last.getTime() <= lostMinutes * 60_000 ? 'ONLINE' : 'LOST';

/** Fleet snapshot for the map. Demo positions are returned but flagged. */
export async function fleet(scope: string[] | undefined) {
  const { gpsSignalLostMinutes } = await getSettings(prisma);
  const vessels = await prisma.vessel.findMany({
    where: { deletedAt: null, status: { not: 'INACTIVE' }, ...(scope ? { id: { in: scope } } : {}) },
    select: {
      id: true, code: true, name: true, status: true,
      trips: { where: { status: { in: ['DEPARTED', 'AT_SEA', 'RETURNING'] } }, select: { id: true, tripNo: true, status: true }, take: 1 },
      gpsDevices: { where: { isActive: true }, select: { id: true, source: true, identifier: true, lastSeenAt: true } },
    },
    orderBy: { code: 'asc' },
  });
  const last = await lastPositions(vessels.map((v) => v.id));
  return {
    signalLostMinutes: gpsSignalLostMinutes,
    vessels: vessels.map(({ trips, ...v }) => {
      const p = last.get(v.id);
      return { ...v, activeTrip: trips[0] ?? null, position: p ?? null, link: linkState(p && !p.isDemo ? p.recordedAt : undefined, gpsSignalLostMinutes) };
    }),
  };
}

/** Alert when a vessel that is at sea has no (real) position within the configured window. */
export async function scanSignalLost(now = new Date()) {
  const { gpsSignalLostMinutes } = await getSettings(prisma);
  const trips = await prisma.fishingTrip.findMany({
    where: { status: { in: ['DEPARTED', 'AT_SEA', 'RETURNING'] } },
    select: { id: true, tripNo: true, departedAt: true, vessel: { select: { id: true, code: true, name: true } } },
  });
  if (!trips.length) return { alerts: 0 };
  const last = await lastPositions(trips.map((t) => t.vessel.id), false);
  const users = await usersWith('gps.view');
  let alerts = 0;
  for (const t of trips) {
    const p = last.get(t.vessel.id);
    const ref = p?.recordedAt ?? t.departedAt ?? now;
    if (now.getTime() - ref.getTime() <= gpsSignalLostMinutes * 60_000) continue;
    alerts++;
    const key = `gpslost:${t.id}:${p ? p.recordedAt.toISOString() : 'none'}`;
    await prisma.notification.createMany({
      data: users.map((userId) => ({
        userId, type: 'GPS_SIGNAL_LOST', severity: 'CRITICAL' as const,
        title: `${t.vessel.name} ขาดสัญญาณ GPS`,
        message: `${t.tripNo} · ตำแหน่งล่าสุด ${p ? formatDateTime(p.recordedAt) : 'ยังไม่มีข้อมูลตั้งแต่ออกเรือ'}`,
        link: `/gps?vesselId=${t.vessel.id}`, entityType: 'Vessel', entityId: t.vessel.id, dedupeKey: key,
      })),
      skipDuplicates: true,
    });
  }
  return { alerts };
}

/** Track for a vessel in a time range (downsampled to <= 5000 points) + trip markers + geofence events. */
/**
 * One coherent track out of everything stored for a vessel. Real data always wins: when the window has any real point,
 * demo points are left out (never mixed). Among several devices (e.g. AIS box + phone) the one with most points is
 * primary; another device's point is kept when the primary was silent around it (> `fillGapMin`) or when it agrees with
 * the primary's nearest fix. Disagreeing points are dropped — interleaving them would zig-zag between two positions.
 */
export function mergeDevices<T extends { deviceId: string | null; source: string; isDemo: boolean; recordedAt: Date; lat: unknown; lng: unknown }>(
  rows: T[],
  opt = { fillGapMin: 15, maxKnots: 30, toleranceKm: 0.5 },
) {
  const real = rows.filter((r) => !r.isDemo);
  const pool = real.length ? real : rows;
  const byDevice = new Map<string, T[]>();
  for (const r of pool) {
    const k = r.deviceId ?? `source:${r.source}`;
    const list = byDevice.get(k);
    if (list) list.push(r);
    else byDevice.set(k, [r]);
  }
  const at = (r: T) => r.recordedAt.getTime();
  const byTime = (a: T, b: T) => at(a) - at(b);
  const devices = [...byDevice.values()].sort((a, b) => b.length - a.length);
  const primary = (devices[0] ?? []).slice().sort(byTime);
  const nearest = (t: number) => {
    let lo = 0;
    let hi = primary.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at(primary[mid]!) < t) lo = mid + 1;
      else hi = mid;
    }
    const prev = lo > 0 ? primary[lo - 1] : undefined;
    const cur = primary[lo];
    return prev && (!cur || Math.abs(t - at(prev)) < Math.abs(at(cur) - t)) ? prev : cur;
  };
  const keep = (r: T) => {
    const p = nearest(at(r));
    if (!p) return true;
    const dtMin = Math.abs(at(r) - at(p)) / 60_000;
    if (dtMin > opt.fillGapMin) return true;
    const km = haversineKm(Number(p.lat), Number(p.lng), Number(r.lat), Number(r.lng));
    return km <= opt.toleranceKm + opt.maxKnots * 1.852 * (dtMin / 60);
  };
  const merged = [...primary, ...devices.slice(1).flatMap((d) => d.filter(keep))].sort(byTime);
  return { rows: merged, demoHidden: rows.length - pool.length, devices: devices.length };
}

export async function track(vesselId: string, from: Date, to: Date, includeDemo: boolean) {
  const where = { vesselId, recordedAt: { gte: from, lte: to }, ...(includeDemo ? {} : { isDemo: false }) };
  const stored = await prisma.gpsPosition.findMany({
    where, orderBy: { recordedAt: 'asc' }, take: 50_000,
    select: { lat: true, lng: true, speedKnots: true, headingDeg: true, recordedAt: true, source: true, isDemo: true, deviceId: true },
  });
  const { rows: merged, demoHidden, devices } = mergeDevices(stored);
  const rows = merged.map(({ deviceId: _d, ...r }) => r);
  const total = rows.length;
  const step = Math.max(1, Math.ceil(total / 5000));
  const points = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  const fences = await prisma.geofence.findMany({ where: { isActive: true } });
  const [trips, events] = await Promise.all([
    prisma.fishingTrip.findMany({
      where: { vesselId, OR: [{ departedAt: { gte: from, lte: to } }, { arrivedAt: { gte: from, lte: to } }] },
      select: { id: true, tripNo: true, departedAt: true, departureLat: true, departureLng: true, departurePort: true, arrivedAt: true, arrivalLat: true, arrivalLng: true, arrivalPort: true },
    }),
    prisma.geofenceEvent.findMany({
      where: { vesselId, at: { gte: from, lte: to }, ...(merged.some((r) => r.isDemo) ? {} : { isDemo: false }) },
      include: { geofence: { select: { name: true } } }, orderBy: { at: 'asc' },
    }),
  ]);
  // legs / stops on every point (not the sampled map line); places = geofences + trip ports
  const places: NamedPlace[] = [
    ...fences.map((f) => ({ name: f.name, fence: { type: f.type, centerLat: num(f.centerLat), centerLng: num(f.centerLng), radiusKm: num(f.radiusKm), polygon: f.polygon as [number, number][] | null } })),
    ...trips.flatMap((t) => [
      { name: t.departurePort ?? '', lat: t.departureLat === null ? null : num(t.departureLat), lng: t.departureLng === null ? null : num(t.departureLng) },
      { name: t.arrivalPort ?? '', lat: t.arrivalLat === null ? null : num(t.arrivalLat), lng: t.arrivalLng === null ? null : num(t.arrivalLng) },
    ]).filter((p) => p.name && p.lat !== null),
  ];
  const analysis = analyzeVoyage(rows.map((r) => ({ t: r.recordedAt, lat: num(r.lat), lng: num(r.lng), speedKnots: r.speedKnots === null ? null : num(r.speedKnots) })), places);
  return { total, sampledEvery: step, demoHidden, devices, points, trips, events, analysis };
}

/** DEMO ONLY: synthesise a plausible track (flagged is_demo) so the map can be evaluated without hardware. */
export async function generateDemo(req: FastifyRequest, vesselId: string, hours: number) {
  const v = await prisma.vessel.findFirst({ where: { id: vesselId, deletedAt: null } });
  if (!v) throw notFound('เรือ');
  const device = await prisma.gpsDevice.upsert({
    where: { identifier: `demo:${vesselId}` },
    create: { identifier: `demo:${vesselId}`, source: 'DEDICATED', vesselId, name: 'โหมดสาธิต (ไม่ใช่ข้อมูลจริง)', isActive: false },
    update: {},
  });
  let [lat, lng] = [7.25 + Math.random() * 0.2, 100.65 + Math.random() * 0.2]; // off Songkhla
  let heading = 60 + Math.random() * 60;
  const end = Date.now();
  const positions: ParsedPosition[] = [];
  for (let t = end - hours * 3600_000; t <= end; t += 10 * 60_000) {
    heading = (heading + (Math.random() - 0.5) * 40 + 360) % 360;
    const knots = 3 + Math.random() * 5;
    [lat, lng] = move(lat, lng, heading, knots * 1.852 * (10 / 60));
    positions.push({ recordedAt: new Date(t), lat, lng, speedKnots: Math.round(knots * 10) / 10, headingDeg: Math.round(heading) });
  }
  const r = await ingest({ id: device.id, vesselId, source: 'DEDICATED' }, positions, { isDemo: true });
  await audit(prisma, req, { action: 'CREATE', entityType: 'GpsDemo', entityId: vesselId, note: `demo ${positions.length} points` });
  return r;
}
