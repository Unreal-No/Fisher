import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Anchor, Banknote, Fish, Fuel, Plus, Receipt, Ship, TrendingUp, Users, Wallet, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatDateTime, formatKg, formatMoney, formatMonth, formatNumber, toISODate, type TripStatus } from '@fisher/shared';
import { FilterBar } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { ExpiryText, TripStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListParams } from '@/lib/hooks';
import { useVessels, vesselOptions } from '@/lib/lookups';

interface Summary {
  range: { from: string; to: string };
  vessels: { total: number; atSea: number; atPort: number; maintenance: number };
  workers: { active: number; docExpired: number; docExpiring30: number; docExpiring90: number };
  trips: { atSeaCount: number; current: { id: string; tripNo: string; status: TripStatus; departedAt: string | null; vessel: { name: string }; crewCount: number }[] };
  catch: { totalKg: number; records: number; bySpecies: { name: string; weightKg: number }[]; monthly: { month: string; weightKg: number }[] };
  fuel: { liters: number; cost: number | null };
  expenses: { confirmed: number; estimated: number } | null;
  sales: { revenue: number; soldKg: number; receivables: number; suppliesCost: number; estimatedProfit: number } | null;
  alerts: {
    maintenance: { id: string; name: string; vessel: { id: string; code: string; name: string }; state: 'OVERDUE' | 'DUE_SOON'; nextDueDate: string | null; hoursLeft: number | null }[];
    documents: { id: string; employeeId: string; employee: string; documentType: string; expiryDate: string }[];
    vessels: { id: string; code: string; name: string; licenseExpiry: string }[];
  };
  recentCatch: { id: string; catchDate: string; weightKg: string; species: { nameTh: string }; vessel: { name: string }; trip: { id: string; tripNo: string } }[];
}

const NAVY = '#1b365d';

export function DashboardPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const today = toISODate();
  const lp = useListParams({ from: `${today.slice(0, 7)}-01`, to: today });
  const vessels = useVessels();
  const params = { from: lp.get('from'), to: lp.get('to'), vesselId: lp.get('vesselId') || undefined };
  const q = useQuery({ queryKey: ['dashboard', params], queryFn: () => api.get<Summary>('/dashboard/summary', params) });

  return (
    <>
      <PageHeader
        title="แดชบอร์ดผู้บริหาร"
        subtitle="ข้อมูลจากรายการที่บันทึกในระบบ ตามช่วงวันที่ที่เลือก"
        actions={
          <>
            {can('trip.create') && (
              <Button onClick={() => nav('/trips?new=1')}>
                <Plus /> สร้างเที่ยวเรือ
              </Button>
            )}
            {can('catch.create') && (
              <Button variant="outline" onClick={() => nav('/catch?new=1')}>
                <Fish /> บันทึกสัตว์น้ำ
              </Button>
            )}
            {can('employee.create') && (
              <Button variant="outline" onClick={() => nav('/employees/new')}>
                <Users /> เพิ่มพนักงาน
              </Button>
            )}
          </>
        }
      />
      <FilterBar>
        <label className="text-sm text-muted">ช่วงวันที่</label>
        <Input type="date" className="w-40" value={lp.get('from')} max={lp.get('to')} onChange={(e) => lp.set({ from: e.target.value })} />
        <span className="text-muted">–</span>
        <Input type="date" className="w-40" value={lp.get('to')} min={lp.get('from')} onChange={(e) => lp.set({ to: e.target.value })} />
        <Select options={vesselOptions(vessels.data)} placeholder="เรือทุกลำ" value={lp.get('vesselId')} onChange={(e) => lp.set({ vesselId: e.target.value })} />
      </FilterBar>

      <QueryView q={q}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="เรือทั้งหมด" value={formatNumber(d.vessels.total)} icon={<Ship />} sub={`จอดท่า ${d.vessels.atPort} ลำ`} />
              <Stat label="เรือออกทะเล" value={formatNumber(d.vessels.atSea)} icon={<Anchor />} sub={`เที่ยวที่อยู่ในทะเล ${d.trips.atSeaCount}`} />
              <Stat label="ซ่อมบำรุง" value={formatNumber(d.vessels.maintenance)} icon={<Wrench />} tone={d.vessels.maintenance ? 'warn' : undefined} />
              <Stat label="พนักงานปฏิบัติงาน" value={formatNumber(d.workers.active)} icon={<Users />} />
              <Stat
                label="เอกสารหมดอายุ / ใน 30 วัน"
                value={`${d.workers.docExpired} / ${d.workers.docExpiring30}`}
                tone={d.workers.docExpired ? 'bad' : d.workers.docExpiring30 ? 'warn' : 'ok'}
                icon={<AlertTriangle />}
                sub={`ภายใน 90 วัน ${d.workers.docExpiring90} ฉบับ`}
              />
              <Stat label="น้ำหนักสัตว์น้ำ (กก.)" value={formatKg(d.catch.totalKg)} icon={<Fish />} sub={`${formatNumber(d.catch.records)} รายการ`} />
              <Stat label="น้ำมันที่เติม (ลิตร)" value={formatNumber(d.fuel.liters)} icon={<Fuel />} />
              {d.fuel.cost !== null && <Stat label="ค่าน้ำมัน (บาท)" value={formatMoney(d.fuel.cost)} icon={<Fuel />} />}
              {d.sales && <Stat label="ยอดขายสัตว์น้ำ (บาท)" value={formatMoney(d.sales.revenue)} icon={<Banknote />} sub={`${formatKg(d.sales.soldKg)} กก. · ไม่รวม VAT`} />}
              {d.sales && <Stat label="ลูกหนี้ค้างรับ (บาท)" value={formatMoney(d.sales.receivables)} icon={<Receipt />} tone={d.sales.receivables > 0 ? 'warn' : undefined} sub="ทั้งหมด ณ ปัจจุบัน" />}
              {d.sales && (
                <Stat label="กำไรจากการดำเนินงาน (ประมาณการ)" value={formatMoney(d.sales.estimatedProfit)} icon={<TrendingUp />} tone={d.sales.estimatedProfit < 0 ? 'bad' : 'ok'}
                  sub="ยอดขาย − น้ำมัน − เสบียง − ค่าใช้จ่ายเที่ยว · ยังไม่รวมค่าแรง/ค่าเสื่อม" />
              )}
              {d.expenses && (
                <Stat
                  label="ค่าใช้จ่ายเที่ยวเรือ (บาท)"
                  value={formatMoney(d.expenses.confirmed)}
                  icon={<Wallet />}
                  sub={d.expenses.estimated ? `ประมาณการเพิ่ม ${formatMoney(d.expenses.estimated)}` : 'ยืนยันแล้วทั้งหมด'}
                />
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Panel title="ปริมาณสัตว์น้ำรายเดือน (กก.) · 12 เดือนล่าสุด" className="xl:col-span-2">
                {d.catch.monthly.length ? (
                  <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={d.catch.monthly.map((m) => ({ ...m, label: formatMonth(`${m.month}-01`) }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatNumber(v)} width={70} />
                        <Tooltip formatter={(v) => [`${formatKg(v)} กก.`, 'น้ำหนัก']} />
                        <Bar dataKey="weightKg" fill={NAVY} radius={[2, 2, 0, 0]} maxBarSize={56} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty title="ยังไม่มีข้อมูลสัตว์น้ำ" />
                )}
              </Panel>
              <Panel title="สัตว์น้ำตามชนิด (ช่วงที่เลือก)">
                {d.catch.bySpecies.length ? (
                  <ul className="space-y-2">
                    {d.catch.bySpecies.map((s) => (
                      <li key={s.name}>
                        <div className="flex justify-between text-sm">
                          <span>{s.name}</span>
                          <span className="tabular-nums">{formatKg(s.weightKg)} กก.</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded bg-slate-100">
                          <div className="h-1.5 rounded bg-navy-700" style={{ width: `${(s.weightKg / d.catch.bySpecies[0]!.weightKg) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="ไม่มีข้อมูลในช่วงนี้" />
                )}
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Panel title="เที่ยวเรือที่กำลังดำเนินการ" className="xl:col-span-2" bodyClass="p-0" actions={<Link className="text-sm text-accent" to="/trips?open=true">ดูทั้งหมด</Link>}>
                {d.trips.current.length ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {d.trips.current.map((t) => (
                        <tr key={t.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-accent-soft" onClick={() => nav(`/trips/${t.id}`)}>
                          <td className="px-4 py-2 font-medium">{t.tripNo}</td>
                          <td className="px-2 py-2">{t.vessel.name}</td>
                          <td className="px-2 py-2"><TripStatusBadge s={t.status} /></td>
                          <td className="hidden px-2 py-2 text-muted sm:table-cell">ออก {formatDateTime(t.departedAt)}</td>
                          <td className="px-4 py-2 text-right text-muted">{t.crewCount} คน</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty title="ไม่มีเที่ยวเรือที่กำลังดำเนินการ" />
                )}
              </Panel>
              <Panel title="แจ้งเตือนสำคัญ" bodyClass="p-0" actions={<Link className="text-sm text-accent" to="/documents">รายงานเอกสาร</Link>}>
                {d.alerts.documents.length + d.alerts.vessels.length + d.alerts.maintenance.length ? (
                  <ul className="divide-y divide-line text-sm">
                    {d.alerts.maintenance.map((m) => (
                      <li key={m.id} className="px-4 py-2">
                        <Link to={`/maintenance?tab=plans&vesselId=${m.vessel.id}`} className="font-medium hover:underline">{m.vessel.code} {m.vessel.name}</Link>
                        <div className={m.state === 'OVERDUE' ? 'text-xs text-bad' : 'text-xs text-warn'}>
                          ซ่อมบำรุง: {m.name} · {m.state === 'OVERDUE' ? 'เกินกำหนด' : 'ใกล้ถึงกำหนด'}{m.nextDueDate ? ` (${formatDate(m.nextDueDate)})` : ''}{m.hoursLeft !== null ? ` · เหลือ ${formatNumber(m.hoursLeft)} ชม.เครื่อง` : ''}
                        </div>
                      </li>
                    ))}
                    {d.alerts.vessels.map((v) => (
                      <li key={v.id} className="px-4 py-2">
                        <Link to={`/vessels/${v.id}`} className="font-medium hover:underline">{v.code} {v.name}</Link>
                        <div className="text-xs text-muted">ใบอนุญาตทำการประมง · <ExpiryText date={v.licenseExpiry} /></div>
                      </li>
                    ))}
                    {d.alerts.documents.map((a) => (
                      <li key={a.id} className="px-4 py-2">
                        <Link to={`/employees/${a.employeeId}`} className="font-medium hover:underline">{a.employee}</Link>
                        <div className="text-xs text-muted">{a.documentType} · <ExpiryText date={a.expiryDate} /></div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="ไม่มีเอกสารใกล้หมดอายุใน 30 วัน" />
                )}
              </Panel>
            </div>

            <Panel title="รายการสัตว์น้ำล่าสุด" bodyClass="p-0">
              {d.recentCatch.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {d.recentCatch.map((c) => (
                        <tr key={c.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2">{formatDate(c.catchDate)}</td>
                          <td className="px-2 py-2"><Link className="text-accent hover:underline" to={`/trips/${c.trip.id}`}>{c.trip.tripNo}</Link></td>
                          <td className="px-2 py-2">{c.vessel.name}</td>
                          <td className="px-2 py-2">{c.species.nameTh}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatKg(c.weightKg)} กก.</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty />
              )}
            </Panel>
          </div>
        )}
      </QueryView>
    </>
  );
}
