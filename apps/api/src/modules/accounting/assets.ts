// Fixed assets: straight-line monthly depreciation with catch-up, sequential monthly runs, disposal with gain/loss.
import type { FastifyRequest } from 'fastify';
import { beYear, type assetDisposalSchema, type fixedAssetSchema } from '@fisher/shared';
import type { z } from 'zod';
import { audit } from '../../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { d, nextSeq, num } from '../../lib/http';
import { prisma, type DbOrTx, type Tx } from '../../lib/prisma';
import { loadMapping } from './autopost';
import { assertOpen, createEntry, r2, type LineIn } from './ledger';

// ---------- pure helpers (YYYY-MM strings) ----------
/** First depreciation month: the acquisition month when bought on the 1st, otherwise the next month. */
export function depStartMonth(acquisitionDate: string) {
  const [y, m, day] = acquisitionDate.split('-').map(Number) as [number, number, number];
  if (day === 1) return `${y}-${String(m).padStart(2, '0')}`;
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
/** Inclusive months from `start` to `through` (0 when through < start). */
export function monthsElapsed(start: string, through: string) {
  const [sy, sm] = start.split('-').map(Number) as [number, number];
  const [ty, tm] = through.split('-').map(Number) as [number, number];
  return Math.max(0, (ty - sy) * 12 + (tm - sm) + 1);
}
/** Depreciation that should have been charged up to and including `through`; the last month absorbs rounding. */
export function expectedAccumulated(cost: number, salvage: number, lifeMonths: number, start: string, through: string) {
  const base = r2(cost - salvage);
  const n = monthsElapsed(start, through);
  if (n <= 0) return 0;
  if (n >= lifeMonths) return base;
  return Math.min(base, r2((base / lifeMonths) * n));
}
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const prevYm = (y: number, m: number) => (m === 1 ? ym(y - 1, 12) : ym(y, m - 1));
const lastDay = (y: number, m: number) => `${ym(y, m)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
const isoCol = (x: Date) => x.toISOString().slice(0, 10);

type AssetIn = z.output<typeof fixedAssetSchema>;

async function checkAccounts(db: DbOrTx, a: AssetIn) {
  const accs = await db.account.findMany({ where: { id: { in: [a.assetAccountId, a.accumDepAccountId, a.depExpenseAccountId] } } });
  const get = (id: string) => accs.find((x) => x.id === id);
  const ok = (x: ReturnType<typeof get>) => !!x && x.isPostable && x.isActive;
  const cost = get(a.assetAccountId);
  const accum = get(a.accumDepAccountId);
  const exp = get(a.depExpenseAccountId);
  if (!ok(cost) || cost!.type !== 'ASSET' || cost!.normalBalance !== 'DEBIT') throw badRequest('บัญชีทรัพย์สินต้องเป็นบัญชีสินทรัพย์ด้านเดบิตที่รับรายการ');
  if (!ok(accum) || accum!.type !== 'ASSET' || accum!.normalBalance !== 'CREDIT') throw badRequest('บัญชีค่าเสื่อมราคาสะสมต้องเป็นบัญชีสินทรัพย์ด้านเครดิต (บัญชีปรับมูลค่า)');
  if (!ok(exp) || exp!.type !== 'EXPENSE') throw badRequest('บัญชีค่าเสื่อมราคาต้องเป็นบัญชีค่าใช้จ่ายที่รับรายการ');
}

export async function accumulated(db: DbOrTx, assetIds: string[]) {
  const rows = await db.depreciationLine.groupBy({ by: ['assetId'], where: { assetId: { in: assetIds } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.assetId, r2(num(r._sum.amount))]));
}

export async function saveAsset(req: FastifyRequest, a: AssetIn, id?: string) {
  await checkAccounts(prisma, a);
  const start = depStartMonth(a.acquisitionDate);
  return prisma.$transaction(async (tx) => {
    let before = null;
    if (id) {
      await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${id}::uuid FOR UPDATE`;
      before = await tx.fixedAsset.findUnique({ where: { id } });
      if (!before) throw notFound('ทรัพย์สิน');
      if (before.status !== 'ACTIVE') throw conflict('INVALID_STATUS', 'ทรัพย์สินจำหน่ายแล้ว แก้ไขไม่ได้');
      const used = await tx.depreciationLine.count({ where: { assetId: id } });
      const changed = isoCol(before.acquisitionDate) !== a.acquisitionDate || num(before.cost) !== a.cost || num(before.salvageValue) !== (a.salvageValue ?? 0)
        || before.usefulLifeMonths !== a.usefulLifeMonths || before.assetAccountId !== a.assetAccountId || before.accumDepAccountId !== a.accumDepAccountId || before.depExpenseAccountId !== a.depExpenseAccountId;
      if (used && changed) throw conflict('HAS_DEPRECIATION', 'คิดค่าเสื่อมแล้ว แก้ไขราคาทุน/อายุ/วันที่/บัญชีไม่ได้ (แก้ได้เฉพาะชื่อ เรือ เลขเครื่อง หมายเหตุ)');
    }
    const data = {
      name: a.name, category: a.category, vesselId: a.vesselId ?? null, acquisitionDate: d(a.acquisitionDate), depStartDate: d(`${start}-01`),
      cost: a.cost, salvageValue: a.salvageValue ?? 0, usefulLifeMonths: a.usefulLifeMonths, assetAccountId: a.assetAccountId,
      accumDepAccountId: a.accumDepAccountId, depExpenseAccountId: a.depExpenseAccountId, serialNo: a.serialNo ?? null, notes: a.notes ?? null,
    };
    const y = beYear();
    const row = id
      ? await tx.fixedAsset.update({ where: { id }, data })
      : await tx.fixedAsset.create({ data: { ...data, assetNo: `FA-${y}-${String(await nextSeq(tx, 'ASSET', String(y))).padStart(4, '0')}`, createdById: req.user!.id } });
    await audit(tx, req, { action: id ? 'UPDATE' : 'CREATE', entityType: 'FixedAsset', entityId: row.id, before: before ?? undefined, after: row });
    return row;
  });
}

/** Amounts a run for (y, m) would charge — catch-up included for assets registered late. */
export async function previewRun(db: DbOrTx, y: number, m: number) {
  const through = ym(y, m);
  const assets = await db.fixedAsset.findMany({ where: { status: 'ACTIVE', depStartDate: { lte: d(lastDay(y, m)) } }, orderBy: { assetNo: 'asc' } });
  const acc = await accumulated(db, assets.map((a) => a.id));
  return assets
    .map((a) => {
      const exp = expectedAccumulated(num(a.cost), num(a.salvageValue), a.usefulLifeMonths, isoCol(a.depStartDate).slice(0, 7), through);
      return { asset: a, before: acc.get(a.id) ?? 0, amount: r2(exp - (acc.get(a.id) ?? 0)) };
    })
    .filter((x) => x.amount > 0);
}

export async function runDepreciation(req: FastifyRequest, y: number, m: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fisher-depreciation'))`;
    await assertOpen(tx, lastDay(y, m));
    const latest = await tx.depreciationRun.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    // first run may start anywhere (catch-up); afterwards strictly month by month
    if (latest) {
      const next = latest.month === 12 ? ym(latest.year + 1, 1) : ym(latest.year, latest.month + 1);
      if (ym(y, m) !== next) throw conflict('RUN_ORDER', `คิดค่าเสื่อมล่าสุดเดือน ${latest.month}/${latest.year + 543} — ต้องคิดเดือน ${next} ก่อน`);
    }
    const items = await previewRun(tx, y, m);
    const total = r2(items.reduce((s, x) => s + x.amount, 0));
    const run = await tx.depreciationRun.create({ data: { year: y, month: m, total, createdById: req.user!.id, lines: { create: items.map((x) => ({ assetId: x.asset.id, amount: x.amount })) } } });
    let entryNo: string | null = null;
    if (items.length) {
      const lines: LineIn[] = items.flatMap((x) => [
        { accountId: x.asset.depExpenseAccountId, debit: x.amount, vesselId: x.asset.vesselId, description: `${x.asset.assetNo} ${x.asset.name}` },
        { accountId: x.asset.accumDepAccountId, credit: x.amount, description: x.asset.assetNo },
      ]);
      const ref = `DEP-${y}-${String(m).padStart(2, '0')}`;
      const e = await createEntry(tx, req.user!.id, { entryDate: lastDay(y, m), memo: `ค่าเสื่อมราคาเดือน ${m}/${y + 543}`, reference: ref, lines, source: { type: 'DEPRECIATION', id: run.id, event: 'RUN', ref } }, req.user!.id);
      await tx.depreciationRun.update({ where: { id: run.id }, data: { entryId: e.id } });
      entryNo = e.entryNo;
    }
    await audit(tx, req, { action: 'RUN', entityType: 'DepreciationRun', entityId: run.id, after: { year: y, month: m, total, assets: items.length, entryNo } });
    return { ...run, entryNo, assets: items.length };
  });
}

export async function disposeAsset(req: FastifyRequest, id: string, b: z.output<typeof assetDisposalSchema>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${id}::uuid FOR UPDATE`;
    const a = await tx.fixedAsset.findUnique({ where: { id } });
    if (!a) throw notFound('ทรัพย์สิน');
    if (a.status !== 'ACTIVE') throw conflict('INVALID_STATUS', 'ทรัพย์สินนี้จำหน่ายแล้ว');
    if (b.disposedAt < isoCol(a.acquisitionDate)) throw badRequest('วันที่จำหน่ายต้องไม่ก่อนวันที่ได้มา');
    await assertOpen(tx, b.disposedAt);
    const [y, mo] = b.disposedAt.split('-').map(Number) as [number, number];
    const acc = (await accumulated(tx, [id])).get(id) ?? 0;
    const due = r2(expectedAccumulated(num(a.cost), num(a.salvageValue), a.usefulLifeMonths, isoCol(a.depStartDate).slice(0, 7), prevYm(y, mo)) - acc);
    if (due > 0) throw conflict('DEPRECIATION_DUE', `ต้องคิดค่าเสื่อมถึงเดือน ${prevYm(y, mo)} ก่อนจำหน่าย (ค้าง ${due} บาท)`);
    const proceeds = r2(b.proceeds ?? 0);
    const cost = num(a.cost);
    const gain = r2(proceeds - (cost - acc));
    const map = await loadMapping(tx);
    let cashAcc: string | undefined;
    if (proceeds > 0) {
      if (b.method === 'CASH') cashAcc = map.get('CASH');
      else {
        const ba = b.bankAccountId ? await tx.bankAccount.findUnique({ where: { id: b.bankAccountId } }) : null;
        if (!ba || !ba.isActive) throw badRequest('บัญชีธนาคารไม่พร้อมใช้งาน');
        cashAcc = ba.glAccountId;
      }
    }
    const need = (k: 'GAIN_ON_DISPOSAL' | 'LOSS_ON_DISPOSAL' | 'CASH') => {
      const v = map.get(k);
      if (!v) throw new AppError(422, 'MAPPING_MISSING', `ยังไม่ได้กำหนดบัญชีสำหรับ ${k}`);
      return v;
    };
    const lines: LineIn[] = [
      { accountId: a.accumDepAccountId, debit: acc, description: 'ค่าเสื่อมราคาสะสม' },
      ...(proceeds > 0 ? [{ accountId: cashAcc ?? need('CASH'), debit: proceeds, description: 'เงินรับจากการจำหน่าย' }] : []),
      ...(gain < 0 ? [{ accountId: need('LOSS_ON_DISPOSAL'), debit: -gain, vesselId: a.vesselId }] : []),
      { accountId: a.assetAccountId, credit: cost, description: `${a.assetNo} ${a.name}` },
      ...(gain > 0 ? [{ accountId: need('GAIN_ON_DISPOSAL'), credit: gain, vesselId: a.vesselId }] : []),
    ];
    const e = await createEntry(tx, req.user!.id, { entryDate: b.disposedAt, memo: `จำหน่ายทรัพย์สิน ${a.assetNo} ${a.name}: ${b.reason}`, reference: a.assetNo, lines, source: { type: 'ASSET_DISPOSAL', id: a.id, event: 'DISPOSE', ref: a.assetNo } }, req.user!.id);
    const after = await tx.fixedAsset.update({ where: { id }, data: { status: 'DISPOSED', disposedAt: d(b.disposedAt), disposalProceeds: proceeds, disposalReason: b.reason } });
    await audit(tx, req, { action: 'DISPOSE', entityType: 'FixedAsset', entityId: id, before: { status: a.status }, after: { status: 'DISPOSED', proceeds, bookValue: r2(cost - acc), gain, entryNo: e.entryNo }, note: b.reason });
    return { ...after, entryNo: e.entryNo, gain, bookValue: r2(cost - acc) };
  });
}

/** Months up to the end of `year` where depreciation is still owed (blocks year-end close). */
export async function depreciationOwed(db: Tx | typeof prisma, year: number) {
  return (await previewRun(db, year, 12)).reduce((s, x) => s + x.amount, 0);
}
