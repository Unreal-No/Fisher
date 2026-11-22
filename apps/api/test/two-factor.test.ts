import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, totpStep, verifyTotp } from '../src/lib/totp';
import { decrypt, encrypt } from '../src/lib/crypto';
import { createUser, login, makeApp, PASSWORD, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('acc', 'ACCOUNTANT');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

/** raw login that understands the 2FA challenge */
async function pwLogin(username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: PASSWORD } });
  return { status: r.statusCode, body: JSON.parse(r.body), cookies: r.cookies };
}
async function second(challenge: string, code: string) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login/2fa', payload: { challenge, code } });
  return { status: r.statusCode, body: JSON.parse(r.body), cookies: r.cookies };
}
const nowCode = (secret: string, offsetSteps = 0) => hotp(secret, totpStep() + offsetSteps);

describe('TOTP primitives', () => {
  it('match RFC 6238 test vectors and reject replays', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(hotp(secret, 1)).toBe('287082'); // T = 59 s → 94287082
    expect(hotp(secret, 37037036)).toBe('081804'); // T = 1111111109 s → 07081804
    const t = 1111111109_000;
    expect(verifyTotp(secret, '081804', null, t)).toBe(37037036);
    expect(verifyTotp(secret, '081804', 37037036, t)).toBeNull(); // replay
    expect(verifyTotp(secret, '12345', null, t)).toBeNull();
    const enc = encrypt('secret-value');
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain('secret-value');
    expect(decrypt(enc)).toBe('secret-value');
  });
});

describe('two-factor login', () => {
  let secret: string;
  let recovery: string[];
  it('enrols with password + confirmation code and returns recovery codes once', async () => {
    const acc = await login(app, 'acc');
    expect((await acc.post('/auth/2fa/setup', { password: 'wrong' })).status).toBe(400);
    const setup = await acc.post('/auth/2fa/setup', { password: PASSWORD });
    expect(setup.status).toBe(200);
    secret = setup.body.secret;
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.qrSvg).toContain('<svg');
    const stored = await prisma.user.findUniqueOrThrow({ where: { username: 'acc' } });
    expect(stored.totpPendingSecret).not.toContain(secret); // encrypted at rest
    expect((await acc.post('/auth/2fa/enable', { code: '000000' === nowCode(secret) ? '111111' : '000000' })).status).toBe(400);
    const en = await acc.post('/auth/2fa/enable', { code: nowCode(secret) });
    expect(en.status).toBe(200);
    recovery = en.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await acc.get('/auth/me')).body).toMatchObject({ twoFactorEnabled: true, mustEnable2fa: false });
    expect((await acc.get('/auth/2fa')).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    const logs = JSON.stringify((await prisma.auditLog.findMany({ where: { entityType: 'User' } })).map((l) => [l.before, l.after, l.note]));
    expect(logs).not.toContain(secret);
  });

  it('password alone gives no session; code, replay, recovery codes, lockout', async () => {
    const p = await pwLogin('acc');
    expect(p.body).toMatchObject({ mfaRequired: true });
    expect(p.cookies.find((c) => c.name === 'fsid')).toBeUndefined();
    expect((await second(p.body.challenge, '123')).status).toBe(400);
    const bad = await second(p.body.challenge, nowCode(secret) === '000000' ? '111111' : '000000');
    expect(bad.body.error.code).toBe('INVALID_CODE');
    // the step accepted at enrolment cannot be replayed; the next step works
    const ok = await second(p.body.challenge, nowCode(secret, 1));
    expect(ok.status).toBe(200);
    expect(ok.cookies.find((c) => c.name === 'fsid')).toBeDefined();
    expect((await second(p.body.challenge, nowCode(secret, 1))).body.error.code).toBe('CHALLENGE_EXPIRED'); // single use

    const p2 = await pwLogin('acc');
    expect((await second(p2.body.challenge, nowCode(secret, 1))).body.error.code).toBe('INVALID_CODE'); // replayed step
    const rc = await second(p2.body.challenge, recovery[0]!.toUpperCase());
    expect(rc.body).toMatchObject({ ok: true, recoveryCodesLeft: 9 });
    const p3 = await pwLogin('acc');
    expect((await second(p3.body.challenge, recovery[0]!)).body.error.code).toBe('INVALID_CODE'); // used once

    for (let i = 0; i < 4; i++) await second(p3.body.challenge, '000001');
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'acc' } });
    expect(u.lockedUntil).not.toBeNull(); // 5 wrong codes lock the account like wrong passwords
    expect((await second(p3.body.challenge, nowCode(secret))).body.error.code).toBe('CHALLENGE_EXPIRED');
    await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: null, failedLogins: 0 } });
  });

  it('administrator reset and role policy', async () => {
    const accId = (await prisma.user.findUniqueOrThrow({ where: { username: 'acc' } })).id;
    expect((await admin.post(`/users/${accId}/reset-2fa`)).status).toBe(200);
    expect((await pwLogin('acc')).body).toEqual({ ok: true });

    expect((await admin.patch('/settings', { require2faRoles: ['NOPE'] })).status).toBe(400);
    expect((await admin.patch('/settings', { require2faRoles: ['ACCOUNTANT'] })).status).toBe(200);
    const acc = await login(app, 'acc');
    expect((await acc.get('/auth/me')).body).toMatchObject({ twoFactorEnabled: false, mustEnable2fa: true });
    expect((await acc.get('/accounting/accounts')).body.error.code).toBe('TWO_FACTOR_REQUIRED');
    const s = (await acc.post('/auth/2fa/setup', { password: PASSWORD })).body.secret;
    await acc.post('/auth/2fa/enable', { code: nowCode(s) });
    expect((await acc.get('/accounting/accounts')).status).toBe(200);
    expect((await acc.post('/auth/2fa/disable', { password: PASSWORD, code: nowCode(s, 1) })).status).toBe(403); // required by role
    expect((await admin.get('/users')).body.items.find((x: { username: string }) => x.username === 'acc').totpEnabledAt).not.toBeNull();
    await admin.patch('/settings', { require2faRoles: [] });
  });
});
