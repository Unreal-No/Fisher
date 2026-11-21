import { PO_STATUS_TH, PR_STATUS_TH, type PoStatus, type PrStatus } from '@fisher/shared';
import { Badge, type Tone } from '@/components/ui/badge';

const PR_TONE: Record<PrStatus, Tone> = { DRAFT: 'neutral', SUBMITTED: 'warn', APPROVED: 'ok', REJECTED: 'bad', CANCELLED: 'neutral', ORDERED: 'info' };
const PO_TONE: Record<PoStatus, Tone> = { DRAFT: 'neutral', APPROVED: 'info', PARTIALLY_RECEIVED: 'warn', RECEIVED: 'ok', CLOSED: 'neutral', CANCELLED: 'neutral' };

export const PrBadge = ({ s }: { s: PrStatus }) => <Badge tone={PR_TONE[s]}>{PR_STATUS_TH[s]}</Badge>;
export const PoBadge = ({ s }: { s: PoStatus }) => <Badge tone={PO_TONE[s]}>{PO_STATUS_TH[s]}</Badge>;
