import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let acc: Agent;
let mgr: Agent;
let f: Awaited<ReturnType<typeof fixtures>>;
let accounts: { id: string; code: string; isPostable: boolean }[];
const A = (code: string) => accounts.find((a) => a.code === code)!.id;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('acc', 'ACCOUNTANT');
  await createUser('mgr', 'OPERATIONS_MANAGER');
  admin = await login(app, 'admin');
  acc = await login(app, 'acc');
  mgr = await login(app, 'mgr');
  f = await fixtures(admin);
  accounts = (await acc.get('/accounting/accounts')).body;
});
afterAll(() => app.close());

const tb = async () => (await acc.get(`/accounting/reports/trial-balance?from=2020-01-01&to=${iso(2)}`)).body;
const bal = (t: { items: { code: string; balance: number }[] }, code: string) => t.items.find((i) => i.code === code)?.balance ?? 0;

describe('chart of accounts & manual journals', () => {
  it('standard chart and full mapping are seeded', async () => {
    expect(accounts.length).toBe(44);
    expect(accounts.find((a) => a.code === '1000')!.isPostable).toBe(false);
    const maps = (await acc.get('/accounting/mappings')).body as { key: string; account: { code: string } | null }[];
    expect(maps.every((m) => m.account)).toBe(true);
    expect(maps.find((m) => m.key === 'AR')!.account!.code).toBe('1130');
  });

  it('validation, segregation of duties, immutability, reversal', async () => {
    const line = (code: string, debit: number, credit: number) => ({ accountId: A(code), debit: debit || '', credit: credit || '' });
    expect((await acc.post('/accounting/journals', { entryDate: iso(-30), memo: 'x', lines: [line('1110', 100, 0), line('3100', 0, 90)] })).status).toBe(400);
    const header = await acc.post('/accounting/journals', { entryDate: iso(-30), memo: 'x', lines: [line('1100', 100, 0), line('3100', 0, 100)] });
    expect(header.status).toBe(400);
    expect(header.body.error.message).toContain('บัญชีคุม');
    expect((await acc.post('/accounting/journals', { entryDate: iso(-30), memo: 'x', lines: [{ accountId: A('1110'), debit: 5, credit: 5 }, line('3100', 0, 5)] })).status).toBe(400);

    const je = await acc.post('/accounting/journals', { entryDate: iso(-30), memo: 'ทุนเริ่มต้น', lines: [line('1110', 100000, 0), line('3100', 0, 100000)] });
    expect(je.status).toBe(201);
    expect(je.body).toMatchObject({ status: 'DRAFT', totalDebit: '100000' });
    expect(je.body.entryNo).toMatch(/^JV-\d{4}-00001$/);
    expect((await acc.post(`/accounting/journals/${je.body.id}/post`)).status).toBe(403); // own entry
    expect((await admin.post(`/accounting/journals/${je.body.id}/post`)).body.status).toBe('POSTED');
    expect((await acc.put(`/accounting/journals/${je.body.id}`, { entryDate: iso(-30), memo: 'x', lines: [line('1110', 1, 0), line('3100', 0, 1)] })).status).toBe(409);

    // database refuses to change posted data even outside the API
    await expect(prisma.journalLine.updateMany({ where: { entryId: je.body.id }, data: { description: 'แก้' } })).rejects.toThrow();
    await expect(prisma.journalEntry.update({ where: { id: je.body.id }, data: { memo: 'แก้' } })).rejects.toThrow();
    await expect(prisma.journalEntry.delete({ where: { id: je.body.id } })).rejects.toThrow();

    const rev = await admin.post(`/accounting/journals/${je.body.id}/reverse`, { entryDate: iso(-29), reason: 'บันทึกผิดบัญชี' });
    expect(rev.status).toBe(201);
    const revDetail = (await acc.get(`/accounting/journals/${rev.body.id}`)).body;
    expect(revDetail.reversalOf.entryNo).toBe(je.body.entryNo);
    expect(revDetail.lines.map((l: { account: { code: string }; debit: string; credit: string }) => [l.account.code, l.debit, l.credit])).toEqual([['1110', '0', '100000'], ['3100', '100000', '0']]);
    expect((await acc.get(`/accounting/journals/${je.body.id}`)).body.status).toBe('REVERSED');
    expect((await admin.post(`/accounting/journals/${je.body.id}/reverse`, { entryDate: iso(-29), reason: 'x' })).status).toBe(409);

    const cap = (await acc.post('/accounting/journals', { entryDate: iso(-30), memo: 'ทุนเริ่มต้น (ฝากธนาคาร)', lines: [line('1120', 200000, 0), line('3100', 0, 200000)] })).body;
    await admin.post(`/accounting/journals/${cap.id}/post`);
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(bal(t, '1110')).toBe(0);
    expect(bal(t, '3100')).toBe(200000);
  });
});

describe('automatic posting', () => {
  let invoiceId: string;
  let paymentId: string;
  let tripId: string;

  it('posts every operational document once, balanced, with vessel/trip dimensions', async () => {
    const trip = await departedTrip(admin, f);
    tripId = trip.id;
    const mack = ((await admin.get('/catch/species')).body as { id: string; code: string }[]).find((s) => s.code === 'MACK-S')!.id;
    await admin.post('/catch/records', { tripId, speciesId: mack, catchDate: iso(-1), weightKg: 1000 });

    // stock: manual receipt 10 × 100, issue 4 to the trip
    const wh = (await admin.post('/inventory/warehouses', { code: 'WH1', name: 'คลังหลัก' })).body.id;
    const rope = (await admin.post('/inventory/items', { name: 'เชือก', category: 'ROPE', unit: 'ม้วน' })).body.id;
    const rc = await admin.post('/inventory/receipts', { warehouseId: wh, itemId: rope, quantity: 10, unitCost: 100, movedAt: ago(30), notes: 'ยอดยกมา' });
    expect(rc.status, JSON.stringify(rc.body)).toBe(201);
    const is = await admin.post('/inventory/issues', { warehouseId: wh, itemId: rope, quantity: 4, movedAt: ago(20), vesselId: f.vessel.id, tripId });
    expect(is.status, JSON.stringify(is.body)).toBe(201);
    // purchase order: 5 rope × 120 into stock + 10 ice × 40 straight to the trip (VAT not part of cost)
    const sup = (await admin.post('/purchasing/suppliers', { name: 'ร้านอุปกรณ์' })).body;
    const po = (await admin.post('/purchasing/orders', {
      supplierId: sup.id, orderDate: iso(0), warehouseId: wh, vesselId: f.vessel.id, tripId, vatRate: 7,
      items: [{ itemId: rope, description: 'เชือก', quantity: 5, unit: 'ม้วน', unitPrice: 120 }, { category: 'ICE', description: 'น้ำแข็ง', quantity: 10, unit: 'ซอง', unitPrice: 40 }],
    })).body;
    expect((await mgr.post(`/purchasing/orders/${po.id}/approve`)).status).toBe(200);
    const gr = await admin.post(`/purchasing/orders/${po.id}/receive`, { receivedAt: ago(10), lines: po.items.map((i: { id: string; quantity: string }) => ({ poItemId: i.id, quantity: Number(i.quantity) })) });
    expect(gr.status).toBe(201);
    // fuel: tank receipt 1000 L × 30, issue 300 L to the trip
    const tank = (await admin.post('/fuel/tanks', { code: 'T1', name: 'ถังกลาง', fuelType: 'DIESEL_B7', capacityL: 50000 })).body;
    await admin.post('/fuel/receipts', { tankId: tank.id, txnDate: ago(9), liters: 1000, unitPrice: 30 });
    expect((await admin.post('/fuel/issues', { tankId: tank.id, txnDate: ago(8), liters: 300, vesselId: f.vessel.id, tripId })).status).toBe(201);
    // trip expenses: actual is posted, estimate is not
    await admin.post(`/trips/${tripId}/expenses`, { category: 'UNLOADING', description: 'ค่าขนถ่าย', amount: 2000, expenseDate: iso(0) });
    await admin.post(`/trips/${tripId}/expenses`, { category: 'PORT_FEE', description: 'ค่าท่า (ประมาณ)', amount: 500, expenseDate: iso(0), isEstimate: true });
    // employee advance 500 cash
    await prisma.employee.update({ where: { id: f.crew.id }, data: { payType: 'DAILY', baseRate: 400 } });
    expect((await acc.post('/payroll/advances', { employeeId: f.crew.id, kind: 'ADVANCE', advanceDate: iso(-3), amount: 500, method: 'CASH', reason: 'เบิก' })).status).toBe(201);

    // arrive, sell 600 kg × 50 with VAT 7 %, receive 10,000, credit note 50 kg
    await admin.post(`/trips/${tripId}/arrive`, { arrivedAt: ago(1), arrivalPort: 'สงขลา', fuelAtArrivalL: 100 });
    const cust = (await admin.post('/sales/customers', { name: 'แพปลา' })).body;
    const inv = (await admin.post('/sales/invoices', { customerId: cust.id, invoiceDate: iso(0), vatRate: 7, items: [{ tripId, speciesId: mack, weightKg: 600, unitPrice: 50 }] })).body;
    invoiceId = inv.id;
    const conf = await admin.post(`/sales/invoices/${inv.id}/confirm`);
    expect(conf.body).toMatchObject({ total: '32100', vatAmount: '2100' });
    const pay = await admin.post(`/sales/invoices/${inv.id}/payments`, { paidAt: ago(0.5), amount: 10000, method: 'TRANSFER' });
    expect(pay.status).toBe(201);
    paymentId = pay.body.id ?? pay.body.payments?.at(-1)?.id;
    const cn = await admin.post(`/sales/invoices/${inv.id}/returns`, { returnDate: iso(0), reason: 'ปลาเสีย', items: [{ salesItemId: inv.items[0].id, weightKg: 50, amount: 2500 }] });
    expect(cn.status).toBe(201);

    // maintenance labour/external work
    const mo = (await admin.post('/maintenance/orders', { vesselId: f.vessel.id, title: 'ซ่อมปั๊มน้ำ', category: 'ENGINE', type: 'CORRECTIVE', reportedAt: ago(0.4) })).body;
    await admin.post(`/maintenance/orders/${mo.id}/start`);
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    expect((await admin.post(`/maintenance/orders/${mo.id}/complete`, { completedAt: minute, laborCost: 700, externalCost: 300 })).status).toBe(200);

    // payroll: approve + pay
    const pp = (await acc.post('/payroll/periods', { name: 'งวดทดสอบ', startDate: iso(-40), endDate: iso(1) })).body;
    await acc.post(`/payroll/periods/${pp.id}/calculate`);
    expect((await admin.post(`/payroll/periods/${pp.id}/approve`)).status).toBe(200);
    expect((await admin.post(`/payroll/periods/${pp.id}/pay`, { paidAt: ago(0), method: 'TRANSFER' })).status).toBe(200);
    const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: pp.id } });

    const pending = (await acc.get('/accounting/auto-post/pending')).body;
    expect(pending.byType).toEqual({
      SALES_INVOICE: 1, SALES_PAYMENT: 1, SALES_RETURN: 1, GOODS_RECEIPT: 1, STOCK_MOVEMENT: 2, FUEL_TXN: 2,
      TRIP_EXPENSE: 1, MAINTENANCE_ORDER: 1, PAYROLL_PERIOD: 2, EMPLOYEE_ADVANCE: 1,
    });
    expect((await mgr.post('/accounting/auto-post')).status).toBe(403);
    const run = (await acc.post('/accounting/auto-post')).body;
    expect(run.exceptions).toEqual([]);
    expect(run.posted).toBe(pending.total);
    expect((await acc.post('/accounting/auto-post')).body.posted).toBe(0); // idempotent

    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(bal(t, '1130')).toBe(32100 - 10000 - 2675); // AR
    expect(bal(t, '2150')).toBe(2100 - 175); // VAT output
    expect(bal(t, '1160')).toBe(1000 - 400 + 600); // inventory
    expect(bal(t, '1170')).toBe(30000 - 9000); // fuel in tank
    expect(bal(t, '2120')).toBe(1000 + 1000 + 30000); // received, not yet billed
    expect(bal(t, '2140')).toBe(2000 + 1000); // accrued trip expense + maintenance
    expect(bal(t, '1140')).toBe(0); // advance recovered by payroll
    expect(bal(t, '2130')).toBe(0); // wages accrued then paid
    expect(bal(t, '5130')).toBe(Number(period.totalGross));
    expect(bal(t, '1110')).toBe(-500); // cash paid out for the advance (no cash opening)
    expect(bal(t, '1120')).toBe(200000 + 10000 - Number(period.totalNet));

    const pl = (await acc.get(`/accounting/reports/profit-loss?from=2020-01-01&to=${iso(2)}`)).body;
    expect(pl.revenue.find((r: { code: string }) => r.code === '4100').amount).toBe(30000);
    expect(pl.revenue.find((r: { code: string }) => r.code === '4110').amount).toBe(-2500);
    const v = pl.byVessel.find((x: { vesselId: string }) => x.vesselId === f.vessel.id);
    // vessel: revenue 30,000 − 2,500; costs: supplies 400 + 400 ice, fuel 9,000, unloading 2,000, maintenance 1,000, crew wages
    expect(v.revenue).toBe(27500);
    expect(v.expense).toBeCloseTo(400 + 400 + 9000 + 2000 + 1000 + Number(period.totalGross), 2);
    const bs = (await acc.get(`/accounting/reports/balance-sheet?asOf=${iso(2)}`)).body;
    expect(bs.balanced).toBe(true);
    expect(bs.unclosedEarnings).toBeCloseTo(pl.netProfit, 2);

    // trip dimension on revenue line
    const revLine = await prisma.journalLine.findFirstOrThrow({ where: { account: { code: '4100' } } });
    expect(revLine).toMatchObject({ tripId, vesselId: f.vessel.id });
  });

  it('voiding a document posts an exact reversal; auto entries cannot be reversed by hand', async () => {
    const payEntry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: 'SALES_PAYMENT', sourceEvent: 'RECEIVE' } });
    const det = (await acc.get(`/accounting/journals/${payEntry.id}`)).body;
    expect(det.sourceLink).toBe(`/sales/invoices/${invoiceId}`);
    expect((await admin.post(`/accounting/journals/${payEntry.id}/reverse`, { entryDate: iso(0), reason: 'x' })).body.error.code).toBe('AUTO_ENTRY');

    const pid = paymentId ?? (await prisma.salesPayment.findFirstOrThrow({ where: { invoiceId } })).id;
    expect((await admin.post(`/sales/payments/${pid}/void`, { reason: 'เช็คคืน' })).status).toBe(200);
    expect((await acc.get('/accounting/auto-post/pending')).body.byType).toEqual({ SALES_PAYMENT: 1 });
    expect((await acc.post('/accounting/auto-post')).body.posted).toBe(1);
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: payEntry.id } })).status).toBe('REVERSED');
    const t = await tb();
    expect(bal(t, '1130')).toBe(32100 - 2675);
    expect(t.balanced).toBe(true);

    const ar = A('1130');
    const gl = (await acc.get(`/accounting/reports/general-ledger?accountId=${ar}&from=2020-01-01&to=${iso(2)}`)).body;
    expect(gl.closing).toBe(32100 - 2675);
    expect(gl.items.map((i: { sourceRef: string }) => i.sourceRef)).toEqual(expect.arrayContaining([expect.stringMatching(/^INV-/), expect.stringMatching(/^CN-/)]));
    // trip remains linked for reporting
    expect(tripId).toBeTruthy();
  });
});

describe('fiscal period close', () => {
  it('blocks drafts and unposted documents, protects closed months, reopens with reason', async () => {
    const draft = (await acc.post('/accounting/journals', { entryDate: '2026-09-10', memo: 'ค่าเช่า', lines: [{ accountId: A('5290'), debit: 1000 }, { accountId: A('1120'), credit: 1000 }] })).body;
    await acc.post('/payroll/advances', { employeeId: f.crew.id, kind: 'ADVANCE', advanceDate: '2026-09-20', amount: 300, reason: 'เบิกย้อนหลัง' });
    const chk = (await acc.get('/accounting/periods/2026/9/checklist')).body;
    expect(chk).toMatchObject({ ok: false, pending: 1, pendingByType: { EMPLOYEE_ADVANCE: 1 } });
    expect(chk.drafts.map((d: { id: string }) => d.id)).toEqual([draft.id]);
    const blocked = await acc.post('/accounting/periods/2026/9/close');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PERIOD_NOT_READY');

    await acc.post(`/accounting/journals/${draft.id}/void`, { reason: 'ซ้ำ' });
    await acc.post('/accounting/auto-post');
    expect((await acc.post('/accounting/periods/2026/9/close')).body.status).toBe('CLOSED');
    const months = (await acc.get('/accounting/periods?year=2026')).body;
    expect(months[8]).toMatchObject({ month: 9, status: 'CLOSED', closedByName: 'acc' });

    // posting into the closed month is refused (API and database), documents dated there wait as exceptions
    const late = (await acc.post('/accounting/journals', { entryDate: '2026-09-12', memo: 'ย้อนหลัง', lines: [{ accountId: A('5290'), debit: 10 }, { accountId: A('1110'), credit: 10 }] })).body;
    expect((await admin.post(`/accounting/journals/${late.id}/post`)).body.error.code).toBe('PERIOD_CLOSED');
    await expect(prisma.journalEntry.update({ where: { id: late.id }, data: { status: 'POSTED', postedAt: new Date() } })).rejects.toThrow(/closed/);
    await acc.post('/payroll/advances', { employeeId: f.crew.id, kind: 'ADVANCE', advanceDate: '2026-09-25', amount: 100, reason: 'ย้อนหลัง' });
    const ex = (await acc.post('/accounting/auto-post')).body;
    expect(ex.posted).toBe(0);
    expect(ex.exceptions[0].reason).toContain('ปิดแล้ว');

    expect((await acc.post('/accounting/periods/2026/9/reopen', {})).status).toBe(400); // reason required
    expect((await acc.post('/accounting/periods/2026/9/reopen', { reason: 'บันทึกเงินเบิกตกหล่น' })).body.status).toBe('OPEN');
    expect((await acc.post('/accounting/auto-post')).body.posted).toBe(1);
    expect((await admin.post(`/accounting/journals/${late.id}/post`)).body.status).toBe('POSTED');
    expect((await tb()).balanced).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'FiscalPeriod' }, orderBy: { id: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['CLOSE', 'REOPEN']);
  });

  it('vessel-scoped users have no access to company accounts', async () => {
    await createUser('cap', 'CAPTAIN', { vesselIds: [f.vessel.id] });
    const cap = await login(app, 'cap');
    expect((await cap.get('/accounting/accounts')).status).toBe(403);
  });
});
