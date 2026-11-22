import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetPassword } from '../src/cli/reset-password';
import { createUser, makeApp, PASSWORD, prisma, resetDb } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
});
afterAll(() => app.close());

const signIn = async (password: string) => {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password } });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

describe('server-console password reset', () => {
  it('gives a one-time password, unlocks, signs out, optionally clears 2FA, and is audited', async () => {
    const u = await prisma.user.update({
      where: { username: 'admin' },
      data: { lockedUntil: new Date(Date.now() + 3600_000), failedLogins: 5, totpEnabledAt: new Date(), totpSecret: 'x', recoveryCodes: ['a'] },
    });
    await prisma.session.create({ data: { id: 'console-test', userId: u.id, csrfToken: 'c', expiresAt: new Date(Date.now() + 3600_000) } });

    const pw = await resetPassword('admin', true);
    expect(pw).toMatch(/^Fisher-[0-9a-f]{10}1$/);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after).toMatchObject({ mustChangePassword: true, failedLogins: 0, lockedUntil: null, totpEnabledAt: null, totpSecret: null, recoveryCodes: [] });
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    expect((await signIn(PASSWORD)).status).toBe(401);
    const ok = await signIn(pw);
    expect(ok.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET', entityId: u.id, username: 'server-console' } })).toBe(1);

    await expect(resetPassword('nobody', false)).rejects.toThrow('ไม่พบผู้ใช้');
  });
});
