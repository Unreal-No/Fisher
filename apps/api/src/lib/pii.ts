// Transparent column encryption for personal data (PDPA): stored as AES-256-GCM ciphertext, decrypted on read.
// These columns are never filtered or sorted on in SQL — keep it that way (ciphertext is not searchable).
import { currentKeyId, decrypt, encrypt, isEncrypted } from './crypto';

export const PII_FIELDS = { employee: ['nationalIdNo', 'bankAccountNo'], employeeDocument: ['documentNo'] } as const;
export type PiiModel = keyof typeof PII_FIELDS;

// late-bound: crypto ↔ prisma import cycle means isEncrypted may not exist yet at module load
const isEnc = (v: unknown): v is string => isEncrypted(v);
export const encField = (v: unknown) => (typeof v === 'string' && v !== '' && !isEnc(v) ? encrypt(v) : v);
/** legacy plaintext rows (before migration) are returned as they are */
export const decField = (v: string | null) => (isEnc(v) ? decrypt(v) : v);

/** Encrypt PII keys of a create/update `data` payload (plain values or `{ set }`). */
export function encData(model: PiiModel, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((d) => encData(model, d));
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const f of PII_FIELDS[model]) {
    if (!(f in out)) continue;
    const v = out[f];
    out[f] = v && typeof v === 'object' && 'set' in v ? { set: encField((v as { set: unknown }).set) } : encField(v);
  }
  return out;
}

/** Encrypt rows stored in plaintext by earlier versions (idempotent; raw SQL bypasses the client extension). */
export async function encryptExistingPii(db: {
  $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
}) {
  const emps = await db.$queryRaw<{ id: string; n: string | null; b: string | null }[]>`
    SELECT id, national_id_no AS n, bank_account_no AS b FROM employees
    WHERE (national_id_no <> '' AND national_id_no !~ '^v[12]:') OR (bank_account_no <> '' AND bank_account_no !~ '^v[12]:')`;
  for (const e of emps)
    await db.$executeRaw`UPDATE employees SET national_id_no = ${encField(e.n)}, bank_account_no = ${encField(e.b)} WHERE id = ${e.id}::uuid`;
  const docs = await db.$queryRaw<{ id: string; d: string }[]>`
    SELECT id, document_no AS d FROM employee_documents WHERE document_no <> '' AND document_no !~ '^v[12]:'`;
  for (const x of docs) await db.$executeRaw`UPDATE employee_documents SET document_no = ${encField(x.d)} WHERE id = ${x.id}::uuid`;
  return { employees: emps.length, documents: docs.length };
}

/** Every encrypted column (PII + 2FA secrets). */
const ENCRYPTED_COLUMNS = [
  ['employees', 'national_id_no'], ['employees', 'bank_account_no'], ['employee_documents', 'document_no'],
  ['users', 'totp_secret'], ['users', 'totp_pending_secret'],
] as const;
const reenc = (v: string | null) => (v && isEnc(v) ? encrypt(decrypt(v)) : v);

/**
 * Key rotation: re-encrypt values written with an old key (or the v1 format) under the current APP_ENCRYPTION_KEY.
 * Run after moving the previous key to APP_ENCRYPTION_KEYS_OLD; afterwards the old key can be removed.
 */
export async function reencryptAll(db: {
  $queryRawUnsafe: <T>(q: string, ...v: unknown[]) => Promise<T>;
  $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<number>;
}) {
  const prefix = `v2:${currentKeyId()}:%`;
  const counts: Record<string, number> = {};
  for (const [table, col] of ENCRYPTED_COLUMNS) {
    // identifiers come from the constant list above, never from input
    const rows = await db.$queryRawUnsafe<{ id: string; v: string }[]>(`SELECT id::text, ${col} AS v FROM ${table} WHERE ${col} ~ '^v[12]:' AND ${col} NOT LIKE $1`, prefix);
    for (const r of rows) await db.$executeRawUnsafe(`UPDATE ${table} SET ${col} = $1 WHERE id::text = $2`, reenc(r.v), r.id);
    counts[`${table}.${col}`] = rows.length;
  }
  return counts;
}
