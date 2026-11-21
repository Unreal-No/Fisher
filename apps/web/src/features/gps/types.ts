import type { GpsLink, TripStatus, VesselStatus } from '@fisher/shared';

export interface Pos { lat: string; lng: string; speedKnots: string | null; headingDeg: string | null; recordedAt: string; source: string; isDemo: boolean }
export interface FleetVessel {
  id: string; code: string; name: string; status: VesselStatus; link: GpsLink;
  activeTrip: { id: string; tripNo: string; status: TripStatus } | null;
  position: Pos | null;
  gpsDevices: { id: string; source: string; identifier: string; lastSeenAt: string | null }[];
}
export interface Fleet { signalLostMinutes: number; vessels: FleetVessel[] }
export interface Track {
  total: number; sampledEvery: number;
  points: Pos[];
  trips: { id: string; tripNo: string; departedAt: string | null; departureLat: string | null; departureLng: string | null; departurePort: string | null; arrivedAt: string | null; arrivalLat: string | null; arrivalLng: string | null; arrivalPort: string | null }[];
  events: { id: string; eventType: 'ENTER' | 'EXIT'; at: string; lat: string; lng: string; isDemo: boolean; geofence: { name: string } }[];
}
export interface Geofence {
  id: string; name: string; type: 'CIRCLE' | 'POLYGON'; centerLat: string | null; centerLng: string | null; radiusKm: string | null;
  polygon: [number, number][] | null; alertOn: 'ENTER' | 'EXIT' | 'BOTH'; isActive: boolean; notes: string | null;
}
export interface Device {
  id: string; vesselId: string | null; source: 'DEDICATED' | 'MOBILE' | 'AIS'; identifier: string; name: string | null; isActive: boolean;
  lastSeenAt: string | null; notes: string | null; vessel: { code: string; name: string } | null;
}
