// API response contracts shared by web & api.
import type { Permission } from './permissions';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; fieldErrors?: Record<string, string[]> };
}

export interface Me {
  id: string;
  username: string;
  fullName: string;
  roles: { code: string; name: string }[];
  permissions: Permission[];
  vesselScope: string[]; // empty = all vessels
  mustChangePassword: boolean;
}

/** Departure crew document check result (per crew member). */
export interface CrewDocIssue {
  employeeId: string;
  employeeName: string;
  documentType: string;
  problem: 'MISSING' | 'EXPIRED' | 'EXPIRING' | 'NOT_ACTIVE' | 'ON_OTHER_TRIP';
  expiryDate?: string | null;
  blocking: boolean;
}

export interface TripSettlement {
  tripId: string;
  days: number | null;
  catchKg: number;
  catchBySpecies: { speciesId: string; nameTh: string; weightKg: number }[];
  lossKg: number;
  fuel: {
    atDepartureL: number | null;
    loadedL: number;
    atArrivalL: number | null;
    consumedL: number | null;
    isEstimated: boolean;
    cost: number;
  };
  engineHours: number | null;
  litersPerEngineHour: number | null;
  suppliesCost: number;
  expenses: number;
  estimatedExpenses: number;
  totalCost: number;
  fuelCostPerKg: number | null;
  costPerKg: number | null;
}
