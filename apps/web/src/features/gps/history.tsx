import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { formatDateTime, formatNumber } from '@fisher/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExportMenu } from '@/components/ui/export-menu';
import { Input, Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, Spinner } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api';
import { num } from '@/lib/export';
import { useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import { cn, fromLocalInput, toLocalInput } from '@/lib/utils';
import { HistoryMap, placeOrCoord, type Focus } from './history-map';
import type { Leg, Stop, Track } from './types';

/** 2.5 -> "2 ชม. 30 นาที"; 52 -> "2 วัน 4 ชม." */
export function humanDuration(hours: number) {
  const mins = Math.round(hours * 60);
  if (mins < 60) return `${mins} นาที`;
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return h > 0 ? `${d} วัน ${h} ชม.` : `${d} วัน`;
  return m > 0 ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

const RANGES = [
  { value: 'trip', label: 'เที่ยวปัจจุบัน/ล่าสุด' },
  { value: '24h', label: '24 ชั่วโมง' },
  { value: '7d', label: '7 วัน' },
  { value: '30d', label: '30 วัน' },
  { value: 'custom', label: 'กำหนดเอง' },
];
const SPAN: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 };

interface TripLite { id: string; tripNo: string; departedAt: string | null; arrivedAt: string | null }
type Item = { kind: 'leg'; at: string; leg: Leg } | { kind: 'stop'; at: string; stop: Stop };

export function HistoryTab() {
  const lp = useListParams();
  const vessels = useVessels();
  const vesselId = lp.get('vesselId');
  const range = lp.get('range') || 'trip';
  const [now, setNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<Focus | null>(null);
  const [activeKey, setActiveKey] = useState('');

  const trips = useQuery({
    queryKey: ['trips', 'latest', vesselId],
    queryFn: () => api.get<{ items: TripLite[] }>('/trips', { vesselId, pageSize: 5 }),
    enabled: !!vesselId && range === 'trip',
  });
  const latestTrip = useMemo(
    () => (trips.data?.items ?? []).filter((t) => t.departedAt).sort((a, b) => (b.departedAt! > a.departedAt! ? 1 : -1))[0],
    [trips.data],
  );

  const win = useMemo(() => {
    if (range === 'custom') {
      const f = lp.get('from');
      const t = lp.get('to');
      return f && t ? { from: fromLocalInput(f), to: fromLocalInput(t) } : null;
    }
    if (range === 'trip') return latestTrip ? { from: latestTrip.departedAt!, to: latestTrip.arrivedAt ?? new Date(now).toISOString() } : null;
    return { from: new Date(now - (SPAN[range] ?? 24) * 3600_000).toISOString(), to: new Date(now).toISOString() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, lp.get('from'), lp.get('to'), latestTrip, now]);

  const track = useQuery({
    queryKey: ['gps', 'track', 'history', vesselId, win?.from, win?.to],
    queryFn: () => api.get<Track>('/gps/track', { vesselId, from: win!.from, to: win!.to, includeDemo: 'true' }),
    enabled: !!vesselId && !!win,
  });
  const t = track.data;
  const a = t?.analysis;
  const endLabel = range === 'trip' && latestTrip?.arrivedAt ? 'ถึง' : 'ล่าสุด';
  const anyDemo = !!t?.points.some((p) => p.isDemo);

  const items = useMemo<Item[]>(
    () => [
      ...(a?.legs ?? []).map((leg): Item => ({ kind: 'leg', at: leg.from, leg })),
      ...(a?.stops ?? []).map((stop): Item => ({ kind: 'stop', at: stop.from, stop })),
    ].sort((x, y) => (x.at > y.at ? 1 : -1)),
    [a],
  );
  const exportRows = () => [
    ['ลำดับ', 'ประเภท', 'เริ่ม', 'สิ้นสุด', 'ระยะเวลา (ชม.)', 'ระยะทาง (กม.)', 'ระยะทาง (ไมล์ทะเล)', 'ความเร็วเฉลี่ย (นอต)', 'สถานที่/พิกัด', 'หมายเหตุ'],
    ...items.map((i, n) =>
      i.kind === 'leg'
        ? [n + 1, 'แล่นเรือ', formatDateTime(i.leg.from), formatDateTime(i.leg.to), num(i.leg.hours.toFixed(2)), num(i.leg.km.toFixed(1)), num(i.leg.nm.toFixed(1)), num(i.leg.avgKnots.toFixed(1)), `${i.leg.fromPlace ?? ''} → ${i.leg.toPlace ?? ''}`, '']
        : [n + 1, `พัก (จุดที่ ${i.stop.index})`, formatDateTime(i.stop.from), formatDateTime(i.stop.to), num(i.stop.hours.toFixed(2)), null, null, null, placeOrCoord(i.stop.place, i.stop.lat, i.stop.lng), i.stop.gap ? 'ไม่มีสัญญาณ' : ''],
    ),
  ];
  const pick = (key: string, points: [number, number][]) => {
    setActiveKey(key);
    setFocus((f) => ({ id: (f?.id ?? 0) + 1, points }));
  };

  const s = a?.summary;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">เรือ<Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" value={vesselId} onChange={(e) => lp.set({ vesselId: e.target.value }, false)} className="w-52" /></label>
        <label className="text-xs text-muted">ช่วงเวลา<Select options={RANGES} value={range} onChange={(e) => lp.set({ range: e.target.value === 'trip' ? undefined : e.target.value }, false)} className="w-48" /></label>
        {range === 'custom' && (
          <>
            <label className="text-xs text-muted">ตั้งแต่<Input type="datetime-local" value={lp.get('from') || toLocalInput(new Date(now - 24 * 3600_000))} onChange={(e) => lp.set({ from: e.target.value }, false)} /></label>
            <label className="text-xs text-muted">ถึง<Input type="datetime-local" value={lp.get('to') || toLocalInput(new Date(now))} onChange={(e) => lp.set({ to: e.target.value }, false)} /></label>
          </>
        )}
        {range !== 'trip' && range !== 'custom' && <Button variant="outline" size="sm" onClick={() => setNow(Date.now())}>รีเฟรช</Button>}
      </div>

      {!vesselId ? <Empty title="เลือกเรือเพื่อดูประวัติการเดินทาง" />
        : range === 'trip' && trips.isLoading ? <Spinner />
        : !win ? <Empty title={range === 'custom' ? 'เลือกช่วงเวลา' : 'ยังไม่มีเที่ยวเรือที่ออกเดินทางของเรือนี้'} />
        : track.isLoading ? <Spinner />
        : track.error ? <p className="text-bad">{track.error instanceof ApiError ? track.error.message : 'โหลดข้อมูลไม่สำเร็จ'}</p>
        : !t || !t.points.length ? <Empty title="ไม่มีข้อมูลตำแหน่งในช่วงเวลานี้" />
        : (
          <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
            <div className="h-[50vh] min-h-[320px] lg:h-[70vh]"><HistoryMap track={t} endLabel={endLabel} focus={focus} /></div>
            <div className="space-y-3">
              {s && (
                <Panel title="สรุปการเดินทาง" actions={anyDemo && <Badge tone="neutral">ข้อมูลจำลอง</Badge>}>
                  <div className="space-y-1.5 text-sm">
                    {s.start && <p>ออกจาก <b>{placeOrCoord(s.start.place, s.start.lat, s.start.lng)}</b> เมื่อ {formatDateTime(s.start.at)}</p>}
                    {s.end && <p>{endLabel === 'ถึง' ? 'ถึง' : 'ตำแหน่งล่าสุด'} <b>{placeOrCoord(s.end.place, s.end.lat, s.end.lng)}</b> เมื่อ {formatDateTime(s.end.at)}</p>}
                    <p>รวม {formatNumber(s.days, 1)} วัน ({formatNumber(s.totalHours, 1)} ชม.)</p>
                    <p>ระยะทาง {formatNumber(s.nm, 1)} ไมล์ทะเล ({formatNumber(s.km, 1)} กม.)</p>
                    <p>เดินเรือ {formatNumber(s.movingHours, 1)} ชม. · จอด/พัก {formatNumber(s.stoppedHours, 1)} ชม. ({s.stops} จุด, นานสุด {formatNumber(s.longestStopHours, 1)} ชม.)</p>
                  </div>
                </Panel>
              )}
              <Panel title="ไทม์ไลน์" bodyClass="p-0 max-h-[50vh] overflow-y-auto" actions={<ExportMenu size="sm" baseName="ประวัติการเดินทาง" sheetName="ไทม์ไลน์" rows={exportRows} disabled={!items.length} />}>
                {items.length ? items.map((i) => {
                  const key = i.kind === 'leg' ? `l${i.leg.index}` : `s${i.stop.index}`;
                  const common = 'w-full border-b border-line px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50';
                  return i.kind === 'leg' ? (
                    <button key={key} className={cn(common, activeKey === key && 'bg-accent-soft')} onClick={() => pick(key, [[i.leg.startLat, i.leg.startLng], [i.leg.endLat, i.leg.endLng]])}>
                      <div>แล่นเรือ {formatNumber(i.leg.km, 1)} กม. · {humanDuration(i.leg.hours)} · เฉลี่ย {formatNumber(i.leg.avgKnots, 0)} นอต{i.leg.fromPlace ? ` จาก ${i.leg.fromPlace}` : ''}</div>
                      <div className="text-xs text-muted">{formatDateTime(i.leg.from)} – {formatDateTime(i.leg.to)}</div>
                    </button>
                  ) : (
                    <button key={key} className={cn(common, activeKey === key && 'bg-accent-soft')} onClick={() => pick(key, [[i.stop.lat, i.stop.lng]])}>
                      <div className="flex items-center gap-2">
                        <span>พัก {humanDuration(i.stop.hours)} ที่ {placeOrCoord(i.stop.place, i.stop.lat, i.stop.lng)}</span>
                        {i.stop.gap && <Badge tone="warn">ไม่มีสัญญาณ</Badge>}
                      </div>
                      <div className="text-xs text-muted">จุดพักที่ {i.stop.index} · {formatDateTime(i.stop.from)} – {formatDateTime(i.stop.to)}</div>
                    </button>
                  );
                }) : <Empty title="ไม่มีข้อมูลสรุป" />}
              </Panel>
            </div>
          </div>
        )}
    </div>
  );
}
