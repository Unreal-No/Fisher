import { FISCAL_STATUS_TH, JOURNAL_STATUS_TH, type FiscalStatus, type JournalStatus } from '@fisher/shared';
import { Badge, type Tone } from '@/components/ui/badge';

const J_TONE: Record<JournalStatus, Tone> = { DRAFT: 'neutral', POSTED: 'ok', REVERSED: 'warn', VOID: 'bad' };
const F_TONE: Record<FiscalStatus, Tone> = { OPEN: 'ok', CLOSED: 'navy' };

export const JournalStatusBadge = ({ s }: { s: JournalStatus }) => <Badge tone={J_TONE[s]}>{JOURNAL_STATUS_TH[s]}</Badge>;
export const FiscalStatusBadge = ({ s }: { s: FiscalStatus }) => <Badge tone={F_TONE[s]}>{FISCAL_STATUS_TH[s]}</Badge>;
