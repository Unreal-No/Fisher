// Automatic posting: turns operational documents into journal entries, idempotently
// (unique source_type + source_id + source_event). Void/cancel events mirror the original entry exactly.
import type { FastifyRequest } from 'fastify';
import { EARNING_CODES, toISODate, type AccountMapKey, type JournalSource } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { num } from '../../lib/http';
import { Prisma, prisma, type DbOrTx } from '../../lib/prisma';
import { createEntry, r2, reverseEntry } from './ledger';

interface DraftLine {
  key: AccountMapKey;
  /** explicit ledger account (bill expense lines, bank accounts); overrides `key` */
  accountId?: string | null;
  debit?: number;
  credit?: number;
  vesselId?: string | null;
  tripId?: string | null;
  description?: string | null;
}
export interface Draft {
  type: JournalSource;
  id: string;
  event: string;
  date: string;
  ref: string;
  memo: string;
  amount: number;
  lines?: DraftLine[];
  /** mirror the entry posted for this event of the same document */
  reverses?: string;
}
type Collector = (db: DbOrTx, posted: Set<string>, to: Date) => Promise<Draft[]>;

const cashKey = (method: string | null | undefined): AccountMapKey => (method === 'CASH' ? 'CASH' : 'BANK');
const day = (d: Date) => toISODate(d);
const dateCol = (d: Date) => d.toISOString().slice(0, 10); // @db.Date columns are stored at UTC midnight
const k = (id: string, event: string) => `${id}:${event}`;

async function postedKeys(db: DbOrTx, type: JournalSource) {
  const rows = await db.journalEntry.findMany({ where: { sourceType: type }, select: { sourceId: true, sourceEvent: true } });
  return new Set(rows.map((r) => k(r.sourceId!, r.sourceEvent!)));
}
/** group amounts by trip (keeps vessel) — revenue/cost lines per trip for vessel/trip profitability */
function byTrip<T>(rows: T[], get: (r: T) => { tripId: string | null; vesselId: string | null; amount: number }) {
  const m = new Map<string, { tripId: string | null; vesselId: string | null; amount: number }>();
  for (const r of rows) {
    const g = get(r);
    const key = `${g.vesselId}|${g.tripId}`;
    const cur = m.get(key) ?? { tripId: g.tripId, vesselId: g.vesselId, amount: 0 };
    cur.amount = r2(cur.amount + g.amount);
    m.set(key, cur);
  }
  return [...m.values()].filter((x) => x.amount !== 0);
}

const COLLECTORS: Record<JournalSource, Collector> = {
  async SALES_INVOICE(db, posted, to) {
    const rows = await db.salesInvoice.findMany({
      where: { confirmedAt: { not: null }, invoiceDate: { lte: to } },
      include: { items: true, customer: { select: { name: true } } },
    });
    const out: Draft[] = [];
    for (const inv of rows) {
      const ref = inv.invoiceNo ?? inv.orderNo;
      if (!posted.has(k(inv.id, 'CONFIRM'))) {
        const rev = byTrip(inv.items, (i) => ({ tripId: i.tripId, vesselId: i.vesselId, amount: num(i.lineTotal) - num(i.discountShare) }));
        const lines: DraftLine[] = [
          { key: 'AR', debit: num(inv.total), description: inv.customer.name },
          ...rev.map((r) => ({ key: 'SALES_REVENUE' as const, credit: r.amount, tripId: r.tripId, vesselId: r.vesselId })),
          { key: 'OTHER_INCOME', credit: num(inv.additionalCost), description: 'ค่าใช้จ่ายเรียกเก็บเพิ่ม' },
          { key: 'VAT_OUTPUT', credit: num(inv.vatAmount) },
        ];
        // rounding of discount shares: put a tiny difference on the largest revenue line
        const diff = r2(num(inv.total) - lines.slice(1).reduce((s, l) => s + (l.credit ?? 0), 0));
        if (diff !== 0 && Math.abs(diff) <= 0.05 && rev.length) {
          const big = lines.filter((l) => l.key === 'SALES_REVENUE').sort((a, b) => (b.credit ?? 0) - (a.credit ?? 0))[0]!;
          big.credit = r2((big.credit ?? 0) + diff);
        }
        out.push({ type: 'SALES_INVOICE', id: inv.id, event: 'CONFIRM', date: dateCol(inv.invoiceDate), ref, memo: `ขาย ${ref} ${inv.customer.name}`, amount: num(inv.total), lines });
      }
      if (inv.voidedAt && inv.voidedAt <= to && !posted.has(k(inv.id, 'VOID')))
        out.push({ type: 'SALES_INVOICE', id: inv.id, event: 'VOID', date: day(inv.voidedAt), ref, memo: `ยกเลิกใบแจ้งหนี้ ${ref}: ${inv.voidReason ?? ''}`, amount: num(inv.total), reverses: 'CONFIRM' });
    }
    return out;
  },

  async SALES_PAYMENT(db, posted, to) {
    const rows = await db.salesPayment.findMany({ where: { paidAt: { lte: to } }, include: { invoice: { select: { invoiceNo: true, customer: { select: { name: true } } } } } });
    const out: Draft[] = [];
    for (const p of rows) {
      if (!posted.has(k(p.id, 'RECEIVE')))
        out.push({
          type: 'SALES_PAYMENT', id: p.id, event: 'RECEIVE', date: day(p.paidAt), ref: p.receiptNo, amount: num(p.amount),
          memo: `รับชำระ ${p.receiptNo} (${p.invoice.invoiceNo ?? ''}) ${p.invoice.customer.name}`,
          lines: [{ key: cashKey(p.method), debit: num(p.amount), description: p.reference }, { key: 'AR', credit: num(p.amount), description: p.invoice.customer.name }],
        });
      if (p.voidedAt && p.voidedAt <= to && !posted.has(k(p.id, 'VOID')))
        out.push({ type: 'SALES_PAYMENT', id: p.id, event: 'VOID', date: day(p.voidedAt), ref: p.receiptNo, amount: num(p.amount), memo: `ยกเลิกใบเสร็จ ${p.receiptNo}: ${p.voidReason ?? ''}`, reverses: 'RECEIVE' });
    }
    return out;
  },

  async SALES_RETURN(db, posted, to) {
    const rows = await db.salesReturn.findMany({
      where: { returnDate: { lte: to } },
      include: { items: { include: { salesItem: { select: { tripId: true, vesselId: true } } } }, invoice: { select: { invoiceNo: true, customer: { select: { name: true } } } } },
    });
    return rows
      .filter((r) => !posted.has(k(r.id, 'CREDIT')))
      .map((r) => {
        const net = byTrip(r.items, (i) => ({ tripId: i.salesItem.tripId, vesselId: i.salesItem.vesselId, amount: num(i.amount) }));
        const vat = r2(num(r.amount) - net.reduce((s, x) => s + x.amount, 0));
        return {
          type: 'SALES_RETURN' as const, id: r.id, event: 'CREDIT', date: dateCol(r.returnDate), ref: r.creditNoteNo, amount: num(r.amount),
          memo: `ใบลดหนี้ ${r.creditNoteNo} (${r.invoice.invoiceNo ?? ''}) ${r.reason}`,
          lines: [
            ...net.map((x) => ({ key: 'SALES_RETURNS' as const, debit: x.amount, tripId: x.tripId, vesselId: x.vesselId })),
            ...(vat > 0 ? [{ key: 'VAT_OUTPUT' as const, debit: vat }] : []),
            { key: 'AR' as const, credit: num(r.amount), description: r.invoice.customer.name },
          ],
        };
      });
  },

  async GOODS_RECEIPT(db, posted, to) {
    const rows = await db.goodsReceipt.findMany({
      where: { receivedAt: { lte: to } },
      include: { items: true, po: { select: { poNo: true, vesselId: true, supplier: { select: { name: true } } } } },
    });
    const supplyIds = rows.flatMap((g) => g.items.map((i) => i.tripSupplyId).filter(Boolean)) as string[];
    const supplies = supplyIds.length ? await db.tripSupply.findMany({ where: { id: { in: supplyIds } }, select: { id: true, tripId: true, trip: { select: { vesselId: true } } } }) : [];
    return rows
      .filter((g) => !posted.has(k(g.id, 'RECEIVE')))
      .map((g) => {
        const toStock = r2(g.items.filter((i) => i.stockMovementId).reduce((s, i) => s + num(i.lineTotal), 0));
        const direct = byTrip(g.items.filter((i) => i.tripSupplyId), (i) => {
          const s = supplies.find((x) => x.id === i.tripSupplyId);
          return { tripId: s?.tripId ?? null, vesselId: s?.trip.vesselId ?? null, amount: num(i.lineTotal) };
        });
        // non-stock lines on an order without a trip: expense of the order's vessel (or company-level)
        const other = r2(g.items.filter((i) => !i.stockMovementId && !i.tripSupplyId).reduce((s, i) => s + num(i.lineTotal), 0));
        const total = r2(toStock + other + direct.reduce((s, x) => s + x.amount, 0));
        return {
          type: 'GOODS_RECEIPT' as const, id: g.id, event: 'RECEIVE', date: day(g.receivedAt), ref: g.grNo, amount: total,
          memo: `รับสินค้า ${g.grNo} (${g.po.poNo}) ${g.po.supplier.name}`,
          lines: [
            { key: 'INVENTORY' as const, debit: toStock },
            ...direct.map((x) => ({ key: 'SUPPLIES_EXPENSE' as const, debit: x.amount, tripId: x.tripId, vesselId: x.vesselId })),
            { key: 'SUPPLIES_EXPENSE' as const, debit: other, vesselId: g.po.vesselId },
            { key: 'GRNI' as const, credit: total, description: `${g.po.supplier.name}${g.supplierInvoiceNo ? ` ใบกำกับ ${g.supplierInvoiceNo}` : ''}` },
          ],
        };
      })
      .filter((d) => d.amount > 0);
  },

  async STOCK_MOVEMENT(db, posted, to) {
    // GR receipts are posted with the goods receipt; transfers stay inside the inventory account
    const rows = await db.stockMovement.findMany({
      where: { movedAt: { lte: to }, refType: { not: 'GR' }, type: { in: ['RECEIPT', 'ISSUE', 'ADJUSTMENT'] }, totalCost: { not: 0 } },
      include: { item: { select: { code: true, name: true } } },
    });
    return rows
      .filter((m) => !posted.has(k(m.id, 'POST')))
      .map((m) => {
        const amt = Math.abs(num(m.totalCost));
        const what = `${m.item.code} ${m.item.name}`;
        const base = { type: 'STOCK_MOVEMENT' as const, id: m.id, event: 'POST', date: day(m.movedAt), ref: m.moveNo, amount: amt };
        if (m.type === 'RECEIPT')
          return { ...base, memo: `รับเข้าคลังไม่ผ่านใบสั่งซื้อ ${m.moveNo} ${what}`, lines: [{ key: 'INVENTORY' as const, debit: amt }, { key: 'GRNI' as const, credit: amt }] };
        if (m.type === 'ISSUE') {
          const exp: AccountMapKey = m.refType === 'MAINTENANCE' ? 'MAINTENANCE_EXPENSE' : 'SUPPLIES_EXPENSE';
          return { ...base, memo: `เบิก ${m.moveNo} ${what}`, lines: [{ key: exp, debit: amt, vesselId: m.vesselId, tripId: m.tripId }, { key: 'INVENTORY' as const, credit: amt }] };
        }
        return num(m.totalCost) > 0
          ? { ...base, memo: `ปรับยอดคลังเพิ่ม ${m.moveNo} ${what}`, lines: [{ key: 'INVENTORY' as const, debit: amt }, { key: 'INVENTORY_VARIANCE' as const, credit: amt }] }
          : { ...base, memo: `ปรับยอดคลังลด ${m.moveNo} ${what}`, lines: [{ key: 'INVENTORY_VARIANCE' as const, debit: amt }, { key: 'INVENTORY' as const, credit: amt }] };
      });
  },

  async FUEL_TXN(db, posted, to) {
    const rows = await db.fuelTransaction.findMany({ where: { txnDate: { lte: to }, totalCost: { not: 0 } }, include: { tank: { select: { code: true } } } });
    return rows
      .filter((t) => !posted.has(k(t.id, 'POST')))
      .map((t) => {
        const amt = Math.abs(num(t.totalCost));
        const base = { type: 'FUEL_TXN' as const, id: t.id, event: 'POST', date: day(t.txnDate), ref: t.txnNo, amount: amt };
        const liters = `${Math.abs(num(t.liters))} ลิตร`;
        if (t.type === 'RECEIPT')
          return { ...base, memo: `รับน้ำมันเข้าถัง ${t.tank.code} ${liters} ${t.supplierName ?? ''}`, lines: [{ key: 'FUEL_INVENTORY' as const, debit: amt }, { key: 'GRNI' as const, credit: amt, description: t.docNo }] };
        if (t.type === 'ISSUE')
          return { ...base, memo: `จ่ายน้ำมันจากถัง ${t.tank.code} ${liters}`, lines: [{ key: 'FUEL_EXPENSE' as const, debit: amt, vesselId: t.vesselId, tripId: t.tripId }, { key: 'FUEL_INVENTORY' as const, credit: amt }] };
        return num(t.totalCost) > 0
          ? { ...base, memo: `ปรับยอดถัง ${t.tank.code} เพิ่ม ${liters}`, lines: [{ key: 'FUEL_INVENTORY' as const, debit: amt }, { key: 'INVENTORY_VARIANCE' as const, credit: amt }] }
          : { ...base, memo: `ปรับยอดถัง ${t.tank.code} ลด ${liters}`, lines: [{ key: 'INVENTORY_VARIANCE' as const, debit: amt }, { key: 'FUEL_INVENTORY' as const, credit: amt }] };
      });
  },

  async TRIP_FUEL(db, posted, to) {
    // fuel bought directly for a trip (not from a company tank)
    const rows = await db.tripFuel.findMany({
      where: { recordedAt: { lte: to }, fuelTxn: null, totalCost: { gt: 0 } },
      include: { trip: { select: { tripNo: true, vesselId: true } } },
    });
    return rows
      .filter((f) => !posted.has(k(f.id, 'POST')))
      .map((f) => ({
        type: 'TRIP_FUEL' as const, id: f.id, event: 'POST', date: day(f.recordedAt), ref: f.trip.tripNo, amount: num(f.totalCost),
        memo: `น้ำมันซื้อตรงเข้าเที่ยว ${f.trip.tripNo} ${num(f.liters)} ลิตร ${f.supplierName ?? ''}`,
        lines: [{ key: 'FUEL_EXPENSE' as const, debit: num(f.totalCost), tripId: f.tripId, vesselId: f.trip.vesselId }, { key: 'GRNI' as const, credit: num(f.totalCost), description: f.supplierName }],
      }));
  },

  async TRIP_SUPPLY(db, posted, to) {
    // supplies bought directly (not issued from stock, not from a purchase order receipt)
    const fromGr = (await db.goodsReceiptItem.findMany({ where: { tripSupplyId: { not: null } }, select: { tripSupplyId: true } })).map((x) => x.tripSupplyId!);
    const rows = await db.tripSupply.findMany({
      where: { createdAt: { lte: to }, stockMove: null, totalCost: { gt: 0 }, id: { notIn: fromGr } },
      include: { trip: { select: { tripNo: true, vesselId: true } } },
    });
    return rows
      .filter((s) => !posted.has(k(s.id, 'POST')))
      .map((s) => ({
        type: 'TRIP_SUPPLY' as const, id: s.id, event: 'POST', date: day(s.createdAt), ref: s.trip.tripNo, amount: num(s.totalCost),
        memo: `เสบียง/วัสดุเข้าเที่ยว ${s.trip.tripNo}: ${s.description}`,
        lines: [{ key: 'SUPPLIES_EXPENSE' as const, debit: num(s.totalCost), tripId: s.tripId, vesselId: s.trip.vesselId }, { key: 'GRNI' as const, credit: num(s.totalCost) }],
      }));
  },

  async TRIP_EXPENSE(db, posted, to) {
    const rows = await db.tripExpense.findMany({
      where: { expenseDate: { lte: to }, isEstimate: false, amount: { gt: 0 } },
      include: { trip: { select: { tripNo: true, vesselId: true } } },
    });
    const keyOf = (c: string): AccountMapKey => (c === 'ICE' || c === 'FOOD' ? 'SUPPLIES_EXPENSE' : c === 'REPAIR' ? 'MAINTENANCE_EXPENSE' : 'TRIP_OTHER_EXPENSE');
    return rows
      .filter((x) => !posted.has(k(x.id, 'POST')))
      .map((x) => ({
        type: 'TRIP_EXPENSE' as const, id: x.id, event: 'POST', date: day(x.expenseDate), ref: x.trip.tripNo, amount: num(x.amount),
        memo: `ค่าใช้จ่ายเที่ยว ${x.trip.tripNo}: ${x.description}`,
        lines: [{ key: keyOf(x.category), debit: num(x.amount), tripId: x.tripId, vesselId: x.trip.vesselId }, { key: 'ACCRUED_EXPENSES' as const, credit: num(x.amount) }],
      }));
  },

  async MAINTENANCE_ORDER(db, posted, to) {
    // parts are posted from the stock issue; here only labour + external work
    const rows = await db.maintenanceOrder.findMany({ where: { status: 'COMPLETED', completedAt: { lte: to } } });
    return rows
      .filter((o) => !posted.has(k(o.id, 'COMPLETE')) && num(o.laborCost) + num(o.externalCost) > 0)
      .map((o) => {
        const amt = r2(num(o.laborCost) + num(o.externalCost));
        return {
          type: 'MAINTENANCE_ORDER' as const, id: o.id, event: 'COMPLETE', date: day(o.completedAt!), ref: o.orderNo, amount: amt, memo: `ค่าซ่อม ${o.orderNo} ${o.title}`,
          lines: [{ key: 'MAINTENANCE_EXPENSE' as const, debit: amt, vesselId: o.vesselId }, { key: 'ACCRUED_EXPENSES' as const, credit: amt, description: o.invoiceNo }],
        };
      });
  },

  async PAYROLL_PERIOD(db, posted, to) {
    const rows = await db.payrollPeriod.findMany({
      where: { approvedAt: { not: null, lte: to } },
      include: { records: { include: { items: { select: { code: true, amount: true, tripId: true } } } } },
    });
    const tripIds = [...new Set(rows.flatMap((p) => p.records.flatMap((r) => r.items.map((i) => i.tripId))).filter(Boolean))] as string[];
    const tripVessel = new Map((tripIds.length ? await db.fishingTrip.findMany({ where: { id: { in: tripIds } }, select: { id: true, vesselId: true } }) : []).map((t) => [t.id, t.vesselId]));
    const out: Draft[] = [];
    for (const p of rows) {
      if (!posted.has(k(p.id, 'APPROVE'))) {
        // trip-based pay is charged to that trip's vessel/trip; other earnings to the record's home vessel
        const earnings = p.records.flatMap((r) => r.items.filter((i) => (EARNING_CODES as readonly string[]).includes(i.code)).map((i) => ({ ...i, home: r.vesselId })));
        const wages = byTrip(earnings, (i) => ({ tripId: i.tripId, vesselId: i.tripId ? (tripVessel.get(i.tripId) ?? i.home) : i.home, amount: num(i.amount) }));
        const sum = (codes: string[]) => r2(p.records.flatMap((r) => r.items).filter((i) => codes.includes(i.code)).reduce((s, i) => s + num(i.amount), 0));
        out.push({
          type: 'PAYROLL_PERIOD', id: p.id, event: 'APPROVE', date: day(p.approvedAt!), ref: p.code, amount: num(p.totalGross), memo: `ค่าแรง ${p.code} ${p.name}`,
          lines: [
            ...wages.map((w) => ({ key: 'CREW_WAGES' as const, debit: w.amount, vesselId: w.vesselId, tripId: w.tripId })),
            { key: 'EMPLOYEE_ADVANCES', credit: sum(['ADVANCE_RECOVERY', 'LOAN_REPAYMENT']), description: 'หักคืนเงินเบิก/เงินกู้' },
            { key: 'OTHER_INCOME', credit: sum(['OTHER_DEDUCTION']), description: 'รายการหักพนักงานอื่น' },
            { key: 'ACCRUED_WAGES', credit: num(p.totalNet) },
          ],
        });
      }
      if (p.paidAt && p.paidAt <= to && !posted.has(k(p.id, 'PAY')))
        out.push({
          type: 'PAYROLL_PERIOD', id: p.id, event: 'PAY', date: day(p.paidAt), ref: p.code, amount: num(p.totalNet), memo: `จ่ายค่าแรง ${p.code}${p.payReference ? ` (${p.payReference})` : ''}`,
          lines: [{ key: 'ACCRUED_WAGES', debit: num(p.totalNet) }, { key: cashKey(p.payMethod), credit: num(p.totalNet) }],
        });
      if (p.status === 'CANCELLED' && p.updatedAt <= to && !posted.has(k(p.id, 'CANCEL')))
        out.push({ type: 'PAYROLL_PERIOD', id: p.id, event: 'CANCEL', date: day(p.updatedAt), ref: p.code, amount: num(p.totalGross), memo: `ยกเลิกงวด ${p.code}: ${p.cancelReason ?? ''}`, reverses: 'APPROVE' });
    }
    return out;
  },

  async VENDOR_BILL(db, posted, to) {
    const rows = await db.vendorBill.findMany({
      where: { approvedAt: { not: null }, billDate: { lte: to } },
      include: { lines: { include: { goodsReceipt: { select: { grNo: true } } } }, supplier: { select: { name: true } } },
    });
    const out: Draft[] = [];
    for (const b of rows) {
      const memo = `ตั้งหนี้ ${b.billNo} ${b.supplier.name} ใบกำกับ ${b.supplierInvoiceNo}`;
      if (!posted.has(k(b.id, 'APPROVE')))
        out.push({
          type: 'VENDOR_BILL', id: b.id, event: 'APPROVE', date: dateCol(b.billDate), ref: b.billNo, amount: num(b.total), memo,
          lines: [
            ...b.lines.map((l) =>
              l.kind === 'GR'
                ? { key: 'GRNI' as const, debit: num(l.amount), description: `ล้าง ${l.goodsReceipt?.grNo ?? ''}` }
                : { key: 'GRNI' as const, accountId: l.accountId, debit: num(l.amount), vesselId: l.vesselId, tripId: l.tripId, description: l.description },
            ),
            { key: 'VAT_INPUT', debit: num(b.vatAmount) },
            { key: 'AP', credit: num(b.total), description: b.supplier.name },
          ],
        });
      if (b.status === 'VOID' && b.voidedAt && b.voidedAt <= to && !posted.has(k(b.id, 'VOID')))
        out.push({ type: 'VENDOR_BILL', id: b.id, event: 'VOID', date: day(b.voidedAt), ref: b.billNo, amount: num(b.total), memo: `ยกเลิก ${b.billNo}: ${b.voidReason ?? ''}`, reverses: 'APPROVE' });
    }
    return out;
  },

  async VENDOR_PAYMENT(db, posted, to) {
    const rows = await db.vendorPayment.findMany({ where: { paidAt: { lte: to } }, include: { supplier: { select: { name: true } }, bankAccount: { select: { glAccountId: true } } } });
    const out: Draft[] = [];
    for (const p of rows) {
      if (!posted.has(k(p.id, 'PAY')))
        out.push({
          type: 'VENDOR_PAYMENT', id: p.id, event: 'PAY', date: day(p.paidAt), ref: p.paymentNo, amount: num(p.grossAmount),
          memo: `จ่ายชำระ ${p.paymentNo} ${p.supplier.name}${p.reference ? ` (${p.reference})` : ''}`,
          lines: [
            { key: 'AP', debit: num(p.grossAmount), description: p.supplier.name },
            { key: cashKey(p.method), accountId: p.bankAccount?.glAccountId ?? null, credit: num(p.netAmount) },
            { key: 'WHT_PAYABLE', credit: num(p.whtAmount), description: p.whtRate ? `หัก ณ ที่จ่าย ${num(p.whtRate)}%` : null },
          ],
        });
      if (p.status === 'VOID' && p.voidedAt && p.voidedAt <= to && !posted.has(k(p.id, 'VOID')))
        out.push({ type: 'VENDOR_PAYMENT', id: p.id, event: 'VOID', date: day(p.voidedAt), ref: p.paymentNo, amount: num(p.grossAmount), memo: `ยกเลิกการจ่าย ${p.paymentNo}: ${p.voidReason ?? ''}`, reverses: 'PAY' });
    }
    return out;
  },

  async EMPLOYEE_ADVANCE(db, posted, to) {
    const rows = await db.employeeAdvance.findMany({ where: { advanceDate: { lte: to } }, include: { employee: { select: { code: true, firstName: true, lastName: true } } } });
    const out: Draft[] = [];
    for (const a of rows) {
      const who = `${a.employee.code} ${a.employee.firstName} ${a.employee.lastName}`;
      if (!posted.has(k(a.id, 'ISSUE')))
        out.push({
          type: 'EMPLOYEE_ADVANCE', id: a.id, event: 'ISSUE', date: dateCol(a.advanceDate), ref: a.advanceNo, amount: num(a.amount),
          memo: `${a.kind === 'LOAN' ? 'ให้กู้' : 'จ่ายเงินเบิก'} ${a.advanceNo} ${who}`,
          lines: [{ key: 'EMPLOYEE_ADVANCES', debit: num(a.amount), description: who }, { key: cashKey(a.method), credit: num(a.amount) }],
        });
      if (a.status === 'CANCELLED' && a.updatedAt <= to && !posted.has(k(a.id, 'CANCEL')))
        out.push({ type: 'EMPLOYEE_ADVANCE', id: a.id, event: 'CANCEL', date: day(a.updatedAt), ref: a.advanceNo, amount: num(a.amount), memo: `ยกเลิก ${a.advanceNo}: ${a.cancelReason ?? ''}`, reverses: 'ISSUE' });
    }
    return out;
  },
};

/** All documents not yet posted, in posting order (date, then originals before reversals). */
export async function collectPending(db: DbOrTx, to: Date = new Date()) {
  const all: Draft[] = [];
  for (const [type, collect] of Object.entries(COLLECTORS) as [JournalSource, Collector][])
    all.push(...(await collect(db, await postedKeys(db, type), to)));
  return all.sort((a, b) => a.date.localeCompare(b.date) || Number(!!a.reverses) - Number(!!b.reverses) || a.ref.localeCompare(b.ref));
}

export interface PostException {
  type: JournalSource;
  id: string;
  event: string;
  ref: string;
  date: string;
  reason: string;
}

export async function loadMapping(db: DbOrTx) {
  const rows = await db.accountMapping.findMany();
  return new Map(rows.map((r) => [r.key as AccountMapKey, r.accountId]));
}

/** Post pending documents up to `to`; each document is its own transaction. */
export async function runAutoPost(req: FastifyRequest, to?: Date) {
  const drafts = await collectPending(prisma, to ?? new Date());
  const map = await loadMapping(prisma);
  const userId = req.user!.id;
  const posted: { type: JournalSource; ref: string; entryNo: string }[] = [];
  const exceptions: PostException[] = [];
  for (const d of drafts) {
    try {
      const entry = await prisma.$transaction(async (tx) => {
        if (d.reverses) {
          const orig = await tx.journalEntry.findFirst({ where: { sourceType: d.type, sourceId: d.id, sourceEvent: d.reverses } });
          if (!orig) throw new AppError(409, 'NO_ORIGINAL', 'ยังไม่มีรายการบัญชีของเอกสารต้นทาง');
          return reverseEntry(tx, userId, orig.id, d.date < dateCol(orig.entryDate) ? dateCol(orig.entryDate) : d.date, d.memo, { type: d.type, id: d.id, event: d.event, ref: d.ref });
        }
        const missing = d.lines!.filter((l) => (l.debit ?? 0) + (l.credit ?? 0) !== 0 && !l.accountId && !map.get(l.key)).map((l) => l.key);
        if (missing.length) throw new AppError(422, 'MAPPING_MISSING', `ยังไม่ได้กำหนดบัญชีสำหรับ: ${[...new Set(missing)].join(', ')}`);
        return createEntry(
          tx, userId,
          {
            entryDate: d.date, memo: d.memo, reference: d.ref, source: { type: d.type, id: d.id, event: d.event, ref: d.ref },
            lines: d.lines!.map((l) => ({ accountId: l.accountId ?? map.get(l.key)!, debit: l.debit ?? 0, credit: l.credit ?? 0, vesselId: l.vesselId, tripId: l.tripId, description: l.description })),
          },
          userId,
        );
      });
      posted.push({ type: d.type, ref: d.ref, entryNo: entry.entryNo });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // posted concurrently
      const reason = e instanceof AppError ? e.message : (e as Error).message.slice(0, 300);
      exceptions.push({ type: d.type, id: d.id, event: d.event, ref: d.ref, date: d.date, reason });
    }
  }
  await audit(prisma, req, { action: 'AUTO_POST', entityType: 'JournalEntry', after: { posted: posted.length, exceptions: exceptions.length, to: to ?? null, entries: posted.slice(0, 200).map((p) => p.entryNo) } });
  return { posted: posted.length, byType: countBy(posted.map((p) => p.type)), exceptions };
}

export const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
