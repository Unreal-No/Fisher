import type { TripStatus, VesselStatus } from '@fisher/shared';

export interface Vessel {
  id: string; code: string; name: string; registrationNo: string; vesselType: string; status: VesselStatus;
  lengthM: string | null; widthM: string | null; grossTonnage: string | null; netTonnage: string | null; hullMaterial: string | null;
  buildYear: number | null; homePort: string | null; engineMake: string | null; engineModel: string | null; engineSerialNo: string | null;
  enginePowerHp: string | null; fuelTankCapacityL: string | null; ownerName: string | null; ownerTaxId: string | null; captainId: string | null;
  radioCallSign: string | null; mmsi: string | null; commEquipment: string | null; licenseNo: string | null; licenseExpiry: string | null;
  registrationExpiry: string | null; photoFileId: string | null; notes: string | null; createdAt: string; updatedAt: string;
  captain: { id: string; code: string; firstName: string; lastName: string } | null;
  activeTrip: { id: string; tripNo: string; status: TripStatus } | null;
  crewCount: number;
}
export interface VesselDetail extends Vessel {
  documents: { id: string; docType: string; docNo: string | null; issueDate: string | null; expiryDate: string | null; fileId: string | null; notes: string | null }[];
  crewEmployees: { id: string; code: string; firstName: string; lastName: string; position: string; status: string; nationality: string }[];
  gpsDevices: { id: string; source: string; identifier: string; name: string | null; isActive: boolean; lastSeenAt: string | null }[];
  stats: { tripsByStatus: Record<string, number>; totalCatchKg: string | number; fuelLiters: string | number; fuelCost: string | number };
}
