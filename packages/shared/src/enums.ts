// Single source of truth for enum values. Must match Prisma enums (apps/api/prisma/schema.prisma).
// Thai labels live in labels.ts.

export const VESSEL_STATUS = ['AT_PORT', 'AT_SEA', 'MAINTENANCE', 'INACTIVE'] as const;
export type VesselStatus = (typeof VESSEL_STATUS)[number];

export const VESSEL_DOC_TYPE = [
  'REGISTRATION',
  'FISHING_LICENSE',
  'PORT_IN_OUT',
  'INSURANCE',
  'SAFETY_CERT',
  'RADIO_LICENSE',
  'OTHER',
] as const;
export type VesselDocType = (typeof VESSEL_DOC_TYPE)[number];

export const EMPLOYEE_STATUS = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUS)[number];

export const EMPLOYEE_POSITION = [
  'CAPTAIN',
  'ENGINEER',
  'DECKHAND',
  'COOK',
  'FISH_HANDLER',
  'OFFICE',
  'MANAGER',
  'OTHER',
] as const;
export type EmployeePosition = (typeof EMPLOYEE_POSITION)[number];

export const GENDER = ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'] as const;
export type Gender = (typeof GENDER)[number];

export const PAY_TYPE = ['MONTHLY', 'DAILY', 'PER_TRIP', 'REVENUE_SHARE', 'CATCH_BASED'] as const;
export type PayType = (typeof PAY_TYPE)[number];

export const DOC_APPLIES_TO = ['ALL', 'THAI', 'FOREIGN'] as const;
export type DocAppliesTo = (typeof DOC_APPLIES_TO)[number];

export const EMP_DOC_STATUS = ['ACTIVE', 'REPLACED', 'CANCELLED'] as const;
export type EmpDocStatus = (typeof EMP_DOC_STATUS)[number];

export const TRIP_STATUS = [
  'DRAFT',
  'PREPARING',
  'DEPARTED',
  'AT_SEA',
  'RETURNING',
  'ARRIVED',
  'PENDING_SETTLEMENT',
  'CLOSED',
  'CANCELLED',
] as const;
export type TripStatus = (typeof TRIP_STATUS)[number];

export const FUEL_TYPE = ['DIESEL', 'DIESEL_B7', 'DIESEL_B10', 'BENZINE', 'OTHER'] as const;
export type FuelType = (typeof FUEL_TYPE)[number];

export const MEASUREMENT = ['MEASURED', 'ESTIMATED'] as const;
export type Measurement = (typeof MEASUREMENT)[number];

export const SUPPLY_CATEGORY = [
  'FOOD',
  'WATER',
  'ICE',
  'NET',
  'ROPE',
  'FISHING_GEAR',
  'SPARE_PART',
  'SAFETY',
  'MAINTENANCE',
  'OTHER',
] as const;
export type SupplyCategory = (typeof SUPPLY_CATEGORY)[number];

export const TRIP_EXPENSE_CATEGORY = ['PORT_FEE', 'ICE', 'FOOD', 'REPAIR', 'LABOR', 'UNLOADING', 'OTHER'] as const;
export type TripExpenseCategory = (typeof TRIP_EXPENSE_CATEGORY)[number];

export const INCIDENT_TYPE = ['ACCIDENT', 'INJURY', 'EQUIPMENT_FAILURE', 'WEATHER', 'LOST_GEAR', 'INSPECTION', 'OTHER'] as const;
export type IncidentType = (typeof INCIDENT_TYPE)[number];

export const SEVERITY = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Severity = (typeof SEVERITY)[number];

export const SPECIES_CATEGORY = ['FISH', 'SQUID', 'SHRIMP', 'CRAB', 'SHELLFISH', 'TRASH_FISH', 'OTHER'] as const;
export type SpeciesCategory = (typeof SPECIES_CATEGORY)[number];

export const STORAGE_TYPE = ['ICE', 'CHILLED', 'FROZEN', 'LIVE', 'DRIED', 'OTHER'] as const;
export type StorageType = (typeof STORAGE_TYPE)[number];

export const CATCH_QUALITY = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;
export type CatchQuality = (typeof CATCH_QUALITY)[number];

export const LOSS_TYPE = ['SPOILAGE', 'DAMAGE', 'WEIGH_DIFF', 'OTHER'] as const;
export type LossType = (typeof LOSS_TYPE)[number];

export const GPS_SOURCE = ['DEDICATED', 'MOBILE', 'AIS'] as const;
export type GpsSource = (typeof GPS_SOURCE)[number];

export const NOTIFICATION_SEVERITY = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITY)[number];

export const FILE_SENSITIVITY = ['INTERNAL', 'CONFIDENTIAL', 'PERSONAL'] as const;
export type FileSensitivity = (typeof FILE_SENSITIVITY)[number];

export const NATIONALITIES = ['TH', 'MM', 'KH', 'LA', 'VN', 'OTHER'] as const;
export type Nationality = (typeof NATIONALITIES)[number];

export const GEOFENCE_TYPE = ['CIRCLE', 'POLYGON'] as const;
export type GeofenceType = (typeof GEOFENCE_TYPE)[number];

export const GEOFENCE_ALERT = ['ENTER', 'EXIT', 'BOTH'] as const;
export type GeofenceAlert = (typeof GEOFENCE_ALERT)[number];

export const FUEL_TXN_TYPE = ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] as const;
export type FuelTxnType = (typeof FUEL_TXN_TYPE)[number];

/** Derived (not stored): GPS connection state of a vessel */
export const GPS_LINK = ['ONLINE', 'LOST', 'NO_DATA'] as const;
export type GpsLink = (typeof GPS_LINK)[number];

export const PR_STATUS = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ORDERED'] as const;
export type PrStatus = (typeof PR_STATUS)[number];

export const PO_STATUS = ['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUS)[number];

export const STOCK_MOVE_TYPE = ['RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT'] as const;
export type StockMoveType = (typeof STOCK_MOVE_TYPE)[number];

export const SALES_STATUS = ['DRAFT', 'CONFIRMED', 'VOID'] as const;
export type SalesStatus = (typeof SALES_STATUS)[number];

export const PAYMENT_METHOD = ['CASH', 'TRANSFER', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

/** Derived from paid/credited vs total */
export const PAYMENT_STATUS = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const MAINT_CATEGORY = ['ENGINE', 'HULL', 'ELECTRICAL', 'HYDRAULIC', 'SAFETY', 'FISHING_GEAR', 'REFRIGERATION', 'DOCKING', 'OTHER'] as const;
export type MaintCategory = (typeof MAINT_CATEGORY)[number];

export const MAINT_TYPE = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION', 'DOCKING'] as const;
export type MaintType = (typeof MAINT_TYPE)[number];

export const MAINT_STATUS = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MaintStatus = (typeof MAINT_STATUS)[number];

export const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITY)[number];

export const ENGINE_HOUR_SOURCE = ['MANUAL', 'TRIP_DEPARTURE', 'TRIP_ARRIVAL', 'MAINTENANCE'] as const;
export type EngineHourSource = (typeof ENGINE_HOUR_SOURCE)[number];

/** Derived */
export const DUE_STATE = ['OK', 'DUE_SOON', 'OVERDUE', 'NO_BASELINE'] as const;
export type DueState = (typeof DUE_STATE)[number];

export const COMP_BASIS = ['GROSS_REVENUE', 'NET_PROFIT', 'CAUGHT_KG', 'SOLD_KG'] as const;
export type CompBasis = (typeof COMP_BASIS)[number];

export const PAYROLL_STATUS = ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUS)[number];

export const ADVANCE_KIND = ['ADVANCE', 'LOAN'] as const;
export type AdvanceKind = (typeof ADVANCE_KIND)[number];

export const ADVANCE_STATUS = ['OPEN', 'SETTLED', 'CANCELLED'] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUS)[number];

export const PAY_ITEM_CODE = [
  'SALARY', 'DAILY_WAGE', 'TRIP_PAY', 'REVENUE_SHARE', 'CATCH_PAY', 'BONUS', 'OTHER_EARNING',
  'ADVANCE_RECOVERY', 'LOAN_REPAYMENT', 'OTHER_DEDUCTION',
] as const;
export type PayItemCode = (typeof PAY_ITEM_CODE)[number];
export const EARNING_CODES: PayItemCode[] = ['SALARY', 'DAILY_WAGE', 'TRIP_PAY', 'REVENUE_SHARE', 'CATCH_PAY', 'BONUS', 'OTHER_EARNING'];
export const ADJUSTMENT_CODES = ['BONUS', 'OTHER_EARNING', 'OTHER_DEDUCTION'] as const;

// ---------- accounting ----------
export const ACCOUNT_TYPE = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPE)[number];
export const NORMAL_BALANCE = ['DEBIT', 'CREDIT'] as const;
export type NormalBalance = (typeof NORMAL_BALANCE)[number];
export const JOURNAL_STATUS = ['DRAFT', 'POSTED', 'REVERSED', 'VOID'] as const;
export type JournalStatus = (typeof JOURNAL_STATUS)[number];
export const FISCAL_STATUS = ['OPEN', 'CLOSED'] as const;
export type FiscalStatus = (typeof FISCAL_STATUS)[number];
/** Keys of the account mapping used by automatic posting. */
export const ACCOUNT_MAP_KEY = [
  'CASH', 'BANK', 'AR', 'EMPLOYEE_ADVANCES', 'INVENTORY', 'FUEL_INVENTORY',
  'GRNI', 'ACCRUED_EXPENSES', 'ACCRUED_WAGES', 'VAT_OUTPUT', 'AP', 'VAT_INPUT', 'WHT_PAYABLE',
  'SALES_REVENUE', 'SALES_RETURNS', 'OTHER_INCOME',
  'FUEL_EXPENSE', 'SUPPLIES_EXPENSE', 'CREW_WAGES', 'TRIP_OTHER_EXPENSE', 'MAINTENANCE_EXPENSE', 'INVENTORY_VARIANCE',
] as const;
export type AccountMapKey = (typeof ACCOUNT_MAP_KEY)[number];
/** Source documents that are posted automatically (sourceType on journal entries). */
export const JOURNAL_SOURCE = [
  'SALES_INVOICE', 'SALES_PAYMENT', 'SALES_RETURN', 'GOODS_RECEIPT', 'STOCK_MOVEMENT', 'FUEL_TXN', 'TRIP_FUEL', 'TRIP_SUPPLY',
  'TRIP_EXPENSE', 'MAINTENANCE_ORDER', 'PAYROLL_PERIOD', 'EMPLOYEE_ADVANCE', 'VENDOR_BILL', 'VENDOR_PAYMENT',
] as const;
export type JournalSource = (typeof JOURNAL_SOURCE)[number];

// ---------- accounts payable / bank ----------
export const VENDOR_BILL_STATUS = ['DRAFT', 'APPROVED', 'VOID'] as const;
export type VendorBillStatus = (typeof VENDOR_BILL_STATUS)[number];
export const BILL_LINE_KIND = ['GR', 'EXPENSE'] as const;
export type BillLineKind = (typeof BILL_LINE_KIND)[number];
export const VENDOR_PAYMENT_STATUS = ['POSTED', 'VOID'] as const;
export type VendorPaymentStatus = (typeof VENDOR_PAYMENT_STATUS)[number];
export const BANK_REC_STATUS = ['DRAFT', 'COMPLETED'] as const;
export type BankRecStatus = (typeof BANK_REC_STATUS)[number];
/** Common Thai withholding tax rates (%) on payments to suppliers. */
export const WHT_RATES = [1, 2, 3, 5] as const;
