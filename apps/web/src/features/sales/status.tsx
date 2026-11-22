import { PAYMENT_STATUS_TH, SALES_STATUS_TH, type PaymentStatus, type SalesStatus } from '@fisher/shared';
import { Badge, type Tone } from '@/components/ui/badge';

const S_TONE: Record<SalesStatus, Tone> = { DRAFT: 'neutral', CONFIRMED: 'info', VOID: 'neutral' };
const P_TONE: Record<PaymentStatus, Tone> = { UNPAID: 'warn', PARTIAL: 'info', PAID: 'ok' };

export const SalesBadge = ({ s }: { s: SalesStatus }) => <Badge tone={S_TONE[s]}>{SALES_STATUS_TH[s]}</Badge>;
export const PayBadge = ({ s }: { s: PaymentStatus | null }) => (s ? <Badge tone={P_TONE[s]}>{PAYMENT_STATUS_TH[s]}</Badge> : <span className="text-muted">-</span>);
