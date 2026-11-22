import type { FastifyInstance } from 'fastify';
import {
  bankAccountSchema, bankRecItemsSchema, bankRecSchema, reasonSchema, toISODate, VENDOR_BILL_STATUS, VENDOR_PAYMENT_STATUS, vendorBillSchema,
  vendorPaymentSchema, type VendorBillStatus, type VendorPaymentStatus,
} from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { d, idParam, num, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { apAging, approveBill, createPayment, saveBill, unbilledReceipts, voidBill, voidPayment } from './ap';
import { completeRec, deleteDraftRec, recDetail, setRecItems } from './bank';
import { vatReport, whtReport } from './reports';

const supSel = { select: { id: true, code: true, name: true, taxId: true } } as const;
const ym = (q: Record<string, string | undefined>) => {
  const today = toISODate();
  const y = Number(q.year) || Number(today.slice(0, 4));
  const m = Number(q.month) || Number(today.slice(5, 7));
  if (y < 2000 || y > 2200 || m < 1 || m > 12) throw badRequest('เดือนภาษีไม่ถูกต้อง');
  return { y, m };
};

export default async function apRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (scopeIds(req)) throw forbidden('ข้อมูลบัญชีเป็นข้อมูลระดับบริษัท ผู้ใช้ที่จำกัดเฉพาะเรือเข้าถึงไม่ได้');
  });

  // ---------- supplier bills ----------
  app.get('/ap/bills', { preHandler: app.can('finance.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.VendorBillWhereInput = {
      ...((VENDOR_BILL_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as VendorBillStatus } : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.openOnly === 'true' ? { status: 'APPROVED' as const, paidAmount: { lt: prisma.vendorBill.fields.total } } : {}),
      ...(q.q ? { OR: [{ billNo: { contains: q.q, mode: 'insensitive' } }, { supplierInvoiceNo: { contains: q.q, mode: 'insensitive' } }, { supplier: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.vendorBill.findMany({ where, orderBy: [{ billDate: 'desc' }, { billNo: 'desc' }], include: { supplier: supSel }, ...paging(q) }),
      prisma.vendorBill.count({ where }),
    ]);
    return paged(rows.map((b) => ({ ...b, outstanding: (num(b.total) - num(b.paidAmount)).toFixed(2) })), total, q);
  });
  app.get('/ap/bills/:id', { preHandler: app.can('finance.view') }, async (req) => {
    const b = await prisma.vendorBill.findUnique({
      where: { id: idParam(req) },
      include: {
        supplier: supSel,
        lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { id: true, code: true, nameTh: true } }, goodsReceipt: { select: { id: true, grNo: true, poId: true } }, vessel: { select: { id: true, code: true, name: true } }, trip: { select: { id: true, tripNo: true } } } },
        allocations: { include: { payment: { select: { id: true, paymentNo: true, paidAt: true, status: true } } } },
      },
    });
    if (!b) throw notFound('ใบแจ้งหนี้ผู้ขาย');
    return { ...b, outstanding: (num(b.total) - num(b.paidAmount)).toFixed(2) };
  });
  app.get('/ap/unbilled-receipts', { preHandler: app.can('finance.view') }, async (req) => {
    const { supplierId, billId } = req.query as { supplierId?: string; billId?: string };
    if (!supplierId) throw badRequest('ต้องระบุผู้ขาย');
    const current = billId ? (await prisma.vendorBillLine.findMany({ where: { billId, kind: 'GR' }, select: { goodsReceiptId: true } })).map((x) => x.goodsReceiptId!) : [];
    return unbilledReceipts(prisma, supplierId, current);
  });
  app.post('/ap/bills', { preHandler: app.can('finance.edit') }, async (req, reply) => reply.status(201).send(await saveBill(req, parse(vendorBillSchema, req.body))));
  app.put('/ap/bills/:id', { preHandler: app.can('finance.edit') }, async (req) => saveBill(req, parse(vendorBillSchema, req.body), idParam(req)));
  app.post('/ap/bills/:id/approve', { preHandler: app.can('finance.approve') }, async (req) => approveBill(req, idParam(req)));
  app.post('/ap/bills/:id/void', { preHandler: app.can('finance.approve') }, async (req) => voidBill(req, idParam(req), parse(reasonSchema, req.body).reason));
  app.get('/ap/aging', { preHandler: app.can('finance.view') }, async (req) => {
    const asOf = (req.query as { asOf?: string }).asOf;
    return apAging(asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : toISODate());
  });

  // ---------- supplier payments ----------
  app.get('/ap/payments', { preHandler: app.can('finance.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.VendorPaymentWhereInput = {
      ...((VENDOR_PAYMENT_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as VendorPaymentStatus } : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(q.q ? { OR: [{ paymentNo: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { supplier: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.vendorPayment.findMany({
        where, orderBy: { paidAt: 'desc' }, ...paging(q),
        include: { supplier: supSel, bankAccount: { select: { id: true, code: true, name: true } }, allocations: { include: { bill: { select: { id: true, billNo: true, supplierInvoiceNo: true } } } } },
      }),
      prisma.vendorPayment.count({ where }),
    ]);
    return paged(items, total, q);
  });
  app.post('/ap/payments', { preHandler: app.can('finance.approve') }, async (req, reply) => reply.status(201).send(await createPayment(req, parse(vendorPaymentSchema, req.body))));
  app.post('/ap/payments/:id/void', { preHandler: app.can('finance.approve') }, async (req) => voidPayment(req, idParam(req), parse(reasonSchema, req.body).reason));

  // ---------- bank accounts ----------
  app.get('/bank-accounts', { preHandler: app.can('finance.view') }, async () =>
    prisma.bankAccount.findMany({ orderBy: { code: 'asc' }, include: { glAccount: { select: { id: true, code: true, nameTh: true } } } }));
  const checkGl = async (glAccountId: string) => {
    const a = await prisma.account.findUnique({ where: { id: glAccountId } });
    if (!a || a.type !== 'ASSET' || !a.isPostable || !a.isActive) throw badRequest('บัญชีแยกประเภทต้องเป็นบัญชีสินทรัพย์ที่รับรายการได้');
  };
  app.post('/bank-accounts', { preHandler: app.can('finance.approve') }, async (req, reply) => {
    const b = parse(bankAccountSchema, req.body);
    await checkGl(b.glAccountId);
    if (await prisma.bankAccount.findUnique({ where: { code: b.code } })) throw conflict('DUPLICATE', `รหัส ${b.code} มีอยู่แล้ว`);
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.bankAccount.create({ data: { ...b, notes: b.notes ?? null } });
      await audit(tx, req, { action: 'CREATE', entityType: 'BankAccount', entityId: r.id, after: r });
      return r;
    });
    return reply.status(201).send(row);
  });
  app.put('/bank-accounts/:id', { preHandler: app.can('finance.approve') }, async (req) => {
    const id = idParam(req);
    const b = parse(bankAccountSchema, req.body);
    const before = await prisma.bankAccount.findUnique({ where: { id } });
    if (!before) throw notFound('บัญชีธนาคาร');
    await checkGl(b.glAccountId);
    if (b.glAccountId !== before.glAccountId && (await prisma.bankReconciliation.count({ where: { bankAccountId: id } })))
      throw conflict('IN_USE', 'มีการกระทบยอดแล้ว เปลี่ยนบัญชีแยกประเภทไม่ได้');
    return prisma.$transaction(async (tx) => {
      const after = await tx.bankAccount.update({ where: { id }, data: { ...b, notes: b.notes ?? null } });
      await audit(tx, req, { action: 'UPDATE', entityType: 'BankAccount', entityId: id, before, after });
      return after;
    });
  });

  // ---------- bank reconciliation ----------
  app.get('/bank-recs', { preHandler: app.can('finance.view') }, async (req) => {
    const { bankAccountId } = req.query as { bankAccountId?: string };
    return prisma.bankReconciliation.findMany({
      where: bankAccountId ? { bankAccountId } : {}, orderBy: [{ statementDate: 'desc' }, { createdAt: 'desc' }], take: 100,
      include: { bankAccount: { select: { id: true, code: true, name: true } }, _count: { select: { items: true } } },
    });
  });
  app.post('/bank-recs', { preHandler: app.can('finance.edit') }, async (req, reply) => {
    const b = parse(bankRecSchema, req.body);
    const ba = await prisma.bankAccount.findUnique({ where: { id: b.bankAccountId } });
    if (!ba) throw notFound('บัญชีธนาคาร');
    const rec = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${b.bankAccountId}::uuid FOR UPDATE`;
      if (await tx.bankReconciliation.findFirst({ where: { bankAccountId: b.bankAccountId, status: 'DRAFT' } })) throw conflict('DRAFT_EXISTS', 'มีการกระทบยอดที่ยังไม่เสร็จของบัญชีนี้อยู่แล้ว');
      const last = await tx.bankReconciliation.findFirst({ where: { bankAccountId: b.bankAccountId, status: 'COMPLETED' }, orderBy: { statementDate: 'desc' } });
      if (last && d(b.statementDate) <= last.statementDate) throw badRequest('วันที่ statement ต้องหลังการกระทบยอดครั้งก่อน');
      const r = await tx.bankReconciliation.create({ data: { bankAccountId: b.bankAccountId, statementDate: d(b.statementDate), statementBalance: b.statementBalance, notes: b.notes ?? null, createdById: req.user!.id } });
      await audit(tx, req, { action: 'CREATE', entityType: 'BankReconciliation', entityId: r.id, after: r });
      return r;
    });
    return reply.status(201).send(rec);
  });
  app.get('/bank-recs/:id', { preHandler: app.can('finance.view') }, async (req) => recDetail(prisma, idParam(req)));
  app.put('/bank-recs/:id/items', { preHandler: app.can('finance.edit') }, async (req) => setRecItems(req, idParam(req), parse(bankRecItemsSchema, req.body).journalLineIds));
  app.post('/bank-recs/:id/complete', { preHandler: app.can('finance.approve') }, async (req) => completeRec(req, idParam(req)));
  app.delete('/bank-recs/:id', { preHandler: app.can('finance.edit') }, async (req) => deleteDraftRec(req, idParam(req)));

  // ---------- tax reports ----------
  app.get('/tax/vat', { preHandler: app.can('finance.view') }, async (req) => {
    const { y, m } = ym(req.query as Record<string, string | undefined>);
    return vatReport(y, m);
  });
  app.get('/tax/wht', { preHandler: app.can('finance.view') }, async (req) => {
    const { y, m } = ym(req.query as Record<string, string | undefined>);
    return whtReport(y, m);
  });
}
