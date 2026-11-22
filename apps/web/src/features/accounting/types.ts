import type { AccountMapKey, AccountType, FiscalStatus, JournalSource, JournalStatus, NormalBalance } from '@fisher/shared';

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
