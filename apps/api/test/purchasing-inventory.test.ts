import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanLowStock } from '../src/modules/inventory/alerts';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let buyer: Agent;
let manager: Agent;
let wh1: string;
let wh2: string;
let rope: string;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('buyer', 'PURCHASING_OFFICER');
  await createUser('mgr', 'OPERATIONS_MANAGER');
  admin = await login(app, 'admin');
  buyer = await login(app, 'buyer');
  manager = await login(app, 'mgr');
  wh1 = (await admin.post('/inventory/warehouses', { code: 'WH1', name: 'คลังหลัก' })).body.id;
  wh2 = (await admin.post('/inventory/warehouses', { code: 'WH2', name: 'คลังท่าเรือ' })).body.id;
  rope = (await admin.post('/inventory/items', { name: 'เชือก PE 12 มม.', category: 'ROPE', unit: 'ม้วน', minStock: 20 })).body.id;
});
afterAll(() => app.close());

const bal = async (w: string, i: string) => prisma.stockBalance.findUnique({ where: { warehouseId_itemId: { warehouseId: w, itemId: i } } });

describe('stock ledger', () => {
  it('moving average, issue to trip, negative block/override, transfer, adjustment, immutability', async () => {
    const item = (await admin.get(`/inventory/items/${rope}`)).body;
    expect(item.code).toMatch(/^ITM-\d{5}$/);
    await admin.post('/inventory/receipts', { warehouseId: wh1, itemId: rope, quantity: 10, unitCost: 100, movedAt: ago(10), notes: 'ยอดยกมา' });
    await admin.post('/inventory/receipts', { warehouseId: wh1, itemId: rope, quantity: 30, unitCost: 120, movedAt: ago(9), notes: 'รับเพิ่ม' });
    let b = await bal(wh1, rope);
    expect(Number(b!.quantity)).toBe(40);
    expect(Number(b!.avgCost)).toBe(115);

    const f = await fixtures(admin);
    const trip = await departedTrip(admin, f);
    const iss = await admin.post('/inventory/issues', { warehouseId: wh1, itemId: rope, quantity: 4, movedAt: ago(8), vesselId: f.vessel.id, tripId: trip.id });
    expect(iss.status).toBe(201);
    expect(iss.body.totalCost).toBe('-460');
    const ts = await prisma.tripSupply.findFirstOrThrow({ where: { tripId: trip.id, stockMove: { isNot: null } } });
    expect(Number(ts.totalCost)).toBe(460);
    expect((await admin.del(`/trips/${trip.id}/supplies/${ts.id}`)).status).toBe(409);
    expect((await admin.get(`/trips/${trip.id}/settlement`)).body.suppliesCost).toBe(460);

    const over = await admin.post('/inventory/issues', { warehouseId: wh1, itemId: rope, quantity: 100, movedAt: ago(7), vesselId: f.vessel.id });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await buyer.post('/inventory/issues', { warehouseId: wh1, itemId: rope, quantity: 100, movedAt: ago(7), vesselId: f.vessel.id, override: true, overrideReason: 'x' })).status).toBe(403);

    const tr = await admin.post('/inventory/transfers', { fromWarehouseId: wh1, toWarehouseId: wh2, itemId: rope, quantity: 6, movedAt: ago(6) });
    expect(tr.status).toBe(201);
    expect(tr.body.out.transferPairId).toBe(tr.body.in.transferPairId);
    expect(Number((await bal(wh2, rope))!.avgCost)).toBe(115);
    expect((await admin.post('/inventory/transfers', { fromWarehouseId: wh1, toWarehouseId: wh1, itemId: rope, quantity: 1, movedAt: ago(6) })).status).toBe(400);

    const adj = await admin.post('/inventory/adjustments', { warehouseId: wh1, itemId: rope, countedQty: 29, movedAt: ago(5), reason: 'ตรวจนับประจำเดือน' });
    expect(Number(adj.body.quantity)).toBe(-1);
    b = await bal(wh1, rope);
    expect(Number(b!.quantity)).toBe(29);
    expect((await admin.post('/inventory/adjustments', { warehouseId: wh1, itemId: rope, countedQty: 29, movedAt: ago(5), reason: 'x' })).status).toBe(409);
    await expect(prisma.stockMovement.deleteMany({ where: { itemId: rope } })).rejects.toThrow();

    const low = await scanLowStock();
    expect(low.low).toBe(1); // WH2 has 6 < 20; WH1 29 >= 20
    expect((await scanLowStock()).created).toBe(0);
    const balances = (await admin.get('/inventory/balances?belowMin=true')).body;
    expect(balances.items).toHaveLength(1);
  });
});

describe('purchasing workflow', () => {
  it('PR → approval (segregated) → PO → partial/complete receipt → stock + trip costs', async () => {
    const sup = await buyer.post('/purchasing/suppliers', { name: 'ร้านอุปกรณ์ประมงสงขลา', taxId: '0905555000123', paymentTermDays: 30 });
    expect(sup.status).toBe(201);
    expect(sup.body.code).toMatch(/^SUP-\d{4}$/);
    expect((await buyer.post('/purchasing/suppliers', { name: 'x', taxId: '123' })).status).toBe(400);

    const pr = (await buyer.post('/purchasing/requests', { notes: 'เตรียมเที่ยวหน้า', items: [{ itemId: rope, description: 'เชือก PE', quantity: 50, unit: 'ม้วน', estUnitCost: 120 }] })).body;
    expect(pr.prNo).toMatch(/^PR-\d{4}-\d{4}$/);
    expect((await manager.post(`/purchasing/requests/${pr.id}/approve`)).status).toBe(409); // not submitted
    await buyer.post(`/purchasing/requests/${pr.id}/submit`);
    expect((await buyer.post(`/purchasing/requests/${pr.id}/approve`)).status).toBe(403); // no permission
    expect((await manager.post(`/purchasing/requests/${pr.id}/approve`, { note: 'ok' })).body.status).toBe('APPROVED');

    const f = await fixtures(admin);
    const trip = await departedTrip(admin, f);
    const po = await buyer.post('/purchasing/orders', {
      supplierId: sup.body.id, prId: pr.id, orderDate: iso(0), warehouseId: wh1, vesselId: f.vessel.id, tripId: trip.id, discount: 600, vatRate: 7,
      items: [
        { itemId: rope, description: 'เชือก PE', quantity: 50, unit: 'ม้วน', unitPrice: 120 },
        { category: 'ICE', description: 'น้ำแข็งซอง ส่งที่เรือ', quantity: 100, unit: 'ซอง', unitPrice: 40 },
      ],
    });
    expect(po.status).toBe(201);
    // subtotal 6000 + 4000 = 10000; discount 600; VAT 7% of 9400 = 658; total 10058
    expect(po.body).toMatchObject({ subtotal: '10000', discount: '600', vatAmount: '658', total: '10058', status: 'DRAFT' });
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe('ORDERED');

    // cannot receive before approval; creator cannot approve own PO
    const rope1 = po.body.items.find((i: { itemId: string | null }) => i.itemId === rope);
    const ice = po.body.items.find((i: { itemId: string | null }) => !i.itemId);
    expect((await admin.post(`/purchasing/orders/${po.body.id}/receive`, { receivedAt: ago(1), lines: [{ poItemId: rope1.id, quantity: 1 }] })).status).toBe(409);
    expect((await manager.post(`/purchasing/orders/${po.body.id}/approve`)).body.status).toBe('APPROVED');

    const before = Number((await bal(wh1, rope))!.quantity);
    const gr1 = await admin.post(`/purchasing/orders/${po.body.id}/receive`, { receivedAt: ago(1), supplierInvoiceNo: 'INV-001', lines: [{ poItemId: rope1.id, quantity: 20 }, { poItemId: ice.id, quantity: 100 }] });
    expect(gr1.status).toBe(201);
    expect(gr1.body.grNo).toMatch(/^GR-\d{4}-\d{4}$/);
    // net unit cost = price * (1 - 600/10000) = 120 * 0.94 = 112.8 (VAT excluded)
    expect(Number(gr1.body.items.find((i: { poItemId: string }) => i.poItemId === rope1.id).unitCost)).toBe(112.8);
    expect(Number((await bal(wh1, rope))!.quantity)).toBe(before + 20);
    const iceSupply = await prisma.tripSupply.findFirstOrThrow({ where: { tripId: trip.id, category: 'ICE' } });
    expect(Number(iceSupply.totalCost)).toBe(3760); // 100 * 40 * 0.94
    expect((await admin.del(`/trips/${trip.id}/supplies/${iceSupply.id}`)).status).toBe(409);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.body.id } })).status).toBe('PARTIALLY_RECEIVED');

    const overR = await admin.post(`/purchasing/orders/${po.body.id}/receive`, { receivedAt: ago(0.5), lines: [{ poItemId: rope1.id, quantity: 31 }] });
    expect(overR.status).toBe(409);
    expect(overR.body.error.code).toBe('OVER_RECEIPT');
    expect((await buyer.post(`/purchasing/orders/${po.body.id}/cancel`, { reason: 'x' })).status).toBe(409); // has receipts

    await admin.post(`/purchasing/orders/${po.body.id}/receive`, { receivedAt: ago(0.5), lines: [{ poItemId: rope1.id, quantity: 30 }] });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.body.id } })).status).toBe('RECEIVED');
    const detail = (await admin.get(`/purchasing/orders/${po.body.id}`)).body;
    expect(detail.receipts).toHaveLength(2);

    const sum = (await admin.get('/purchasing/summary')).body;
    expect(sum.bySupplier[0]).toMatchObject({ orders: 1, total: 10058, vat: 658 });
  });

  it('close a partially received PO; cancel restores PR to approved', async () => {
    const sup = (await buyer.post('/purchasing/suppliers', { name: 'ผู้ขาย 2' })).body;
    const pr = (await buyer.post('/purchasing/requests', { items: [{ description: 'ถุงมือ', quantity: 10, unit: 'คู่' }] })).body;
    await buyer.post(`/purchasing/requests/${pr.id}/submit`);
    await manager.post(`/purchasing/requests/${pr.id}/approve`);
    const po = (await buyer.post('/purchasing/orders', { supplierId: sup.id, prId: pr.id, orderDate: iso(0), warehouseId: wh1, vatRate: 0, items: [{ category: 'SAFETY', description: 'ถุงมือ', quantity: 10, unit: 'คู่', unitPrice: 25 }] })).body;
    expect((await buyer.post(`/purchasing/orders/${po.id}/cancel`, { reason: 'ผู้ขายไม่มีของ' })).body.status).toBe('CANCELLED');
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe('APPROVED');

    const po2 = (await buyer.post('/purchasing/orders', { supplierId: sup.id, orderDate: iso(0), warehouseId: wh1, vatRate: 0, items: [{ category: 'SAFETY', description: 'ถุงมือ', quantity: 10, unit: 'คู่', unitPrice: 25 }] })).body;
    await manager.post(`/purchasing/orders/${po2.id}/approve`);
    await admin.post(`/purchasing/orders/${po2.id}/receive`, { receivedAt: ago(1), lines: [{ poItemId: po2.items[0].id, quantity: 6 }] });
    expect((await manager.post(`/purchasing/orders/${po2.id}/close`, { reason: 'ผู้ขายส่งได้แค่นี้' })).body.status).toBe('CLOSED');
    expect(await prisma.auditLog.count({ where: { entityId: po2.id, action: 'STATUS_CHANGE' } })).toBe(2);
  });
});
