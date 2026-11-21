// Stock posting engine: every movement locks its stock_balances row (FOR UPDATE), applies moving-average cost
// and writes an immutable stock_movements row in the caller's transaction.
import { beYear } from '@fisher/shared';
import { AppError, badRequest } from '../../lib/errors';
import { nextSeq, num } from '../../lib/http';
import type { Tx } from '../../lib/prisma';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export interface PostInput {
  type: 'RECEIPT' | 'ISSUE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT';
  warehouseId: string;
  itemId: string;
  /** signed quantity: + in, - out */
  quantity: number;
  /** required for inbound RECEIPT/TRANSFER_IN; outbound uses current average */
  unitCost?: number;
  movedAt: Date;
  refType: 'GR' | 'ISSUE' | 'TRANSFER' | 'ADJUSTMENT' | 'MANUAL';
  refId?: string | null;
  transferPairId?: string | null;
  vesselId?: string | null;
  tripId?: string | null;
  tripSupplyId?: string | null;
  notes?: string | null;
  /** set only after permission + reason were verified by the caller */
  allowNegative?: { reason: string } | null;
  userId: string;
}

/** Lock (and lazily create) the balance row. Call in a stable order when locking several rows. */
export async function lockBalance(tx: Tx, warehouseId: string, itemId: string) {
  await tx.$executeRaw`INSERT INTO stock_balances (warehouse_id, item_id, quantity, avg_cost, updated_at)
    VALUES (${warehouseId}::uuid, ${itemId}::uuid, 0, 0, now()) ON CONFLICT DO NOTHING`;
  const rows = await tx.$queryRaw<{ quantity: string; avg_cost: string }[]>`
    SELECT quantity, avg_cost FROM stock_balances WHERE warehouse_id = ${warehouseId}::uuid AND item_id = ${itemId}::uuid FOR UPDATE`;
  return { qty: num(rows[0]!.quantity), avg: num(rows[0]!.avg_cost) };
}

async function moveNo(tx: Tx) {
  const y = beYear();
  return `STK-${y}-${String(await nextSeq(tx, 'STOCK', String(y))).padStart(6, '0')}`;
}

export async function postMovement(tx: Tx, m: PostInput) {
  if (m.quantity === 0) throw badRequest('จำนวนต้องไม่เป็นศูนย์');
  const [wh, item] = await Promise.all([
    tx.warehouse.findUnique({ where: { id: m.warehouseId } }),
    tx.inventoryItem.findUnique({ where: { id: m.itemId } }),
  ]);
  if (!wh || !wh.isActive) throw badRequest('คลังสินค้าไม่ถูกต้องหรือถูกปิดใช้งาน');
  if (!item || item.deletedAt) throw badRequest('ไม่พบสินค้า');
  const b = await lockBalance(tx, m.warehouseId, m.itemId);
  const newQty = r3(b.qty + m.quantity);
  let unitCost: number;
  let newAvg = b.avg;
  if (m.quantity > 0) {
    unitCost = m.unitCost ?? b.avg;
    // moving average; a non-positive opening balance carries no cost information
    newAvg = b.qty > 0 ? r4((b.qty * b.avg + m.quantity * unitCost) / newQty) : unitCost;
  } else {
    unitCost = b.avg;
    if (newQty < 0 && !m.allowNegative)
      throw new AppError(422, 'INSUFFICIENT_STOCK', `${item.name}: สต็อกในคลัง ${wh.name} ไม่พอ (คงเหลือ ${b.qty} ${item.unit})`, {
        itemId: item.id, warehouseId: wh.id, available: b.qty,
      });
  }
  await tx.stockBalance.update({
    where: { warehouseId_itemId: { warehouseId: m.warehouseId, itemId: m.itemId } },
    data: { quantity: newQty, avgCost: newAvg },
  });
  return tx.stockMovement.create({
    data: {
      moveNo: await moveNo(tx), type: m.type, movedAt: m.movedAt, warehouseId: m.warehouseId, itemId: m.itemId,
      quantity: m.quantity, unitCost, totalCost: r2(m.quantity * unitCost), balanceAfter: newQty, avgCostAfter: newAvg,
      refType: m.refType, refId: m.refId ?? null, transferPairId: m.transferPairId ?? null, vesselId: m.vesselId ?? null,
      tripId: m.tripId ?? null, tripSupplyId: m.tripSupplyId ?? null, overrideReason: m.allowNegative?.reason ?? null,
      notes: m.notes ?? null, createdById: m.userId,
    },
  });
}
