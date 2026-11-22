import { createCipheriv, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { currentKeyId, decrypt, encrypt } from '../src/lib/crypto';
import { reencryptAll } from '../src/lib/pii';
import { createUser, iso, login, makeApp, prisma, resetDb } from './helpers';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');
const saved = { cur: config.APP_ENCRYPTION_KEY, old: config.APP_ENCRYPTION_KEYS_OLD };
let app: FastifyInstance;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  config.APP_ENCRYPTION_KEY = KEY_A;
  config.APP_ENCRYPTION_KEYS_OLD = undefined;
});
afterAll(async () => {
  config.APP_ENCRYPTION_KEY = saved.cur;
  config.APP_ENCRYPTION_KEYS_OLD = saved.old;
  await app.close();
});

/** a value in the pre-0.12 format (no key id) */
function legacyV1(plain: string, b64key: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(b64key, 'base64'), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

describe('encryption key rotation', () => {
  it('reads old-key data during rotation, re-encrypts everything, then works without the old key', async () => {
    await createUser('admin', 'SUPER_ADMIN');
    const admin = await login(app, 'admin');
    const res = await admin.post('/employees', { firstName: 'ทดสอบ', lastName: 'กุญแจ', nationality: 'TH', position: 'DECKHAND', startDate: iso(-5), nationalIdNo: '1209900011223', bankAccountNo: '555-1-22222-3' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const e = res.body;
    const idA = currentKeyId();
    const [r1] = await prisma.$queryRaw<{ n: string }[]>`SELECT national_id_no AS n FROM employees WHERE id = ${e.id}::uuid`;
    expect(r1!.n.startsWith(`v2:${idA}:`)).toBe(true);
    // a 2FA secret and a legacy v1 value, both under key A
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.user.update({ where: { id: u.id }, data: { totpSecret: encrypt('JBSWY3DPEHPK3PXP') } });
    await prisma.$executeRaw`UPDATE employees SET bank_account_no = ${legacyV1('000-0-00000-1', KEY_A)} WHERE id = ${e.id}::uuid`;

    // rotate: B becomes current, A kept as old
    config.APP_ENCRYPTION_KEY = KEY_B;
    config.APP_ENCRYPTION_KEYS_OLD = KEY_A;
    const idB = currentKeyId();
    expect(idB).not.toBe(idA);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).nationalIdNo).toBe('1209900011223');
    const counts = await reencryptAll(prisma);
    expect(counts).toMatchObject({ 'employees.national_id_no': 1, 'employees.bank_account_no': 1, 'users.totp_secret': 1 });
    expect(Object.values(await reencryptAll(prisma)).every((n) => n === 0)).toBe(true); // idempotent

    // old key removed: everything still readable, all values under key B
    config.APP_ENCRYPTION_KEYS_OLD = undefined;
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(emp).toMatchObject({ nationalIdNo: '1209900011223', bankAccountNo: '000-0-00000-1' });
    const raw = await prisma.$queryRaw<{ n: string; b: string }[]>`SELECT national_id_no AS n, bank_account_no AS b FROM employees WHERE id = ${e.id}::uuid`;
    expect(raw[0]!.n.startsWith(`v2:${idB}:`) && raw[0]!.b.startsWith(`v2:${idB}:`)).toBe(true);
    const u2 = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(decrypt(u2.totpSecret!)).toBe('JBSWY3DPEHPK3PXP');

    // a value under an unknown key fails with a clear message
    config.APP_ENCRYPTION_KEY = KEY_A;
    expect(() => decrypt(u2.totpSecret!)).toThrow(/APP_ENCRYPTION_KEYS_OLD/);
    config.APP_ENCRYPTION_KEY = KEY_B;
  });
});
