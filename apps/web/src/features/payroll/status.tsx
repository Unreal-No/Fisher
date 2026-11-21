import { ADVANCE_STATUS_TH, PAYROLL_STATUS_TH, type AdvanceStatus, type PayrollStatus } from '@fisher/shared';
import { Badge, type Tone } from '@/components/ui/badge';

const PAY_TONE: Record<PayrollStatus, Tone> = { DRAFT: 'neutral', CALCULATED: 'info', APPROVED: 'warn', PAID: 'ok', CANCELLED: 'neutral' };
const ADV_TONE: Record<AdvanceStatus, Tone> = { OPEN: 'warn', SETTLED: 'ok', CANCELLED: 'neutral' };

export const PayrollStatusBadge = ({ s }: { s: PayrollStatus }) => <Badge tone={PAY_TONE[s]}>{PAYROLL_STATUS_TH[s]}</Badge>;
export const AdvanceStatusBadge = ({ s }: { s: AdvanceStatus }) => <Badge tone={ADV_TONE[s]}>{ADVANCE_STATUS_TH[s]}</Badge>;
