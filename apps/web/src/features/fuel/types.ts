import type { FuelTxnType, FuelType, Measurement, TripStatus } from '@fisher/shared';

type VesselRef = { id: string; code: string; name: string };

export interface FuelReport {
  byTrip: {
    tripId: string; tripNo: string; status: TripStatus; vessel: VesselRef; departedAt: string | null; arrivedAt: string | null; days: number | null;
    loadedL: number; consumedL: number | null; isEstimated: boolean; fuelCost: number; catchKg: number; fuelCostPerKg: number | null;
    litersPerKg: number | null; engineHours: number | null; litersPerEngineHour: number | null;
  }[];
  byVessel: { vessel: VesselRef; trips: number; loadedL: number; consumedL: number; consumedTrips: number; fuelCost: number; catchKg: number; isEstimated: boolean; fuelCostPerKg: number | null }[];
  monthly: { month: string; liters: number; cost: number }[];
}

export interface FuelEntry {
  id: string; recordedAt: string; fuelType: FuelType; liters: string; pricePerLiter: string | null; totalCost: string | null; supplierName: string | null;
  measurement: Measurement; notes: string | null; trip: { id: string; tripNo: string; vessel: { code: string; name: string } }; fuelTxn: { txnNo: string } | null;
}

export interface FuelTank {
  id: string; code: string; name: string; location: string | null; fuelType: FuelType; capacityL: string | null; balanceL: string; avgCost: string; isActive: boolean; notes: string | null;
}

export interface FuelTxn {
  id: string; txnNo: string; type: FuelTxnType; txnDate: string; liters: string; unitCost: string | null; totalCost: string | null; balanceAfterL: string; avgCostAfter: string;
  supplierName: string | null; docNo: string | null; measurement: Measurement | null; overrideReason: string | null; notes: string | null;
  tank: { code: string; name: string }; vessel: { code: string; name: string } | null; tripFuel: { trip: { id: string; tripNo: string } } | null;
}
