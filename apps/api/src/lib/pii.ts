// Transparent column encryption for personal data (PDPA): stored as AES-256-GCM ciphertext, decrypted on read.
// These columns are never filtered or sorted on in SQL — keep it that way (ciphertext is not searchable).
import { decrypt, encrypt } from './crypto';

export const PII_FIELDS = { employee: ['nationalIdNo', 'bankAccountNo'], employeeDocument: ['documentNo'] } as const;
export type PiiModel = keyof typeof PII_FIELDS;

const isEnc = (v: unknown): v is string => typeof v === 'string' && v.startsWith('v1:');
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
    WHERE (national_id_no <> '' AND national_id_no NOT LIKE 'v1:%') OR (bank_account_no <> '' AND bank_account_no NOT LIKE 'v1:%')`;
  for (const e of emps)
    await db.$executeRaw`UPDATE employees SET national_id_no = ${encField(e.n)}, bank_account_no = ${encField(e.b)} WHERE id = ${e.id}::uuid`;
  const docs = await db.$queryRaw<{ id: string; d: string }[]>`
    SELECT id, document_no AS d FROM employee_documents WHERE document_no <> '' AND document_no NOT LIKE 'v1:%'`;
  for (const x of docs) await db.$executeRaw`UPDATE employee_documents SET document_no = ${encField(x.d)} WHERE id = ${x.id}::uuid`;
  return { employees: emps.length, documents: docs.length };
}
