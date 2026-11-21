import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useNavigate } from 'react-router';
import { daysUntil, formatDate, NATIONALITY_TH, type Nationality } from '@fisher/shared';
import { FilterBar } from '@/components/filters';
import { PageHeader } from '@/components/layout/app-layout';
import { ExpiryText } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Empty, QueryView } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListParams } from '@/lib/hooks';
import { downloadCsv } from '@/lib/export';

interface Row {
  id: string; documentNo: string | null; expiryDate: string;
  documentType: { nameTh: string };
  employee: { id: string; code: string; firstName: string; lastName: string; nationality: string; currentVessel: { name: string } | null };
}

export function DocumentsReportPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const lp = useListParams({ days: '90' });
  const q = useQuery({ queryKey: ['doc-report', lp.get('days')], queryFn: () => api.get<Row[]>('/employees/reports/documents', { days: lp.get('days') }) });
  const exportCsv = (rows: Row[]) =>
    downloadCsv(`worker-documents-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['รหัส', 'ชื่อ-สกุล', 'สัญชาติ', 'เรือ', 'เอกสาร', 'เลขที่', 'วันหมดอายุ', 'คงเหลือ (วัน)'],
      ...rows.map((r) => [r.employee.code, `${r.employee.firstName} ${r.employee.lastName}`, NATIONALITY_TH[r.employee.nationality as Nationality] ?? r.employee.nationality,
        r.employee.currentVessel?.name ?? '', r.documentType.nameTh, r.documentNo ?? '', formatDate(r.expiryDate), String(daysUntil(r.expiryDate))]),
    ]);
  return (
    <>
      <PageHeader title="รายงานเอกสารแรงงานใกล้หมดอายุ" subtitle="รวมเอกสารที่หมดอายุแล้วและจะหมดอายุภายในช่วงที่เลือก (เฉพาะพนักงานที่ยังปฏิบัติงาน)" />
      <QueryView q={q}>
        {(rows) => (
          <>
            <FilterBar>
              <Select
                options={[30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `ภายใน ${d} วัน` }))}
                value={lp.get('days')} onChange={(e) => lp.set({ days: e.target.value })}
              />
              <span className="text-sm text-muted">ทั้งหมด {rows.length} ฉบับ · หมดอายุแล้ว {rows.filter((r) => daysUntil(r.expiryDate)! < 0).length}</span>
              {can('employee.export') && rows.length > 0 && <Button variant="outline" size="sm" className="ml-auto" onClick={() => exportCsv(rows)}><Download /> ส่งออก CSV</Button>}
            </FilterBar>
            <Panel bodyClass="p-0">
              {rows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">พนักงาน</th><th className="px-2">สัญชาติ</th><th className="px-2">เรือ</th><th className="px-2">เอกสาร</th><th className="px-2">เลขที่</th><th className="px-4">วันหมดอายุ</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-accent-soft" onClick={() => nav(`/employees/${r.employee.id}`)}>
                          <td className="px-4 py-2"><span className="font-medium">{r.employee.code}</span> {r.employee.firstName} {r.employee.lastName}</td>
                          <td className="px-2">{NATIONALITY_TH[r.employee.nationality as Nationality] ?? r.employee.nationality}</td>
                          <td className="px-2">{r.employee.currentVessel?.name ?? '-'}</td>
                          <td className="px-2">{r.documentType.nameTh}</td>
                          <td className="px-2 font-mono text-xs">{r.documentNo ?? '-'}</td>
                          <td className="px-4"><ExpiryText date={r.expiryDate} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty title="ไม่มีเอกสารที่ใกล้หมดอายุในช่วงนี้" />}
            </Panel>
          </>
        )}
      </QueryView>
    </>
  );
}
