import type { FastifyRequest } from 'fastify';
import { maskId } from '@fisher/shared';
import type { DbOrTx } from './prisma';

const SENSITIVE = new Set(['passwordHash', 'nationalIdNo', 'bankAccountNo', 'documentNo']);

/** Deep-clone to JSON-safe data and mask PDPA-sensitive keys. */
export function redact(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(redact);
  if (typeof v === 'object') {
    if ('toFixed' in (v as object) && 'd' in (v as object)) return String(v); // Prisma.Decimal
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE.has(k) ? (k === 'passwordHash' ? '[hidden]' : maskId(val as string)) : redact(val);
    }
    return out;
  }
  return v;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  /** actor override (e.g. login before req.user is set) */
  userId?: string;
  username?: string;
}

export async function audit(db: DbOrTx, req: FastifyRequest | null, a: AuditInput) {
  await db.auditLog.create({
    data: {
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ?? null,
      before: a.before === undefined ? undefined : (redact(a.before) as object),
      after: a.after === undefined ? undefined : (redact(a.after) as object),
      note: a.note ?? null,
      userId: a.userId ?? req?.user?.id ?? null,
      username: a.username ?? req?.user?.username ?? null,
      ip: req?.ip ?? null,
      userAgent: req?.headers['user-agent']?.slice(0, 300) ?? null,
      requestId: req?.id ?? null,
    },
  });
}

/** Shallow diff of changed keys (for adjustment/audit trails). */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = redact(before[k]);
    const b = redact(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: a, to: b };
  }
  return changes;
}
