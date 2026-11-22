import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCcw, Ship, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import {
  assignVesselSchema, EMPLOYEE_POSITION_TH, employeeDocSchema, formatDate, formatDateTime, formatMoney, GENDER_TH, NATIONALITY_TH, PAY_TYPE_TH,
  toISODate, type Nationality,
} from '@fisher/shared';
import { FileLink, FileUpload } from '@/components/file-upload';
import { PageHeader } from '@/components/layout/app-layout';
import { DocStateBadge, EmployeeStatusBadge, ExpiryText, TripStatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, FormGrid } from '@/components/ui/form';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DL, Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useDocTypes, useVessels, vesselOptions } from '@/lib/lookups';
import { EmployeePayrollTab } from '@/features/payroll/employee-payroll-tab';
import type { EmpDoc, EmployeeDetail } from './types';

const EVENT_TH: Record<string, string> = {
  HIRED: 'เริ่มงาน', STATUS_CHANGE: 'เปลี่ยนสถานะ', POSITION_CHANGE: 'เปลี่ยนตำแหน่ง', PAY_CHANGE: 'เปลี่ยนค่าตอบแทน', VESSEL_ASSIGN: 'ย้ายเรือ',
};
const DOC_STATUS = { ACTIVE: ['ใช้งาน', 'ok'], REPLACED: ['ต่ออายุแล้ว', 'neutral'], CANCELLED: ['ยกเลิก', 'neutral'] } as const;

export function EmployeeDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const nav = useNavigate();
  const vessels = useVessels();
  const [docDlg, setDocDlg] = useState<{ renew?: EmpDoc } | null>(null);
  const [cancelDoc, setCancelDoc] = useState<EmpDoc | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => api.get<EmployeeDetail>(`/employees/${id}`) });
  const cancel = useAction((v: { docId: string; reason: string }) => api.post(`/employees/${id}/documents/${v.docId}/cancel`, { reason: v.reason }), {
    success: 'ยกเลิกเอกสารแล้ว', invalidate: ['employee', 'employees'], onSuccess: () => setCancelDoc(null),
  });
  const del = useAction(() => api.del(`/employees/${id}`), { success: 'ลบพนักงานแล้ว', invalidate: ['employees'], onSuccess: () => nav('/employees') });
  const vesselName = (vid: string | null) => vessels.data?.find((v) => v.id === vid)?.name ?? (vid ? '(เรือ)' : 'ไม่ประจำเรือ');

  return (
    <QueryView q={q}>
      {(e) => (
        <>
          <PageHeader
            title={`${e.firstName} ${e.lastName}${e.nickname ? ` (${e.nickname})` : ''}`}
            subtitle={<span className="inline-flex flex-wrap items-center gap-2">{e.code} · {EMPLOYEE_POSITION_TH[e.position]} · {NATIONALITY_TH[e.nationality as Nationality] ?? e.nationality} <EmployeeStatusBadge s={e.status} /></span>}
            actions={
              <>
                {can('employee.edit') && <Button variant="outline" onClick={() => setAssignOpen(true)}><Ship /> ย้าย/กำหนดเรือ</Button>}
                {can('employee.edit') && <Button variant="outline" onClick={() => nav(`/employees/${id}/edit`)}><Pencil /> แก้ไข</Button>}
                {can('employee.delete') && <Button variant="danger-outline" onClick={() => setDelOpen(true)}><Trash2 /></Button>}
              </>
            }
          />
          <Tabs
            tabs={[
              {
                value: 'info', label: 'ข้อมูลพนักงาน',
                content: (
                  <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
                    <Panel title="รายละเอียด">
                      <DL items={[
                        ['ชื่อ (อังกฤษ)', [e.firstNameEn, e.lastNameEn].filter(Boolean).join(' ')], ['เพศ', GENDER_TH[e.gender]], ['วันเกิด', formatDate(e.dateOfBirth)],
                        ['เลขประจำตัว', e.nationalIdNo], ['โทรศัพท์', e.phone], ['ที่อยู่', e.address],
                        ['ผู้ติดต่อฉุกเฉิน', [e.emergencyContactName, e.emergencyContactPhone].filter(Boolean).join(' · ')],
                        ['ประจำเรือ', e.currentVessel ? <Link className="text-accent" to={`/vessels/${e.currentVessel.id}`}>{e.currentVessel.name}</Link> : 'ยังไม่ประจำเรือ'],
                        ['วันเริ่มงาน', formatDate(e.startDate)], ['วันสิ้นสุด', formatDate(e.endDate)],
                        ['ค่าตอบแทน', `${PAY_TYPE_TH[e.payType]}${e.baseRate ? ` · ${formatMoney(e.baseRate)} บาท` : ''}`],
                        ['บัญชีธนาคาร', [e.bankName, e.bankAccountNo].filter(Boolean).join(' ')], ['บัญชีผู้ใช้ระบบ', e.user?.username], ['หมายเหตุ', e.notes],
                      ]} />
                    </Panel>
                    <Panel title="รูปถ่าย">{e.photoFileId ? <img src={fileUrl(e.photoFileId)} alt="" className="w-full rounded border border-line" /> : <Empty title="ไม่มีรูป" />}</Panel>
                  </div>
                ),
              },
              {
                value: 'docs', label: <span className="inline-flex items-center gap-1.5">เอกสาร {e.checklist.some((c) => c.state === 'EXPIRED' || c.state === 'MISSING') && <span className="size-2 rounded-full bg-bad" />}</span>,
                content: (
                  <div className="space-y-4">
                    <Panel title="รายการเอกสารที่ต้องมี (ตามการตั้งค่า)" bodyClass="p-0">
                      {e.checklist.length ? (
                        <table className="w-full text-sm">
                          <tbody>
                            {e.checklist.map((c) => (
                              <tr key={c.documentTypeId} className="border-b border-line last:border-0">
                                <td className="px-4 py-2">{c.nameTh}</td>
                                <td className="px-2"><ExpiryText date={c.expiryDate} /></td>
                                <td className="px-4 text-right"><DocStateBadge s={c.state} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <Empty title="ไม่มีเอกสารบังคับสำหรับพนักงานนี้" />}
                      <p className="border-t border-line px-4 py-2 text-xs text-muted">การแจ้งเตือนเป็นการเตือนทางธุรกิจตามที่ตั้งค่า ไม่ใช่ความเห็นทางกฎหมาย</p>
                    </Panel>
                    <Panel title="ทะเบียนเอกสาร (รวมประวัติการต่ออายุ)" bodyClass="p-0" actions={can('employee_doc.manage') && <Button size="sm" onClick={() => setDocDlg({})}><Plus /> เพิ่มเอกสาร</Button>}>
                      {e.documents.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-left text-xs text-slate-600">
                              <tr><th className="px-4 py-2">ประเภท</th><th className="px-2">เลขที่</th><th className="px-2">วันออก</th><th className="px-2">หมดอายุ</th><th className="px-2">ไฟล์</th><th className="px-2">สถานะ</th><th /></tr>
                            </thead>
                            <tbody>
                              {e.documents.map((d) => (
                                <tr key={d.id} className={`border-t border-line ${d.status !== 'ACTIVE' ? 'text-muted' : ''}`}>
                                  <td className="px-4 py-2">{d.documentType.nameTh}</td>
                                  <td className="px-2 font-mono text-xs">{d.documentNo ?? '-'}</td>
                                  <td className="px-2">{formatDate(d.issueDate)}</td>
                                  <td className="px-2">{d.status === 'ACTIVE' ? <ExpiryText date={d.expiryDate} /> : formatDate(d.expiryDate)}</td>
                                  <td className="px-2">{can('employee.sensitive') ? <FileLink id={d.fileId} label="เปิด" /> : d.fileId ? <span className="text-xs text-muted">มีไฟล์ (จำกัดสิทธิ์)</span> : '-'}</td>
                                  <td className="px-2"><Badge tone={DOC_STATUS[d.status][1]}>{DOC_STATUS[d.status][0]}</Badge></td>
                                  <td className="whitespace-nowrap px-2 text-right">
                                    {can('employee_doc.manage') && d.status === 'ACTIVE' && (
                                      <>
                                        <Button variant="ghost" size="sm" onClick={() => setDocDlg({ renew: d })}><RefreshCcw /> ต่ออายุ</Button>
                                        <Button variant="ghost" size="icon" aria-label="ยกเลิก" onClick={() => setCancelDoc(d)}><XCircle /></Button>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <Empty title="ยังไม่มีเอกสาร" />}
                    </Panel>
                  </div>
                ),
              },
              {
                value: 'history', label: 'ประวัติการจ้าง/ประจำเรือ',
                content: (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Panel title="ประวัติการประจำเรือ" bodyClass="p-0">
                      {e.assignments.length ? (
                        <table className="w-full text-sm"><tbody>
                          {e.assignments.map((a) => (
                            <tr key={a.id} className="border-b border-line last:border-0">
                              <td className="px-4 py-2"><Link className="text-accent" to={`/vessels/${a.vessel.id}`}>{a.vessel.name}</Link></td>
                              <td className="px-2">{EMPLOYEE_POSITION_TH[a.position]}</td>
                              <td className="px-4 text-right">{formatDate(a.startDate)} – {a.endDate ? formatDate(a.endDate) : <Badge tone="ok">ปัจจุบัน</Badge>}</td>
                            </tr>
                          ))}
                        </tbody></table>
                      ) : <Empty />}
                    </Panel>
                    <Panel title="ประวัติการจ้างงาน">
                      <ol className="space-y-2 text-sm">
                        {e.history.map((h) => (
                          <li key={h.id} className="border-l-2 border-line pl-3">
                            <div className="text-xs text-muted">{formatDate(h.effectiveDate)}</div>
                            <div><b>{EVENT_TH[h.eventType] ?? h.eventType}</b>{' '}
                              {h.eventType === 'VESSEL_ASSIGN' ? `${vesselName(h.fromValue)} → ${vesselName(h.toValue)}` : [h.fromValue, h.toValue].filter(Boolean).join(' → ')}
                            </div>
                            {h.notes && <div className="text-xs text-muted">{h.notes}</div>}
                          </li>
                        ))}
                      </ol>
                    </Panel>
                  </div>
                ),
              },
              {
                value: 'trips', label: `เที่ยวเรือ (${e.tripCrew.length})`,
                content: (
                  <Panel bodyClass="p-0">
                    {e.tripCrew.length ? (
                      <table className="w-full text-sm"><tbody>
                        {e.tripCrew.map((t) => (
                          <tr key={t.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-accent-soft" onClick={() => nav(`/trips/${t.trip.id}`)}>
                            <td className="px-4 py-2 font-medium">{t.trip.tripNo}</td><td className="px-2">{t.trip.vessel.name}</td>
                            <td className="px-2">{EMPLOYEE_POSITION_TH[t.role]}</td><td className="px-2">{formatDateTime(t.trip.departedAt)}</td>
                            <td className="px-4 text-right"><TripStatusBadge s={t.trip.status} /></td>
                          </tr>
                        ))}
                      </tbody></table>
                    ) : <Empty title="ยังไม่เคยร่วมเที่ยวเรือ" />}
                  </Panel>
                ),
              },
              { value: 'payroll', label: 'เงินเดือน', hidden: !can('payroll.view'), content: <EmployeePayrollTab employeeId={id} /> },
            ]}
          />
          {docDlg && <DocDialog employeeId={id} renew={docDlg.renew} nationality={e.nationality} onClose={() => setDocDlg(null)} />}
          <AssignDialog employeeId={id} open={assignOpen} onOpenChange={setAssignOpen} current={e.currentVesselId} options={vesselOptions(vessels.data)} />
          <ConfirmDialog
            open={!!cancelDoc} onOpenChange={() => setCancelDoc(null)} title="ยกเลิกเอกสาร" danger requireReason loading={cancel.isPending}
            message={`ยกเลิก ${cancelDoc?.documentType.nameTh} (เอกสารจะถูกเก็บในประวัติ)`}
            onConfirm={(reason) => cancelDoc && cancel.mutate({ docId: cancelDoc.id, reason })}
          />
          <ConfirmDialog
            open={delOpen} onOpenChange={setDelOpen} title="ลบพนักงาน" danger loading={del.isPending} confirmText="ลบ"
            message="ลบได้เฉพาะพนักงานที่ไม่มีประวัติเที่ยวเรือ หากเคยทำงานแล้วให้เปลี่ยนสถานะเป็นลาออก/เลิกจ้างแทน"
            onConfirm={() => del.mutate(undefined)}
          />
        </>
      )}
    </QueryView>
  );
}

function DocDialog({ employeeId, renew, nationality, onClose }: { employeeId: string; renew?: EmpDoc; nationality: string; onClose: () => void }) {
  const types = useDocTypes();
  const f = useForm({
    resolver: zodResolver(employeeDocSchema),
    defaultValues: { documentTypeId: renew?.documentTypeId ?? '', documentNo: '', issueDate: '', expiryDate: '', issuedBy: '', fileId: '', notes: '' },
  });
  const save = useAction(
    (v: unknown) => api.post(renew ? `/employees/${employeeId}/documents/${renew.id}/renew` : `/employees/${employeeId}/documents`, v),
    { success: renew ? 'ต่ออายุเอกสารแล้ว' : 'เพิ่มเอกสารแล้ว', invalidate: ['employee', 'employees', 'dashboard'], onSuccess: onClose },
  );
  const opts = (types.data ?? [])
    .filter((t) => t.isActive && (t.appliesTo === 'ALL' || (t.appliesTo === 'THAI') === (nationality === 'TH')))
    .map((t) => ({ value: t.id, label: `${t.nameTh}${t.isRequired ? ' *' : ''}` }));
  const e = f.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={renew ? `ต่ออายุ: ${renew.documentType.nameTh}` : 'เพิ่มเอกสารพนักงาน'}
      description="ข้อมูลเอกสารเป็นข้อมูลส่วนบุคคล เข้าถึงได้เฉพาะผู้มีสิทธิ์"
      footer={<><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <FormGrid cols={2}>
        <Field label="ประเภทเอกสาร" required error={e.documentTypeId?.message} className="sm:col-span-2">
          <Select options={opts} placeholder="- เลือก -" disabled={!!renew} {...f.register('documentTypeId')} />
        </Field>
        <Field label="เลขที่เอกสาร"><Input autoComplete="off" {...f.register('documentNo')} /></Field>
        <Field label="ออกโดย"><Input {...f.register('issuedBy')} /></Field>
        <Field label="วันที่ออก" error={e.issueDate?.message}><Input type="date" max={toISODate()} {...f.register('issueDate')} /></Field>
        <Field label="วันหมดอายุ" error={e.expiryDate?.message}><Input type="date" {...f.register('expiryDate')} /></Field>
        <Field label="สแกนเอกสาร" className="sm:col-span-2"><FileUpload sensitivity="PERSONAL" value={f.watch('fileId') as string} onChange={(v) => f.setValue('fileId', v ?? '')} /></Field>
        <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea rows={2} {...f.register('notes')} /></Field>
      </FormGrid>
    </Dialog>
  );
}

function AssignDialog({ employeeId, open, onOpenChange, current, options }: {
  employeeId: string; open: boolean; onOpenChange: (o: boolean) => void; current: string | null; options: { value: string; label: string }[];
}) {
  const f = useForm({ resolver: zodResolver(assignVesselSchema), defaultValues: { vesselId: current ?? '', startDate: toISODate(), notes: '' } });
  const save = useAction((v: unknown) => api.post(`/employees/${employeeId}/assign-vessel`, v), {
    success: 'บันทึกการประจำเรือแล้ว', invalidate: ['employee', 'employees', 'vessel'], onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="กำหนด/ย้ายเรือที่ประจำ" size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button><Button loading={save.isPending} onClick={f.handleSubmit((v) => save.mutate(v))}>บันทึก</Button></>}>
      <div className="space-y-3">
        <Field label="เรือ"><Select options={options} placeholder="- ไม่ประจำเรือ -" {...f.register('vesselId')} /></Field>
        <Field label="มีผลตั้งแต่" required><Input type="date" {...f.register('startDate')} /></Field>
        <Field label="หมายเหตุ"><Textarea rows={2} {...f.register('notes')} /></Field>
      </div>
    </Dialog>
  );
}
