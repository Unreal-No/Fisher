import { describe, expect, it } from 'vitest';
import { move } from '../src/modules/gps/geo';
import { analyzeVoyage, type TrackPoint } from '../src/modules/gps/voyage';

const PORT = { lat: 7.22, lng: 100.6 };
/** build a track: segments of [minutes, knots, heading] sampled every `every` minutes */
function build(start: Date, segs: { min: number; kn: number; hdg: number; every?: number; silent?: boolean }[]) {
  const out: TrackPoint[] = [];
  let [lat, lng] = [PORT.lat, PORT.lng];
  let t = start.getTime();
  out.push({ t: new Date(t), lat, lng, speedKnots: 0 });
  for (const s of segs) {
    const every = s.every ?? 10;
    for (let m = every; m <= s.min; m += every) {
      [lat, lng] = move(lat, lng, s.hdg, s.kn * 1.852 * (every / 60));
      t += every * 60_000;
      if (!s.silent || m === s.min) out.push({ t: new Date(t), lat, lng, speedKnots: s.kn });
    }
  }
  return out;
}

describe('voyage analysis', () => {
  it('splits a trip into legs and stops with durations, distances and place names', () => {
    const start = new Date('2026-11-01T22:00:00Z'); // 05:00 Bangkok
    const track = build(start, [
      { min: 180, kn: 8, hdg: 90 }, // 3 h transit east (~44 km)
      { min: 600, kn: 0.2, hdg: 0 }, // 10 h anchored overnight
      { min: 360, kn: 3, hdg: 45 }, // 6 h trawling
      { min: 240, kn: 0, hdg: 0, silent: true }, // 4 h no signal, did not move
      { min: 20, kn: 0.5, hdg: 0 }, // short pause (below 30 min) — part of the next leg
      { min: 240, kn: 8, hdg: 250 }, // heading home
    ]);
    const fence = { type: 'CIRCLE' as const, centerLat: PORT.lat, centerLng: PORT.lng, radiusKm: 1, polygon: null };
    const { summary, stops, legs } = analyzeVoyage(track, [{ name: 'ท่าเรือสงขลา', fence }]);

    expect(summary.start?.place).toBe('ท่าเรือสงขลา');
    expect(summary.end?.place).toBeNull(); // still at sea
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({ index: 1, hours: 10, gap: false });
    expect(stops[1]!.gap).toBe(true);
    expect(stops[1]!.hours).toBeGreaterThanOrEqual(4);
    expect(legs).toHaveLength(3);
    expect(legs[0]!.km).toBeCloseTo(44.4, 0);
    expect(legs[0]!.avgKnots).toBeCloseTo(8, 0);
    expect(legs[0]!.fromPlace).toBe('ท่าเรือสงขลา');
    expect(summary.stops).toBe(2);
    expect(summary.totalHours).toBeCloseTo((180 + 600 + 360 + 240 + 20 + 240) / 60, 1);
    expect(summary.days).toBeCloseTo(summary.totalHours / 24, 1);
    expect(summary.stoppedHours + summary.movingHours).toBeCloseTo(summary.totalHours, 0);
    expect(summary.longestStopHours).toBe(10);
  });

  it('works without speed data and with too few points', () => {
    const t0 = new Date('2026-11-01T00:00:00Z');
    const pts: TrackPoint[] = [];
    for (let i = 0; i < 12; i++) pts.push({ t: new Date(t0.getTime() + i * 600_000), lat: 7.5, lng: 101, speedKnots: null }); // 2 h still
    const r = analyzeVoyage(pts);
    expect(r.stops).toHaveLength(1);
    expect(r.legs).toHaveLength(0);
    expect(analyzeVoyage([]).summary.start).toBeNull();
    expect(analyzeVoyage([pts[0]!]).summary).toMatchObject({ stops: 0, km: 0 });
  });
});
