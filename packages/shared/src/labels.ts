// Thai UI labels for enum values. Keep keys in sync with enums.ts.
import type * as E from './enums';

export const VESSEL_STATUS_TH: Record<E.VesselStatus, string> = {
  AT_PORT: 'จอดท่า',
  AT_SEA: 'ออกทะเล',
  MAINTENANCE: 'ซ่อมบำรุง',
  INACTIVE: 'เลิกใช้งาน',
};

export const VESSEL_DOC_TYPE_TH: Record<E.VesselDocType, string> = {
  REGISTRATION: 'ทะเบียนเรือ',
  FISHING_LICENSE: 'ใบอนุญาตทำการประมง',
  PORT_IN_OUT: 'เอกสารแจ้งเข้า-ออก (PIPO)',
  INSURANCE: 'กรมธรรม์ประกันภัย',
  SAFETY_CERT: 'ใบรับรองความปลอดภัย',
  RADIO_LICENSE: 'ใบอนุญาตวิทยุสื่อสาร',
  OTHER: 'อื่นๆ',
};

export const EMPLOYEE_STATUS_TH: Record<E.EmployeeStatus, string> = {
  ACTIVE: 'ปฏิบัติงาน',
  ON_LEAVE: 'ลางาน',
  SUSPENDED: 'พักงาน',
  RESIGNED: 'ลาออก',
  TERMINATED: 'เลิกจ้าง',
};

export const EMPLOYEE_POSITION_TH: Record<E.EmployeePosition, string> = {
  CAPTAIN: 'ไต้ก๋ง/นายเรือ',
  ENGINEER: 'ช่างเครื่อง',
  DECKHAND: 'ลูกเรือ',
  COOK: 'แม่ครัว/พ่อครัว',
  FISH_HANDLER: 'คัดแยกปลา',
  OFFICE: 'พนักงานสำนักงาน',
  MANAGER: 'ผู้จัดการ',
  OTHER: 'อื่นๆ',
};

export const GENDER_TH: Record<E.Gender, string> = {
  MALE: 'ชาย',
  FEMALE: 'หญิง',
  OTHER: 'อื่นๆ',
  UNSPECIFIED: 'ไม่ระบุ',
};

export const PAY_TYPE_TH: Record<E.PayType, string> = {
  MONTHLY: 'รายเดือน',
  DAILY: 'รายวัน',
  PER_TRIP: 'รายเที่ยว',
  REVENUE_SHARE: 'ส่วนแบ่งรายได้',
  CATCH_BASED: 'ตามปริมาณสัตว์น้ำ',
};

export const DOC_APPLIES_TO_TH: Record<E.DocAppliesTo, string> = {
  ALL: 'ทุกคน',
  THAI: 'คนไทย',
  FOREIGN: 'แรงงานต่างด้าว',
};

export const TRIP_STATUS_TH: Record<E.TripStatus, string> = {
  DRAFT: 'ร่าง',
  PREPARING: 'เตรียมออกเรือ',
  DEPARTED: 'ออกจากท่า',
  AT_SEA: 'อยู่ในทะเล',
  RETURNING: 'กำลังกลับเข้าฝั่ง',
  ARRIVED: 'เข้าท่าแล้ว',
  PENDING_SETTLEMENT: 'รอสรุปเที่ยว',
  CLOSED: 'ปิดเที่ยว',
  CANCELLED: 'ยกเลิก',
};

export const FUEL_TYPE_TH: Record<E.FuelType, string> = {
  DIESEL: 'ดีเซล',
  DIESEL_B7: 'ดีเซล B7',
  DIESEL_B10: 'ดีเซล B10',
  BENZINE: 'เบนซิน',
  OTHER: 'อื่นๆ',
};

export const MEASUREMENT_TH: Record<E.Measurement, string> = { MEASURED: 'วัดจริง', ESTIMATED: 'ประมาณการ' };

export const SUPPLY_CATEGORY_TH: Record<E.SupplyCategory, string> = {
  FOOD: 'อาหาร',
  WATER: 'น้ำดื่ม',
  ICE: 'น้ำแข็ง',
  NET: 'อวน',
  ROPE: 'เชือก',
  FISHING_GEAR: 'อุปกรณ์ประมง',
  SPARE_PART: 'อะไหล่',
  SAFETY: 'อุปกรณ์ความปลอดภัย',
  MAINTENANCE: 'วัสดุซ่อมบำรุง',
  OTHER: 'อื่นๆ',
};

export const TRIP_EXPENSE_CATEGORY_TH: Record<E.TripExpenseCategory, string> = {
  PORT_FEE: 'ค่าท่าเรือ',
  ICE: 'ค่าน้ำแข็ง',
  FOOD: 'ค่าอาหาร',
  REPAIR: 'ค่าซ่อม',
  LABOR: 'ค่าแรงงาน',
  UNLOADING: 'ค่าขนถ่าย',
  OTHER: 'อื่นๆ',
};

export const INCIDENT_TYPE_TH: Record<E.IncidentType, string> = {
  ACCIDENT: 'อุบัติเหตุ',
  INJURY: 'บาดเจ็บ',
  EQUIPMENT_FAILURE: 'อุปกรณ์ขัดข้อง',
  WEATHER: 'สภาพอากาศ',
  LOST_GEAR: 'เครื่องมือสูญหาย',
  INSPECTION: 'ถูกตรวจสอบ',
  OTHER: 'อื่นๆ',
};

export const SEVERITY_TH: Record<E.Severity, string> = { LOW: 'ต่ำ', MEDIUM: 'ปานกลาง', HIGH: 'สูง' };

export const SPECIES_CATEGORY_TH: Record<E.SpeciesCategory, string> = {
  FISH: 'ปลา',
  SQUID: 'หมึก',
  SHRIMP: 'กุ้ง',
  CRAB: 'ปู',
  SHELLFISH: 'หอย',
  TRASH_FISH: 'ปลาเป็ด',
  OTHER: 'อื่นๆ',
};

export const STORAGE_TYPE_TH: Record<E.StorageType, string> = {
  ICE: 'แช่น้ำแข็ง',
  CHILLED: 'แช่เย็น',
  FROZEN: 'แช่แข็ง',
  LIVE: 'มีชีวิต',
  DRIED: 'ตากแห้ง',
  OTHER: 'อื่นๆ',
};

export const CATCH_QUALITY_TH: Record<E.CatchQuality, string> = {
  EXCELLENT: 'ดีมาก',
  GOOD: 'ดี',
  FAIR: 'พอใช้',
  POOR: 'ต่ำ',
};

export const LOSS_TYPE_TH: Record<E.LossType, string> = {
  SPOILAGE: 'เน่าเสีย',
  DAMAGE: 'เสียหาย',
  WEIGH_DIFF: 'ส่วนต่างน้ำหนัก',
  OTHER: 'อื่นๆ',
};

export const NATIONALITY_TH: Record<E.Nationality, string> = {
  TH: 'ไทย',
  MM: 'เมียนมา',
  KH: 'กัมพูชา',
  LA: 'ลาว',
  VN: 'เวียดนาม',
  OTHER: 'อื่นๆ',
};

/** Options helper for <select>. */
export const toOptions = <K extends string>(m: Record<K, string>) =>
  (Object.keys(m) as K[]).map((value) => ({ value, label: m[value] }));

export const GPS_SOURCE_TH: Record<E.GpsSource, string> = { DEDICATED: 'อุปกรณ์ GPS', MOBILE: 'มือถือ', AIS: 'AIS' };
export const GEOFENCE_TYPE_TH: Record<E.GeofenceType, string> = { CIRCLE: 'วงกลม', POLYGON: 'รูปหลายเหลี่ยม' };
export const GEOFENCE_ALERT_TH: Record<E.GeofenceAlert, string> = { ENTER: 'เมื่อเข้าเขต', EXIT: 'เมื่อออกนอกเขต', BOTH: 'ทั้งเข้าและออก' };
export const FUEL_TXN_TYPE_TH: Record<E.FuelTxnType, string> = { RECEIPT: 'รับเข้าถัง', ISSUE: 'จ่ายเข้าเรือ', ADJUSTMENT: 'ปรับยอด' };
export const GPS_LINK_TH: Record<E.GpsLink, string> = { ONLINE: 'ออนไลน์', LOST: 'ขาดสัญญาณ', NO_DATA: 'ไม่มีข้อมูล' };
export const PR_STATUS_TH: Record<E.PrStatus, string> = {
  DRAFT: 'ร่าง', SUBMITTED: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก', ORDERED: 'ออกใบสั่งซื้อแล้ว',
};
export const PO_STATUS_TH: Record<E.PoStatus, string> = {
  DRAFT: 'ร่าง', APPROVED: 'อนุมัติแล้ว', PARTIALLY_RECEIVED: 'รับบางส่วน', RECEIVED: 'รับครบ', CLOSED: 'ปิด', CANCELLED: 'ยกเลิก',
};
export const STOCK_MOVE_TYPE_TH: Record<E.StockMoveType, string> = {
  RECEIPT: 'รับเข้า', ISSUE: 'เบิกจ่าย', TRANSFER_OUT: 'โอนออก', TRANSFER_IN: 'โอนเข้า', ADJUSTMENT: 'ปรับยอด',
};
export const SALES_STATUS_TH: Record<E.SalesStatus, string> = { DRAFT: 'ร่าง (ใบสั่งขาย)', CONFIRMED: 'ออกใบแจ้งหนี้แล้ว', VOID: 'ยกเลิก' };
export const PAYMENT_METHOD_TH: Record<E.PaymentMethod, string> = { CASH: 'เงินสด', TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', OTHER: 'อื่นๆ' };
export const PAYMENT_STATUS_TH: Record<E.PaymentStatus, string> = { UNPAID: 'ยังไม่ชำระ', PARTIAL: 'ชำระบางส่วน', PAID: 'ชำระครบ' };
export const MAINT_CATEGORY_TH: Record<E.MaintCategory, string> = {
  ENGINE: 'เครื่องยนต์', HULL: 'ตัวเรือ', ELECTRICAL: 'ไฟฟ้า', HYDRAULIC: 'ระบบไฮดรอลิก/กว้าน', SAFETY: 'อุปกรณ์ความปลอดภัย',
  FISHING_GEAR: 'เครื่องมือประมง', REFRIGERATION: 'ระบบทำความเย็น/ห้องเย็น', DOCKING: 'ขึ้นคาน', OTHER: 'อื่นๆ',
};
export const MAINT_TYPE_TH: Record<E.MaintType, string> = { PREVENTIVE: 'บำรุงรักษาตามแผน', CORRECTIVE: 'ซ่อมแก้ไข', INSPECTION: 'ตรวจสภาพ', DOCKING: 'ขึ้นคาน' };
export const MAINT_STATUS_TH: Record<E.MaintStatus, string> = { OPEN: 'รอดำเนินการ', IN_PROGRESS: 'กำลังซ่อม', COMPLETED: 'เสร็จแล้ว', CANCELLED: 'ยกเลิก' };
export const PRIORITY_TH: Record<E.Priority, string> = { LOW: 'ต่ำ', MEDIUM: 'ปานกลาง', HIGH: 'สูง', CRITICAL: 'วิกฤต' };
export const ENGINE_HOUR_SOURCE_TH: Record<E.EngineHourSource, string> = { MANUAL: 'บันทึกเอง', TRIP_DEPARTURE: 'ออกเรือ', TRIP_ARRIVAL: 'เข้าท่า', MAINTENANCE: 'ซ่อมบำรุง' };
export const DUE_STATE_TH: Record<E.DueState, string> = { OK: 'ปกติ', DUE_SOON: 'ใกล้ถึงกำหนด', OVERDUE: 'เกินกำหนด', NO_BASELINE: 'ยังไม่มีข้อมูลครั้งล่าสุด' };
export const COMP_BASIS_TH: Record<E.CompBasis, string> = {
  GROSS_REVENUE: 'ยอดขายสุทธิของเที่ยว', NET_PROFIT: 'กำไรขั้นต้นของเที่ยว', CAUGHT_KG: 'น้ำหนักสัตว์น้ำที่จับได้ (กก.)', SOLD_KG: 'น้ำหนักที่ขายได้ (กก.)',
};
export const PAYROLL_STATUS_TH: Record<E.PayrollStatus, string> = { DRAFT: 'ร่าง', CALCULATED: 'คำนวณแล้ว', APPROVED: 'อนุมัติแล้ว', PAID: 'จ่ายแล้ว', CANCELLED: 'ยกเลิก' };
export const ADVANCE_KIND_TH: Record<E.AdvanceKind, string> = { ADVANCE: 'เบิกล่วงหน้า', LOAN: 'เงินกู้ (ผ่อนชำระ)' };
export const ADVANCE_STATUS_TH: Record<E.AdvanceStatus, string> = { OPEN: 'ค้างหัก', SETTLED: 'หักครบแล้ว', CANCELLED: 'ยกเลิก' };
export const PAY_ITEM_CODE_TH: Record<E.PayItemCode, string> = {
  SALARY: 'เงินเดือน', DAILY_WAGE: 'ค่าจ้างรายวัน', TRIP_PAY: 'ค่าจ้างรายเที่ยว', REVENUE_SHARE: 'ส่วนแบ่งรายได้', CATCH_PAY: 'ค่าจ้างตามปริมาณสัตว์น้ำ',
  BONUS: 'โบนัส', OTHER_EARNING: 'รายได้อื่น', ADVANCE_RECOVERY: 'หักเงินเบิกล่วงหน้า', LOAN_REPAYMENT: 'หักผ่อนเงินกู้', OTHER_DEDUCTION: 'รายการหักอื่น',
};
/** Warning codes stored on payroll records (calc engine). */
export const PAYROLL_WARNING_TH: Record<string, string> = {
  RECOVERY_LIMITED: 'หักเงินเบิก/เงินกู้ได้ไม่ครบ เพราะรายได้ในงวดไม่พอ (ยอดค้างยกไปงวดถัดไป)',
  DEDUCTION_OVER_LIMIT: 'ยอดหักเกินร้อยละที่ตั้งไว้ — ตรวจสอบเพดานการหักตาม พ.ร.บ.คุ้มครองแรงงาน ม.76',
  NO_EARNINGS: 'ไม่มีรายได้ในงวดนี้',
};

// ---------- accounting ----------
export const ACCOUNT_TYPE_TH: Record<E.AccountType, string> = { ASSET: 'สินทรัพย์', LIABILITY: 'หนี้สิน', EQUITY: 'ส่วนของเจ้าของ', REVENUE: 'รายได้', EXPENSE: 'ค่าใช้จ่าย' };
export const NORMAL_BALANCE_TH: Record<E.NormalBalance, string> = { DEBIT: 'เดบิต', CREDIT: 'เครดิต' };
export const JOURNAL_STATUS_TH: Record<E.JournalStatus, string> = { DRAFT: 'ร่าง', POSTED: 'ผ่านรายการแล้ว', REVERSED: 'กลับรายการแล้ว', VOID: 'ยกเลิก' };
export const FISCAL_STATUS_TH: Record<E.FiscalStatus, string> = { OPEN: 'เปิด', CLOSED: 'ปิดงวดแล้ว' };
export const ACCOUNT_MAP_KEY_TH: Record<E.AccountMapKey, string> = {
  CASH: 'เงินสด (รับ/จ่ายด้วยเงินสด)', BANK: 'เงินฝากธนาคาร (โอน/เช็ค/อื่นๆ)', AR: 'ลูกหนี้การค้า', EMPLOYEE_ADVANCES: 'เงินยืม/เงินเบิกพนักงาน',
  INVENTORY: 'สินค้าคงเหลือ (วัสดุ/อะไหล่)', FUEL_INVENTORY: 'น้ำมันคงเหลือในถัง', GRNI: 'รับสินค้า/บริการแล้วรอตั้งหนี้',
  ACCRUED_EXPENSES: 'ค่าใช้จ่ายค้างจ่าย', ACCRUED_WAGES: 'ค่าแรงค้างจ่าย', VAT_OUTPUT: 'ภาษีขาย',
  SALES_REVENUE: 'รายได้ขายสัตว์น้ำ', SALES_RETURNS: 'รับคืน/ลดหนี้จากการขาย', OTHER_INCOME: 'รายได้อื่น (ค่าขนส่งเรียกเก็บ/หักพนักงาน)',
  FUEL_EXPENSE: 'ค่าน้ำมันเชื้อเพลิง', SUPPLIES_EXPENSE: 'ค่าเสบียง/วัสดุสิ้นเปลืองเที่ยวเรือ', CREW_WAGES: 'ค่าแรงลูกเรือ/เงินเดือน',
  TRIP_OTHER_EXPENSE: 'ค่าใช้จ่ายเที่ยวเรืออื่น', MAINTENANCE_EXPENSE: 'ค่าซ่อมบำรุงเรือ', INVENTORY_VARIANCE: 'ผลต่างจากการตรวจนับ/ปรับยอด',
};
export const JOURNAL_SOURCE_TH: Record<E.JournalSource, string> = {
  SALES_INVOICE: 'ใบแจ้งหนี้ขาย', SALES_PAYMENT: 'รับชำระ', SALES_RETURN: 'ใบลดหนี้', GOODS_RECEIPT: 'รับสินค้า (ใบสั่งซื้อ)',
  STOCK_MOVEMENT: 'เคลื่อนไหวคลัง', FUEL_TXN: 'ถังน้ำมัน', TRIP_FUEL: 'น้ำมันซื้อตรงเข้าเที่ยว', TRIP_SUPPLY: 'เสบียงซื้อตรงเข้าเที่ยว',
  TRIP_EXPENSE: 'ค่าใช้จ่ายเที่ยวเรือ', MAINTENANCE_ORDER: 'ใบสั่งซ่อม', PAYROLL_PERIOD: 'งวดเงินเดือน', EMPLOYEE_ADVANCE: 'เงินเบิก/เงินกู้',
};
