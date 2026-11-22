import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toISODate } from '@fisher/shared';
import { depStartMonth, expectedAccumulated, monthsElapsed } from '../src/modules/accounting/assets';
import { createUser, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let acc: Agent;
let acc2: Agent;
let f: Awaited<ReturnType<typeof fixtures>>;
let accounts: { id: string; code: string }[];
const A = (code: string) => accounts.find((a) => a.code === code)!.id;
let vesselAsset: string;
let engine: string;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('acc', 'ACCOUNTANT');
  await createUser('acc2', 'ACCOUNTANT');
  const admin = await login(app, 'admin');
  acc = await login(app, 'acc');
  acc2 = await login(app, 'acc2');
  f = await fixtures(admin);
  accounts = (await acc.get('/accounting/accounts')).body;
});
afterAll(() => app.close());

/** manual journal created by acc and posted by acc2 */
async function je(entryDate: string, memo: string, lines: { code: string; debit?: number; credit?: number }[]) {
  const e = (await acc.post('/accounting/journals', { entryDate, memo, lines: lines.map((l) => ({ accountId: A(l.code), debit: l.debit ?? '', credit: l.credit ?? '' })) })).body;
  const p = await acc2.post(`/accounting/journals/${e.id}/post`);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
}
const run = (y: number, m: number) => acc.post('/accounting/depreciation/runs', { year: y, month: m });
const tb = async (to: string) => (await acc.get(`/accounting/reports/trial-balance?from=2020-01-01&to=${to}`)).body;
const bal = (t: { items: { code: string; balance: number }[] }, code: string) => t.items.find((i) => i.code === code)?.balance ?? 0;

describe('depreciation helpers', () => {
  it('start month, elapsed months, straight line with rounding absorbed at the end', () => {
    expect(depStartMonth('2025-01-15')).toBe('2025-02');
    expect(depStartMonth('2025-03-01')).toBe('2025-03');
    expect(depStartMonth('2025-12-20')).toBe('2026-01');
    expect(monthsElapsed('2025-11', '2026-02')).toBe(4);
    expect(monthsElapsed('2025-11', '2025-10')).toBe(0);
    expect(expectedAccumulated(100000, 0, 3, '2025-01', '2025-01')).toBe(33333.33);
    expect(expectedAccumulated(100000, 0, 3, '2025-01', '2025-02')).toBe(66666.67);
    expect(expectedAccumulated(100000, 0, 3, '2025-01', '2025-03')).toBe(100000);
    expect(expectedAccumulated(100000, 10000, 3, '2025-01', '2030-01')).toBe(90000);
  });
});

describe('fixed assets', () => {
  it('register, run monthly in order with catch-up, protect depreciated data, dispose with loss', async () => {
    await je('2025-01-01', 'ซื้อเครื่องยนต์สำรอง', [{ code: '1210', debit: 60000 }, { code: '1120', credit: 60000 }]);
    await je('2025-01-10', 'ซื้อเรือ (เงินทุนเจ้าของ)', [{ code: '1210', debit: 1200000 }, { code: '3100', credit: 1200000 }]);
    const base = { category: 'VESSEL', vesselId: f.vessel.id, assetAccountId: A('1210'), accumDepAccountId: A('1219'), depExpenseAccountId: A('5230') };
    expect((await acc.post('/accounting/assets', { ...base, name: 'x', acquisitionDate: '2025-01-10', cost: 1, usefulLifeMonths: 12, accumDepAccountId: A('5230') })).status).toBe(400);
    const v = await acc.post('/accounting/assets', { ...base, name: 'เรือ ส.ทดสอบ', acquisitionDate: '2025-01-10', cost: 1200000, usefulLifeMonths: 120 });
    expect(v.status).toBe(201);
    expect(v.body.assetNo).toMatch(/^FA-\d{4}-0001$/);
    expect(v.body.depStartDate.slice(0, 10)).toBe('2025-02-01');
    vesselAsset = v.body.id;

    expect((await run(2025, 1)).body).toMatchObject({ total: '0', entryNo: null });
    expect((await run(2025, 3)).body.error.code).toBe('RUN_ORDER');
    const feb = (await run(2025, 2)).body;
    expect(feb).toMatchObject({ total: '10000', assets: 1 });
    expect((await run(2025, 2)).body.error.code).toBe('RUN_ORDER');
    const line = await prisma.journalLine.findFirstOrThrow({ where: { account: { code: '5230' } } });
    expect(line).toMatchObject({ vesselId: f.vessel.id });

    expect((await acc.put(`/accounting/assets/${vesselAsset}`, { ...base, name: 'เรือ', acquisitionDate: '2025-01-10', cost: 1300000, usefulLifeMonths: 120 })).body.error.code).toBe('HAS_DEPRECIATION');
    expect((await acc.put(`/accounting/assets/${vesselAsset}`, { ...base, name: 'เรือ ส.ทดสอบ 1', acquisitionDate: '2025-01-10', cost: 1200000, usefulLifeMonths: 120, serialNo: 'HULL-01' })).status).toBe(200);

    // registered late: acquired 1 Jan (starts Jan) → March run catches up Jan–Mar
    engine = (await acc.post('/accounting/assets', { ...base, category: 'ENGINE', name: 'เครื่องยนต์สำรอง', acquisitionDate: '2025-01-01', cost: 60000, usefulLifeMonths: 60 })).body.id;
    const prev = (await acc.get('/accounting/depreciation/preview?year=2025&month=3')).body;
    expect(prev.items.map((i: { amount: number }) => i.amount).sort()).toEqual([10000, 3000]);
    expect((await run(2025, 3)).body.total).toBe('13000');

    const due = await acc2.post(`/accounting/assets/${engine}/dispose`, { disposedAt: '2025-05-15', proceeds: 50000, method: 'CASH', reason: 'ขายต่อ' });
    expect(due.body.error.code).toBe('DEPRECIATION_DUE'); // April not run yet
    expect((await run(2025, 4)).body.total).toBe('11000');
    const disp = await acc2.post(`/accounting/assets/${engine}/dispose`, { disposedAt: '2025-05-15', proceeds: 50000, method: 'CASH', reason: 'ขายต่อ' });
    expect(disp.status).toBe(200);
    expect(disp.body).toMatchObject({ status: 'DISPOSED', bookValue: 56000, gain: -6000 });
    const dj = (await acc.get(`/accounting/journals/${(await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: 'ASSET_DISPOSAL' } })).id}`)).body;
    expect(dj.lines.map((l: { account: { code: string }; debit: string; credit: string }) => [l.account.code, Number(l.debit), Number(l.credit)])).toEqual([
      ['1219', 4000, 0], ['1110', 50000, 0], ['5240', 6000, 0], ['1210', 0, 60000],
    ]);
    expect((await acc2.post(`/accounting/assets/${engine}/dispose`, { disposedAt: '2025-05-20', reason: 'x' })).status).toBe(409);
    expect((await run(2025, 5)).body.total).toBe('10000'); // disposed engine no longer depreciates

    const rec = (await acc.get('/accounting/assets-reconcile')).body as { code: string; register: number; ledger: number; difference: number }[];
    expect(rec.map((r) => [r.code, r.register, r.ledger, r.difference])).toEqual([['1210', 1200000, 1200000, 0], ['1219', -40000, -40000, 0]]);
    const list = (await acc.get('/accounting/assets?status=ACTIVE')).body.items;
    expect(list).toEqual([expect.objectContaining({ id: vesselAsset, accumulatedDepreciation: '40000.00', bookValue: '1160000.00' })]);
  });
});

describe('year-end close & cash flow', () => {
  it('requires depreciation and earlier steps, closes P&L to retained earnings, reopens', async () => {
    await je('2025-06-30', 'ขายสัตว์น้ำ (สรุป)', [{ code: '1120', debit: 500000 }, { code: '4100', credit: 500000 }]);
    const chk = (await acc.get('/accounting/year-end/2025')).body;
    expect(chk).toMatchObject({ ok: false, depreciationOwed: 70000, drafts: 0, pending: 0, openEarlierYears: [] });
    expect((await acc.post('/accounting/year-end/2025/close')).body.error.code).toBe('YEAR_NOT_READY');
    for (let m = 6; m <= 12; m++) expect((await run(2025, m)).status).toBe(201);

    // P&L 2025: revenue 500,000 − depreciation (110,000 vessel + 4,000 engine) − loss 6,000 = 380,000
    const pl = (await acc.get('/accounting/reports/profit-loss?from=2025-01-01&to=2025-12-31')).body;
    expect(pl.netProfit).toBe(380000);
    const cf = (await acc.get('/accounting/reports/cash-flow?from=2025-01-01&to=2025-12-31')).body;
    expect(cf).toMatchObject({ netProfit: 380000, openingCash: 0, closingCash: 490000, netChange: 490000, balanced: true });
    expect(cf.investing.total).toBe(-1200000);
    expect(cf.financing.total).toBe(1200000);
    expect(cf.operating.adjustments).toEqual([expect.objectContaining({ code: '1219', amount: 110000 })]);

    const closed = await acc2.post('/accounting/year-end/2025/close');
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', netProfit: 380000 });
    const t = await tb('2025-12-31');
    expect(t.balanced).toBe(true);
    expect(bal(t, '3200')).toBe(380000);
    expect(bal(t, '4100')).toBe(0);
    const bs = (await acc.get('/accounting/reports/balance-sheet?asOf=2025-12-31')).body;
    expect(bs).toMatchObject({ unclosedEarnings: 0, balanced: true });
    // income statement of a closed year is unchanged; the closing entry is not "profit"
    expect((await acc.get('/accounting/reports/profit-loss?from=2025-01-01&to=2025-12-31')).body.netProfit).toBe(380000);
    expect(((await acc.get('/accounting/periods?year=2025')).body as { status: string }[]).every((p) => p.status === 'CLOSED')).toBe(true);
    expect((await acc.post('/accounting/journals', { entryDate: '2025-08-01', memo: 'x', lines: [{ accountId: A('5290'), debit: 1 }, { accountId: A('1110'), credit: 1 }] })).status).toBe(201);
    const late = (await prisma.journalEntry.findFirstOrThrow({ where: { memo: 'x', status: 'DRAFT' } })).id;
    expect((await acc2.post(`/accounting/journals/${late}/post`)).body.error.code).toBe('PERIOD_CLOSED');
    await acc.post(`/accounting/journals/${late}/void`, { reason: 'ทดสอบ' });

    expect((await acc2.post('/accounting/year-end/2025/reopen', { reason: 'ปรับปรุงรายการตามผู้สอบบัญชี' })).body.status).toBe('OPEN');
    expect((await acc.get('/accounting/reports/balance-sheet?asOf=2025-12-31')).body.unclosedEarnings).toBe(380000);
    expect(bal(await tb('2025-12-31'), '3200')).toBe(0);
    expect((await acc2.post('/accounting/year-end/2025/close')).body.status).toBe('CLOSED'); // close again
    expect(bal(await tb('2025-12-31'), '3200')).toBe(380000);
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'FiscalYear' }, orderBy: { id: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['CLOSE', 'REOPEN', 'CLOSE']);
  });
});

describe('ภ.ง.ด.1', () => {
  it('salary withholding entered on payroll is deducted, posted and reported', async () => {
    await prisma.employee.update({ where: { id: f.captain.id }, data: { payType: 'MONTHLY', baseRate: 30000, nationalIdNo: '1100700000011' } });
    const p = (await acc.post('/payroll/periods', { name: 'งวดภาษี', startDate: iso(-20), endDate: iso(5) })).body;
    expect((await acc.post(`/payroll/periods/${p.id}/adjustments`, { employeeId: f.captain.id, code: 'WITHHOLDING_TAX', description: 'ภาษีเงินได้หัก ณ ที่จ่าย', amount: 500 })).status).toBe(201);
    await acc.post(`/payroll/periods/${p.id}/calculate`);
    await acc2.post(`/payroll/periods/${p.id}/approve`);
    expect((await acc2.post(`/payroll/periods/${p.id}/pay`, { paidAt: new Date(Date.now() - 60_000).toISOString(), method: 'TRANSFER' })).status).toBe(200);
    const rec = await prisma.payrollRecord.findFirstOrThrow({ where: { periodId: p.id, employeeId: f.captain.id } });
    expect(Number(rec.deduction)).toBe(500);

    const today = toISODate();
    const r = (await acc.get(`/accounting/tax/pnd1?year=${today.slice(0, 4)}&month=${Number(today.slice(5, 7))}`)).body;
    expect(r.totals).toMatchObject({ count: 1, tax: 500 });
    expect(r.rows[0]).toMatchObject({ employeeId: f.captain.id, income: Number(rec.gross), tax: 500 });
    expect(r.rows[0].nationalIdNo).not.toBe('1100700000011'); // accountant has no access to personal data
    expect((await acc.post('/accounting/auto-post')).body.exceptions).toEqual([]);
    expect(bal(await tb(iso(10)), '2160')).toBe(500);
  });
});
