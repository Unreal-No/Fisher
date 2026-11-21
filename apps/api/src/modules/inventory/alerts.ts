// Low-stock reminders (weekly per item+warehouse while below minimum).
import { prisma } from '../../lib/prisma';
import { num } from '../../lib/http';

export async function scanLowStock(now = new Date()) {
  const rows = await prisma.stockBalance.findMany({
    where: { item: { deletedAt: null, isActive: true, minStock: { not: null } }, warehouse: { isActive: true } },
    include: { item: { select: { id: true, code: true, name: true, unit: true, minStock: true } }, warehouse: { select: { id: true, name: true } } },
  });
  const low = rows.filter((r) => num(r.quantity) < num(r.item.minStock));
  if (!low.length) return { low: 0, created: 0 };
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, roles: { some: { role: { permissions: { some: { permission: { code: 'inventory.view' } } } } } } },
    select: { id: true },
  });
  const week = `${now.getUTCFullYear()}-W${Math.ceil(((+now - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400_000 + 1) / 7)}`;
  const res = await prisma.notification.createMany({
    data: low.flatMap((r) =>
      users.map((u) => ({
        userId: u.id, type: 'LOW_STOCK', severity: 'WARNING' as const,
        title: `สินค้าต่ำกว่าจุดสั่งซื้อ: ${r.item.name}`,
        message: `${r.warehouse.name} คงเหลือ ${num(r.quantity)} ${r.item.unit} (ขั้นต่ำ ${num(r.item.minStock)})`,
        link: `/inventory?tab=balances&belowMin=true`, entityType: 'InventoryItem', entityId: r.item.id,
        dedupeKey: `lowstock:${r.warehouse.id}:${r.item.id}:${week}`,
      })),
    ),
    skipDuplicates: true,
  });
  return { low: low.length, created: res.count };
}
