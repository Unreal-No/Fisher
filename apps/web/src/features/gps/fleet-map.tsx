// Imperative Leaflet map (OpenStreetMap tiles). Layers are rebuilt when data changes.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { formatDateTime, formatNumber } from '@fisher/shared';
import type { FleetVessel, Geofence, Track } from './types';

const COLORS = { ONLINE: '#15803d', LOST: '#b91c1c', NO_DATA: '#64748b', DEMO: '#7c8796' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function vesselIcon(v: FleetVessel, selected: boolean) {
  const demo = v.position?.isDemo;
  const color = demo ? COLORS.DEMO : v.status === 'AT_SEA' || v.link === 'ONLINE' ? COLORS[v.link] : COLORS.NO_DATA;
  const rot = Number(v.position?.headingDeg ?? 0);
  const size = selected ? 30 : 24;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;transform:rotate(${rot}deg)">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M12 2 L19 21 L12 17 L5 21 Z" fill="${color}" stroke="#fff" stroke-width="1.5" ${demo ? 'stroke-dasharray="2 2" fill-opacity="0.7"' : ''}/></svg></div>
      <div style="position:absolute;left:${size}px;top:2px;white-space:nowrap;font:600 11px Sarabun,sans-serif;color:#0b1f3a;background:#fffd;padding:0 3px;border-radius:2px">${esc(v.name)}${demo ? ' · จำลอง' : ''}</div>`,
  });
}

export function FleetMap({ vessels, track, fences, selectedId, onSelect }: {
  vessels: FleetVessel[]; track?: Track; fences?: Geofence[]; selectedId?: string; onSelect: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(null);
  const layers = useRef<L.LayerGroup>(null);
  const fitted = useRef<string>('');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([9.5, 100.8], 6); // Gulf of Thailand
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    L.control.scale({ metric: true, imperial: false }).addTo(m);
    map.current = m;
    layers.current = L.layerGroup().addTo(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const f of fences ?? []) {
      if (!f.isActive) continue;
      const style = { color: '#b45309', weight: 1.5, fillOpacity: 0.08, dashArray: '4 4' };
      const shape =
        f.type === 'CIRCLE' && f.centerLat && f.centerLng && f.radiusKm
          ? L.circle([Number(f.centerLat), Number(f.centerLng)], { ...style, radius: Number(f.radiusKm) * 1000 })
          : f.polygon
            ? L.polygon(f.polygon, style)
            : null;
      shape?.bindTooltip(`เขต: ${esc(f.name)}`).addTo(g);
    }
    const bounds: L.LatLngExpression[] = [];
    if (track?.points.length) {
      const pts = track.points.map((p) => [Number(p.lat), Number(p.lng)] as [number, number]);
      const demo = track.points.some((p) => p.isDemo);
      L.polyline(pts, { color: demo ? COLORS.DEMO : '#1b365d', weight: 3, opacity: 0.85, dashArray: demo ? '6 6' : undefined }).addTo(g);
      L.circleMarker(pts[0]!, { radius: 5, color: '#1b365d', fillColor: '#fff', fillOpacity: 1 }).bindTooltip(`เริ่ม ${formatDateTime(track.points[0]!.recordedAt)}`).addTo(g);
      bounds.push(...pts);
      for (const t of track.trips) {
        if (t.departureLat && t.departureLng)
          L.circleMarker([Number(t.departureLat), Number(t.departureLng)], { radius: 7, color: '#15803d', fillOpacity: 0.9 })
            .bindPopup(`<b>ออกเรือ ${esc(t.tripNo)}</b><br>${esc(t.departurePort ?? '')}<br>${formatDateTime(t.departedAt)}`).addTo(g);
        if (t.arrivalLat && t.arrivalLng)
          L.circleMarker([Number(t.arrivalLat), Number(t.arrivalLng)], { radius: 7, color: '#2563eb', fillOpacity: 0.9 })
            .bindPopup(`<b>เข้าท่า ${esc(t.tripNo)}</b><br>${esc(t.arrivalPort ?? '')}<br>${formatDateTime(t.arrivedAt)}`).addTo(g);
      }
      for (const e of track.events)
        L.circleMarker([Number(e.lat), Number(e.lng)], { radius: 5, color: '#b45309', fillColor: '#fbbf24', fillOpacity: 1 })
          .bindTooltip(`${e.eventType === 'ENTER' ? 'เข้าเขต' : 'ออกเขต'} ${esc(e.geofence.name)} · ${formatDateTime(e.at)}`).addTo(g);
    }
    for (const v of vessels) {
      if (!v.position) continue;
      const p = v.position;
      const ll: [number, number] = [Number(p.lat), Number(p.lng)];
      L.marker(ll, { icon: vesselIcon(v, v.id === selectedId), zIndexOffset: v.id === selectedId ? 1000 : 0 })
        .bindPopup(
          `<b>${esc(v.code)} ${esc(v.name)}</b>${p.isDemo ? ' <i>(จำลอง)</i>' : ''}<br>
          ${formatDateTime(p.recordedAt)}<br>${p.speedKnots !== null ? `${formatNumber(p.speedKnots, 1)} นอต` : ''} ${p.headingDeg !== null ? `· ${formatNumber(p.headingDeg)}°` : ''}<br>
          ${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}`,
        )
        .on('click', () => onSelect(v.id))
        .addTo(g);
      if (!track?.points.length) bounds.push(ll);
    }
    const key = `${selectedId ?? ''}:${track?.points.length ? 'T' : '-'}:${vessels.filter((v) => v.position).length}`;
    if (bounds.length && fitted.current !== key) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 11 });
    }
  }, [vessels, track, fences, selectedId, onSelect]);

  return <div ref={el} className="h-full min-h-[420px] w-full rounded-md border border-line" role="region" aria-label="แผนที่ตำแหน่งเรือ" />;
}
