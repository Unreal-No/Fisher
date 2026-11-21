import type { AdvanceKind, AdvanceStatus, CompBasis, EmployeePosition, PayItemCode, PayrollStatus, PayType, PaymentMethod } from '@fisher/shared';

export interface VesselRef { id: string; code: string; name: string }
export interface EmpRef { id: string; code: string; firstName: string; lastName: string; position: EmployeePosition; nationality: string }

export interface PeriodRow {
  id: string; code: string; name: string; startDate: string; endDate: string; payDate: string | null; vesselId: string | null; vessel: VesselRef | null;
  status: PayrollStatus; totalGross: string; totalDeduction: string; totalNet: string; calculatedAt: string | null; approvedAt: string | null; paidAt: string | null;
  _count: { records: number };
}
export interface PayrollRecordRow {
  id: string; employeeId: string; employee: EmpRef; vessel: VesselRef | null; position: EmployeePosition | null;
  gross: string; deduction: string; net: string; warnings: string[] | null;
}
export interface PayrollAdjustment { id: string; employeeId: string; employee: EmpRef; code: PayItemCode; description: string; amount: string; createdAt: string }
export interface PeriodDetail extends PeriodRow {
  notes: string | null; createdByName: string | null; calculatedByName: string | null; approvedByName: string | null; calculatedById: string | null;
  needsRecalc: boolean; records: PayrollRecordRow[]; adjustments: PayrollAdjustment[];
}
export interface CalcResult { skipped: { employeeId: string; name: string; reason: string }[] }

export interface CompRule {
  id: string; name: string; method: PayType; vesselId: string | null; vessel: VesselRef | null; position: EmployeePosition | null;
  employeeId: string | null; employee: EmpRef | null; rate: string; basis: CompBasis | null; effectiveFrom: string; effectiveTo: string | null; isActive: boolean; notes: string | null;
}
export interface Advance {
  id: string; advanceNo: string; employeeId: string; employee: EmpRef; kind: AdvanceKind; advanceDate: string; amount: string; installment: string | null;
  method: PaymentMethod; reason: string; status: AdvanceStatus; recoveredAmount: string; outstanding: string; cancelReason: string | null;
}
export interface AdvancePage { items: Advance[]; total: number; outstandingTotal: string }

export interface SlipItem { id: string; code: PayItemCode; description: string; quantity: string | null; rate: string | null; amount: string; tripId: string | null; calc: { formula?: string; source?: string } | null }
export interface Slip {
  companyName: string;
  period: PeriodRow;
  record: {
    id: string; gross: string; deduction: string; net: string; warnings: string[] | null; position: EmployeePosition | null; vessel: VesselRef | null;
    employee: { code: string; firstName: string; lastName: string; firstNameEn: string | null; lastNameEn: string | null; position: EmployeePosition; nationality: string; bankName: string | null; bankAccountNo: string | null };
    items: SlipItem[];
  };
  trips: { id: string; tripNo: string }[];
}
export interface EmployeeHistory {
  records: { id: string; gross: string; deduction: string; net: string; period: { id: string; code: string; name: string; startDate: string; endDate: string; status: PayrollStatus } }[];
  advances: Advance[];
}
