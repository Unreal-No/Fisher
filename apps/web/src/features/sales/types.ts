import type { PaymentMethod, PaymentStatus, SalesStatus } from '@fisher/shared';

export interface Customer {
  id: string; code: string; name: string; taxId: string | null; branch: string | null; contactName: string | null; phone: string | null;
  email: string | null; address: string | null; creditTermDays: number | null; isActive: boolean; notes: string | null;
}

export interface Lot {
  lotNo: string; tripId: string; speciesId: string; gradeId: string | null; caughtKg: number; soldKg: number; availableKg: number; sellable: boolean;
  trip: { id: string; tripNo: string; status: string; arrivedAt: string | null; vessel: { code: string; name: string } };
  species: { id: string; code: string; nameTh: string; defaultPrice: string | null };
  grade: { id: string; code: string; nameTh: string } | null;
}

export interface InvoiceRow {
  id: string; orderNo: string; invoiceNo: string | null; status: SalesStatus; invoiceDate: string; dueDate: string | null; total: string;
  paidAmount: string; creditedAmount: string; outstanding: number; paymentStatus: PaymentStatus | null; customer: { code: string; name: string };
}

export interface InvoiceItem {
  id: string; tripId: string; vesselId: string; speciesId: string; gradeId: string | null; description: string | null; weightKg: string; quantity: number | null;
  unitPrice: string; lineTotal: string; discountShare: string; returnedKg: string; returnedAmount: string;
  species: { code: string; nameTh: string }; grade: { code: string; nameTh: string } | null; trip: { id: string; tripNo: string; vessel: { code: string; name: string } };
}
export interface SalesPayment {
  id: string; receiptNo: string; paidAt: string; amount: string; method: PaymentMethod; reference: string | null; notes: string | null;
  voidedAt: string | null; voidReason: string | null;
}
export interface SalesReturn {
  id: string; creditNoteNo: string; returnDate: string; reason: string; amount: string; items: { salesItemId: string; weightKg: string; amount: string }[];
}
export interface Invoice extends InvoiceRow {
  subtotal: string; discount: string; additionalCost: string; vatRate: string; vatAmount: string; notes: string | null; confirmedAt: string | null;
  voidedAt: string | null; voidReason: string | null;
  customer: { id: string; code: string; name: string; taxId: string | null; branch: string | null; address: string | null; phone: string | null };
  items: InvoiceItem[]; payments: SalesPayment[]; returns: SalesReturn[];
}

export interface Receivables {
  totalOutstanding: number | string;
  byCustomer: { customer: { id: string; code: string; name: string }; total: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90p: number; invoices: number }[];
  invoices: { id: string; invoiceNo: string | null; invoiceDate: string; dueDate: string | null; customer: { code?: string; name: string }; total: string | number; outstanding: number; overdueDays: number }[];
}

export type GroupBy = 'species' | 'customer' | 'vessel' | 'trip' | 'month';
export interface SalesReport {
  groupBy: GroupBy; items: { key: string; label: string; weightKg: number; revenue: number; invoices: number; avgPrice: number | null }[]; totalRevenue: number; totalKg: number;
}
