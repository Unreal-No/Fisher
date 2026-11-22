import type { StockMoveType, SupplyCategory } from '@fisher/shared';

export interface Warehouse { id: string; code: string; name: string; location: string | null; isActive: boolean; notes: string | null }

export interface InventoryItem {
  id: string; code: string; name: string; category: SupplyCategory; unit: string; minStock: string | null; isActive: boolean; notes: string | null;
  onHand: number; stockValue: number; belowMin: boolean;
}

export interface Balance {
  warehouseId: string; itemId: string; quantity: string; avgCost: string; value: number; belowMin: boolean;
  item: { id: string; code: string; name: string; unit: string; category: SupplyCategory; minStock: string | null };
  warehouse: { id: string; code: string; name: string };
}

export interface BalancesResult { items: Balance[]; totalValue: number }

export interface StockMovement {
  id: string; moveNo: string; type: StockMoveType; movedAt: string; quantity: string; unitCost: string; totalCost: string; balanceAfter: string;
  avgCostAfter: string; refType: string | null; notes: string | null; overrideReason: string | null; tripId: string | null;
  item: { code: string; name: string; unit: string }; warehouse: { code: string; name: string }; vessel: { code: string; name: string } | null;
}
