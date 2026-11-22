// Leaflet map for the voyage history: route, start/end, numbered stops; `focus` pans/zooms to a timeline item.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { formatDateTime, formatNumber } from '@fisher/shared';
import { addBaseLayer } from './tiles';
import type { Track } from './types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const placeOrCoord = (place: string | null | undefined, lat: number, lng: number) => place ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
export interface Focus { id: number; points: [number, number][] }

export function HistoryMap({ track, endLabel, focus }: { track: Track; endLabel: string; focus: Focus | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(null);
  const layers = useRef<L.LayerGroup>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current).setView([9.5, 100.8], 6);
    addBaseLayer(m);
    L.control.scale({ metric: true, imperial: false }).addTo(m);
    map.current = m;
    layers.current = L.layerGroup().addTo(m);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts = track.points.map((p) => [Number(p.lat), Number(p.lng)] as [number, number]);
    const demo = track.points.some((p) => p.isDemo);
    const bounds: [number, number][] = [...pts];
    if (pts.length) L.polyline(pts, { color: demo ? '#7c8796' : '#1b365d', weight: 3, opacity: 0.85, dashArray: demo ? '6 6' : undefined }).addTo(g);
    const a = track.analysis;
    if (a?.summary.start) {
      const s = a.summary.start;
      L.circleMarker([s.lat, s.lng], { radius: 9, color: '#fff', weight: 2, fillColor: '#15803d', fillOpacity: 1 })
        .bindTooltip(`ออกจาก ${esc(placeOrCoord(s.place, s.lat, s.lng))} · ${formatDateTime(s.at)}`).addTo(g);
      bounds.push([s.lat, s.lng]);
    }
    if (a?.summary.end) {
      const e = a.summary.end;
      L.circleMarker([e.lat, e.lng], { radius: 9, color: '#fff', weight: 2, fillColor: endLabel === 'ถึง' ? '#2563eb' : '#b91c1c', fillOpacity: 1 })
        .bindTooltip(`${endLabel} ${esc(placeOrCoord(e.place, e.lat, e.lng))} · ${formatDateTime(e.at)}`).addTo(g);
      bounds.push([e.lat, e.lng]);
    }
    const maxH = Math.max(1, ...(a?.stops ?? []).map((s) => s.hours));
    for (const s of a?.stops ?? []) {
      const r = 8 + Math.round((s.hours / maxH) * 10);
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '', iconSize: [r * 2, r * 2], iconAnchor: [r, r],
          html: `<div style="width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 0 2px #0008;color:#0b1f3a;font:700 11px Sarabun,sans-serif;display:flex;align-items:center;justify-content:center">${s.index}</div>`,
        }),
      }).bindTooltip(`จุดพักที่ ${s.index} · ${formatNumber(s.hours, 1)} ชม. · ${formatDateTime(s.from)} – ${formatDateTime(s.to)} · ${esc(placeOrCoord(s.place, s.lat, s.lng))}`).addTo(g);
      bounds.push([s.lat, s.lng]);
    }
    if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 12 });
  }, [track, endLabel]);

  useEffect(() => {
    const m = map.current;
    if (!m || !focus || !focus.points.length) return;
    if (focus.points.length === 1) m.setView(focus.points[0]!, 12);
    else m.fitBounds(L.latLngBounds(focus.points), { padding: [40, 40], maxZoom: 12 });
  }, [focus]);

  return <div ref={el} className="h-full min-h-[320px] w-full rounded-md border border-line" role="region" aria-label="แผนที่ประวัติการเดินทาง" />;
}
