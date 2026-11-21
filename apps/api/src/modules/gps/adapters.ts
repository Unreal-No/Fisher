// GPS ingestion adapters: each turns a provider payload into normalised positions.
// Add a provider = add an adapter here (no change to storage/geofence logic).
import { gpsIngestSchema } from '@fisher/shared';
import { badRequest } from '../../lib/errors';

export interface ParsedPosition {
  mmsi?: string; // AIS only: vessel resolved by MMSI
  recordedAt: Date;
  lat: number;
  lng: number;
  speedKnots?: number | null;
  headingDeg?: number | null;
  signalQuality?: number | null;
}
export interface AdapterInput {
  body: unknown;
  query: Record<string, string | undefined>;
}
export interface GpsAdapter {
  source: 'DEDICATED' | 'MOBILE' | 'AIS';
  parse(i: AdapterInput): ParsedPosition[];
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
/** unix seconds | unix ms | ISO string */
export function parseTime(v: unknown): Date {
  if (v === undefined || v === null || v === '') return new Date();
  const n = Number(v);
  if (!Number.isNaN(n)) return new Date(n > 1e12 ? n : n * 1000);
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest('timestamp ไม่ถูกต้อง');
  return d;
}

/** Our JSON format: { positions: [{ recordedAt, lat, lng, speedKnots?, headingDeg?, signalQuality? }] } */
const generic: GpsAdapter = {
  source: 'DEDICATED',
  parse: ({ body }) =>
    gpsIngestSchema.parse(body).positions.map((p) => ({ ...p, recordedAt: new Date(p.recordedAt) })),
};

/** OsmAnd / Traccar Client protocol (phones & many trackers): id, lat, lon, timestamp, speed (knots), bearing */
const osmand: GpsAdapter = {
  source: 'MOBILE',
  parse: ({ body, query }) => {
    const b = { ...query, ...(body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) } as Record<string, unknown>;
    // Traccar Client JSON mode: { location: { coords: {...}, timestamp } }
    const loc = b.location as { coords?: Record<string, unknown>; timestamp?: unknown } | undefined;
    const c = loc?.coords ?? b;
    const lat = num(c.latitude ?? c.lat);
    const lng = num(c.longitude ?? c.lon ?? c.lng);
    if (lat === null || lng === null) throw badRequest('ต้องมี lat/lon');
    const speedMs = loc?.coords ? num(c.speed) : null; // JSON mode speed is m/s
    return [
      {
        recordedAt: parseTime(loc?.timestamp ?? b.timestamp),
        lat,
        lng,
        speedKnots: speedMs !== null ? speedMs * 1.943844 : num(b.speed),
        headingDeg: num(c.heading ?? c.bearing),
        signalQuality: null,
      },
    ];
  },
};

/** AIS feed (push from provider/receiver): object or array of { mmsi, lat, lon|lng, sog, cog|heading, timestamp } */
const ais: GpsAdapter = {
  source: 'AIS',
  parse: ({ body }) => {
    const rows = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : [body];
    if (rows.length > 5000) throw badRequest('ส่งได้ไม่เกิน 5000 รายการต่อครั้ง');
    return rows.map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const lat = num(x.lat ?? x.latitude);
      const lng = num(x.lon ?? x.lng ?? x.longitude);
      if (!x.mmsi || lat === null || lng === null) throw badRequest('ข้อมูล AIS ต้องมี mmsi, lat, lon');
      return { mmsi: String(x.mmsi), recordedAt: parseTime(x.timestamp ?? x.time), lat, lng, speedKnots: num(x.sog ?? x.speed), headingDeg: num(x.cog ?? x.heading), signalQuality: null };
    });
  },
};

export const ADAPTERS: Record<string, GpsAdapter> = { generic, osmand, ais };
