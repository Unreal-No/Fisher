// Voyage analysis: turns a raw track into legs (moving) and stops (stationary) with durations and distances.
// Pure function — unit tested with synthetic tracks.
import { haversineKm, insideFence, type FenceLite } from './geo';

export interface TrackPoint {
  t: Date;
  lat: number;
  lng: number;
  speedKnots: number | null;
}
export interface NamedPlace {
  name: string;
  lat?: number | null;
  lng?: number | null;
  /** a geofence: the place covers its area */
  fence?: FenceLite;
}
export interface VoyageOptions {
  /** at or below this speed a point counts as stationary */
  stopSpeedKnots: number;
  /** shorter stationary periods are part of the leg */
  minStopMinutes: number;
  /** without speed, a point within this distance of the previous one counts as stationary */
  stillRadiusKm: number;
  /** a silent period longer than this, with the vessel in the same spot, counts as a stop (e.g. device off in port) */
  gapMinutes: number;
}
export const DEFAULT_VOYAGE: VoyageOptions = { stopSpeedKnots: 1, minStopMinutes: 30, stillRadiusKm: 0.3, gapMinutes: 120 };

export interface Stop {
  index: number;
  from: Date;
  to: Date;
  hours: number;
  lat: number;
  lng: number;
  place: string | null;
  /** part of the stop has no data (device silent) */
  gap: boolean;
}
export interface Leg {
  index: number;
  from: Date;
  to: Date;
  hours: number;
  km: number;
  nm: number;
  avgKnots: number;
  maxKnots: number;
  fromPlace: string | null;
  toPlace: string | null;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}
export interface VoyageSummary {
  start: { at: Date; lat: number; lng: number; place: string | null } | null;
  end: { at: Date; lat: number; lng: number; place: string | null } | null;
  totalHours: number;
  days: number;
  movingHours: number;
  stoppedHours: number;
  km: number;
  nm: number;
  stops: number;
  longestStopHours: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const hrs = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

/** Name of the place at a coordinate: a geofence containing it, else a named point within 2 km. */
export function placeName(lat: number, lng: number, places: NamedPlace[]) {
  for (const p of places) if (p.fence && insideFence(p.fence, lat, lng)) return p.name;
  let best: { name: string; d: number } | null = null;
  for (const p of places) {
    if (p.fence || p.lat == null || p.lng == null) continue;
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (d <= 2 && (!best || d < best.d)) best = { name: p.name, d };
  }
  return best?.name ?? null;
}

export function analyzeVoyage(input: TrackPoint[], places: NamedPlace[] = [], opt: VoyageOptions = DEFAULT_VOYAGE) {
  const pts = [...input].sort((a, b) => a.t.getTime() - b.t.getTime());
  if (pts.length < 2) {
    const p = pts[0];
    const one = p ? { at: p.t, lat: p.lat, lng: p.lng, place: placeName(p.lat, p.lng, places) } : null;
    return { summary: { start: one, end: one, totalHours: 0, days: 0, movingHours: 0, stoppedHours: 0, km: 0, nm: 0, stops: 0, longestStopHours: 0 } satisfies VoyageSummary, stops: [] as Stop[], legs: [] as Leg[] };
  }
  // 1) classify each point; a long silent gap without movement is stationary time
  const still = pts.map((p, i) => {
    if (p.speedKnots != null) return p.speedKnots <= opt.stopSpeedKnots;
    const prev = pts[i - 1];
    return !!prev && haversineKm(prev.lat, prev.lng, p.lat, p.lng) <= opt.stillRadiusKm;
  });
  const gapStill = pts.map((p, i) => {
    const prev = pts[i - 1];
    return !!prev && hrs(prev.t, p.t) * 60 >= opt.gapMinutes && haversineKm(prev.lat, prev.lng, p.lat, p.lng) <= opt.stillRadiusKm * 3;
  });
  // 2) runs of stationary points → stops (when long enough)
  type Run = { s: number; e: number; gap: boolean };
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let i = 0; i < pts.length; i++) {
    const st = still[i] || gapStill[i];
    if (st) {
      if (!cur) cur = { s: gapStill[i] && i > 0 ? i - 1 : i, e: i, gap: gapStill[i]! };
      else {
        cur.e = i;
        cur.gap ||= gapStill[i]!;
      }
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  const stopRuns = runs.filter((r) => hrs(pts[r.s]!.t, pts[r.e]!.t) * 60 >= opt.minStopMinutes);

  const stops: Stop[] = stopRuns.map((r, i) => {
    const seg = pts.slice(r.s, r.e + 1);
    const lat = seg.reduce((s, p) => s + p.lat, 0) / seg.length;
    const lng = seg.reduce((s, p) => s + p.lng, 0) / seg.length;
    // the stop lasts until the vessel is seen moving again
    const end = pts[r.e + 1]?.t ?? pts[r.e]!.t;
    return { index: i + 1, from: pts[r.s]!.t, to: end, hours: r1(hrs(pts[r.s]!.t, end)), lat: r2s(lat), lng: r2s(lng), place: placeName(lat, lng, places), gap: r.gap };
  });

  // 3) legs between stops (and before the first / after the last)
  const bounds: [number, number][] = [];
  let startIdx = 0;
  for (const r of stopRuns) {
    if (r.s > startIdx) bounds.push([startIdx, r.s]);
    startIdx = r.e;
  }
  if (startIdx < pts.length - 1) bounds.push([startIdx, pts.length - 1]);
  const legs: Leg[] = bounds
    .map(([s, e]) => {
      let km = 0;
      let maxKn = 0;
      for (let i = s + 1; i <= e; i++) {
        km += haversineKm(pts[i - 1]!.lat, pts[i - 1]!.lng, pts[i]!.lat, pts[i]!.lng);
        maxKn = Math.max(maxKn, pts[i]!.speedKnots ?? 0);
      }
      const h = hrs(pts[s]!.t, pts[e]!.t);
      const a = pts[s]!;
      const b = pts[e]!;
      return {
        from: a.t, to: b.t, hours: r1(h), km: r1(km), nm: r1(km / 1.852), avgKnots: h > 0 ? r1(km / 1.852 / h) : 0, maxKnots: r1(maxKn),
        fromPlace: placeName(a.lat, a.lng, places), toPlace: placeName(b.lat, b.lng, places),
        startLat: r2s(a.lat), startLng: r2s(a.lng), endLat: r2s(b.lat), endLng: r2s(b.lng),
      };
    })
    .filter((l) => l.km >= 0.05 || l.hours >= 0.5)
    .map((l, i) => ({ index: i + 1, ...l }));

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const totalHours = hrs(first.t, last.t);
  const stoppedHours = stops.reduce((s, x) => s + x.hours, 0);
  const km = legs.reduce((s, l) => s + l.km, 0);
  const summary: VoyageSummary = {
    start: { at: first.t, lat: r2s(first.lat), lng: r2s(first.lng), place: placeName(first.lat, first.lng, places) },
    end: { at: last.t, lat: r2s(last.lat), lng: r2s(last.lng), place: placeName(last.lat, last.lng, places) },
    totalHours: r1(totalHours), days: r1(totalHours / 24), movingHours: r1(Math.max(0, totalHours - stoppedHours)), stoppedHours: r1(stoppedHours),
    km: r1(km), nm: r1(km / 1.852), stops: stops.length, longestStopHours: r1(Math.max(0, ...stops.map((s) => s.hours))),
  };
  return { summary, stops, legs };
}

/** coordinates rounded to ~1 m */
function r2s(v: number) {
  return Math.round(v * 100000) / 100000;
}
