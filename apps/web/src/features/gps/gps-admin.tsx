import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  formatDateTime, GEOFENCE_ALERT_TH, GEOFENCE_TYPE_TH, geofenceSchema, GPS_SOURCE_TH, gpsDeviceSchema, toOptions,
} from '@fisher/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';
import type { Device, Geofence } from './types';

const origin = () => window.location.origin;

function KeyDialog({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const urls: [string, string][] = [
    ['แอป Traccar Client / OsmAnd (มือถือ, เครื่องติดตามส่วนใหญ่) — ใส่เป็น Server URL', `${origin()}/api/v1/gps/ingest/osmand/${apiKey}`],
    ['JSON ทั่วไป (POST, header x-device-key)', `${origin()}/api/v1/gps/ingest/generic`],
    ['ฟีด AIS (POST, header x-device-key) — เฉพาะอุปกรณ์ประเภท AIS', `${origin()}/api/v1/gps/ingest/ais`],
  ];
  const copy = (s: string) => void navigator.clipboard?.writeText(s).then(() => toast.success('คัดลอกแล้ว'));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="คีย์อุปกรณ์ (แสดงครั้งเดียว)" size="lg" footer={<Button onClick={onClose}>บันทึกคีย์แล้ว ปิด</Button>}>
      <div className="space-y-3 text-sm">
        <p className="text-warn">เก็บคีย์นี้ไว้ในที่ปลอดภัย ระบบเก็บเฉพาะค่าแฮช หากทำหายต้องสร้างคีย์ใหม่</p>
        <div className="flex items-center gap-2"><code className="flex-1 break-all rounded bg-slate-100 px-2 py-1.5">{apiKey}</code><Button size="icon" variant="outline" aria-label="คัดลอก" onClick={() => copy(apiKey)}><Copy /></Button></div>
        {urls.map(([label, u]) => (
          <div key={u}>
            <div className="text-xs text-muted">{label}</div>
            <div className="flex items-center gap-2"><code className="flex-1 break-all rounded bg-slate-50 px-2 py-1 text-xs">{u}</code><Button size="icon" variant="ghost" aria-label="คัดลอก" onClick={() => copy(u)}><Copy /></Button></div>
          </div>
        ))}
        <p className="text-xs text-muted">ต้องเปิดผ่าน HTTPS ในการใช้งานจริง · ข้อมูลที่ส่งต้องเป็นเวลาไม่เกิน 30 วันย้อนหลัง</p>
      </div>
    </Dialog>
  );
}

export function DevicesPanel() {
  const { can } = useAuth();
  const vessels = useVessels();
  const q = useQuery({ queryKey: ['gps', 'devices'], queryFn: () => api.get<Device[]>('/gps/devices') });
  const [edit, setEdit] = useState<Device | 'new' | null>(null);
  const [key, setKey] = useState<string>();
  const [rotate, setRotate] = useState<Device | null>(null);
  const [demoVessel, setDemoVessel] = useState('');
  const rot = useAction((id: string) => api.post<{ apiKey: string }>(`/gps/devices/${id}/rotate-key`), { onSuccess: (r) => { setRotate(null); setKey(r.apiKey); } });
  const demo = useAction(() => api.post<{ accepted: number }>('/gps/demo', { vesselId: demoVessel, hours: 24 }), {
    invalidate: ['gps'], onSuccess: (r) => toast.success(`สร้างข้อมูลสาธิต ${r.accepted} จุด (ติดป้ายสาธิต)`),
  });
  const clearDemo = useAction(() => api.del<{ deletedPositions: number }>(`/gps/demo${demoVessel ? `?vesselId=${demoVessel}` : ''}`), {
    invalidate: ['gps'], onSuccess: (r) => toast.success(`ลบข้อมูลสาธิต ${r.deletedPositions} จุด`),
  });
  const manage = can('gps.manage');
  return (
    <div className="space-y-4">
      <Panel title="อุปกรณ์ส่งตำแหน่ง" bodyClass="p-0" actions={manage && <Button size="sm" onClick={() => setEdit('new')}><Plus /> เพิ่มอุปกรณ์</Button>}>
        <QueryView q={q}>
          {(rows) => rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">รหัสอุปกรณ์</th><th className="px-2">ชื่อ</th><th className="px-2">ประเภท</th><th className="px-2">เรือ</th><th className="px-2">ส่งข้อมูลล่าสุด</th><th className="px-2">สถานะ</th><th /></tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="border-t border-line">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{d.identifier}</td><td className="px-2">{d.name ?? '-'}</td>
                      <td className="px-2">{GPS_SOURCE_TH[d.source]}</td><td className="px-2">{d.vessel ? `${d.vessel.code} ${d.vessel.name}` : d.source === 'AIS' ? 'จับคู่ด้วย MMSI' : '-'}</td>
                      <td className="whitespace-nowrap px-2">{formatDateTime(d.lastSeenAt)}</td>
                      <td className="px-2">{d.isActive ? <Badge tone="ok">ใช้งาน</Badge> : <Badge>ปิด</Badge>}</td>
                      <td className="whitespace-nowrap px-2 text-right">{manage && <>
                        <Button variant="ghost" size="icon" aria-label="แก้ไข" onClick={() => setEdit(d)}><Pencil /></Button>
                        {d.source !== 'MOBILE' && <Button variant="ghost" size="icon" aria-label="สร้างคีย์ใหม่" onClick={() => setRotate(d)}><KeyRound /></Button>}
                      </>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="ยังไม่มีอุปกรณ์" />}
        </QueryView>
      </Panel>
      {manage && (
        <Panel title="โหมดสาธิต (สำหรับทดลองโดยไม่มีอุปกรณ์)">
          <div className="flex flex-wrap items-center gap-2">
            <Select options={vesselOptions(vessels.data)} placeholder="- เลือกเรือ -" value={demoVessel} onChange={(e) => setDemoVessel(e.target.value)} className="w-56" />
            <Button variant="outline" disabled={!demoVessel} loading={demo.isPending} onClick={() => demo.mutate(undefined)}><Wand2 /> สร้างเส้นทางสาธิต 24 ชม.</Button>
            <Button variant="danger-outline" loading={clearDemo.isPending} onClick={() => clearDemo.mutate(undefined)}><Trash2 /> ลบข้อมูลสาธิต{demoVessel ? 'ของเรือนี้' : 'ทั้งหมด'}</Button>
          </div>
          <p className="mt-2 text-xs text-muted">ข้อมูลสาธิตติดป้ายชัดเจน แสดงเป็นเส้นประสีเทา ไม่นำไปคำนวณสถานะสัญญาณหรือสร้างการแจ้งเตือน</p>
        </Panel>
      )}
      {can('settings.manage') && <SimulatorPanel />}
      {edit && <DeviceDialog d={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onKey={setKey} />}
      {key && <KeyDialog apiKey={key} onClose={() => setKey(undefined)} />}
      <ConfirmDialog open={!!rotate} onOpenChange={() => setRotate(null)} title="สร้างคีย์ใหม่" confirmText="สร้างคีย์ใหม่" danger loading={rot.isPending}
        message={`คีย์เดิมของ ${rotate?.identifier} จะใช้ไม่ได้ทันที ต้องตั้งค่าคีย์ใหม่ในอุปกรณ์`} onConfirm={() => rotate && rot.mutate(rotate.id)} />
    </div>
  );
}

function SimulatorPanel() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ gpsSimulator?: boolean }>('/settings') });
  const save = useAction((v: boolean) => api.patch('/settings', { gpsSimulator: v }), { success: 'บันทึกการตั้งค่าแล้ว', invalidate: ['settings'] });
  return (
    <Panel title="สัญญาณจำลอง AIS/VMS">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" role="switch" className="size-4" checked={!!q.data?.gpsSimulator} disabled={!q.data || save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
        สัญญาณจำลอง AIS/VMS
      </label>
      <p className="mt-2 text-xs text-muted">ใช้ระหว่างยังไม่เชื่อมต่อผู้ให้บริการจริง — เรือที่ออกทะเลจะเคลื่อนที่ตามเส้นทางจำลองทุก 1 นาที (ข้อมูลติดป้าย จำลอง และถูกลบเมื่อล้างข้อมูลก่อนใช้งานจริง)</p>
    </Panel>
  );
}

function DeviceDialog({ d, onClose, onKey }: { d?: Device; onClose: () => void; onKey: (k: string) => void }) {
  const vessels = useVessels();
  const f = useForm({
    resolver: zodResolver(gpsDeviceSchema),
    defaultValues: { vesselId: d?.vesselId ?? '', source: d?.source ?? 'DEDICATED', identifier: d?.identifier ?? '', name: d?.name ?? '', isActive: d?.isActive ?? true, notes: d?.notes ?? '' },
  });
  const save = useAction(
    (v: unknown) => (d ? api.patch(`/gps/devices/${d.id}`, v) : api.post<{ apiKey: string }>('/gps/devices', v)),
    { success: 'บันทึกอุปกรณ์แล้ว', invalidate: ['gps'], onSuccess: (r) => { onClose(); if (!d) onKey((r as { apiKey: string }).apiKey); } },
  );
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={d ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์ GPS'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="ประเภท"><Select options={toOptions(GPS_SOURCE_TH)} disabled={!!d} {...f.register('source')} /></Field>
        <Field label="รหัสอุปกรณ์ (IMEI/Serial)" required error={e.identifier?.message}><Input disabled={!!d} {...f.register('identifier')} /></Field>
        <Field label="ชื่อเรียก"><Input {...f.register('name')} /></Field>
        <Field label="ติดตั้งบนเรือ" hint="AIS ไม่ต้องเลือก (จับคู่ด้วย MMSI ของเรือ)"><Select options={vesselOptions(vessels.data)} placeholder="- ไม่ระบุ -" {...f.register('vesselId')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

const polyToText = (p: [number, number][] | null) => (p ?? []).map(([a, b]) => `${a}, ${b}`).join('\n');
const textToPoly = (s: string) =>
  s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,\s]+/).map(Number) as [number, number]);

export function GeofencesPanel() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['gps', 'geofences'], queryFn: () => api.get<Geofence[]>('/gps/geofences') });
  const [edit, setEdit] = useState<Geofence | 'new' | null>(null);
  return (
    <Panel title="เขตพื้นที่แจ้งเตือน" bodyClass="p-0" actions={can('gps.manage') && <Button size="sm" onClick={() => setEdit('new')}><Plus /> เพิ่มเขต</Button>}>
      <QueryView q={q}>
        {(rows) => rows.length ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">ชื่อเขต</th><th className="px-2">รูปแบบ</th><th className="px-2">ขนาด</th><th className="px-2">แจ้งเตือน</th><th className="px-2">สถานะ</th><th /></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="border-t border-line">
                  <td className="px-4 py-2 font-medium">{g.name}</td><td className="px-2">{GEOFENCE_TYPE_TH[g.type]}</td>
                  <td className="px-2">{g.type === 'CIRCLE' ? `รัศมี ${Number(g.radiusKm)} กม.` : `${g.polygon?.length ?? 0} จุด`}</td>
                  <td className="px-2">{GEOFENCE_ALERT_TH[g.alertOn]}</td>
                  <td className="px-2">{g.isActive ? <Badge tone="ok">ใช้งาน</Badge> : <Badge>ปิด</Badge>}</td>
                  <td className="px-2 text-right">{can('gps.manage') && <Button variant="ghost" size="icon" aria-label="แก้ไข" onClick={() => setEdit(g)}><Pencil /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="ยังไม่มีเขตพื้นที่">ใช้กำหนดท่าเรือ เขตห้ามทำประมง หรือเขตทำประมง เพื่อแจ้งเตือนเมื่อเรือเข้า/ออก</Empty>}
      </QueryView>
      {edit && <FenceDialog g={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </Panel>
  );
}

function FenceDialog({ g, onClose }: { g?: Geofence; onClose: () => void }) {
  const [polyText, setPolyText] = useState(polyToText(g?.polygon ?? null));
  const f = useForm({
    resolver: zodResolver(geofenceSchema),
    defaultValues: {
      name: g?.name ?? '', type: g?.type ?? 'CIRCLE', centerLat: g?.centerLat ?? '', centerLng: g?.centerLng ?? '', radiusKm: g?.radiusKm ?? '',
      polygon: g?.polygon ?? null, alertOn: g?.alertOn ?? 'BOTH', isActive: g?.isActive ?? true, notes: g?.notes ?? '',
    },
  });
  const save = useAction((v: unknown) => (g ? api.put(`/gps/geofences/${g.id}`, v) : api.post('/gps/geofences', v)), { success: 'บันทึกเขตพื้นที่แล้ว', invalidate: ['gps'], onSuccess: onClose });
  const type = f.watch('type');
  const e = f.formState.errors as Record<string, { message?: string }>;
  const submit = () => {
    f.setValue('polygon', type === 'POLYGON' ? (textToPoly(polyText) as never) : null);
    void f.handleSubmit((v) => save.mutate(v))();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={g ? `แก้ไขเขต ${g.name}` : 'เพิ่มเขตพื้นที่'}
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={submit}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="ชื่อเขต" required error={e.name?.message}><Input {...f.register('name')} /></Field>
        <Field label="รูปแบบ"><Select options={toOptions(GEOFENCE_TYPE_TH)} {...f.register('type')} /></Field>
        {type === 'CIRCLE' ? (
          <>
            <Field label="ละติจูดจุดศูนย์กลาง" required error={e.centerLat?.message}><Input inputMode="decimal" {...f.register('centerLat')} /></Field>
            <Field label="ลองจิจูดจุดศูนย์กลาง" required error={e.centerLng?.message}><Input inputMode="decimal" {...f.register('centerLng')} /></Field>
            <Field label="รัศมี (กม.)" required error={e.radiusKm?.message}><Input inputMode="decimal" {...f.register('radiusKm')} /></Field>
          </>
        ) : (
          <Field label="พิกัดมุม (บรรทัดละ 1 จุด: lat, lng)" required error={e.polygon?.message ?? (e as Record<string, { message?: string }>)['polygon.0']?.message} className="sm:col-span-2">
            <Textarea rows={6} value={polyText} onChange={(x) => setPolyText(x.target.value)} placeholder={'7.20, 100.55\n7.25, 100.65\n7.15, 100.70'} />
          </Field>
        )}
        <Field label="แจ้งเตือนเมื่อ"><Select options={toOptions(GEOFENCE_ALERT_TH)} {...f.register('alertOn')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Input {...f.register('notes')} /></Field>
        <Checkbox label="เปิดใช้งาน" {...f.register('isActive')} />
      </FormGrid>
    </Dialog>
  );
}

export function EventsPanel() {
  const q = useQuery({
    queryKey: ['gps', 'events'],
    queryFn: () => api.get<{ id: string; eventType: 'ENTER' | 'EXIT'; at: string; isDemo: boolean; geofence: { name: string }; vessel: { code: string; name: string } }[]>('/gps/geofence-events'),
  });
  return (
    <Panel title="เหตุการณ์เข้า-ออกเขต (200 รายการล่าสุด)" bodyClass="p-0">
      <QueryView q={q}>
        {(rows) => rows.length ? (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-2">{formatDateTime(r.at)}</td><td className="px-2">{r.vessel.code} {r.vessel.name}</td>
                  <td className="px-2"><Badge tone={r.eventType === 'ENTER' ? 'info' : 'warn'}>{r.eventType === 'ENTER' ? 'เข้าเขต' : 'ออกนอกเขต'}</Badge></td>
                  <td className="px-2">{r.geofence.name}</td><td className="px-4 text-right">{r.isDemo && <Badge>สาธิต</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="ยังไม่มีเหตุการณ์" />}
      </QueryView>
    </Panel>
  );
}
