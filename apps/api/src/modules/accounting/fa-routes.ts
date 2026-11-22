import type { FastifyInstance } from 'fastify';
import { ASSET_STATUS, assetDisposalSchema, depreciationRunSchema, fixedAssetSchema, reasonSchema, toISODate, type AssetStatus } from '@fisher/shared';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { has } from '../../plugins/auth';
import { idParam, num, paged, paging, parse, parseList, scopeIds } from '../../lib/http';
import { Prisma, prisma } from '../../lib/prisma';
import { accumulated, disposeAsset, previewRun, runDepreciation, saveAsset } from './assets';
import { r2 } from './ledger';
import { cashFlow, pnd1Report } from './reports';
import { closeYear, reopenYear, yearChecklist } from './yearend';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const yearOf = (v: unknown) => {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2200) throw badRequest('ปีไม่ถูกต้อง');
  return y;
};
const acc = { select: { id: true, code: true, nameTh: true } } as const;

export default async function faRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (scopeIds(req)) throw forbidden('ข้อมูลบัญชีเป็นข้อมูลระดับบริษัท ผู้ใช้ที่จำกัดเฉพาะเรือเข้าถึงไม่ได้');
  });

  // ---------- fixed assets ----------
  app.get('/assets', { preHandler: app.can('finance.view') }, async (req) => {
    const q = parseList(req);
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.FixedAssetWhereInput = {
      ...((ASSET_STATUS as readonly string[]).includes(f.status ?? '') ? { status: f.status as AssetStatus } : {}),
      ...(f.vesselId ? { vesselId: f.vesselId } : {}),
      ...(q.q ? { OR: [{ assetNo: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }, { serialNo: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.fixedAsset.findMany({ where, orderBy: { assetNo: 'asc' }, include: { vessel: { select: { id: true, code: true, name: true } } }, ...paging(q) }),
      prisma.fixedAsset.count({ where }),
    ]);
    const accMap = await accumulated(prisma, rows.map((r) => r.id));
    return paged(rows.map((r) => {
      const a = accMap.get(r.id) ?? 0;
      return { ...r, accumulatedDepreciation: a.toFixed(2), bookValue: (num(r.cost) - a).toFixed(2) };
    }), total, q);
  });
  app.get('/assets/:id', { preHandler: app.can('finance.view') }, async (req) => {
    const a = await prisma.fixedAsset.findUnique({
      where: { id: idParam(req) },
      include: {
        vessel: { select: { id: true, code: true, name: true } }, assetAccount: acc, accumDepAccount: acc, depExpenseAccount: acc,
        depLines: { include: { run: { select: { year: true, month: true, entryId: true } } }, orderBy: { run: { year: 'asc' } } },
      },
    });
    if (!a) throw notFound('ทรัพย์สิน');
    const accum = r2(a.depLines.reduce((s, l) => s + num(l.amount), 0));
    const monthly = r2((num(a.cost) - num(a.salvageValue)) / a.usefulLifeMonths);
    const disposal = a.status === 'DISPOSED' ? await prisma.journalEntry.findFirst({ where: { sourceType: 'ASSET_DISPOSAL', sourceId: a.id }, select: { id: true, entryNo: true } }) : null;
    return { ...a, accumulatedDepreciation: accum.toFixed(2), bookValue: (num(a.cost) - accum).toFixed(2), monthlyDepreciation: monthly.toFixed(2), disposalEntry: disposal };
  });
  app.post('/assets', { preHandler: app.can('finance.edit') }, async (req, reply) => reply.status(201).send(await saveAsset(req, parse(fixedAssetSchema, req.body))));
  app.put('/assets/:id', { preHandler: app.can('finance.edit') }, async (req) => saveAsset(req, parse(fixedAssetSchema, req.body), idParam(req)));
  app.post('/assets/:id/dispose', { preHandler: app.can('finance.approve') }, async (req) => disposeAsset(req, idParam(req), parse(assetDisposalSchema, req.body)));
  /** register vs ledger: asset cost and accumulated depreciation per GL account */
  app.get('/assets-reconcile', { preHandler: app.can('finance.view') }, async () => {
    const assets = await prisma.fixedAsset.findMany({ where: { status: 'ACTIVE' } });
    const accMap = await accumulated(prisma, assets.map((a) => a.id));
    const reg = new Map<string, number>();
    for (const a of assets) {
      reg.set(a.assetAccountId, r2((reg.get(a.assetAccountId) ?? 0) + num(a.cost)));
      reg.set(a.accumDepAccountId, r2((reg.get(a.accumDepAccountId) ?? 0) - (accMap.get(a.id) ?? 0)));
    }
    const ids = [...reg.keys()];
    const gl = ids.length ? await prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: ids }, entry: { status: { in: ['POSTED', 'REVERSED'] } } }, _sum: { debit: true, credit: true } }) : [];
    const accounts = await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, nameTh: true } });
    return accounts.map((a) => {
      const ledger = r2(num(gl.find((g) => g.accountId === a.id)?._sum.debit) - num(gl.find((g) => g.accountId === a.id)?._sum.credit));
      const register = reg.get(a.id) ?? 0;
      return { ...a, register, ledger, difference: r2(ledger - register) };
    }).sort((x, y) => x.code.localeCompare(y.code));
  });

  // ---------- depreciation ----------
  app.get('/depreciation/runs', { preHandler: app.can('finance.view') }, async () =>
    prisma.depreciationRun.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 120, include: { _count: { select: { lines: true } } } }));
  app.get('/depreciation/preview', { preHandler: app.can('finance.view') }, async (req) => {
    const { year, month } = parse(depreciationRunSchema, req.query);
    const items = await previewRun(prisma, year, month);
    return { year, month, total: r2(items.reduce((s, x) => s + x.amount, 0)), items: items.map((x) => ({ assetId: x.asset.id, assetNo: x.asset.assetNo, name: x.asset.name, before: x.before, amount: x.amount })) };
  });
  app.post('/depreciation/runs', { preHandler: app.can('finance.approve') }, async (req, reply) => {
    const { year, month } = parse(depreciationRunSchema, req.body);
    return reply.status(201).send(await runDepreciation(req, year, month));
  });

  // ---------- year end ----------
  app.get('/year-end/:year', { preHandler: app.can('finance.view') }, async (req) => yearChecklist(yearOf((req.params as { year: string }).year)));
  app.post('/year-end/:year/close', { preHandler: app.can('finance.approve') }, async (req) => closeYear(req, yearOf((req.params as { year: string }).year)));
  app.post('/year-end/:year/reopen', { preHandler: app.can('finance.approve') }, async (req) =>
    reopenYear(req, yearOf((req.params as { year: string }).year), parse(reasonSchema, req.body).reason));

  // ---------- reports ----------
  app.get('/reports/cash-flow', { preHandler: app.can('finance.view') }, async (req) => {
    const f = req.query as Record<string, string | undefined>;
    const today = toISODate();
    return cashFlow(f.from && ISO.test(f.from) ? f.from : `${today.slice(0, 4)}-01-01`, f.to && ISO.test(f.to) ? f.to : today);
  });
  app.get('/tax/pnd1', { preHandler: app.can('finance.view') }, async (req) => {
    const f = req.query as Record<string, string | undefined>;
    const today = toISODate();
    const y = Number(f.year) || Number(today.slice(0, 4));
    const m = Number(f.month) || Number(today.slice(5, 7));
    if (y < 2000 || y > 2200 || m < 1 || m > 12) throw badRequest('เดือนภาษีไม่ถูกต้อง');
    return pnd1Report(y, m, has(req, 'employee.sensitive'));
  });

}
