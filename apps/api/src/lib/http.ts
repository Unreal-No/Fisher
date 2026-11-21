import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { listQuery } from '@fisher/shared';
import { forbidden } from './errors';
import type { DbOrTx } from './prisma';

export const parse = <S extends z.ZodType>(s: S, data: unknown): z.output<S> => s.parse(data ?? {});
export const parseList = (req: FastifyRequest) => listQuery.parse(req.query ?? {});
export const paging = (q: { page: number; pageSize: number }) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
export const paged = <T>(items: T[], total: number, q: { page: number; pageSize: number }) => ({
  items,
  total,
  page: q.page,
  pageSize: q.pageSize,
});
/** 'YYYY-MM-DD' -> Date (UTC midnight) for @db.Date; null/undefined preserved. */
export const d = <T extends string | null | undefined>(v: T): T extends string ? Date : T =>
  (v ? new Date(`${v}T00:00:00.000Z`) : v) as never;
export const dt = <T extends string | null | undefined>(v: T): T extends string ? Date : T =>
  (v ? new Date(v) : v) as never;
export const idParam = (req: FastifyRequest) => (req.params as { id: string }).id;
export const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Vessel data scope: undefined = all vessels. */
export const scopeIds = (req: FastifyRequest) =>
  req.user && req.user.vesselScope.length ? req.user.vesselScope : undefined;
export const vesselWhere = (req: FastifyRequest) => {
  const s = scopeIds(req);
  return s ? { vesselId: { in: s } } : {};
};
export function assertVesselScope(req: FastifyRequest, vesselId: string) {
  const s = scopeIds(req);
  if (s && !s.includes(vesselId)) throw forbidden('ไม่มีสิทธิ์เข้าถึงข้อมูลเรือลำนี้');
}

/** Gap-free running number (locks the sequence row inside the caller's transaction). */
export async function nextSeq(db: DbOrTx, key: string, period: string): Promise<number> {
  const rows = await db.$queryRaw<{ last_value: number }[]>`
    INSERT INTO doc_sequences (key, period, last_value) VALUES (${key}, ${period}, 1)
    ON CONFLICT (key, period) DO UPDATE SET last_value = doc_sequences.last_value + 1
    RETURNING last_value`;
  return Number(rows[0]!.last_value);
}
export const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
