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
