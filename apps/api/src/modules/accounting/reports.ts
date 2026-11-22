// Financial reports from posted ledger lines (POSTED + REVERSED entries; reversals offset each other).
import { Prisma, prisma } from '../../lib/prisma';
import { num } from '../../lib/http';
import { r2 } from './ledger';

const LEDGER = Prisma.sql`e.status IN ('POSTED', 'REVERSED')`;
const dateSql = (d: string) => Prisma.sql`${d}::date`;
type Row = { id: string; code: string; name_th: string; type: string; normal_balance: string; parent_id: string | null };

/** Opening (before `from`), movements in [from, to], closing — debit-positive; `balance` shown on the normal side. */
export async function trialBalance(from: string, to: string) {
  const rows = await prisma.$queryRaw<(Row & { opening: string; dr: string; cr: string })[]>`
    SELECT a.id, a.code, a.name_th, a.type, a.normal_balance, a.parent_id,
      COALESCE(SUM(CASE WHEN e.entry_date < ${dateSql(from)} THEN l.debit - l.credit END), 0) AS opening,
      COALESCE(SUM(CASE WHEN e.entry_date >= ${dateSql(from)} THEN l.debit END), 0) AS dr,
      COALESCE(SUM(CASE WHEN e.entry_date >= ${dateSql(from)} THEN l.credit END), 0) AS cr
    FROM accounts a
    JOIN journal_lines l ON l.account_id = a.id
    JOIN journal_entries e ON e.id = l.entry_id AND ${LEDGER} AND e.entry_date <= ${dateSql(to)}
    GROUP BY a.id ORDER BY a.code`;
  const items = rows.map((r) => {
    const opening = num(r.opening);
    const dr = num(r.dr);
    const cr = num(r.cr);
    const closing = r2(opening + dr - cr);
    const sign = r.normal_balance === 'DEBIT' ? 1 : -1;
    return { accountId: r.id, code: r.code, nameTh: r.name_th, type: r.type, normalBalance: r.normal_balance, opening: r2(opening), debit: r2(dr), credit: r2(cr), closing, balance: r2(closing * sign) };
  });
  const totals = {
    debit: r2(items.reduce((s, i) => s + i.debit, 0)),
    credit: r2(items.reduce((s, i) => s + i.credit, 0)),
    closingDebit: r2(items.reduce((s, i) => s + Math.max(0, i.closing), 0)),
    closingCredit: r2(items.reduce((s, i) => s + Math.max(0, -i.closing), 0)),
  };
  return { from, to, items, totals, balanced: totals.debit === totals.credit && totals.closingDebit === totals.closingCredit };
}

/** Income statement for [from, to]; optional vessel dimension; breakdown per vessel (unallocated = no vessel on the line). */
export async function profitLoss(from: string, to: string, vesselId?: string) {
  const vf = vesselId ? Prisma.sql`AND l.vessel_id = ${vesselId}::uuid` : Prisma.empty;
  const rows = await prisma.$queryRaw<(Row & { amt: string })[]>`
    SELECT a.id, a.code, a.name_th, a.type, a.normal_balance, a.parent_id, SUM(l.credit - l.debit) AS amt
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE ${LEDGER} AND e.entry_date BETWEEN ${dateSql(from)} AND ${dateSql(to)} AND a.type IN ('REVENUE', 'EXPENSE') ${vf}
    GROUP BY a.id ORDER BY a.code`;
  // revenue shown as credit − debit (contra revenue becomes negative); expenses as debit − credit
  const revenue = rows.filter((r) => r.type === 'REVENUE').map((r) => ({ accountId: r.id, code: r.code, nameTh: r.name_th, amount: r2(num(r.amt)) }));
  const expenses = rows.filter((r) => r.type === 'EXPENSE').map((r) => ({ accountId: r.id, code: r.code, nameTh: r.name_th, amount: r2(-num(r.amt)) }));
  const totalRevenue = r2(revenue.reduce((s, r) => s + r.amount, 0));
  const totalExpense = r2(expenses.reduce((s, r) => s + r.amount, 0));
  const vrows = await prisma.$queryRaw<{ vessel_id: string | null; code: string | null; name: string | null; revenue: string; expense: string }[]>`
    SELECT l.vessel_id, v.code, v.name,
      COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN l.credit - l.debit END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN l.debit - l.credit END), 0) AS expense
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    LEFT JOIN vessels v ON v.id = l.vessel_id
    WHERE ${LEDGER} AND e.entry_date BETWEEN ${dateSql(from)} AND ${dateSql(to)} AND a.type IN ('REVENUE', 'EXPENSE') ${vf}
    GROUP BY l.vessel_id, v.code, v.name ORDER BY v.code NULLS LAST`;
  const byVessel = vrows.map((v) => ({
    vesselId: v.vessel_id, code: v.code, name: v.name ?? 'ไม่ระบุเรือ (ส่วนกลาง)',
    revenue: r2(num(v.revenue)), expense: r2(num(v.expense)), profit: r2(num(v.revenue) - num(v.expense)),
  }));
  return { from, to, vesselId: vesselId ?? null, revenue, expenses, totalRevenue, totalExpense, netProfit: r2(totalRevenue - totalExpense), byVessel };
}

/** Statement of financial position as of a date. Profit not yet closed to retained earnings is shown inside equity. */
export async function balanceSheet(asOf: string) {
  const rows = await prisma.$queryRaw<(Row & { bal: string })[]>`
    SELECT a.id, a.code, a.name_th, a.type, a.normal_balance, a.parent_id, SUM(l.debit - l.credit) AS bal
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE ${LEDGER} AND e.entry_date <= ${dateSql(asOf)}
    GROUP BY a.id ORDER BY a.code`;
  const pick = (type: string, sign: 1 | -1) =>
    rows.filter((r) => r.type === type).map((r) => ({ accountId: r.id, code: r.code, nameTh: r.name_th, amount: r2(num(r.bal) * sign) })).filter((r) => r.amount !== 0);
  const assets = pick('ASSET', 1);
  const liabilities = pick('LIABILITY', -1);
  const equity = pick('EQUITY', -1);
  const earnings = r2(-rows.filter((r) => r.type === 'REVENUE' || r.type === 'EXPENSE').reduce((s, r) => s + num(r.bal), 0));
  const sum = (xs: { amount: number }[]) => r2(xs.reduce((s, x) => s + x.amount, 0));
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = r2(sum(equity) + earnings);
  return { asOf, assets, liabilities, equity, unclosedEarnings: earnings, totalAssets, totalLiabilities, totalEquity, balanced: r2(totalAssets - totalLiabilities - totalEquity) === 0 };
}

/** Account ledger with opening balance and running balance (normal side). */
export async function generalLedger(accountId: string, from: string, to: string, vesselId?: string) {
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const sign = acc.normalBalance === 'DEBIT' ? 1 : -1;
  const vf = vesselId ? Prisma.sql`AND l.vessel_id = ${vesselId}::uuid` : Prisma.empty;
  const [open] = await prisma.$queryRaw<{ bal: string | null }[]>`
    SELECT SUM(l.debit - l.credit) AS bal FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ${accountId}::uuid AND ${LEDGER} AND e.entry_date < ${dateSql(from)} ${vf}`;
  const lines = await prisma.$queryRaw<
    { entry_id: string; entry_no: string; entry_date: Date; memo: string; description: string | null; debit: string; credit: string; source_type: string | null; source_id: string | null; source_ref: string | null; vessel_code: string | null; trip_no: string | null; trip_id: string | null }[]
  >`
    SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.memo, l.description, l.debit, l.credit, e.source_type, e.source_id, e.source_ref,
      v.code AS vessel_code, t.trip_no, l.trip_id
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    LEFT JOIN vessels v ON v.id = l.vessel_id LEFT JOIN fishing_trips t ON t.id = l.trip_id
    WHERE l.account_id = ${accountId}::uuid AND ${LEDGER} AND e.entry_date BETWEEN ${dateSql(from)} AND ${dateSql(to)} ${vf}
    ORDER BY e.entry_date, e.entry_no, l.line_no
    LIMIT 5000`;
  let running = r2(num(open?.bal) * sign);
  const opening = running;
  const items = lines.map((l) => {
    running = r2(running + (num(l.debit) - num(l.credit)) * sign);
    return {
      entryId: l.entry_id, entryNo: l.entry_no, entryDate: l.entry_date.toISOString().slice(0, 10), memo: l.memo, description: l.description,
      debit: num(l.debit), credit: num(l.credit), balance: running, sourceType: l.source_type, sourceId: l.source_id, sourceRef: l.source_ref,
      vesselCode: l.vessel_code, tripNo: l.trip_no, tripId: l.trip_id,
    };
  });
  return {
    account: { id: acc.id, code: acc.code, nameTh: acc.nameTh, normalBalance: acc.normalBalance }, from, to, opening, closing: running,
    totalDebit: r2(items.reduce((s, i) => s + i.debit, 0)), totalCredit: r2(items.reduce((s, i) => s + i.credit, 0)), items, truncated: lines.length === 5000,
  };
}

const monthBounds = (y: number, m: number) => {
  const mm = String(m).padStart(2, '0');
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = `${y}-${mm}-01`;
  const end = `${y}-${mm}-${String(last).padStart(2, '0')}`;
  return { start, end, startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${end}T00:00:00Z`), startTs: new Date(`${start}T00:00:00+07:00`), endTs: new Date(`${end}T23:59:59.999+07:00`) };
};

/** Output/input VAT for a tax month (basis for ภ.พ.30). Exempt (0 %) sales are totalled separately. */
export async function vatReport(y: number, m: number) {
  const b = monthBounds(y, m);
  const [invoices, returns, bills] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { status: 'CONFIRMED', invoiceDate: { gte: b.startDate, lte: b.endDate } },
      include: { customer: { select: { name: true, taxId: true, branch: true } } }, orderBy: [{ invoiceDate: 'asc' }, { invoiceNo: 'asc' }],
    }),
    prisma.salesReturn.findMany({
      where: { returnDate: { gte: b.startDate, lte: b.endDate }, invoice: { vatAmount: { gt: 0 } } },
      include: { items: { select: { amount: true } }, invoice: { select: { invoiceNo: true, customer: { select: { name: true, taxId: true, branch: true } } } } }, orderBy: { returnDate: 'asc' },
    }),
    prisma.vendorBill.findMany({
      where: { status: 'APPROVED', billDate: { gte: b.startDate, lte: b.endDate }, vatAmount: { gt: 0 } },
      include: { supplier: { select: { name: true, taxId: true, branch: true } } }, orderBy: [{ billDate: 'asc' }, { billNo: 'asc' }],
    }),
  ]);
  const base = (i: (typeof invoices)[number]) => r2(num(i.subtotal) - num(i.discount) + num(i.additionalCost));
  const output = invoices.filter((i) => num(i.vatAmount) > 0).map((i) => ({
    date: i.invoiceDate.toISOString().slice(0, 10), docNo: i.invoiceNo, name: i.customer.name, taxId: i.customer.taxId, branch: i.customer.branch, base: base(i), vat: num(i.vatAmount),
  }));
  const credits = returns.map((r) => {
    const net = r2(r.items.reduce((s, x) => s + num(x.amount), 0));
    return { date: r.returnDate.toISOString().slice(0, 10), docNo: r.creditNoteNo, refDocNo: r.invoice.invoiceNo, name: r.invoice.customer.name, taxId: r.invoice.customer.taxId, branch: r.invoice.customer.branch, base: net, vat: r2(num(r.amount) - net) };
  });
  const input = bills.map((x) => ({
    date: x.billDate.toISOString().slice(0, 10), docNo: x.supplierInvoiceNo, billNo: x.billNo, name: x.supplier.name, taxId: x.supplier.taxId, branch: x.supplier.branch, base: num(x.subtotal), vat: num(x.vatAmount),
  }));
  const sum = (xs: { base: number; vat: number }[]) => ({ base: r2(xs.reduce((s, x) => s + x.base, 0)), vat: r2(xs.reduce((s, x) => s + x.vat, 0)) });
  const exemptSales = r2(invoices.filter((i) => num(i.vatAmount) === 0).reduce((s, i) => s + base(i), 0));
  const o = sum(output);
  const c = sum(credits);
  const inp = sum(input);
  const outputVat = r2(o.vat - c.vat);
  return {
    year: y, month: m, output, credits, input, exemptSales,
    totals: { outputBase: r2(o.base - c.base), outputVat, inputBase: inp.base, inputVat: inp.vat, netVat: r2(outputVat - inp.vat) },
  };
}

/** Withholding tax on supplier payments for a month, split into ภ.ง.ด.3 (individuals) and ภ.ง.ด.53 (companies). */
export async function whtReport(y: number, m: number) {
  const b = monthBounds(y, m);
  const rows = await prisma.vendorPayment.findMany({
    where: { status: 'POSTED', whtAmount: { gt: 0 }, paidAt: { gte: b.startTs, lte: b.endTs } },
    include: { supplier: { select: { name: true, taxId: true, branch: true, address: true, isIndividual: true } } }, orderBy: { paidAt: 'asc' },
  });
  const map = (x: (typeof rows)[number]) => ({
    date: x.paidAt.toISOString(), paymentNo: x.paymentNo, name: x.supplier.name, taxId: x.supplier.taxId, branch: x.supplier.branch, address: x.supplier.address,
    base: num(x.whtBase), rate: num(x.whtRate), wht: num(x.whtAmount),
  });
  const pnd3 = rows.filter((x) => x.supplier.isIndividual).map(map);
  const pnd53 = rows.filter((x) => !x.supplier.isIndividual).map(map);
  const t = (xs: { base: number; wht: number }[]) => ({ count: xs.length, base: r2(xs.reduce((s, x) => s + x.base, 0)), wht: r2(xs.reduce((s, x) => s + x.wht, 0)) });
  return { year: y, month: m, pnd3, pnd53, totals: { pnd3: t(pnd3), pnd53: t(pnd53) }, missingTaxId: rows.filter((x) => !x.supplier.taxId).length };
}
