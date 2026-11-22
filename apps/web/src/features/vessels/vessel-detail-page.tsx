import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import {
  EMPLOYEE_POSITION_TH, formatDate, formatDateTime, formatKg, formatNumber, NATIONALITY_TH, toOptions,
  VESSEL_DOC_TYPE_TH, vesselDocSchema, type EmployeePosition, type EmployeeStatus, type Nationality, type Paged, type TripStatus, type VesselDocType,
} from '@fisher/shared';
import { AuditList, type AuditRow } from '@/components/audit-list';
import { FileLink, FileUpload } from '@/components/file-upload';
import { PageHeader } from '@/components/layout/app-layout';
import { EmployeeStatusBadge, ExpiryText, TripStatusBadge, VesselStatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DL, Panel, Stat } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { personName } from '@/lib/utils';
import { VesselMaintenanceTab } from '../maintenance/vessel-maintenance-tab';
import type { VesselDetail } from './types';

export function VesselDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const nav = useNavigate();
  const [docOpen, setDocOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const q = useQuery({ queryKey: ['vessel', id], queryFn: () => api.get<VesselDetail>(`/vessels/${id}`) });
  const trips = useQuery({
    queryKey: ['vessel-trips', id],
    queryFn: () => api.get<Paged<{ id: string; tripNo: string; status: TripStatus; departedAt: string | null; arrivedAt: string | null; captain: { firstName: string; lastName: string } | null }>>(`/vessels/${id}/trips`, { pageSize: 50 }),
    enabled: can('trip.view'),
  });
  const history = useQuery({ queryKey: ['vessel-history', id], queryFn: () => api.get<AuditRow[]>(`/vessels/${id}/history`) });
  const del = useAction(() => api.del(`/vessels/${id}`), { success: 'ลบเรือแล้ว', invalidate: ['vessels'], onSuccess: () => nav('/vessels') });
  const delDoc = useAction((docId: string) => api.del(`/vessels/${id}/documents/${docId}`), { success: 'ลบเอกสารแล้ว', invalidate: ['vessel', 'vessel-history'] });

  return (
    <QueryView q={q}>
      {(v) => (
        <>
          <PageHeader
            title={`${v.code} · ${v.name}`}
            subtitle={<span className="inline-flex items-center gap-2">ทะเบียน {v.registrationNo} <VesselStatusBadge s={v.status} /> {v.activeTrip && <Link to={`/trips/${v.activeTrip.id}`} className="text-accent hover:underline">เที่ยว {v.activeTrip.tripNo}</Link>}</span>}
            actions={
              <>
                {can('vessel.edit') && <Button variant="outline" onClick={() => nav(`/vessels/${id}/edit`)}><Pencil /> แก้ไข</Button>}
                {can('vessel.delete') && <Button variant="danger-outline" onClick={() => setDelOpen(true)}><Trash2 /> ลบ</Button>}
              </>
            }
          />
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="เที่ยวทั้งหมด" value={formatNumber(Object.values(v.stats.tripsByStatus).reduce((a, b) => a + b, 0))} sub={`ปิดแล้ว ${v.stats.tripsByStatus.CLOSED ?? 0}`} />
            <Stat label="สัตว์น้ำสะสม (กก.)" value={formatKg(v.stats.totalCatchKg)} />
            <Stat label="น้ำมันสะสม (ลิตร)" value={formatNumber(v.stats.fuelLiters)} />
            <Stat label="ลูกเรือประจำ" value={formatNumber(v.crewCount)} />
          </div>
          <Tabs
            tabs={[
              {
                value: 'info', label: 'ข้อมูลเรือ',
                content: (
                  <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                    <Panel title="รายละเอียด">
                      <DL items={[
                        ['ประเภท', v.vesselType], ['ท่าเรือประจำ', v.homePort], ['ไต้ก๋งประจำ', v.captain ? <Link className="text-accent" to={`/employees/${v.captain.id}`}>{personName(v.captain)}</Link> : null],
                        ['ความยาว × กว้าง (ม.)', v.lengthM ? `${formatNumber(v.lengthM, 2)} × ${formatNumber(v.widthM, 2)}` : null],
                        ['ตันกรอส / ตันเนต', v.grossTonnage ? `${formatNumber(v.grossTonnage, 2)} / ${formatNumber(v.netTonnage, 2)}` : null],
                        ['วัสดุ / ปีที่ต่อ', [v.hullMaterial, v.buildYear].filter(Boolean).join(' / ')],
                        ['เครื่องยนต์', [v.engineMake, v.engineModel].filter(Boolean).join(' ')], ['หมายเลขเครื่อง', v.engineSerialNo],
                        ['กำลัง (แรงม้า)', v.enginePowerHp && formatNumber(v.enginePowerHp)], ['ความจุถังน้ำมัน', v.fuelTankCapacityL && `${formatNumber(v.fuelTankCapacityL)} ลิตร`],
                        ['เจ้าของ', v.ownerName], ['สัญญาณเรียกขาน', v.radioCallSign], ['MMSI', v.mmsi], ['อุปกรณ์สื่อสาร', v.commEquipment],
                        ['เลขที่ใบอนุญาต', v.licenseNo], ['ใบอนุญาตหมดอายุ', <ExpiryText date={v.licenseExpiry} />], ['ทะเบียนหมดอายุ', <ExpiryText date={v.registrationExpiry} />],
                        ['อุปกรณ์ GPS', v.gpsDevices.length ? v.gpsDevices.map((g) => `${g.source}:${g.identifier}`).join(', ') : 'ยังไม่ได้เชื่อมต่อ'],
                        ['หมายเหตุ', v.notes],
                      ]} />
                    </Panel>
                    <Panel title="รูปเรือ">
                      {v.photoFileId ? <img src={fileUrl(v.photoFileId)} alt={v.name} className="w-full rounded border border-line object-cover" /> : <Empty title="ไม่มีรูป" />}
                      <div className="mt-3 text-xs text-muted">ปรับปรุงล่าสุด {formatDateTime(v.updatedAt)}</div>
                    </Panel>
                  </div>
                ),
              },
              {
                value: 'docs', label: `เอกสาร (${v.documents.length})`,
                content: (
                  <Panel title="เอกสารเรือ" bodyClass="p-0" actions={can('vessel.edit') && <Button size="sm" onClick={() => setDocOpen(true)}><Plus /> เพิ่มเอกสาร</Button>}>
                    {v.documents.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">ประเภท</th><th className="px-2">เลขที่</th><th className="px-2">วันออก</th><th className="px-2">วันหมดอายุ</th><th className="px-2">ไฟล์</th><th className="px-2">หมายเหตุ</th><th /></tr></thead>
                          <tbody>
                            {v.documents.map((d) => (
                              <tr key={d.id} className="border-t border-line">
                                <td className="px-4 py-2">{VESSEL_DOC_TYPE_TH[d.docType as VesselDocType]}</td>
                                <td className="px-2">{d.docNo ?? '-'}</td>
                                <td className="px-2">{formatDate(d.issueDate)}</td>
                                <td className="px-2"><ExpiryText date={d.expiryDate} /></td>
                                <td className="px-2"><FileLink id={d.fileId} label="เปิดไฟล์" /></td>
                                <td className="px-2 text-muted">{d.notes ?? ''}</td>
                                <td className="px-2 text-right">{can('vessel.edit') && <Button variant="ghost" size="icon" aria-label="ลบ" onClick={() => confirm('ยืนยันลบเอกสารนี้?') && delDoc.mutate(d.id)}><Trash2 /></Button>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <Empty title="ยังไม่มีเอกสาร" />}
                  </Panel>
                ),
              },
              {
                value: 'crew', label: `ลูกเรือประจำ (${v.crewEmployees.length})`,
                content: (
                  <Panel bodyClass="p-0">
                    {v.crewEmployees.length ? (
                      <table className="w-full text-sm">
                        <tbody>
                          {v.crewEmployees.map((e) => (
                            <tr key={e.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-accent-soft" onClick={() => nav(`/employees/${e.id}`)}>
                              <td className="px-4 py-2 font-medium">{e.code}</td><td className="px-2">{personName(e)}</td>
                              <td className="px-2">{EMPLOYEE_POSITION_TH[e.position as EmployeePosition]}</td>
                              <td className="px-2">{NATIONALITY_TH[e.nationality as Nationality] ?? e.nationality}</td>
                              <td className="px-4 text-right"><EmployeeStatusBadge s={e.status as EmployeeStatus} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <Empty title="ยังไม่มีลูกเรือประจำเรือลำนี้" />}
                  </Panel>
                ),
              },
              {
                value: 'trips', label: 'ประวัติเที่ยวเรือ', hidden: !can('trip.view'),
                content: (
                  <Panel bodyClass="p-0">
                    {trips.data?.items.length ? (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">เลขที่เที่ยว</th><th className="px-2">ไต้ก๋ง</th><th className="px-2">ออกเรือ</th><th className="px-2">เข้าท่า</th><th className="px-4 text-right">สถานะ</th></tr></thead>
                        <tbody>
                          {trips.data.items.map((t) => (
                            <tr key={t.id} className="cursor-pointer border-t border-line hover:bg-accent-soft" onClick={() => nav(`/trips/${t.id}`)}>
                              <td className="px-4 py-2 font-medium">{t.tripNo}</td><td className="px-2">{personName(t.captain)}</td>
                              <td className="px-2">{formatDateTime(t.departedAt)}</td><td className="px-2">{formatDateTime(t.arrivedAt)}</td>
                              <td className="px-4 text-right"><TripStatusBadge s={t.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <Empty title="ยังไม่มีเที่ยวเรือ" />}
                  </Panel>
                ),
              },
              { value: 'maintenance', label: 'ซ่อมบำรุง', hidden: !can('maintenance.view'), content: <VesselMaintenanceTab vesselId={id} /> },
              { value: 'history', label: 'ประวัติการแก้ไข', content: <Panel><AuditList rows={history.data} /></Panel> },
            ]}
          />
          <VesselDocDialog vesselId={id} open={docOpen} onOpenChange={setDocOpen} />
          <ConfirmDialog
            open={delOpen} onOpenChange={setDelOpen} danger title="ลบเรือ" confirmText="ลบเรือ" loading={del.isPending}
            message={<>ยืนยันลบ <b>{v.name}</b>? ข้อมูลประวัติจะยังถูกเก็บไว้ (ลบแบบซ่อน) และไม่สามารถลบได้หากมีเที่ยวที่ยังไม่ปิด</>}
            onConfirm={() => del.mutate(undefined)}
          />
        </>
      )}
    </QueryView>
  );
}

function VesselDocDialog({ vesselId, open, onOpenChange }: { vesselId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useForm({ resolver: zodResolver(vesselDocSchema), defaultValues: { docType: 'FISHING_LICENSE', docNo: '', issueDate: '', expiryDate: '', fileId: '', notes: '' } });
  const save = useAction((v: unknown) => api.post(`/vessels/${vesselId}/documents`, v), {
    success: 'เพิ่มเอกสารแล้ว', invalidate: ['vessel', 'vessel-history'], onSuccess: () => { f.reset(); onOpenChange(false); },
  });
  const e = f.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="เพิ่มเอกสารเรือ"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="ประเภทเอกสาร" required><Select options={toOptions(VESSEL_DOC_TYPE_TH)} {...f.register('docType')} /></Field>
        <Field label="เลขที่เอกสาร"><Input {...f.register('docNo')} /></Field>
        <Field label="วันที่ออก" error={e.issueDate?.message}><Input type="date" {...f.register('issueDate')} /></Field>
        <Field label="วันหมดอายุ" error={e.expiryDate?.message}><Input type="date" {...f.register('expiryDate')} /></Field>
        <Field label="ไฟล์เอกสาร" className="sm:col-span-2"><FileUpload sensitivity="CONFIDENTIAL" value={f.watch('fileId') as string} onChange={(v) => f.setValue('fileId', v ?? '')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}
