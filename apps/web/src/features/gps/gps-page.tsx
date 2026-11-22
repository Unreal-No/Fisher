import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info, LocateFixed, Navigation, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { formatDateTime, formatNumber, GPS_LINK_TH, GPS_SOURCE_TH, type GpsSource } from '@fisher/shared';
import { PageHeader } from '@/components/layout/app-layout';
import { TripStatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { enqueue } from '@/lib/offline-queue';
import { cn } from '@/lib/utils';
import { DevicesPanel, EventsPanel, GeofencesPanel } from './gps-admin';
import { FleetMap } from './fleet-map';
import { HistoryTab } from './history';
import { useLivePositions } from './use-live';
import type { Fleet, FleetVessel, Geofence, Pos, Track } from './types';


function distanceKm(pts: { lat: string; lng: string }[]) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const r = Math.PI / 180;
    const h = Math.sin(((+b.lat - +a.lat) * r) / 2) ** 2 + Math.cos(+a.lat * r) * Math.cos(+b.lat * r) * Math.sin(((+b.lng - +a.lng) * r) / 2) ** 2;
    d += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  return d;
}

function VesselRow({ v, selected, onClick }: { v: FleetVessel; selected: boolean; onClick: () => void }) {
  const lostAtSea = v.link === 'LOST' && v.status === 'AT_SEA';
  return (
    <button onClick={onClick} className={cn('w-full border-b border-line px-3 py-2 text-left last:border-0 hover:bg-slate-50', selected && 'bg-accent-soft')}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{v.code} · {v.name}</span>
        {v.position?.isDemo ? <Badge tone="neutral">จำลอง</Badge> : <Badge tone={lostAtSea ? 'bad' : v.link === 'ONLINE' ? 'ok' : 'neutral'}>{GPS_LINK_TH[v.link]}</Badge>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {v.activeTrip && <TripStatusBadge s={v.activeTrip.status} />}
        {v.position ? (
          <>
            <span>{formatDateTime(v.position.recordedAt)}</span>
            {v.position.speedKnots !== null && <span>{formatNumber(v.position.speedKnots, 1)} นอต</span>}
            <span>{GPS_SOURCE_TH[v.position.source as GpsSource]}</span>
          </>
        ) : (
          <span>ยังไม่มีข้อมูลตำแหน่ง</span>
        )}
      </div>
      {lostAtSea && <div className="mt-0.5 flex items-center gap-1 text-xs text-bad"><AlertTriangle className="size-3" /> อยู่ในทะเลแต่ขาดสัญญาณ</div>}
    </button>
  );
}

/** Browser geolocation → /gps/mobile every 60 s while the page is open (screen on). Offline: queued. */
function MobileReporter() {
  const vessels = useVessels();
  const [vesselId, setVesselId] = useState('');
  const [on, setOn] = useState(false);
  const [last, setLast] = useState<string>();
  const buf = useRef<{ recordedAt: string; lat: number; lng: number; speedKnots: number | null; headingDeg: number | null }[]>([]);
  useEffect(() => {
    if (!on || !vesselId) return;
    if (!('geolocation' in navigator)) {
      toast.error('อุปกรณ์นี้ไม่รองรับ GPS');
      setOn(false);
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        buf.current.push({
          recordedAt: new Date(p.timestamp).toISOString(), lat: p.coords.latitude, lng: p.coords.longitude,
          speedKnots: p.coords.speed !== null ? Math.round(p.coords.speed * 1.943844 * 10) / 10 : null,
          headingDeg: p.coords.heading !== null && !Number.isNaN(p.coords.heading) ? Math.round(p.coords.heading) : null,
        });
        setLast(new Date(p.timestamp).toISOString());
      },
      (e) => {
        toast.error(e.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง' : 'อ่านตำแหน่งไม่สำเร็จ');
        setOn(false);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 },
    );
    const flush = async () => {
      const positions = buf.current.splice(0, 200);
      if (!positions.length) return;
      try {
        await api.post('/gps/mobile', { vesselId, positions });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) await enqueue('/gps/mobile', { vesselId, positions }, `ตำแหน่งเรือ ${positions.length} จุด`);
        else toast.error(e instanceof ApiError ? e.message : 'ส่งตำแหน่งไม่สำเร็จ');
      }
    };
    const t = setInterval(flush, 60_000);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(t);
      void flush();
    };
  }, [on, vesselId]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select options={vesselOptions(vessels.data)} placeholder="- เรือที่อยู่ -" value={vesselId} onChange={(e) => setVesselId(e.target.value)} disabled={on} className="w-48" />
      {on ? (
        <Button variant="danger-outline" onClick={() => setOn(false)}><Square /> หยุดส่งตำแหน่ง</Button>
      ) : (
        <Button variant="outline" disabled={!vesselId} onClick={() => setOn(true)}><LocateFixed /> ส่งตำแหน่งจากมือถือนี้</Button>
      )}
      {on && <span className="text-xs text-muted">{last ? `จุดล่าสุด ${formatDateTime(last)} · ส่งทุก 1 นาที` : 'กำลังหาตำแหน่ง...'}</span>}
    </div>
  );
}

function LiveIndicator({ connected, lastAt }: { connected: boolean; lastAt: Date | null }) {
  return (
    <div className={cn('flex items-center gap-2 rounded border px-3 py-1.5 text-sm', connected ? 'border-green-200 bg-ok-soft text-ok' : 'border-amber-200 bg-warn-soft text-warn')} role="status">
      <span className="relative flex size-2.5">
        {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60" />}
        <span className={cn('relative inline-flex size-2.5 rounded-full', connected ? 'bg-green-600' : 'bg-amber-500')} />
      </span>
      {connected ? <b>สด</b> : <span>กำลังเชื่อมต่อใหม่…</span>}
      {lastAt && <span className="text-xs">อัปเดตล่าสุด {lastAt.toLocaleTimeString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' })}</span>}
    </div>
  );
}

function MapTab() {
  const lp = useListParams();
  const vesselId = lp.get('vesselId');
  const [includeDemo, setIncludeDemo] = useState(true);
  const live = useLivePositions();
  const fleet = useQuery({ queryKey: ['gps', 'fleet'], queryFn: () => api.get<Fleet>('/gps/fleet'), refetchInterval: 60_000 });
  const fences = useQuery({ queryKey: ['gps', 'geofences'], queryFn: () => api.get<Geofence[]>('/gps/geofences') });
  const [trailRange] = useState(() => ({ from: new Date(Date.now() - 12 * 3600_000).toISOString(), to: new Date().toISOString() }));
  const track = useQuery({
    queryKey: ['gps', 'track', 'live', vesselId, includeDemo],
    queryFn: () => api.get<Track>('/gps/track', { vesselId, from: trailRange.from, to: trailRange.to, includeDemo: String(includeDemo) }),
    enabled: !!vesselId,
  });
  const setRef = useRef(lp.set);
  setRef.current = lp.set;
  const select = useCallback((id: string) => setRef.current({ vesselId: id }, false), []);
  const vessels = useMemo(
    () =>
      (fleet.data?.vessels ?? []).map((v) => {
        const l = live.latest.get(v.id);
        if (!l || (v.position && v.position.recordedAt > l.recordedAt)) return v;
        const position: Pos = {
          lat: String(l.lat), lng: String(l.lng), speedKnots: l.speedKnots === null ? null : String(l.speedKnots),
          headingDeg: l.headingDeg === null ? null : String(l.headingDeg), recordedAt: l.recordedAt, source: l.source, isDemo: l.isDemo,
        };
        return { ...v, position, link: l.isDemo ? v.link : ('ONLINE' as const) };
      }),
    [fleet.data, live.latest],
  );
  const merged = useMemo<Track | undefined>(() => {
    if (!track.data) return undefined;
    const lastAt = track.data.points.at(-1)?.recordedAt ?? '';
    const extra = (live.trail.get(vesselId) ?? []).filter((p) => p.recordedAt > lastAt && (includeDemo || !p.isDemo)).map((p): Pos => ({
      lat: String(p.lat), lng: String(p.lng), speedKnots: p.speedKnots === null ? null : String(p.speedKnots),
      headingDeg: p.headingDeg === null ? null : String(p.headingDeg), recordedAt: p.recordedAt, source: p.source, isDemo: p.isDemo,
    }));
    return { ...track.data, points: [...track.data.points, ...extra] };
  }, [track.data, live.trail, vesselId, includeDemo]);
  const sel = vessels.find((v) => v.id === vesselId);
  const stats = useMemo(() => {
    const pts = merged?.points ?? [];
    return { km: distanceKm(pts), maxKn: Math.max(0, ...pts.map((p) => Number(p.speedKnots ?? 0))) };
  }, [merged]);
  const anyDemo = vessels.some((v) => v.position?.isDemo) || merged?.points.some((p) => p.isDemo);
  const noData = fleet.data && !vessels.some((v) => v.position);

  return (
    <QueryView q={fleet}>
      {(f) => (
        <div className="space-y-3">
          <LiveIndicator connected={live.connected} lastAt={live.lastAt} />
          {anyDemo && (
            <div className="flex items-center gap-2 rounded border border-line bg-slate-100 px-3 py-2 text-sm text-slate-700">
              <Info className="size-4 shrink-0" /> มีข้อมูล <Badge tone="neutral">จำลอง</Badge> (เส้นประ/สีเทา) ซึ่งไม่ใช่ตำแหน่งจริง และไม่ใช้คำนวณสถานะสัญญาณหรือแจ้งเตือน
            </div>
          )}
          {noData && (
            <div className="flex items-start gap-2 rounded border border-blue-200 bg-accent-soft px-3 py-2 text-sm text-blue-900">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>ยังไม่มีข้อมูลตำแหน่งจากอุปกรณ์จริง — เพิ่มอุปกรณ์ที่แท็บ "อุปกรณ์ GPS" (รองรับเครื่องติดตาม, แอป Traccar Client บนมือถือ, AIS) หรือใช้ปุ่มส่งตำแหน่งจากมือถือ</span>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
            <div className="space-y-3">
              <Panel title={`เรือ (${vessels.length})`} bodyClass="p-0 max-h-[360px] overflow-y-auto">
                {vessels.length ? vessels.map((v) => <VesselRow key={v.id} v={v} selected={v.id === vesselId} onClick={() => select(v.id)} />) : <Empty />}
              </Panel>
              {sel && (
                <Panel title={`เส้นทาง 12 ชม. ล่าสุด ${sel.name}`} actions={<Link to={`/vessels/${sel.id}`} className="text-sm text-accent">ข้อมูลเรือ</Link>}>
                  <div className="space-y-2 text-sm">
                    <Checkbox label="แสดงข้อมูลจำลอง" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />
                    {track.error ? <p className="text-bad">{(track.error as ApiError).message}</p> : merged && (
                      <div className="rounded bg-slate-50 p-2 text-xs leading-relaxed">
                        จุดตำแหน่ง {formatNumber(merged.points.length)} จุด<br />
                        ระยะทางโดยประมาณ {formatNumber(stats.km, 1)} กม. ({formatNumber(stats.km / 1.852, 1)} ไมล์ทะเล) · ความเร็วสูงสุด {formatNumber(stats.maxKn, 1)} นอต
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => lp.set({ tab: 'history', vesselId: sel.id }, false)}>ดูประวัติการเดินทาง</Button>
                      <Button variant="ghost" size="sm" onClick={() => lp.set({ vesselId: undefined }, false)}>ล้างการเลือก</Button>
                    </div>
                  </div>
                </Panel>
              )}
              <p className="text-xs text-muted">ขาดสัญญาณเมื่อไม่มีตำแหน่งจริงเกิน {f.signalLostMinutes} นาที (ตั้งค่าได้) · ข้อมูลสดผ่านการเชื่อมต่อต่อเนื่อง และรีเฟรชสำรองทุก 1 นาที</p>
            </div>
            <div className="h-[70vh] min-h-[420px]">
              <FleetMap vessels={vessels} track={vesselId ? merged : undefined} fences={fences.data} selectedId={vesselId} onSelect={select} />
            </div>
          </div>
        </div>
      )}
    </QueryView>
  );
}

export function GpsPage() {
  const { can } = useAuth();
  const lp = useListParams();
  return (
    <>
      <PageHeader
        title="ติดตามเรือ (GPS)"
        subtitle="ตำแหน่งล่าสุด เส้นทางย้อนหลัง การเข้า-ออกเขต และสถานะสัญญาณ"
        actions={can('gps.report') && <MobileReporter />}
      />
      <Tabs
        value={lp.get('tab') || 'map'}
        onValueChange={(t) => lp.set({ tab: t }, false)}
        tabs={[
          { value: 'map', label: <span className="inline-flex items-center gap-1.5"><Navigation className="size-3.5" /> แผนที่</span>, content: <MapTab /> },
          { value: 'history', label: 'ประวัติการเดินทาง', content: <HistoryTab /> },
          { value: 'devices', label: 'อุปกรณ์ GPS', content: <DevicesPanel /> },
          { value: 'geofences', label: 'เขตพื้นที่ (Geofence)', content: <GeofencesPanel /> },
          { value: 'events', label: 'เหตุการณ์เข้า-ออกเขต', content: <EventsPanel /> },
        ]}
      />
    </>
  );
}
