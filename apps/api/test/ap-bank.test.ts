import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toISODate } from '@fisher/shared';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let acc: Agent;
let acc2: Agent;
let f: Awaited<ReturnType<typeof fixtures>>;
let accounts: { id: string; code: string }[];
const A = (code: string) => accounts.find((a) => a.code === code)!.id;
let sup: { id: string };
let sup2: { id: string };
let grId: string;
let bankId: string;
let billId: string;
const ym = () => ({ y: toISODate().slice(0, 4), m: String(Number(toISODate().slice(5, 7))) });
const tb = async () => (await acc.get(`/accounting/reports/trial-balance?from=2020-01-01&to=${iso(3)}`)).body;
const bal = (t: { items: { code: string; balance: number }[] }, code: string) => t.items.find((i) => i.code === code)?.balance ?? 0;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('acc', 'ACCOUNTANT');
  await createUser('acc2', 'ACCOUNTANT');
  await createUser('mgr', 'OPERATIONS_MANAGER');
  admin = await login(app, 'admin');
  acc = await login(app, 'acc');
  acc2 = await login(app, 'acc2');
  const mgr = await login(app, 'mgr');
  f = await fixtures(admin);
  accounts = (await acc.get('/accounting/accounts')).body;
  const trip = await departedTrip(admin, f);
  sup = (await admin.post('/purchasing/suppliers', { name: 'บริษัท อุปกรณ์ประมง จำกัด', taxId: '0105555000011', paymentTermDays: 30 })).body;
  sup2 = (await admin.post('/purchasing/suppliers', { name: 'นายช่าง ซ่อมดี', taxId: '3100500000011', isIndividual: true })).body;
  const wh = (await admin.post('/inventory/warehouses', { code: 'WH1', name: 'คลัง' })).body.id;
  const rope = (await admin.post('/inventory/items', { name: 'เชือก', category: 'ROPE', unit: 'ม้วน' })).body.id;
  const po = (await admin.post('/purchasing/orders', {
    supplierId: sup.id, orderDate: iso(0), warehouseId: wh, vesselId: f.vessel.id, tripId: trip.id, vatRate: 7,
    items: [{ itemId: rope, description: 'เชือก', quantity: 10, unit: 'ม้วน', unitPrice: 100 }, { category: 'ICE', description: 'น้ำแข็ง', quantity: 5, unit: 'ซอง', unitPrice: 40 }],
  })).body;
  await mgr.post(`/purchasing/orders/${po.id}/approve`);
  grId = (await admin.post(`/purchasing/orders/${po.id}/receive`, { receivedAt: ago(5), lines: po.items.map((i: { id: string; quantity: string }) => ({ poItemId: i.id, quantity: Number(i.quantity) })) })).body.id;
  await admin.post(`/trips/${trip.id}/expenses`, { category: 'REPAIR', description: 'ซ่อมรอก (ร้านภายนอก)', amount: 2000, expenseDate: iso(0) });
});
afterAll(() => app.close());

describe('supplier bills', () => {
  it('match goods receipts and accruals, once only, approved by a second person', async () => {
    const open = (await acc.get(`/accounting/ap/unbilled-receipts?supplierId=${sup.id}`)).body;
    expect(open).toEqual([expect.objectContaining({ id: grId, amount: 1200 })]);
    expect((await acc.get(`/accounting/ap/unbilled-receipts?supplierId=${sup2.id}`)).body).toEqual([]);

    const body = (no: string, over: object = {}) => ({
      supplierId: sup.id, supplierInvoiceNo: no, billDate: iso(0), vatRate: 7,
      lines: [{ kind: 'GR', goodsReceiptId: grId }, { kind: 'EXPENSE', accountId: A('2140'), amount: 2000, description: 'ล้างค่าซ่อมค้างจ่าย' }], ...over,
    });
    expect((await acc.post('/accounting/ap/bills', body('IV-1', { lines: [{ kind: 'EXPENSE', amount: 5 }] }))).status).toBe(400); // no account
    expect((await acc.post('/accounting/ap/bills', body('IV-1', { supplierId: sup2.id }))).body.error.code).toBe('GR_NOT_BILLABLE');
    const bill = await acc.post('/accounting/ap/bills', body('IV-1'));
    expect(bill.status).toBe(201);
    billId = bill.body.id;
    // GR value 1,200 + 2,000 = 3,200; VAT 7 % = 224; due date from supplier terms
    expect(bill.body).toMatchObject({ status: 'DRAFT', subtotal: '3200', vatAmount: '224', total: '3424' });
    expect(bill.body.billNo).toMatch(/^AP-\d{4}-0001$/);
    expect((new Date(bill.body.dueDate).getTime() - new Date(bill.body.billDate).getTime()) / 86400_000).toBe(30);
    expect((await acc.post('/accounting/ap/bills', body('IV-1'))).body.error.code).toBe('DUPLICATE_INVOICE');
    expect((await acc.post('/accounting/ap/bills', body('IV-2'))).body.error.code).toBe('GR_NOT_BILLABLE'); // GR already on IV-1
    expect((await acc.post(`/accounting/ap/bills/${billId}/approve`)).status).toBe(403);
    expect((await acc2.post(`/accounting/ap/bills/${billId}/approve`)).body.status).toBe('APPROVED');
    expect((await acc.put(`/accounting/ap/bills/${billId}`, body('IV-1'))).status).toBe(409);
    expect((await acc.get(`/accounting/ap/unbilled-receipts?supplierId=${sup.id}`)).body).toEqual([]);
  });
});

describe('supplier payments, withholding tax, posting', () => {
  let payId: string;
  it('pays with withholding tax, posts AP/VAT/WHT and clears GRNI and accruals', async () => {
    const ba = await acc.post('/accounting/bank-accounts', { code: 'BA1', name: 'กระแสรายวัน', bankName: 'กสิกรไทย', accountNo: '123-4-56789-0', glAccountId: A('1120') });
    expect(ba.status).toBe(201);
    bankId = ba.body.id;
    expect((await acc.post('/accounting/bank-accounts', { code: 'BA2', name: 'x', bankName: 'x', accountNo: '1234567', glAccountId: A('2110') })).status).toBe(400); // not an asset

    const pay = (over: object = {}) => ({ supplierId: sup.id, paidAt: ago(0.2), method: 'TRANSFER', bankAccountId: bankId, allocations: [{ billId, amount: 3424 }], ...over });
    expect((await acc.post('/accounting/ap/payments', pay({ bankAccountId: '' }))).status).toBe(400);
    expect((await acc.post('/accounting/ap/payments', pay({ allocations: [{ billId, amount: 3425 }] }))).body.error.code).toBe('OVERPAY');
    expect((await acc.post('/accounting/ap/payments', pay({ whtRate: 3 }))).status).toBe(400); // base required
    const p = await acc.post('/accounting/ap/payments', pay({ whtRate: 3, whtBase: 2000, reference: 'TRF-1' }));
    expect(p.status).toBe(201);
    payId = p.body.id;
    expect(p.body).toMatchObject({ grossAmount: '3424', whtAmount: '60', netAmount: '3364' });
    expect(p.body.paymentNo).toMatch(/^PV-\d{4}-0001$/);
    expect((await acc.get(`/accounting/ap/bills/${billId}`)).body.outstanding).toBe('0.00');
    expect((await acc.post(`/accounting/ap/bills/${billId}/void`, { reason: 'x' })).body.error.code).toBe('HAS_PAYMENTS');

    const pending = (await acc.get('/accounting/auto-post/pending')).body.byType;
    expect(pending).toMatchObject({ VENDOR_BILL: 1, VENDOR_PAYMENT: 1, GOODS_RECEIPT: 1, TRIP_EXPENSE: 1 });
    expect((await acc.post('/accounting/auto-post')).body.exceptions).toEqual([]);
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(bal(t, '2120')).toBe(0); // goods received not invoiced: cleared by the bill
    expect(bal(t, '2140')).toBe(0); // accrued trip repair: cleared by the bill
    expect(bal(t, '1150')).toBe(224); // input VAT
    expect(bal(t, '2110')).toBe(0); // AP paid
    expect(bal(t, '2160')).toBe(60); // WHT to remit
    expect(bal(t, '1120')).toBe(-3364);
  });

  it('void payment reverses; partial payments; aging; WHT report by form', async () => {
    expect((await acc.post(`/accounting/ap/payments/${payId}/void`, { reason: 'โอนผิดบัญชี' })).body.status).toBe('VOID');
    expect((await acc.get(`/accounting/ap/bills/${billId}`)).body.outstanding).toBe('3424.00');
    expect((await acc.post(`/accounting/ap/payments/${payId}/void`, { reason: 'x' })).status).toBe(409);
    await acc.post('/accounting/ap/payments', { supplierId: sup.id, paidAt: ago(0.1), method: 'CASH', allocations: [{ billId, amount: 1000 }] });
    const aging = (await acc.get(`/accounting/ap/aging?asOf=${iso(0)}`)).body;
    expect(aging.items).toEqual([expect.objectContaining({ supplierId: sup.id, current: 2424, total: 2424 })]);

    // individual contractor: no VAT, 3 % withholding → ภ.ง.ด.3
    const b2 = (await acc.post('/accounting/ap/bills', { supplierId: sup2.id, supplierInvoiceNo: 'R-77', billDate: iso(0), vatRate: 0, lines: [{ kind: 'EXPENSE', accountId: A('5150'), amount: 1000, vesselId: f.vessel.id, description: 'ค่าแรงซ่อมเครื่อง' }] })).body;
    await acc2.post(`/accounting/ap/bills/${b2.id}/approve`);
    expect((await acc.post('/accounting/ap/payments', { supplierId: sup2.id, paidAt: ago(0.1), method: 'CASH', whtRate: 3, whtBase: 1000, allocations: [{ billId: b2.id, amount: 1000 }] })).body.netAmount).toBe('970');
    expect((await acc.post('/accounting/auto-post')).body.exceptions).toEqual([]);
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(bal(t, '2110')).toBe(2424); // AP left on IV-1
    expect(bal(t, '2160')).toBe(30); // first WHT reversed with the voided payment
    expect(bal(t, '1120')).toBe(0);

    const { y, m } = ym();
    const wht = (await acc.get(`/accounting/tax/wht?year=${y}&month=${m}`)).body;
    expect(wht.totals).toEqual({ pnd3: { count: 1, base: 1000, wht: 30 }, pnd53: { count: 0, base: 0, wht: 0 } });
    expect(wht.pnd3[0]).toMatchObject({ taxId: '3100500000011', rate: 3 });
    const vat = (await acc.get(`/accounting/tax/vat?year=${y}&month=${m}`)).body;
    expect(vat.input).toEqual([expect.objectContaining({ docNo: 'IV-1', base: 3200, vat: 224 })]);
    expect(vat.totals).toMatchObject({ inputVat: 224, outputVat: 0, netVat: -224 });
  });
});

describe('bank reconciliation', () => {
  it('ticks statement lines until the cleared balance matches, once per line', async () => {
    const cap = (await acc.post('/accounting/journals', { entryDate: iso(-2), memo: 'นำเงินทุนเข้าธนาคาร', lines: [{ accountId: A('1120'), debit: 50000 }, { accountId: A('3100'), credit: 50000 }] })).body;
    await acc2.post(`/accounting/journals/${cap.id}/post`);
    const rec = await acc.post('/accounting/bank-recs', { bankAccountId: bankId, statementDate: iso(2), statementBalance: 50000 });
    expect(rec.status).toBe(201);
    expect((await acc.post('/accounting/bank-recs', { bankAccountId: bankId, statementDate: iso(2), statementBalance: 1 })).body.error.code).toBe('DRAFT_EXISTS');
    let det = (await acc.get(`/accounting/bank-recs/${rec.body.id}`)).body;
    // +50,000 deposit, −3,364 transfer and its +3,364 reversal
    expect(det.items.map((i: { debit: number; credit: number }) => i.debit - i.credit).sort((a: number, b: number) => a - b)).toEqual([-3364, 3364, 50000]);
    expect(det).toMatchObject({ bookBalance: 50000, clearedBalance: 0, difference: 50000 });
    expect((await acc.post(`/accounting/bank-recs/${rec.body.id}/complete`)).body.error.code).toBe('NOT_RECONCILED');
    const deposit = det.items.find((i: { debit: number }) => i.debit === 50000).journalLineId;
    det = (await acc.put(`/accounting/bank-recs/${rec.body.id}/items`, { journalLineIds: [deposit] })).body;
    expect(det).toMatchObject({ clearedBalance: 50000, difference: 0, unclearedTotal: 0 });
    expect((await acc.post(`/accounting/bank-recs/${rec.body.id}/complete`)).body.status).toBe('COMPLETED');
    expect((await acc.put(`/accounting/bank-recs/${rec.body.id}/items`, { journalLineIds: [] })).status).toBe(409);

    expect((await acc.post('/accounting/bank-recs', { bankAccountId: bankId, statementDate: iso(2), statementBalance: 50000 })).status).toBe(400); // not after last
    const next = (await acc.post('/accounting/bank-recs', { bankAccountId: bankId, statementDate: iso(3), statementBalance: 50000 })).body;
    const nd = (await acc.get(`/accounting/bank-recs/${next.id}`)).body;
    expect(nd.items.map((i: { journalLineId: string }) => i.journalLineId)).not.toContain(deposit);
    expect(nd.clearedBalance).toBe(50000); // carried from the completed reconciliation
    expect((await acc.put(`/accounting/bank-recs/${next.id}/items`, { journalLineIds: [deposit] })).body.error.code).toBe('ALREADY_CLEARED');
    expect((await acc.del(`/accounting/bank-recs/${next.id}`)).body.ok).toBe(true);
  });

  it('vessel-scoped users cannot reach payables', async () => {
    await createUser('cap', 'CAPTAIN', { vesselIds: [f.vessel.id] });
    expect((await (await login(app, 'cap')).get('/accounting/ap/bills')).status).toBe(403);
  });
});
