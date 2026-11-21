import type { EmployeePosition, FuelType, IncidentType, Measurement, Severity, SupplyCategory, TripExpenseCategory, TripStatus, VesselStatus } from '@fisher/shared';

type Person = { id: string; code: string; firstName: string; lastName: string; nickname: string | null };
export interface TripListItem {
  id: string; tripNo: string; status: TripStatus; departedAt: string | null; arrivedAt: string | null; plannedDepartureAt: string | null;
  createdAt: string; vessel: { id: string; code: string; name: string }; captain: Person | null; crewCount: number; catchKg: number;
}
export interface Trip {
  id: string; tripNo: string; status: TripStatus; version: number; vesselId: string; captainId: string | null;
  plannedDepartureAt: string | null; plannedReturnAt: string | null; fishingArea: string | null; notes: string | null;
  departedAt: string | null; departurePort: string | null; departureLat: string | null; departureLng: string | null;
  fuelAtDepartureL: string | null; fuelAtDepartureMeasurement: Measurement | null; conditionNote: string | null; departureOverrideReason: string | null;
  arrivedAt: string | null; arrivalPort: string | null; arrivalLat: string | null; arrivalLng: string | null;
  fuelAtArrivalL: string | null; fuelAtArrivalMeasurement: Measurement | null;
  allowConcurrent: boolean; concurrentReason: string | null; closedAt: string | null; cancelledAt: string | null; cancelReason: string | null; createdAt: string;
  vessel: { id: string; code: string; name: string; fuelTankCapacityL: string | null; homePort: string | null; status: VesselStatus; licenseExpiry: string | null };
  captain: Person | null;
  crew: { id: string; employeeId: string; role: EmployeePosition; notes: string | null; docCheck: unknown; employee: Person & { nationality: string; position: EmployeePosition; status: string } }[];
  fuel: { id: string; recordedAt: string; fuelType: FuelType; liters: string; pricePerLiter: string | null; totalCost: string | null; supplierName: string | null; measurement: Measurement; fileId: string | null; notes: string | null }[];
  supplies: { id: string; category: SupplyCategory; description: string; quantity: string; unit: string; unitCost: string | null; totalCost: string | null; notes: string | null }[];
  expenses: { id: string; category: TripExpenseCategory; description: string; amount: string; expenseDate: string; isEstimate: boolean; fileId: string | null; notes: string | null }[];
  incidents: { id: string; occurredAt: string; type: IncidentType; severity: Severity; description: string; lat: string | null; lng: string | null }[];
  statusHistory: { id: string; fromStatus: TripStatus | null; toStatus: TripStatus; note: string | null; changedAt: string }[];
}
