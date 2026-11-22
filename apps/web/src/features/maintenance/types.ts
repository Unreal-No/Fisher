import type { DueState, EngineHourSource, MaintCategory, MaintStatus, MaintType, Priority } from '@fisher/shared';

export interface VesselRef { id: string; code: string; name: string }
export interface PlanDue { nextDueDate: string | null; nextDueHours: number | null; daysLeft: number | null; hoursLeft: number | null; state: DueState }
export interface MaintPlan {
  id: string; vesselId: string; name: string; category: MaintCategory; intervalDays: number | null; intervalEngineHours: number | null;
  lastDoneAt: string | null; lastDoneEngineHours: string | null; isActive: boolean; notes: string | null;
  vessel: VesselRef; currentEngineHours: number | null; due: PlanDue;
}
export interface EngineHourLog {
  id: string; recordedAt: string; hours: string; source: EngineHourSource; isReset: boolean; tripId: string | null; orderId: string | null; notes: string | null;
}
export interface MaintOrderRow {
  id: string; orderNo: string; vesselId: string; title: string; category: MaintCategory; type: MaintType; priority: Priority; status: MaintStatus;
  takesOutOfService: boolean; reportedAt: string; startedAt: string | null; completedAt: string | null;
  laborCost: string; externalCost: string; partsCost: string; totalCost: number;
  vessel: VesselRef & { status: string }; provider: { code: string; name: string } | null;
}
export interface MaintPart {
  id: string; moveNo: string; movedAt: string; quantity: string; unitCost: string; totalCost: string;
  item: { code: string; name: string; unit: string }; warehouse: { code: string; name: string };
}
export interface MaintOrder extends MaintOrderRow {
  planId: string | null; engineHours: string | null; providerId: string | null; invoiceNo: string | null; description: string | null; findings: string | null;
  cancelReason: string | null; plan: { id: string; name: string } | null; provider: { id: string; code: string; name: string } | null;
  attachments: { id: string; fileId: string; note: string | null; createdAt: string }[]; parts: MaintPart[];
}
export interface MaintReport {
  groupBy: string; total: string | number;
  items: { key: string; label: string; orders: number; labor: string; external: string; parts: string; total: string }[];
}
export interface ItemLite { id: string; code: string; name: string; unit: string }
export interface WarehouseLite { id: string; code: string; name: string; isActive?: boolean }
export interface ProviderLite { id: string; code: string; name: string }
