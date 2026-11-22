import type { AccountMapKey, AccountType, BankRecStatus, BillLineKind, FiscalStatus, JournalSource, JournalStatus, NormalBalance, PaymentMethod, VendorBillStatus, VendorPaymentStatus } from '@fisher/shared';

export interface Account {
  id: string; code: string; nameTh: string; nameEn: string | null; type: AccountType; normalBalance: NormalBalance; parentId: string | null;
  isPostable: boolean; isActive: boolean; isSystem: boolean; description: string | null; lineCount: number; mappedAs: string[];
}
export interface Mapping { key: AccountMapKey; account: { id: string; code: string; nameTh: string } | null }
export interface FiscalPeriod {
  year: number; month: number; status: FiscalStatus; closedAt: string | null; closedByName: string | null; reopenedAt: string | null; reopenReason: string | null;
  drafts: number; posted: number;
}
export interface Checklist {
  drafts: { id: string; entryNo: string; memo: string }[]; pending: number; pendingByType: Record<string, number>; ok: boolean;
}
export interface JournalRow {
  id: string; entryNo: string; entryDate: string; status: JournalStatus; memo: string; reference: string | null; sourceType: JournalSource | null; sourceRef: string | null;
  totalDebit: string; totalCredit: string;
}
export interface JournalLine {
  lineNo: number; account: { id: string; code: string; nameTh: string }; debit: string; credit: string; description: string | null;
  vessel: { id: string; code: string; name: string } | null; trip: { id: string; tripNo: string } | null;
}
export interface JournalDetail extends JournalRow {
  lines: JournalLine[]; reversalOf: { id: string; entryNo: string } | null; reversedBy: { id: string; entryNo: string } | null;
  createdById: string | null; createdByName: string | null; postedByName: string | null; sourceLink: string | null; sourceId?: string | null;
}
export interface PendingItem { type: JournalSource; id: string; event: string; date: string; ref: string; memo: string; amount: number | string; reversal: boolean }
export interface PendingResult { to: string; total: number; byType: Record<string, number>; items: PendingItem[] }
export interface AutoPostResult { posted: number; byType: Record<string, number>; exceptions: { type: string; id: string; event: string; ref: string; date: string; reason: string }[] }

export interface RepLine { accountId: string; code: string; nameTh: string; amount: number }
export interface TrialBalance {
  items: { accountId: string; code: string; nameTh: string; type: AccountType; normalBalance: NormalBalance; opening: number; debit: number; credit: number; closing: number; balance: number }[];
  totals: { debit: number; credit: number; closingDebit: number; closingCredit: number }; balanced: boolean;
}
export interface ProfitLoss {
  revenue: RepLine[]; expenses: RepLine[]; totalRevenue: number; totalExpense: number; netProfit: number;
  byVessel: { vesselId: string; code: string; name: string; revenue: number; expense: number; profit: number }[];
}
export interface BalanceSheet {
  assets: RepLine[]; liabilities: RepLine[]; equity: RepLine[]; unclosedEarnings: number; totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean;
}
export interface GeneralLedger {
  account: { id: string; code: string; nameTh: string } | null; opening: number; closing: number; totalDebit: number; totalCredit: number;
  items: { entryId: string; entryNo: string; entryDate: string; memo: string; description: string | null; debit: number; credit: number; balance: number; sourceRef: string | null; vesselCode: string | null; tripNo: string | null }[];
  truncated: boolean;
}

// ---------- AP / bank / tax ----------
export interface BillRow {
  id: string; billNo: string; supplierInvoiceNo: string; billDate: string; dueDate: string | null; status: VendorBillStatus;
  subtotal: string; vatRate: string; vatAmount: string; total: string; paidAmount: string; outstanding: string;
  supplier: { id: string; code: string; name: string; taxId: string | null };
}
export interface BillLine {
  lineNo: number; kind: BillLineKind; goodsReceipt: { id: string; grNo: string; poId: string } | null; account: { id: string; code: string; nameTh: string } | null;
  description: string | null; amount: string; vessel: { id: string; code: string; name: string } | null; trip: { id: string; tripNo: string } | null;
}
export interface BillDetail extends BillRow {
  notes?: string | null; createdById: string | null; lines: BillLine[];
  allocations: { amount: string; payment: { id: string; paymentNo: string; paidAt: string; status: VendorPaymentStatus } }[];
}
export interface UnbilledReceipt { id: string; grNo: string; poNo: string; receivedAt: string; supplierInvoiceNo: string | null; amount: string | number }
export interface ApAging {
  asOf: string; total: number;
  items: (AgingBuckets & { supplierId: string; code: string; name: string })[];
}
export interface AgingBuckets { current: number; d30: number; d60: number; d90: number; over90: number; total: number }
export interface PaymentRow {
  id: string; paymentNo: string; paidAt: string; method: PaymentMethod; bankAccount: { id: string; code: string; name: string } | null; reference: string | null;
  grossAmount: string; whtRate: string | null; whtBase: string | null; whtAmount: string; netAmount: string; status: VendorPaymentStatus;
  supplier: { id: string; code: string; name: string };
  allocations: { amount: string; bill: { id: string; billNo: string; supplierInvoiceNo: string } }[];
}
export interface BankAccount {
  id: string; code: string; name: string; bankName: string; accountNo: string; glAccountId: string;
  glAccount: { id: string; code: string; nameTh: string }; isActive: boolean; notes: string | null;
}
export interface BankRecRow {
  id: string; bankAccount: { id: string; code: string; name: string }; statementDate: string; statementBalance: string; status: BankRecStatus; _count: { items: number };
}
export interface BankRecDetail extends BankRecRow {
  notes?: string | null; bankAccount: BankAccount;
  items: { journalLineId: string; entryId: string; entryNo: string; entryDate: string; memo: string; sourceRef: string | null; description: string | null; debit: string | number; credit: string | number; cleared: boolean }[];
  bookBalance: number; clearedBalance: number; difference: number; unclearedTotal: number;
}
export interface VatReport {
  output: { date: string; docNo: string; name: string; taxId: string | null; branch: string | null; base: number; vat: number }[];
  credits: { date: string; docNo: string; refDocNo: string | null; name: string; taxId: string | null; branch: string | null; base: number; vat: number }[];
  input: { date: string; docNo: string; billNo: string; name: string; taxId: string | null; branch: string | null; base: number; vat: number }[];
  exemptSales: number;
  totals: { outputBase: number; outputVat: number; inputBase: number; inputVat: number; netVat: number };
}
export interface WhtRow { date: string; paymentNo: string; name: string; taxId: string | null; branch: string | null; address: string | null; base: number; rate: number; wht: number }
export interface WhtReport {
  pnd3: WhtRow[]; pnd53: WhtRow[]; totals: { pnd3: { count: number; base: number; wht: number }; pnd53: { count: number; base: number; wht: number } }; missingTaxId: number;
}
