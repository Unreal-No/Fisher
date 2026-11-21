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
