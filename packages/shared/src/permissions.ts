// RBAC catalogue. Permission code = `<module>.<action>`.
// Seeded into DB (permissions table); roles are editable at runtime by role.manage.

export const PERMISSIONS = {
  // Dashboard
  'dashboard.view': 'ดูแดชบอร์ด',
  'dashboard.finance': 'ดูตัวเลขการเงินบนแดชบอร์ด',
  // Fleet
  'vessel.view': 'ดูข้อมูลเรือ',
  'vessel.create': 'เพิ่มเรือ',
  'vessel.edit': 'แก้ไขเรือ',
  'vessel.delete': 'ลบเรือ',
  'vessel.export': 'ส่งออกข้อมูลเรือ',
  // Trips
  'trip.view': 'ดูเที่ยวเรือ',
  'trip.create': 'สร้างเที่ยวเรือ',
  'trip.edit': 'บันทึกขั้นตอนเที่ยวเรือ',
  'trip.approve': 'อนุมัติ/ปิดเที่ยว/ข้ามเงื่อนไข',
  'trip.delete': 'ยกเลิกเที่ยวเรือ',
  'trip.export': 'ส่งออกเที่ยวเรือ',
  // Catch
  'catch.view': 'ดูสัตว์น้ำที่จับได้',
  'catch.create': 'บันทึกสัตว์น้ำ',
  'catch.edit': 'ปรับปรุงน้ำหนัก/เกรด',
  'catch.delete': 'ยกเลิกรายการสัตว์น้ำ',
  'catch.export': 'ส่งออกสัตว์น้ำ',
  'species.manage': 'จัดการทะเบียนพันธุ์สัตว์น้ำ',
  // GPS
  'gps.view': 'ดูแผนที่ติดตามเรือ',
  'gps.manage': 'จัดการอุปกรณ์ GPS/Geofence',
  'gps.report': 'ส่งตำแหน่งเรือจากมือถือ',
  // HR
  'employee.view': 'ดูข้อมูลพนักงาน',
  'employee.create': 'เพิ่มพนักงาน',
  'employee.edit': 'แก้ไขพนักงาน',
  'employee.delete': 'ลบพนักงาน',
  'employee.export': 'ส่งออกพนักงาน',
  'employee.sensitive': 'ดูข้อมูลส่วนบุคคล/เลขเอกสาร/ไฟล์เอกสาร',
  'employee_doc.manage': 'จัดการเอกสารพนักงาน',
  // Later modules (declared now so role matrix is complete)
  'sales.view': 'ดูการขาย',
  'sales.create': 'สร้างการขาย',
  'sales.approve': 'อนุมัติการขาย',
  'purchase.view': 'ดูการจัดซื้อ',
  'purchase.create': 'สร้างการจัดซื้อ',
  'purchase.approve': 'อนุมัติการจัดซื้อ',
  'inventory.view': 'ดูคลังสินค้า',
  'inventory.edit': 'เคลื่อนไหวสต็อก',
  'inventory.approve': 'อนุมัติจ่ายเกินสต็อก',
  'fuel.view': 'ดูน้ำมัน',
  'fuel.edit': 'บันทึกน้ำมัน',
  'fuel.approve': 'อนุมัติจ่ายน้ำมันเกินยอดคงเหลือ',
  'payroll.view': 'ดูเงินเดือน',
  'payroll.edit': 'คำนวณเงินเดือน',
  'payroll.approve': 'อนุมัติเงินเดือน',
  'finance.view': 'ดูบัญชี/การเงิน',
  'finance.edit': 'บันทึกบัญชี',
  'finance.approve': 'อนุมัติ/ผ่านรายการบัญชี',
  'report.view': 'ดูรายงาน',
  'report.export': 'ส่งออกรายงาน',
  // Admin
  'user.manage': 'จัดการผู้ใช้',
  'role.manage': 'จัดการบทบาทและสิทธิ์',
  'audit.view': 'ดูประวัติการใช้งาน',
  'settings.manage': 'ตั้งค่าระบบ',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const pick = (...prefixes: string[]) =>
  ALL_PERMISSIONS.filter((p) => prefixes.some((x) => (x.endsWith('.') ? p.startsWith(x) : p === x)));

const VIEW_ALL = ALL_PERMISSIONS.filter((p) => p.endsWith('.view') && p !== 'audit.view');

export const ROLE_DEFS: Record<string, { name: string; description: string; permissions: Permission[] }> = {
  SUPER_ADMIN: { name: 'ผู้ดูแลระบบสูงสุด', description: 'ทุกสิทธิ์', permissions: ALL_PERMISSIONS },
  OWNER: {
    name: 'เจ้าของกิจการ',
    description: 'ดูทุกส่วน อนุมัติ และส่งออก',
    permissions: ALL_PERMISSIONS.filter((p) => !['user.manage', 'role.manage', 'settings.manage'].includes(p)),
  },
  OPERATIONS_MANAGER: {
    name: 'ผู้จัดการฝ่ายปฏิบัติการ',
    description: 'ควบคุมเรือ เที่ยวเรือ สัตว์น้ำ',
    permissions: pick('dashboard.view', 'vessel.', 'trip.', 'catch.', 'species.manage', 'gps.', 'employee.view', 'fuel.', 'inventory.', 'purchase.view', 'purchase.approve', 'report.'),
  },
  FLEET_MANAGER: {
    name: 'ผู้จัดการกองเรือ',
    description: 'ทะเบียนเรือ เที่ยวเรือ GPS',
    permissions: pick('dashboard.view', 'vessel.', 'trip.view', 'trip.create', 'trip.edit', 'trip.export', 'catch.view', 'gps.', 'employee.view', 'fuel.', 'report.view'),
  },
  CAPTAIN: {
    name: 'ไต้ก๋ง/นายเรือ',
    description: 'บันทึกเที่ยวเรือและสัตว์น้ำของเรือตนเอง',
    permissions: pick('dashboard.view', 'vessel.view', 'trip.view', 'trip.edit', 'catch.view', 'catch.create', 'gps.view', 'gps.report', 'employee.view'),
  },
  HR_OFFICER: {
    name: 'เจ้าหน้าที่บุคคล',
    description: 'ข้อมูลพนักงานและเอกสารแรงงาน',
    permissions: pick('dashboard.view', 'employee.', 'employee_doc.manage', 'vessel.view', 'trip.view', 'payroll.view', 'report.view'),
  },
  ACCOUNTANT: {
    name: 'นักบัญชี',
    description: 'การเงิน บัญชี เงินเดือน',
    permissions: pick('dashboard.', 'finance.', 'payroll.', 'sales.view', 'purchase.view', 'fuel.view', 'trip.view', 'catch.view', 'vessel.view', 'report.', 'employee.view'),
  },
  PURCHASING_OFFICER: {
    name: 'เจ้าหน้าที่จัดซื้อ',
    description: 'ใบขอซื้อ ใบสั่งซื้อ ผู้ขาย',
    permissions: pick('dashboard.view', 'purchase.view', 'purchase.create', 'inventory.view', 'inventory.edit', 'fuel.view', 'fuel.edit', 'vessel.view', 'trip.view'),
  },
  WAREHOUSE_OFFICER: {
    name: 'เจ้าหน้าที่คลังสินค้า',
    description: 'รับ-จ่าย-โอนสต็อก',
    permissions: pick('dashboard.view', 'inventory.view', 'inventory.edit', 'purchase.view', 'vessel.view', 'trip.view', 'catch.view'),
  },
  SALES_OFFICER: {
    name: 'เจ้าหน้าที่ขาย',
    description: 'ขายสัตว์น้ำ ลูกค้า',
    permissions: pick('dashboard.view', 'sales.view', 'sales.create', 'catch.view', 'trip.view', 'vessel.view', 'inventory.view'),
  },
  VIEWER: { name: 'ผู้ดูข้อมูล', description: 'ดูอย่างเดียว (ไม่รวมข้อมูลส่วนบุคคล)', permissions: VIEW_ALL },
};

export type RoleCode = keyof typeof ROLE_DEFS;
