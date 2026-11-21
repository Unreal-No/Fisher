// Pure geo helpers (no PostGIS needed at this scale).
const R = 6371; // km
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ray casting; polygon = [[lat, lng], ...] */
export function pointInPolygon(lat: number, lng: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]!;
    const [yj, xj] = poly[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface FenceLite {
  type: 'CIRCLE' | 'POLYGON';
  centerLat: unknown;
  centerLng: unknown;
  radiusKm: unknown;
  polygon: unknown;
}
export function insideFence(f: FenceLite, lat: number, lng: number) {
  if (f.type === 'CIRCLE') return haversineKm(Number(f.centerLat), Number(f.centerLng), lat, lng) <= Number(f.radiusKm);
  return Array.isArray(f.polygon) && pointInPolygon(lat, lng, f.polygon as [number, number][]);
}

/** Destination point from start, bearing (deg) and distance (km) */
export function move(lat: number, lng: number, bearingDeg: number, km: number): [number, number] {
  const d = km / R;
  const b = rad(bearingDeg);
  const la1 = rad(lat);
  const lo1 = rad(lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [(la2 * 180) / Math.PI, (((lo2 * 180) / Math.PI + 540) % 360) - 180];
}
