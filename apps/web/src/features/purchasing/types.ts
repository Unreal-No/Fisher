import type { PoStatus, PrStatus, SupplyCategory } from '@fisher/shared';

export interface Supplier {
  id: string; code: string; name: string; taxId: string | null; branch: string | null; contactName: string | null; phone: string | null;
  email: string | null; address: string | null; paymentTermDays: number | null; bankName: string | null; bankAccountNo: string | null;
  isActive: boolean; isIndividual?: boolean; notes: string | null;
}

export interface PrItem { id: string; itemId: string | null; description: string; quantity: string; unit: string; estUnitCost: string | null; notes: string | null }
export interface PurchaseRequest {
  id: string; prNo: string; status: PrStatus; neededBy: string | null; vesselId: string | null; tripId: string | null; notes: string | null;
  requestedById: string; submittedAt: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string;
  items: PrItem[]; _count?: { orders: number }; orders?: { id: string; poNo: string; status: PoStatus }[];
}

export interface PoItem {
  id: string; itemId: string | null; category: SupplyCategory; description: string; quantity: string; unit: string;
  unitPrice: string; lineTotal: string; receivedQty: string;
}
export interface GoodsReceipt {
  id: string; grNo: string; receivedAt: string; supplierInvoiceNo: string | null; notes: string | null; warehouseId: string;
  items: { poItemId: string; quantity: string; unitCost: string; lineTotal: string }[];
}
export interface PurchaseOrderRow {
  id: string; poNo: string; status: PoStatus; orderDate: string; expectedDate: string | null; subtotal: string; discount: string;
  vatRate: string; vatAmount: string; total: string; supplier: { code: string; name: string };
}
export interface PurchaseOrder extends PurchaseOrderRow {
  warehouseId: string; vesselId: string | null; tripId: string | null; notes: string | null; approvedAt: string | null; closedAt: string | null;
  closeReason: string | null; createdById: string; supplier: { id: string; code: string; name: string }; pr: { id: string; prNo: string } | null;
  items: PoItem[]; receipts: GoodsReceipt[];
}

export interface PurchaseSummary {
  bySupplier: { supplierId: string; code: string; name: string; orders: number; total: string; vat: string }[];
  monthly: { month: string; orders: number; total: string }[];
}

export interface ItemLite { id: string; code: string; name: string; unit: string; category: SupplyCategory }
export interface WarehouseLite { id: string; code: string; name: string; isActive: boolean }
