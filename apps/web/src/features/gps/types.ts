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
  analysis?: Analysis;
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

export interface LivePos { vesselId: string; lat: number | string; lng: number | string; speedKnots: number | string | null; headingDeg: number | string | null; recordedAt: string; isDemo: boolean; source: string }
export interface Place { at: string; lat: number; lng: number; place: string | null }
export interface Stop { index: number; from: string; to: string; hours: number; lat: number; lng: number; place: string | null; gap: boolean }
export interface Leg {
  index: number; from: string; to: string; hours: number; km: number; nm: number; avgKnots: number; maxKnots: number;
  fromPlace: string | null; toPlace: string | null; startLat: number; startLng: number; endLat: number; endLng: number;
}
export interface Analysis {
  summary: { start: Place | null; end: Place | null; totalHours: number; days: number; movingHours: number; stoppedHours: number; km: number; nm: number; stops: number; longestStopHours: number };
  stops: Stop[]; legs: Leg[];
}
