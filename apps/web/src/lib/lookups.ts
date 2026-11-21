// Cached reference lists for selects.
import { useQuery } from '@tanstack/react-query';
import type { Paged } from '@fisher/shared';
import { api } from './api';

export interface VesselLite { id: string; code: string; name: string; status: string; captainId: string | null; homePort: string | null }
export interface EmployeeLite { id: string; code: string; firstName: string; lastName: string; nickname: string | null; position: string; status: string; nationality: string; currentVesselId: string | null; docStatus: string }
export interface Species { id: string; code: string; nameTh: string; nameEn: string | null; scientificName: string | null; category: string; unit: string; defaultPrice: string | null; isActive: boolean; sortOrder: number }
export interface Grade { id: string; code: string; nameTh: string }
export interface DocType { id: string; code: string; nameTh: string; nameEn: string | null; appliesTo: string; isRequired: boolean; requiresExpiry: boolean; isActive: boolean; sortOrder: number }

const STALE = 5 * 60_000;
export const useVessels = (enabled = true) =>
  useQuery({ queryKey: ['vessels', 'lite'], queryFn: () => api.get<Paged<VesselLite>>('/vessels', { all: 'true' }).then((r) => r.items), staleTime: STALE, enabled });
export const useEmployees = (params: Record<string, string> = {}, enabled = true) =>
  useQuery({ queryKey: ['employees', 'lite', params], queryFn: () => api.get<Paged<EmployeeLite>>('/employees', { all: 'true', status: 'ACTIVE', ...params }).then((r) => r.items), staleTime: 60_000, enabled });
export const useSpecies = (activeOnly = false) =>
  useQuery({ queryKey: ['species', activeOnly], queryFn: () => api.get<Species[]>('/catch/species', activeOnly ? { active: 'true' } : {}), staleTime: STALE });
export const useGrades = () => useQuery({ queryKey: ['grades'], queryFn: () => api.get<Grade[]>('/catch/grades'), staleTime: STALE });
export const useDocTypes = () => useQuery({ queryKey: ['document-types'], queryFn: () => api.get<DocType[]>('/document-types'), staleTime: STALE });

export const vesselOptions = (v?: VesselLite[]) => (v ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }));
export const employeeOptions = (e?: EmployeeLite[]) => (e ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.firstName} ${x.lastName}` }));
