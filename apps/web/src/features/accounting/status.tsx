import { BANK_REC_STATUS_TH, FISCAL_STATUS_TH, JOURNAL_STATUS_TH, VENDOR_BILL_STATUS_TH, VENDOR_PAYMENT_STATUS_TH, type BankRecStatus, type FiscalStatus, type JournalStatus, type VendorBillStatus, type VendorPaymentStatus } from '@fisher/shared';
import { Badge, type Tone } from '@/components/ui/badge';

const J_TONE: Record<JournalStatus, Tone> = { DRAFT: 'neutral', POSTED: 'ok', REVERSED: 'warn', VOID: 'bad' };
const F_TONE: Record<FiscalStatus, Tone> = { OPEN: 'ok', CLOSED: 'navy' };

export const JournalStatusBadge = ({ s }: { s: JournalStatus }) => <Badge tone={J_TONE[s]}>{JOURNAL_STATUS_TH[s]}</Badge>;
export const FiscalStatusBadge = ({ s }: { s: FiscalStatus }) => <Badge tone={F_TONE[s]}>{FISCAL_STATUS_TH[s]}</Badge>;

const B_TONE: Record<VendorBillStatus, Tone> = { DRAFT: 'neutral', APPROVED: 'ok', VOID: 'bad' };
const P_TONE: Record<VendorPaymentStatus, Tone> = { POSTED: 'ok', VOID: 'bad' };
const R_TONE: Record<BankRecStatus, Tone> = { DRAFT: 'warn', COMPLETED: 'ok' };
export const BillStatusBadge = ({ s }: { s: VendorBillStatus }) => <Badge tone={B_TONE[s]}>{VENDOR_BILL_STATUS_TH[s]}</Badge>;
export const VPayStatusBadge = ({ s }: { s: VendorPaymentStatus }) => <Badge tone={P_TONE[s]}>{VENDOR_PAYMENT_STATUS_TH[s]}</Badge>;
export const RecStatusBadge = ({ s }: { s: BankRecStatus }) => <Badge tone={R_TONE[s]}>{BANK_REC_STATUS_TH[s]}</Badge>;
