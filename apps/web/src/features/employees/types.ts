import type { EmployeePosition, EmployeeStatus, Gender, PayType, TripStatus } from '@fisher/shared';

export interface Employee {
  id: string; code: string; firstName: string; lastName: string; firstNameEn: string | null; lastNameEn: string | null; nickname: string | null;
  dateOfBirth: string | null; nationality: string; gender: Gender; phone: string | null; address: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; nationalIdNo: string | null; startDate: string; endDate: string | null;
  status: EmployeeStatus; position: EmployeePosition; currentVesselId: string | null; payType: PayType; baseRate: string | null;
  bankName: string | null; bankAccountNo: string | null; photoFileId: string | null; notes: string | null; updatedAt: string;
  currentVessel: { id: string; code: string; name: string } | null;
  docStatus?: 'OK' | 'EXPIRING' | 'EXPIRED' | 'MISSING'; docIssues?: number;
}
export interface EmpDoc {
  id: string; documentTypeId: string; documentNo: string | null; issueDate: string | null; expiryDate: string | null; issuedBy: string | null;
  fileId: string | null; status: 'ACTIVE' | 'REPLACED' | 'CANCELLED'; replacedById: string | null; notes: string | null; createdAt: string;
  documentType: { code: string; nameTh: string; requiresExpiry: boolean };
}
export interface EmployeeDetail extends Employee {
  documents: EmpDoc[];
  checklist: { documentTypeId: string; code: string; nameTh: string; state: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'MISSING' | 'NO_EXPIRY'; expiryDate: string | null }[];
  history: { id: string; eventType: string; effectiveDate: string; fromValue: string | null; toValue: string | null; notes: string | null }[];
  assignments: { id: string; startDate: string; endDate: string | null; position: EmployeePosition; vessel: { id: string; code: string; name: string } }[];
  tripCrew: { id: string; role: EmployeePosition; trip: { id: string; tripNo: string; status: TripStatus; departedAt: string | null; arrivedAt: string | null; vessel: { name: string } } }[];
  user: { id: string; username: string } | null;
}
