// Zod schemas shared by web forms (client validation) and API (server validation).
// Convention: blank form values ('' / NaN) become null => PATCH can clear a field; undefined = untouched.
import { z } from 'zod';
import * as E from './enums';

const REQ = 'กรุณากรอกข้อมูล';
const blankToNull = (v: unknown) => (v === '' ? null : v);
/** '' -> null (clear), '1,234.5' -> 1234.5, unparsable text -> NaN (rejected with a Thai message). */
const toNum = (v: unknown) => {
  if (v === '' || v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v; // RHF valueAsNumber on empty input
  const t = String(v).replace(/,/g, '').trim();
  return t === '' ? null : Number(t);
};
const NUM = 'กรุณากรอกตัวเลข';

export const reqStr = (max = 200) => z.string({ error: REQ }).trim().min(1, REQ).max(max, `ไม่เกิน ${max} ตัวอักษร`);
export const optStr = (max = 200) => z.preprocess(blankToNull, z.string().trim().max(max).nullish());
export const optNum = (min = 0, max = 1e12) =>
  z.preprocess(toNum, z.number({ error: NUM }).min(min, `ต้องไม่น้อยกว่า ${min}`).max(max).nullish());
export const reqNum = (min = 0, max = 1e12) =>
  z.preprocess(toNum, z.number({ error: (i) => (i.input === null || i.input === undefined ? REQ : NUM) }).min(min, `ต้องไม่น้อยกว่า ${min}`).max(max));
export const posNum = (max = 1e12) =>
  z.preprocess(toNum, z.number({ error: (i) => (i.input === null || i.input === undefined ? REQ : NUM) }).positive('ต้องมากกว่า 0').max(max));
export const optInt = (min = 0, max = 1e9) =>
  z.preprocess(toNum, z.number({ error: NUM }).int('ต้องเป็นจำนวนเต็ม').min(min).max(max).nullish());

export const isoDate = z.string({ error: REQ }).regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง');
export const optDate = z.preprocess(blankToNull, isoDate.nullish());
export const isoDateTime = z
  .string({ error: REQ })
  .min(1, REQ)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'รูปแบบวันเวลาไม่ถูกต้อง');
export const optDateTime = z.preprocess(blankToNull, isoDateTime.nullish());
export const id = z.uuid('รหัสไม่ถูกต้อง');
export const optId = z.preprocess(blankToNull, id.nullish());
export const lat = optNum(-90, 90);
export const lng = optNum(-180, 180);
const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

// ---------- common ----------
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(50).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListQuery = z.infer<typeof listQuery>;

// ---------- auth / users ----------
export const loginSchema = z.object({ username: reqStr(50), password: z.string().min(1, REQ).max(200) });
export const passwordRule = z
  .string()
  .min(8, 'อย่างน้อย 8 ตัวอักษร')
  .max(128)
  .regex(/[a-z]/, 'ต้องมีตัวพิมพ์เล็ก')
  .regex(/[A-Z]/, 'ต้องมีตัวพิมพ์ใหญ่')
  .regex(/\d/, 'ต้องมีตัวเลข');
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, REQ), newPassword: passwordRule });
export const userCreateSchema = z.object({
  username: reqStr(50).regex(/^[a-z0-9._-]+$/, 'ใช้ a-z 0-9 . _ - เท่านั้น'),
  fullName: reqStr(120),
  email: z.preprocess(blankToNull, z.email('อีเมลไม่ถูกต้อง').nullish()),
  password: passwordRule,
  roleIds: z.array(id).min(1, 'เลือกอย่างน้อย 1 บทบาท'),
  vesselIds: z.array(id).default([]),
  employeeId: optId,
  isActive: z.boolean().default(true),
});
export const userUpdateSchema = userCreateSchema.omit({ password: true, username: true }).partial();
export const resetPasswordSchema = z.object({ newPassword: passwordRule });
export const rolePermissionsSchema = z.object({ permissions: z.array(z.string().max(60)) });

// ---------- vessels ----------
export const vesselSchema = z.object({
  code: optStr(20),
  name: reqStr(120),
  registrationNo: reqStr(50),
  vesselType: reqStr(60),
  lengthM: optNum(0, 500),
  widthM: optNum(0, 100),
  grossTonnage: optNum(0, 100000),
  netTonnage: optNum(0, 100000),
  hullMaterial: optStr(60),
  buildYear: optInt(1900, 2200),
  homePort: optStr(120),
  engineMake: optStr(80),
  engineModel: optStr(80),
  engineSerialNo: optStr(80),
  enginePowerHp: optNum(0, 100000),
  fuelTankCapacityL: optNum(0, 1e7),
  ownerName: optStr(150),
  ownerTaxId: optStr(20),
  captainId: optId,
  radioCallSign: optStr(30),
  mmsi: z.preprocess(blankToNull, z.string().regex(/^\d{9}$/, 'MMSI ต้องเป็นตัวเลข 9 หลัก').nullish()),
  commEquipment: optStr(300),
  licenseNo: optStr(60),
  licenseExpiry: optDate,
  registrationExpiry: optDate,
  status: z.enum(E.VESSEL_STATUS).default('AT_PORT'),
  photoFileId: optId,
  notes: optStr(2000),
});
export type VesselInput = z.input<typeof vesselSchema>;

export const vesselDocSchema = z.object({
  docType: z.enum(E.VESSEL_DOC_TYPE),
  docNo: optStr(80),
  issueDate: optDate,
  expiryDate: optDate,
  fileId: optId,
  notes: optStr(1000),
});

// ---------- employees ----------
export const employeeSchema = z.object({
  code: optStr(20),
  firstName: reqStr(80),
  lastName: reqStr(80),
  firstNameEn: optStr(80),
  lastNameEn: optStr(80),
  nickname: optStr(40),
  dateOfBirth: optDate,
  nationality: z.enum(E.NATIONALITIES),
  gender: z.enum(E.GENDER).default('UNSPECIFIED'),
  phone: optStr(30),
  address: optStr(500),
  emergencyContactName: optStr(120),
  emergencyContactPhone: optStr(30),
  nationalIdNo: optStr(30),
  startDate: isoDate,
  status: z.enum(E.EMPLOYEE_STATUS).default('ACTIVE'),
  position: z.enum(E.EMPLOYEE_POSITION),
  payType: z.enum(E.PAY_TYPE).default('MONTHLY'),
  baseRate: optNum(0, 1e8),
  bankName: optStr(80),
  bankAccountNo: optStr(30),
  photoFileId: optId,
  notes: optStr(2000),
});
export type EmployeeInput = z.input<typeof employeeSchema>;

export const documentTypeSchema = z.object({
  code: reqStr(30).regex(/^[A-Z0-9_]+$/, 'ใช้ A-Z 0-9 _'),
  nameTh: reqStr(120),
  nameEn: optStr(120),
  appliesTo: z.enum(E.DOC_APPLIES_TO),
  isRequired: bool.default(false),
  requiresExpiry: bool.default(true),
  isActive: bool.default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export const employeeDocSchema = z.object({
  documentTypeId: id,
  documentNo: optStr(60),
  issueDate: optDate,
  expiryDate: optDate,
  issuedBy: optStr(120),
  fileId: optId,
  notes: optStr(1000),
});

export const assignVesselSchema = z.object({
  vesselId: optId,
  startDate: isoDate,
  position: z.enum(E.EMPLOYEE_POSITION).optional(),
  notes: optStr(500),
});

// ---------- trips ----------
export const tripCreateSchema = z.object({
  vesselId: id,
  captainId: optId,
  plannedDepartureAt: optDateTime,
  plannedReturnAt: optDateTime,
  departurePort: optStr(120),
  fishingArea: optStr(200),
  notes: optStr(2000),
  allowConcurrent: z.boolean().optional(),
  overrideReason: optStr(500),
});
export const tripUpdateSchema = tripCreateSchema.omit({ vesselId: true, allowConcurrent: true, overrideReason: true }).partial();

export const tripCrewSchema = z.object({
  members: z
    .array(z.object({ employeeId: id, role: z.enum(E.EMPLOYEE_POSITION), notes: optStr(300) }))
    .max(200),
});

export const tripFuelSchema = z.object({
  recordedAt: isoDateTime,
  fuelType: z.enum(E.FUEL_TYPE),
  liters: posNum(1e7),
  pricePerLiter: optNum(0, 1000),
  supplierName: optStr(150),
  measurement: z.enum(E.MEASUREMENT).default('MEASURED'),
  fileId: optId,
  notes: optStr(500),
});

export const tripSupplySchema = z.object({
  category: z.enum(E.SUPPLY_CATEGORY),
  description: reqStr(200),
  quantity: posNum(1e8),
  unit: reqStr(20),
  unitCost: optNum(0, 1e9),
  notes: optStr(500),
});

export const departSchema = z.object({
  departedAt: isoDateTime,
  departurePort: reqStr(120),
  departureLat: lat,
  departureLng: lng,
  fuelAtDepartureL: reqNum(0, 1e7),
  fuelAtDepartureMeasurement: z.enum(E.MEASUREMENT).default('MEASURED'),
  engineHoursAtDeparture: optNum(0, 1e6),
  conditionNote: optStr(2000),
  override: z.boolean().optional(),
  overrideReason: optStr(500),
});

export const tripStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PREPARING', 'AT_SEA', 'RETURNING', 'ARRIVED', 'PENDING_SETTLEMENT']),
  note: optStr(500),
});

export const arriveSchema = z.object({
  arrivedAt: isoDateTime,
  arrivalPort: reqStr(120),
  arrivalLat: lat,
  arrivalLng: lng,
  fuelAtArrivalL: reqNum(0, 1e7),
  fuelAtArrivalMeasurement: z.enum(E.MEASUREMENT).default('MEASURED'),
  engineHoursAtArrival: optNum(0, 1e6),
  notes: optStr(2000),
});

export const tripExpenseSchema = z.object({
  category: z.enum(E.TRIP_EXPENSE_CATEGORY),
  description: reqStr(200),
  amount: posNum(1e10),
  expenseDate: isoDate,
  isEstimate: z.boolean().default(false),
  fileId: optId,
  notes: optStr(500),
});

export const tripIncidentSchema = z.object({
  occurredAt: isoDateTime,
  type: z.enum(E.INCIDENT_TYPE),
  severity: z.enum(E.SEVERITY),
  description: reqStr(2000),
  lat,
  lng,
});

export const reasonSchema = z.object({ reason: reqStr(500) });
export const noteSchema = z.object({ note: optStr(1000) });

// ---------- catch ----------
export const speciesSchema = z.object({
  code: reqStr(20).regex(/^[A-Z0-9_-]+$/, 'ใช้ A-Z 0-9 _ -'),
  nameTh: reqStr(120),
  nameEn: optStr(120),
  scientificName: optStr(150),
  category: z.enum(E.SPECIES_CATEGORY),
  unit: reqStr(20).default('กก.'),
  defaultPrice: optNum(0, 1e7),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export const catchCreateSchema = z.object({
  clientRequestId: z.uuid().optional(),
  tripId: id,
  speciesId: id,
  gradeId: optId,
  catchDate: isoDate,
  weightKg: posNum(1e7),
  quantity: optInt(0),
  basketCount: optInt(0),
  quality: z.preprocess(blankToNull, z.enum(E.CATCH_QUALITY).nullish()),
  storageType: z.enum(E.STORAGE_TYPE).default('ICE'),
  notes: optStr(1000),
});
export type CatchCreateInput = z.input<typeof catchCreateSchema>;

export const catchUpdateSchema = catchCreateSchema
  .omit({ clientRequestId: true, tripId: true })
  .partial()
  .extend({ version: z.number().int(), reason: reqStr(500) });

export const catchLossSchema = z.object({
  tripId: id,
  catchRecordId: optId,
  speciesId: id,
  lossType: z.enum(E.LOSS_TYPE),
  weightKg: posNum(1e7),
  reason: reqStr(500),
  recordedAt: isoDateTime,
});

// ---------- settings ----------
export const settingsSchema = z.object({
  companyName: optStr(200),
  docReminderDays: z.array(z.number().int().min(1).max(365)).min(1).max(10).optional(),
  gpsSignalLostMinutes: z.number().int().min(5).max(1440).optional(),
  maintenanceReminderDays: z.number().int().min(1).max(180).optional(),
  maintenanceReminderHours: z.number().int().min(1).max(5000).optional(),
});

// ---------- GPS ----------
export const gpsPositionSchema = z.object({
  recordedAt: isoDateTime,
  lat: reqNum(-90, 90),
  lng: reqNum(-180, 180),
  speedKnots: optNum(0, 100),
  headingDeg: optNum(0, 360),
  signalQuality: optInt(0, 100),
});
export const gpsIngestSchema = z.object({ positions: z.array(gpsPositionSchema).min(1).max(1000) });
export const gpsMobileSchema = z.object({ vesselId: id, positions: z.array(gpsPositionSchema).min(1).max(200) });
export const gpsDeviceSchema = z.object({
  vesselId: optId,
  source: z.enum(E.GPS_SOURCE),
  identifier: reqStr(80),
  name: optStr(120),
  isActive: z.boolean().default(true),
  notes: optStr(500),
});
const latLng = z.tuple([reqNum(-90, 90), reqNum(-180, 180)]);
export const geofenceSchema = z
  .object({
    name: reqStr(120),
    type: z.enum(E.GEOFENCE_TYPE),
    centerLat: lat,
    centerLng: lng,
    radiusKm: optNum(0.01, 2000),
    polygon: z.array(latLng).min(3, 'อย่างน้อย 3 จุด').max(500).nullish(),
    alertOn: z.enum(E.GEOFENCE_ALERT).default('BOTH'),
    isActive: z.boolean().default(true),
    notes: optStr(500),
  })
  .superRefine((g, ctx) => {
    if (g.type === 'CIRCLE') {
      if (g.centerLat == null) ctx.addIssue({ code: 'custom', path: ['centerLat'], message: REQ });
      if (g.centerLng == null) ctx.addIssue({ code: 'custom', path: ['centerLng'], message: REQ });
      if (g.radiusKm == null) ctx.addIssue({ code: 'custom', path: ['radiusKm'], message: REQ });
    } else if (!g.polygon) ctx.addIssue({ code: 'custom', path: ['polygon'], message: 'อย่างน้อย 3 จุด' });
  });
export const gpsDemoSchema = z.object({ vesselId: id, hours: z.coerce.number().int().min(1).max(72).default(24) });

// ---------- fuel ----------
export const fuelTankSchema = z.object({
  code: reqStr(20),
  name: reqStr(120),
  location: optStr(200),
  fuelType: z.enum(E.FUEL_TYPE),
  capacityL: optNum(0, 1e8),
  isActive: z.boolean().default(true),
  notes: optStr(500),
});
export const fuelReceiptSchema = z.object({
  tankId: id,
  txnDate: isoDateTime,
  liters: posNum(1e8),
  unitPrice: reqNum(0, 1000),
  supplierName: optStr(150),
  docNo: optStr(60),
  fileId: optId,
  notes: optStr(500),
});
export const fuelIssueSchema = z.object({
  tankId: id,
  txnDate: isoDateTime,
  liters: posNum(1e8),
  vesselId: id,
  tripId: optId,
  measurement: z.enum(E.MEASUREMENT).default('MEASURED'),
  notes: optStr(500),
  override: z.boolean().optional(),
  overrideReason: optStr(500),
});
export const fuelAdjustSchema = z.object({
  tankId: id,
  txnDate: isoDateTime,
  measuredBalanceL: reqNum(0, 1e8),
  reason: reqStr(500),
});

// ---------- suppliers / inventory ----------
export const supplierSchema = z.object({
  code: optStr(20),
  name: reqStr(200),
  taxId: z.preprocess(blankToNull, z.string().regex(/^\d{13}$/, 'เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก').nullish()),
  branch: optStr(60),
  contactName: optStr(120),
  phone: optStr(40),
  email: z.preprocess(blankToNull, z.email('อีเมลไม่ถูกต้อง').nullish()),
  address: optStr(500),
  paymentTermDays: optInt(0, 365),
  bankName: optStr(80),
  bankAccountNo: optStr(30),
  isActive: z.boolean().default(true),
  notes: optStr(1000),
});
export const warehouseSchema = z.object({
  code: reqStr(20),
  name: reqStr(120),
  location: optStr(200),
  isActive: z.boolean().default(true),
  notes: optStr(500),
});
export const inventoryItemSchema = z.object({
  code: optStr(30),
  name: reqStr(200),
  category: z.enum(E.SUPPLY_CATEGORY),
  unit: reqStr(20),
  minStock: optNum(0, 1e9),
  isActive: z.boolean().default(true),
  notes: optStr(500),
});
const qty = posNum(1e9);
export const stockReceiptSchema = z.object({
  warehouseId: id, itemId: id, quantity: qty, unitCost: reqNum(0, 1e9), movedAt: isoDateTime, notes: reqStr(500),
});
export const stockIssueSchema = z.object({
  warehouseId: id, itemId: id, quantity: qty, movedAt: isoDateTime, vesselId: id, tripId: optId, notes: optStr(500),
  override: z.boolean().optional(), overrideReason: optStr(500),
});
export const stockTransferSchema = z
  .object({ fromWarehouseId: id, toWarehouseId: id, itemId: id, quantity: qty, movedAt: isoDateTime, notes: optStr(500) })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, { path: ['toWarehouseId'], message: 'คลังปลายทางต้องไม่ซ้ำคลังต้นทาง' });
export const stockAdjustSchema = z.object({
  warehouseId: id, itemId: id, countedQty: reqNum(0, 1e9), movedAt: isoDateTime, reason: reqStr(500),
});

// ---------- purchasing ----------
const prLine = z.object({
  itemId: optId,
  description: reqStr(200),
  quantity: qty,
  unit: reqStr(20),
  estUnitCost: optNum(0, 1e9),
  notes: optStr(300),
});
export const purchaseRequestSchema = z.object({
  neededBy: optDate,
  vesselId: optId,
  tripId: optId,
  notes: optStr(1000),
  items: z.array(prLine).min(1, 'เพิ่มรายการอย่างน้อย 1 รายการ').max(200),
});
const poLine = z.object({
  itemId: optId,
  category: z.enum(E.SUPPLY_CATEGORY).default('OTHER'),
  description: reqStr(200),
  quantity: qty,
  unit: reqStr(20),
  unitPrice: reqNum(0, 1e9),
});
export const purchaseOrderSchema = z.object({
  supplierId: id,
  prId: optId,
  orderDate: isoDate,
  expectedDate: optDate,
  warehouseId: id,
  vesselId: optId,
  tripId: optId,
  discount: optNum(0, 1e10),
  vatRate: z.preprocess((v) => (v === '' || v == null ? 7 : Number(v)), z.number().min(0).max(20)),
  notes: optStr(1000),
  items: z.array(poLine).min(1, 'เพิ่มรายการอย่างน้อย 1 รายการ').max(200),
});
export const goodsReceiptSchema = z.object({
  receivedAt: isoDateTime,
  warehouseId: optId,
  supplierInvoiceNo: optStr(60),
  fileId: optId,
  notes: optStr(1000),
  lines: z.array(z.object({ poItemId: id, quantity: qty })).min(1, 'ระบุจำนวนที่รับอย่างน้อย 1 รายการ'),
});

// ---------- sales ----------
export const customerSchema = z.object({
  code: optStr(20),
  name: reqStr(200),
  taxId: z.preprocess(blankToNull, z.string().regex(/^\d{13}$/, 'เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก').nullish()),
  branch: optStr(60),
  contactName: optStr(120),
  phone: optStr(40),
  email: z.preprocess(blankToNull, z.email('อีเมลไม่ถูกต้อง').nullish()),
  address: optStr(500),
  creditTermDays: optInt(0, 365),
  isActive: z.boolean().default(true),
  notes: optStr(1000),
});
const saleLine = z.object({
  tripId: id,
  speciesId: id,
  gradeId: optId,
  description: optStr(200),
  weightKg: posNum(1e7),
  quantity: optInt(0),
  unitPrice: reqNum(0, 1e7),
});
export const salesInvoiceSchema = z.object({
  customerId: id,
  invoiceDate: isoDate,
  dueDate: optDate,
  discount: optNum(0, 1e10),
  additionalCost: optNum(0, 1e10),
  vatRate: z.preprocess((v) => (v === '' || v == null ? 0 : Number(v)), z.number().min(0).max(20)),
  notes: optStr(1000),
  items: z.array(saleLine).min(1, 'เพิ่มรายการอย่างน้อย 1 รายการ').max(300),
});
export const salesPaymentSchema = z.object({
  paidAt: isoDateTime,
  amount: posNum(1e10),
  method: z.enum(E.PAYMENT_METHOD),
  reference: optStr(100),
  notes: optStr(500),
});
export const salesReturnSchema = z.object({
  returnDate: isoDate,
  reason: reqStr(500),
  items: z.array(z.object({ salesItemId: id, weightKg: posNum(1e7), amount: posNum(1e10) })).min(1, 'ระบุรายการคืนอย่างน้อย 1 รายการ'),
});

// ---------- maintenance ----------
export const maintenancePlanSchema = z
  .object({
    vesselId: id,
    name: reqStr(150),
    category: z.enum(E.MAINT_CATEGORY),
    intervalDays: optInt(1, 3650),
    intervalEngineHours: optInt(1, 100000),
    lastDoneAt: optDate,
    lastDoneEngineHours: optNum(0, 1e6),
    isActive: z.boolean().default(true),
    notes: optStr(1000),
  })
  .refine((p) => p.intervalDays != null || p.intervalEngineHours != null, { path: ['intervalDays'], message: 'กำหนดรอบเป็นวันหรือชั่วโมงเครื่องอย่างน้อยหนึ่งอย่าง' });
export const engineHourSchema = z.object({
  vesselId: id,
  recordedAt: isoDateTime,
  hours: reqNum(0, 1e6),
  isReset: z.boolean().default(false),
  notes: optStr(500),
});
export const maintenanceOrderSchema = z.object({
  vesselId: id,
  planId: optId,
  title: reqStr(200),
  category: z.enum(E.MAINT_CATEGORY),
  type: z.enum(E.MAINT_TYPE),
  priority: z.enum(E.PRIORITY).default('MEDIUM'),
  reportedAt: isoDateTime,
  takesOutOfService: z.boolean().default(false),
  providerId: optId,
  description: optStr(2000),
});
export const maintenanceCompleteSchema = z.object({
  completedAt: isoDateTime,
  engineHours: optNum(0, 1e6),
  findings: optStr(2000),
  laborCost: optNum(0, 1e10),
  externalCost: optNum(0, 1e10),
  providerId: optId,
  invoiceNo: optStr(60),
});
export const maintenancePartSchema = z.object({ warehouseId: id, itemId: id, quantity: posNum(1e9), notes: optStr(300) });
export const attachmentSchema = z.object({ fileId: id, note: optStr(300) });

// ---------- payroll ----------
export const compensationRuleSchema = z
  .object({
    name: reqStr(150),
    method: z.enum(E.PAY_TYPE),
    vesselId: optId,
    position: z.preprocess(blankToNull, z.enum(E.EMPLOYEE_POSITION).nullish()),
    employeeId: optId,
    rate: optNum(0, 1e9),
    basis: z.preprocess(blankToNull, z.enum(E.COMP_BASIS).nullish()),
    effectiveFrom: isoDate,
    effectiveTo: optDate,
    isActive: z.boolean().default(true),
    notes: optStr(1000),
  })
  .superRefine((r, ctx) => {
    if (r.rate == null) ctx.addIssue({ code: 'custom', path: ['rate'], message: REQ });
    if (r.method === 'REVENUE_SHARE' && !(r.basis === 'GROSS_REVENUE' || r.basis === 'NET_PROFIT'))
      ctx.addIssue({ code: 'custom', path: ['basis'], message: 'ส่วนแบ่งรายได้ต้องเลือกฐานเป็นยอดขายหรือกำไร' });
    if (r.method === 'REVENUE_SHARE' && r.rate != null && r.rate > 100) ctx.addIssue({ code: 'custom', path: ['rate'], message: 'เปอร์เซ็นต์ต้องไม่เกิน 100' });
    if (r.method === 'CATCH_BASED' && !(r.basis === 'CAUGHT_KG' || r.basis === 'SOLD_KG'))
      ctx.addIssue({ code: 'custom', path: ['basis'], message: 'ค่าจ้างตามปริมาณต้องเลือกฐานเป็นน้ำหนักจับหรือขาย' });
    if (r.effectiveTo && r.effectiveTo < r.effectiveFrom) ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'วันสิ้นสุดต้องหลังวันเริ่ม' });
  });
export const advanceSchema = z
  .object({
    employeeId: id,
    kind: z.enum(E.ADVANCE_KIND),
    advanceDate: isoDate,
    amount: posNum(1e8),
    installment: optNum(0.01, 1e8),
    method: z.enum(E.PAYMENT_METHOD).default('CASH'),
    reason: reqStr(500),
  })
  .refine((a) => a.kind === 'ADVANCE' || a.installment != null, { path: ['installment'], message: 'เงินกู้ต้องกำหนดยอดผ่อนต่องวด' });
export const payrollPeriodSchema = z
  .object({
    name: reqStr(120),
    startDate: isoDate,
    endDate: isoDate,
    payDate: optDate,
    vesselId: optId,
    notes: optStr(1000),
  })
  .refine((p) => p.endDate >= p.startDate, { path: ['endDate'], message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' });
export const payrollAdjustmentSchema = z.object({
  employeeId: id,
  code: z.enum(E.ADJUSTMENT_CODES),
  description: reqStr(200),
  amount: posNum(1e8),
});
export const payrollPaySchema = z.object({
  paidAt: isoDateTime,
  method: z.enum(E.PAYMENT_METHOD),
  reference: optStr(100),
});
