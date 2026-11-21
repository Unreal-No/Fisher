import { DUE_STATE_TH, MAINT_STATUS_TH, PRIORITY_TH, type DueState, type MaintStatus, type Priority } from '@fisher/shared';
import { Badge, type Tone } from '@/components/ui/badge';

const STATUS_TONE: Record<MaintStatus, Tone> = { OPEN: 'warn', IN_PROGRESS: 'info', COMPLETED: 'ok', CANCELLED: 'neutral' };
const PRIORITY_TONE: Record<Priority, Tone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warn', CRITICAL: 'bad' };
const DUE_TONE: Record<DueState, Tone> = { OK: 'ok', DUE_SOON: 'warn', OVERDUE: 'bad', NO_BASELINE: 'neutral' };

export const MaintStatusBadge = ({ s }: { s: MaintStatus }) => <Badge tone={STATUS_TONE[s]}>{MAINT_STATUS_TH[s]}</Badge>;
export const PriorityBadge = ({ p }: { p: Priority }) => <Badge tone={PRIORITY_TONE[p]}>{PRIORITY_TH[p]}</Badge>;
export const DueBadge = ({ s }: { s: DueState }) => <Badge tone={DUE_TONE[s]}>{DUE_STATE_TH[s]}</Badge>;
