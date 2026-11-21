// GPS storage, geofence evaluation, fleet status, signal-lost alerts and clearly-flagged demo tracks.
import { formatDateTime } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { notFound, unprocessable } from '../../lib/errors';
import { num } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { getSettings } from '../../lib/settings';
import type { FastifyRequest } from 'fastify';
import type { ParsedPosition } from './adapters';
import { insideFence, move } from './geo';

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
export async function track(vesselId: string, from: Date, to: Date, includeDemo: boolean) {
  const where = { vesselId, recordedAt: { gte: from, lte: to }, ...(includeDemo ? {} : { isDemo: false }) };
  const total = await prisma.gpsPosition.count({ where });
  const step = Math.max(1, Math.ceil(total / 5000));
  const rows = await prisma.gpsPosition.findMany({
    where, orderBy: { recordedAt: 'asc' }, take: 50_000,
    select: { lat: true, lng: true, speedKnots: true, headingDeg: true, recordedAt: true, source: true, isDemo: true },
  });
  const points = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  const [trips, events] = await Promise.all([
    prisma.fishingTrip.findMany({
      where: { vesselId, OR: [{ departedAt: { gte: from, lte: to } }, { arrivedAt: { gte: from, lte: to } }] },
      select: { id: true, tripNo: true, departedAt: true, departureLat: true, departureLng: true, departurePort: true, arrivedAt: true, arrivalLat: true, arrivalLng: true, arrivalPort: true },
    }),
    prisma.geofenceEvent.findMany({
      where: { vesselId, at: { gte: from, lte: to }, ...(includeDemo ? {} : { isDemo: false }) },
      include: { geofence: { select: { name: true } } }, orderBy: { at: 'asc' },
    }),
  ]);
  return { total, sampledEvery: step, points, trips, events };
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
