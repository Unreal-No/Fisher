import type { TripStatus } from './enums';

/** Allowed manual/workflow transitions. Actions (depart/arrive/close) are validated server-side too. */
export const TRIP_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  DRAFT: ['PREPARING', 'CANCELLED'],
  PREPARING: ['DRAFT', 'DEPARTED', 'CANCELLED'],
  DEPARTED: ['AT_SEA', 'RETURNING', 'ARRIVED'],
  AT_SEA: ['RETURNING', 'ARRIVED'],
  RETURNING: ['AT_SEA', 'ARRIVED'],
  ARRIVED: ['PENDING_SETTLEMENT'],
  PENDING_SETTLEMENT: ['CLOSED', 'ARRIVED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Statuses that occupy a vessel. A vessel may have at most one trip in these (unless explicitly authorised). */
export const ACTIVE_TRIP_STATUSES: TripStatus[] = ['PREPARING', 'DEPARTED', 'AT_SEA', 'RETURNING', 'ARRIVED'];
/** Vessel physically away from port. */
export const AT_SEA_STATUSES: TripStatus[] = ['DEPARTED', 'AT_SEA', 'RETURNING'];
/** Catch may be recorded/adjusted in these statuses. */
export const CATCH_EDITABLE_STATUSES: TripStatus[] = ['DEPARTED', 'AT_SEA', 'RETURNING', 'ARRIVED', 'PENDING_SETTLEMENT'];
/** Plan fields (crew, fuel loaded, supplies) editable before departure. */
export const PLAN_EDITABLE_STATUSES: TripStatus[] = ['DRAFT', 'PREPARING'];
/** Arrival-stage data (expenses, incidents) editable. */
export const ARRIVAL_EDITABLE_STATUSES: TripStatus[] = ['DEPARTED', 'AT_SEA', 'RETURNING', 'ARRIVED', 'PENDING_SETTLEMENT'];

export const canTransition = (from: TripStatus, to: TripStatus) => TRIP_TRANSITIONS[from].includes(to);
export const isActiveTrip = (s: TripStatus) => ACTIVE_TRIP_STATUSES.includes(s);
