import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toISODate } from '@fisher/shared';
import { dayCount, monthlyAmount, overlapDays, pickRule, planRecoveries, type RuleLite } from '../src/modules/payroll/calc';
import { ago, createUser, departedTrip, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let acc: Agent;
let hr: Agent;
let f: Awaited<ReturnType<typeof fixtures>>;
let tripId: string;

const rule = (o: Partial<RuleLite>): RuleLite => ({
  id: Math.random().toString(36), name: 'r', method: 'DAILY', vesselId: null, position: null, employeeId: null, rate: 1, basis: null,
  effectiveFrom: new Date('2026-01-01'), effectiveTo: null, ...o,
});

describe('calc helpers', () => {
  it('rule priority: employee > vessel > position > global; effective dates', () => {
    const at = new Date('2026-06-01T05:00:00Z');
    const emp = { id: 'e1', position: 'DECKHAND' };
    const rules = [
      rule({ id: 'global', rate: 300 }),
      rule({ id: 'pos', position: 'DECKHAND', rate: 350 }),
      rule({ id: 'vessel', vesselId: 'v1', rate: 380 }),
      rule({ id: 'emp', employeeId: 'e1', rate: 500, effectiveFrom: new Date('2026-07-01') }),
      rule({ id: 'other-emp', employeeId: 'e2', rate: 999 }),
    ];
    expect(pickRule(rules, 'DAILY', emp, 'v1', at)!.id).toBe('vessel');
    expect(pickRule(rules, 'DAILY', emp, 'v2', at)!.id).toBe('pos');
    expect(pickRule(rules, 'DAILY', { id: 'e3', position: 'COOK' }, null, at)!.id).toBe('global');
    expect(pickRule(rules, 'DAILY', emp, 'v1', new Date('2026-07-02T05:00:00Z'))!.id).toBe('emp');
    expect(pickRule(rules, 'MONTHLY', emp, 'v1', at)).toBeNull();
    expect(pickRule([rule({ effectiveTo: new Date('2026-05-31') })], 'DAILY', emp, null, at)).toBeNull();
  });
  it('monthly proration per calendar month, days at sea overlap, recoveries never exceed net', () => {
    expect(monthlyAmount(30000, '2026-02-01', '2026-02-28', '2025-01-01', null).amount).toBe(30000);
    expect(monthlyAmount(28000, '2026-02-01', '2026-02-28', '2026-02-15', null).amount).toBe(14000); // 14/28 days
    const two = monthlyAmount(31000, '2026-01-17', '2026-02-14', '2020-01-01', null); // 15/31 Jan + 14/28 Feb
    expect(two.parts).toEqual([{ month: '2026-01', days: 15, daysInMonth: 31 }, { month: '2026-02', days: 14, daysInMonth: 28 }]);
    expect(two.amount).toBe(30500);
    expect(monthlyAmount(30000, '2026-03-01', '2026-03-31', '2026-01-01', '2026-02-20').amount).toBe(0); // left before period
    expect(dayCount('2026-01-30', '2026-02-02')).toBe(4);
    expect(overlapDays('2026-01-28', '2026-02-03', '2026-02-01', '2026-02-28')).toBe(3);
    expect(planRecoveries(1500, [
      { advanceId: 'a', kind: 'ADVANCE', outstanding: 1000, installment: null },
      { advanceId: 'l', kind: 'LOAN', outstanding: 5000, installment: 2000 },
    ])).toEqual([{ advanceId: 'a', kind: 'ADVANCE', amount: 1000, limited: false }, { advanceId: 'l', kind: 'LOAN', amount: 500, limited: true }]);
    expect(planRecoveries(0, [{ advanceId: 'a', kind: 'ADVANCE', outstanding: 10, installment: null }])[0]).toMatchObject({ amount: 0, limited: true });
  });
});

describe('payroll API', () => {
  beforeAll(async () => {
    await resetDb();
    app = await makeApp();
    await createUser('admin', 'SUPER_ADMIN');
    await createUser('acc', 'ACCOUNTANT');
    await createUser('hr', 'HR_OFFICER');
    admin = await login(app, 'admin');
    acc = await login(app, 'acc');
    hr = await login(app, 'hr');
    f = await fixtures(admin);
    await prisma.employee.update({ where: { id: f.captain.id }, data: { payType: 'MONTHLY', baseRate: 30000, bankName: 'กสิกรไทย', bankAccountNo: '1234567890' } });
    await prisma.employee.update({ where: { id: f.crew.id }, data: { payType: 'DAILY', baseRate: 400 } });
    // a trip with 1,000 kg caught, 600 kg sold × 50 = 30,000 baht, closed now
    const sp = (await admin.get('/catch/species')).body as { id: string; code: string }[];
    const mack = sp.find((s) => s.code === 'MACK-S')!.id;
    const t = await departedTrip(admin, f);
    tripId = t.id;
    await admin.post('/catch/records', { tripId, speciesId: mack, catchDate: iso(-1), weightKg: 1000 });
    await admin.post(`/trips/${tripId}/arrive`, { arrivedAt: ago(1), arrivalPort: 'สงขลา', fuelAtArrivalL: 100 });
    const cust = (await admin.post('/sales/customers', { name: 'แพปลา' })).body;
    const inv = (await admin.post('/sales/invoices', { customerId: cust.id, invoiceDate: iso(0), items: [{ tripId, speciesId: mack, weightKg: 600, unitPrice: 50 }] })).body;
    expect((await admin.post(`/sales/invoices/${inv.id}/confirm`)).status).toBe(200);
    await admin.post(`/trips/${tripId}/status`, { status: 'PENDING_SETTLEMENT' });
    expect((await admin.post(`/trips/${tripId}/close`)).status).toBe(200);
  });
  afterAll(() => app.close());

  it('rules & advances: validation and permissions', async () => {
    expect((await acc.post('/payroll/rules', { name: 'x', method: 'REVENUE_SHARE', rate: 10, effectiveFrom: iso(-365) })).status).toBe(400); // no basis
    expect((await acc.post('/payroll/rules', { name: 'x', method: 'REVENUE_SHARE', basis: 'GROSS_REVENUE', rate: 120, effectiveFrom: iso(-365) })).status).toBe(400);
    expect((await hr.post('/payroll/rules', { name: 'x', method: 'DAILY', rate: 1, effectiveFrom: iso(-365) })).status).toBe(403);
    const share = await acc.post('/payroll/rules', { name: 'ส่วนแบ่งไต้ก๋ง', method: 'REVENUE_SHARE', basis: 'GROSS_REVENUE', rate: 10, vesselId: f.vessel.id, position: 'CAPTAIN', effectiveFrom: iso(-365) });
    expect(share.status).toBe(201);
    expect((await acc.post('/payroll/rules', { name: 'ค่าปลาลูกเรือ', method: 'CATCH_BASED', basis: 'CAUGHT_KG', rate: 0.5, position: 'DECKHAND', effectiveFrom: iso(-365) })).status).toBe(201);

    expect((await acc.post('/payroll/advances', { employeeId: f.captain.id, kind: 'LOAN', advanceDate: iso(-10), amount: 3000, reason: 'กู้' })).status).toBe(400); // no installment
    expect((await acc.post('/payroll/advances', { employeeId: f.captain.id, kind: 'LOAN', advanceDate: iso(-10), amount: 3000, installment: 5000, reason: 'กู้' })).status).toBe(400);
    const loan = await acc.post('/payroll/advances', { employeeId: f.captain.id, kind: 'LOAN', advanceDate: iso(-10), amount: 3000, installment: 1000, reason: 'ซ่อมบ้าน' });
    expect(loan.status).toBe(201);
    expect(loan.body.advanceNo).toMatch(/^ADV-\d{4}-\d{4}$/);
    expect((await acc.post('/payroll/advances', { employeeId: f.crew.id, kind: 'ADVANCE', advanceDate: iso(-5), amount: 500, reason: 'เบิกก่อนออกเรือ' })).status).toBe(201);
    const list = (await hr.get('/payroll/advances?status=OPEN')).body;
    expect(list.total).toBe(2);
    expect(list.outstandingTotal).toBe('3500.00');
  });

  it('calculate → segregation of duties → adjustments force recalculation → approve applies recoveries', async () => {
    const ps = iso(-40);
    const pe = iso(1);
    const p = await acc.post('/payroll/periods', { name: 'งวดทดสอบ', startDate: ps, endDate: pe });
    expect(p.status).toBe(201);
    expect(p.body.code).toMatch(/^PAY-\d{4}-001$/);
    expect((await hr.post(`/payroll/periods/${p.body.id}/calculate`)).status).toBe(403);
    expect((await acc.post(`/payroll/periods/${p.body.id}/approve`)).status).toBe(409); // not calculated yet

    expect((await acc.post(`/payroll/periods/${p.body.id}/adjustments`, { employeeId: f.captain.id, code: 'BONUS', description: 'โบนัสเที่ยวดี', amount: 2000 })).status).toBe(201);
    expect((await acc.post(`/payroll/periods/${p.body.id}/adjustments`, { employeeId: f.crew.id, code: 'SALARY', description: 'x', amount: 1 })).status).toBe(400); // not an adjustment code
    const c = await acc.post(`/payroll/periods/${p.body.id}/calculate`);
    expect(c.status).toBe(200);
    expect(c.body.records).toBe(2);
    expect(c.body.skipped).toEqual([]);

    const trip = await prisma.fishingTrip.findUniqueOrThrow({ where: { id: tripId } });
    const days = overlapDays(toISODate(trip.departedAt!), toISODate(trip.arrivedAt!), ps, pe);
    const salary = monthlyAmount(30000, ps, pe, toISODate(new Date(f.captain.startDate)), null).amount;
    const detail = (await hr.get(`/payroll/periods/${p.body.id}`)).body;
    const cap = detail.records.find((r: { employeeId: string }) => r.employeeId === f.captain.id);
    const crew = detail.records.find((r: { employeeId: string }) => r.employeeId === f.crew.id);
    // captain: prorated salary + 10% of 30,000 revenue + bonus; loan installment 1,000
    expect(Number(cap.gross)).toBeCloseTo(salary + 3000 + 2000, 2);
    expect(Number(cap.deduction)).toBe(1000);
    // crew: daily 400 × days at sea + 0.5 × 1,000 kg; advance 500 recovered
    expect(Number(crew.gross)).toBeCloseTo(days * 400 + 500, 2);
    expect(Number(crew.deduction)).toBe(500);
    expect(Number(detail.totalNet)).toBeCloseTo(salary + 5000 - 1000 + days * 400, 2);

    // calculator cannot approve own calculation
    const self = await acc.post(`/payroll/periods/${p.body.id}/approve`);
    expect(self.status).toBe(403);
    // a new adjustment sends the period back to DRAFT
    const ded = await acc.post(`/payroll/periods/${p.body.id}/adjustments`, { employeeId: f.crew.id, code: 'OTHER_DEDUCTION', description: 'ค่าอุปกรณ์เสียหาย', amount: 100 });
    expect(ded.status).toBe(201);
    const dirty = (await acc.get(`/payroll/periods/${p.body.id}`)).body;
    expect(dirty).toMatchObject({ status: 'DRAFT', needsRecalc: true });
    expect((await admin.post(`/payroll/periods/${p.body.id}/approve`)).status).toBe(409);
    await acc.post(`/payroll/periods/${p.body.id}/calculate`);
    const recalced = (await acc.get(`/payroll/periods/${p.body.id}`)).body;
    const crew2 = recalced.records.find((r: { employeeId: string }) => r.employeeId === f.crew.id);
    expect(Number(crew2.deduction)).toBe(600);
    if ((600 / Number(crew2.gross)) * 100 > 20) expect(crew2.warnings).toContain('DEDUCTION_OVER_LIMIT');

    const ok = await admin.post(`/payroll/periods/${p.body.id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    const advs = await prisma.employeeAdvance.findMany({ orderBy: { advanceNo: 'asc' } });
    expect(advs.map((a) => [a.kind, a.status, Number(a.recoveredAmount)])).toEqual([['LOAN', 'OPEN', 1000], ['ADVANCE', 'SETTLED', 500]]);
    expect((await acc.post(`/payroll/periods/${p.body.id}/adjustments`, { employeeId: f.crew.id, code: 'BONUS', description: 'x', amount: 1 })).status).toBe(409);

    // trip settlement now carries trip-based crew cost (daily + catch + share; not monthly salary)
    const st = (await admin.get(`/trips/${tripId}/settlement`)).body;
    expect(st.crewCost).toBeCloseTo(days * 400 + 500 + 3000, 2);
    expect(st.profitAfterCrew).toBeCloseTo(st.grossProfit - st.crewCost, 2);

    // overlapping period skips both employees
    const p2 = (await acc.post('/payroll/periods', { name: 'ซ้อน', startDate: iso(-10), endDate: iso(5) })).body;
    const c2 = (await acc.post(`/payroll/periods/${p2.id}/calculate`)).body;
    expect(c2.records).toBe(0);
    expect(c2.skipped).toHaveLength(2);
    expect(c2.skipped[0].reason).toContain(p.body.code);
    expect((await admin.post(`/payroll/periods/${p2.id}/cancel`, { reason: 'สร้างผิด' })).body.status).toBe('CANCELLED');

    // cancelling the approved period gives the recoveries back
    expect((await acc.post(`/payroll/periods/${p.body.id}/cancel`, { reason: 'คำนวณผิดงวด' })).status).toBe(200);
    const back = await prisma.employeeAdvance.findMany({ orderBy: { advanceNo: 'asc' } });
    expect(back.map((a) => [a.status, Number(a.recoveredAmount)])).toEqual([['OPEN', 0], ['OPEN', 0]]);
    expect((await admin.get(`/trips/${tripId}/settlement`)).body.crewCost).toBe(0);
  });

  it('pay, payslip masking, bank file, history, advance cancel rules, dashboard cost', async () => {
    const p = (await acc.post('/payroll/periods', { name: 'งวดจริง', startDate: iso(-40), endDate: iso(1), payDate: iso(2) })).body;
    const calc = (await acc.post(`/payroll/periods/${p.id}/calculate`)).body;
    expect(calc.records).toBe(2);
    expect((await acc.post(`/payroll/periods/${p.id}/pay`, { paidAt: ago(0), method: 'TRANSFER' })).status).toBe(409); // not approved
    expect((await admin.post(`/payroll/periods/${p.id}/approve`)).status).toBe(200);

    const detail = (await acc.get(`/payroll/periods/${p.id}`)).body;
    const capRec = detail.records.find((r: { employeeId: string }) => r.employeeId === f.captain.id);
    const slipAcc = (await acc.get(`/payroll/periods/${p.id}/records/${capRec.id}`)).body;
    expect(slipAcc.record.employee.bankAccountNo).not.toBe('1234567890'); // accountant has no employee.sensitive
    expect(slipAcc.record.items.find((i: { code: string }) => i.code === 'REVENUE_SHARE').calc.base).toBe(30000);
    expect(slipAcc.trips.map((t: { id: string }) => t.id)).toContain(tripId);
    expect((await hr.get(`/payroll/periods/${p.id}/records/${capRec.id}`)).body.record.employee.bankAccountNo).toBe('1234567890');

    expect((await acc.raw(`/payroll/periods/${p.id}/bank-file`)).status).toBe(403);
    const csv = await admin.raw(`/payroll/periods/${p.id}/bank-file`);
    expect(csv.status).toBe(200);
    expect(csv.headers['x-missing-accounts']).toBe('1'); // crew has no bank account
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.includes('1234567890'))).toContain(p.code);

    const paid = await admin.post(`/payroll/periods/${p.id}/pay`, { paidAt: ago(0), method: 'TRANSFER', reference: 'TRF-001' });
    expect(paid.body.status).toBe('PAID');
    expect((await admin.post(`/payroll/periods/${p.id}/cancel`, { reason: 'x' })).status).toBe(409);

    const hist = (await hr.get(`/payroll/employees/${f.crew.id}/history`)).body;
    expect(hist.records.map((r: { period: { status: string } }) => r.period.status)).toEqual(expect.arrayContaining(['PAID', 'CANCELLED']));

    const settled = await prisma.employeeAdvance.findFirstOrThrow({ where: { kind: 'ADVANCE' } });
    expect((await admin.post(`/payroll/advances/${settled.id}/cancel`, { reason: 'x' })).status).toBe(409);
    const fresh = (await acc.post('/payroll/advances', { employeeId: f.crew.id, kind: 'ADVANCE', advanceDate: iso(0), amount: 200, reason: 'บันทึกผิด' })).body;
    expect((await acc.post(`/payroll/advances/${fresh.id}/cancel`, { reason: 'บันทึกซ้ำ' })).body.status).toBe('CANCELLED');

    const dash = (await admin.get(`/dashboard/summary?from=${iso(-40)}&to=${iso(1)}`)).body;
    expect(dash.sales.payrollCost).toBeCloseTo(Number(detail.totalGross), 2);

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'PayrollPeriod', entityId: p.id }, orderBy: { id: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['CREATE', 'CALCULATE', 'APPROVE', 'EXPORT', 'PAY']);
  });
});
