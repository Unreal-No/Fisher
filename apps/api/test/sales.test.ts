import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let seller: Agent;
let tripId: string;
let vesselId: string;
let mack: string;
let squid: string;
let gradeA: string;
let customer: { id: string };

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('seller', 'SALES_OFFICER');
  admin = await login(app, 'admin');
  seller = await login(app, 'seller');
  const sp = (await admin.get('/catch/species')).body as { id: string; code: string }[];
  mack = sp.find((s) => s.code === 'MACK-S')!.id;
  squid = sp.find((s) => s.code === 'SQID')!.id;
  gradeA = ((await admin.get('/catch/grades')).body as { id: string; code: string }[]).find((g) => g.code === 'A')!.id;
  const f = await fixtures(admin);
  vesselId = f.vessel.id;
  const t = await departedTrip(admin, f);
  tripId = t.id;
  await admin.post('/catch/records', { tripId, speciesId: mack, gradeId: gradeA, catchDate: iso(-1), weightKg: 1000 });
  await admin.post('/catch/records', { tripId, speciesId: squid, catchDate: iso(-1), weightKg: 200 });
  customer = (await seller.post('/sales/customers', { name: 'แพปลาตัวอย่าง', creditTermDays: 15 })).body;
});
afterAll(() => app.close());

const line = (over: object = {}) => ({ tripId, speciesId: mack, gradeId: gradeA, weightKg: 600, unitPrice: 50, ...over });

describe('sales from lots', () => {
  it('cannot sell before arrival; lots show availability; oversell blocked', async () => {
    const early = await seller.post('/sales/invoices', { customerId: customer.id, invoiceDate: iso(0), items: [line()] });
    expect(early.status).toBe(400); // trip still at sea
    await admin.post(`/trips/${tripId}/arrive`, { arrivedAt: ago(1), arrivalPort: 'สงขลา', fuelAtArrivalL: 100 });
    const lots = (await seller.get(`/sales/lots?tripId=${tripId}`)).body;
    const lot = lots.find((l: { speciesId: string }) => l.speciesId === mack);
    expect(lot).toMatchObject({ caughtKg: 1000, soldKg: 0, availableKg: 1000 });
    expect(lot.lotNo).toMatch(/\/MACK-S\/A$/);
    const over = await seller.post('/sales/invoices', { customerId: customer.id, invoiceDate: iso(0), items: [line({ weightKg: 1001 })] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LOT_INSUFFICIENT');
    // wrong grade has no catch
    expect((await seller.post('/sales/invoices', { customerId: customer.id, invoiceDate: iso(0), items: [line({ gradeId: null, weightKg: 1 })] })).status).toBe(409);
  });

  it('draft → confirm (invoice no, due date, discount share) → concurrent oversell rejected at confirm', async () => {
    const a = (await seller.post('/sales/invoices', { customerId: customer.id, invoiceDate: iso(0), discount: 300, additionalCost: 200, items: [line(), line({ speciesId: squid, gradeId: null, weightKg: 100, unitPrice: 120 })] })).body;
    // subtotal 30000 + 12000 = 42000; total = 42000 - 300 + 200 = 41900 (VAT 0)
    expect(a).toMatchObject({ status: 'DRAFT', subtotal: '42000', total: '41900' });
    expect(a.orderNo).toMatch(/^SO-\d{4}-\d{4}$/);
    expect(a.items.reduce((s: number, i: { discountShare: string }) => s + Number(i.discountShare), 0)).toBe(300);
    expect(new Date(a.dueDate).getTime() - new Date(a.invoiceDate).getTime()).toBe(15 * 86400_000);

    const b = (await seller.post('/sales/invoices', { customerId: customer.id, invoiceDate: iso(0), items: [line({ weightKg: 500 })] })).body;
    const ca = await seller.post(`/sales/invoices/${a.id}/confirm`);
    expect(ca.status).toBe(200);
    expect(ca.body.invoiceNo).toMatch(/^INV-\d{4}-\d{4}$/);
    const cb = await seller.post(`/sales/invoices/${b.id}/confirm`); // 600 + 500 > 1000
    expect(cb.status).toBe(409);
    expect(cb.body.error.code).toBe('LOT_OVERSOLD');
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('DRAFT');
    expect((await seller.put(`/sales/invoices/${a.id}`, { customerId: customer.id, invoiceDate: iso(0), items: [line()] })).status).toBe(409);

    // catch can no longer be reduced below what was sold
    const rec = await prisma.catchRecord.findFirstOrThrow({ where: { tripId, speciesId: mack } });
    const adj = await admin.patch(`/catch/records/${rec.id}`, { version: rec.version, weightKg: 500, reason: 'ทดสอบ' });
    expect(adj.status).toBe(409);
    expect(adj.body.error.code).toBe('LOT_OVERSOLD');
    expect((await admin.post('/catch/losses', { tripId, speciesId: mack, lossType: 'SPOILAGE', weightKg: 450, reason: 'x', recordedAt: ago(0.5) })).status).toBe(409);
    expect((await admin.post('/catch/losses', { tripId, speciesId: mack, lossType: 'SPOILAGE', weightKg: 50, reason: 'น้ำแข็งละลาย', recordedAt: ago(0.5) })).status).toBe(201);
    const lot = (await seller.get(`/sales/lots?tripId=${tripId}`)).body.find((l: { speciesId: string }) => l.speciesId === mack);
    expect(lot.availableKg).toBe(350); // 1000 - 600 sold - 50 loss
  });

  it('payments, credit note, void rules, receivables aging, revenue report, trip settlement', async () => {
    const inv = (await seller.get('/sales/invoices?status=CONFIRMED')).body.items[0];
    expect(inv.paymentStatus).toBe('UNPAID');
    expect((await seller.post(`/sales/invoices/${inv.id}/payments`, { paidAt: ago(0.2), amount: 50000, method: 'TRANSFER' })).body.error.code).toBe('OVERPAYMENT');
    const pay = await seller.post(`/sales/invoices/${inv.id}/payments`, { paidAt: ago(0.2), amount: 20000, method: 'TRANSFER', reference: 'KBANK-001' });
    expect(pay.status).toBe(201);
    expect(pay.body.receiptNo).toMatch(/^RC-\d{4}-\d{4}$/);
    expect((await admin.post(`/sales/invoices/${inv.id}/void`, { reason: 'x' })).body.error.code).toBe('HAS_PAYMENTS');

    const detail = (await seller.get(`/sales/invoices/${inv.id}`)).body;
    const mackLine = detail.items.find((i: { speciesId: string }) => i.speciesId === mack);
    expect((await seller.post(`/sales/invoices/${inv.id}/returns`, { returnDate: iso(0), reason: 'x', items: [{ salesItemId: mackLine.id, weightKg: 10, amount: 500 }] })).status).toBe(403);
    expect((await admin.post(`/sales/invoices/${inv.id}/returns`, { returnDate: iso(0), reason: 'x', items: [{ salesItemId: mackLine.id, weightKg: 601, amount: 1 }] })).body.error.code).toBe('OVER_RETURN');
    const cn = await admin.post(`/sales/invoices/${inv.id}/returns`, { returnDate: iso(0), reason: 'ปลาไม่สด', items: [{ salesItemId: mackLine.id, weightKg: 20, amount: 1000 }] });
    expect(cn.status).toBe(201);
    expect(cn.body.creditNoteNo).toMatch(/^CN-\d{4}-\d{4}$/);
    const after = (await seller.get(`/sales/invoices/${inv.id}`)).body;
    expect(after).toMatchObject({ paidAmount: '20000', creditedAmount: '1000', outstanding: 20900, paymentStatus: 'PARTIAL' });
    // returned fish is not restocked
    expect((await seller.get(`/sales/lots?tripId=${tripId}`)).body.find((l: { speciesId: string }) => l.speciesId === mack).availableKg).toBe(350);

    const ar = (await seller.get('/sales/receivables')).body;
    expect(ar.totalOutstanding).toBe(20900);
    expect(ar.byCustomer[0]).toMatchObject({ total: 20900, current: 20900 });

    const rep = (await seller.get(`/sales/report?groupBy=species&from=${iso(-1)}&to=${iso(0)}`)).body;
    // mackerel: 30000 - share(300*30000/42000=214.29) - 1000 returned = 28785.71 ; squid: 12000 - 85.71
    expect(rep.totalRevenue).toBeCloseTo(40700, 2);
    expect(rep.items.find((i: { label: string }) => i.label === 'ปลาทู').weightKg).toBe(580);

    const s = (await admin.get(`/trips/${tripId}/settlement`)).body;
    expect(s.revenue).toBeCloseTo(40700, 2);
    expect(s.soldKg).toBe(680);
    expect(s.grossProfit).toBeCloseTo(40700 - s.totalCost, 2);

    // void payment restores outstanding; invoice with credit note cannot be voided
    await admin.post(`/sales/payments/${pay.body.id}/void`, { reason: 'โอนผิดบัญชี' });
    expect((await seller.get(`/sales/invoices/${inv.id}`)).body.outstanding).toBe(40900);
    expect((await admin.post(`/sales/invoices/${inv.id}/void`, { reason: 'x' })).body.error.code).toBe('HAS_CREDIT_NOTES');

    const d = (await admin.get(`/dashboard/summary?from=${iso(-1)}&to=${iso(0)}&vesselId=${vesselId}`)).body;
    expect(d.sales.revenue).toBeCloseTo(40700, 2);
    expect(d.sales.receivables).toBe(40900);
  });

  it('voiding a confirmed invoice releases lot availability', async () => {
    const x = (await seller.post('/sales/invoices', { customerId: customer.id, invoiceDate: iso(0), items: [line({ weightKg: 300 })] })).body;
    await seller.post(`/sales/invoices/${x.id}/confirm`);
    const lotOf = async () => (await seller.get(`/sales/lots?tripId=${tripId}`)).body.find((l: { speciesId: string }) => l.speciesId === mack).availableKg;
    expect(await lotOf()).toBe(50);
    expect((await seller.post(`/sales/invoices/${x.id}/void`, { reason: 'x' })).status).toBe(403);
    expect((await admin.post(`/sales/invoices/${x.id}/void`, { reason: 'ลูกค้ายกเลิก' })).body.status).toBe('VOID');
    expect(await lotOf()).toBe(350);
  });
});
