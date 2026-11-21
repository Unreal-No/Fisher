import { formatDateTime } from '@fisher/shared';
import { Empty } from './ui/states';

export interface AuditRow { id: string; at: string; username: string | null; action: string; entityType: string; note: string | null; before: unknown; after: unknown }

export const ACTION_TH: Record<string, string> = {
  CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', STATUS_CHANGE: 'เปลี่ยนสถานะ', LOGIN: 'เข้าสู่ระบบ', LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ',
  LOGOUT: 'ออกจากระบบ', VIEW_SENSITIVE: 'ดูข้อมูลส่วนบุคคล', OVERRIDE: 'ข้ามเงื่อนไข (อนุมัติ)', DEPART: 'ออกเรือ', ARRIVE: 'เข้าท่า',
  CLOSE: 'ปิดเที่ยว', CANCEL: 'ยกเลิก', RENEW: 'ต่ออายุเอกสาร', ADJUST: 'ปรับปรุงรายการ', VOID: 'ยกเลิกรายการ', UPDATE_CREW: 'แก้ไขลูกเรือ',
  ASSIGN_VESSEL: 'ย้ายเรือ', PASSWORD_CHANGE: 'เปลี่ยนรหัสผ่าน', PASSWORD_RESET: 'รีเซ็ตรหัสผ่าน', DEACTIVATE: 'ปิดใช้งาน',
};

/** Changed keys between before/after snapshots (shallow). */
function changedKeys(b: unknown, a: unknown) {
  if (!b || !a || typeof b !== 'object' || typeof a !== 'object') return [];
  const skip = new Set(['updatedAt', 'createdAt', 'version']);
  return Object.keys(a).filter((k) => !skip.has(k) && JSON.stringify((b as never)[k]) !== JSON.stringify((a as never)[k]));
}

export function AuditList({ rows }: { rows?: AuditRow[] }) {
  if (!rows?.length) return <Empty title="ยังไม่มีประวัติ" />;
  return (
    <ol className="space-y-0 text-sm">
      {rows.map((r) => {
        const keys = changedKeys(r.before, r.after);
        return (
          <li key={r.id} className="flex gap-3 border-l-2 border-line py-2 pl-3">
            <div className="w-36 shrink-0 text-xs text-muted">{formatDateTime(r.at)}</div>
            <div className="min-w-0">
              <span className="font-medium">{ACTION_TH[r.action] ?? r.action}</span>
              <span className="text-muted"> · {r.entityType} · โดย {r.username ?? 'ระบบ'}</span>
              {keys.length > 0 && <div className="text-xs text-muted">ฟิลด์ที่เปลี่ยน: {keys.join(', ')}</div>}
              {r.note && <div className="text-xs text-slate-600">หมายเหตุ: {r.note}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
