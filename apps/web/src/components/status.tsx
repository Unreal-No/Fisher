import {
  EMPLOYEE_STATUS_TH, TRIP_STATUS_TH, VESSEL_STATUS_TH, daysUntil, formatDate,
  type EmployeeStatus, type TripStatus, type VesselStatus,
} from '@fisher/shared';
import { Badge, type Tone } from './ui/badge';

const tripTone: Record<TripStatus, Tone> = {
  DRAFT: 'neutral', PREPARING: 'info', DEPARTED: 'navy', AT_SEA: 'navy', RETURNING: 'navy',
  ARRIVED: 'warn', PENDING_SETTLEMENT: 'warn', CLOSED: 'ok', CANCELLED: 'neutral',
};
const vesselTone: Record<VesselStatus, Tone> = { AT_PORT: 'ok', AT_SEA: 'navy', MAINTENANCE: 'warn', INACTIVE: 'neutral' };
const empTone: Record<EmployeeStatus, Tone> = { ACTIVE: 'ok', ON_LEAVE: 'info', SUSPENDED: 'warn', RESIGNED: 'neutral', TERMINATED: 'bad' };

export const TripStatusBadge = ({ s }: { s: TripStatus }) => <Badge tone={tripTone[s]}>{TRIP_STATUS_TH[s]}</Badge>;
export const VesselStatusBadge = ({ s }: { s: VesselStatus }) => <Badge tone={vesselTone[s]}>{VESSEL_STATUS_TH[s]}</Badge>;
export const EmployeeStatusBadge = ({ s }: { s: EmployeeStatus }) => <Badge tone={empTone[s]}>{EMPLOYEE_STATUS_TH[s]}</Badge>;

const docTone = { OK: 'ok', VALID: 'ok', NO_EXPIRY: 'ok', EXPIRING: 'warn', EXPIRED: 'bad', MISSING: 'bad' } as const;
const docLabel = { OK: 'ครบถ้วน', VALID: 'ใช้ได้', NO_EXPIRY: 'ไม่มีวันหมดอายุ', EXPIRING: 'ใกล้หมดอายุ', EXPIRED: 'หมดอายุ', MISSING: 'ขาดเอกสาร' } as const;
export const DocStateBadge = ({ s }: { s: keyof typeof docTone }) => <Badge tone={docTone[s]}>{docLabel[s]}</Badge>;

/** Expiry date with remaining-days colour */
export function ExpiryText({ date, warnDays = 30 }: { date?: string | null; warnDays?: number }) {
  if (!date) return <span className="text-muted">-</span>;
  const d = daysUntil(date)!;
  const cls = d < 0 ? 'text-bad font-medium' : d <= warnDays ? 'text-warn font-medium' : '';
  return (
    <span className={cls}>
      {formatDate(date)}
      <span className="ml-1 text-xs text-muted">({d < 0 ? `เกิน ${-d} วัน` : `อีก ${d} วัน`})</span>
    </span>
  );
}
