import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, loginSchema } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { AppError, badRequest } from '../../lib/errors';
import { config } from '../../config';
import { parse } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { clearSessionCookies, createSession, toMe } from '../../plugins/auth';

const MAX_FAILS = 5;
const LOCK_MIN = 15;
export const hashPassword = (p: string) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
// equalise timing for unknown users (avoid username enumeration)
let dummyHash: Promise<string> | undefined;

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: config.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { username, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    const fail = () => new AppError(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (!user || !user.isActive || user.deletedAt) {
      await verify(await (dummyHash ??= hashPassword('dummy-password-x')), password).catch(() => false);
      await audit(prisma, req, { action: 'LOGIN_FAILED', entityType: 'User', note: username });
      throw fail();
    }
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw new AppError(423, 'LOCKED', `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่หลัง ${LOCK_MIN} นาที`);
    if (!(await verify(user.passwordHash, password))) {
      const fails = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null },
      });
      await audit(prisma, req, { action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id });
      throw fail();
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await createSession(reply, req, user.id);
    await audit(prisma, req, { action: 'LOGIN', entityType: 'User', entityId: user.id, userId: user.id, username: user.username });
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    if (req.user) {
      await prisma.session.delete({ where: { id: req.user.sessionId } }).catch(() => undefined);
      await audit(prisma, req, { action: 'LOGOUT', entityType: 'User', entityId: req.user.id });
    }
    clearSessionCookies(reply);
    return { ok: true };
  });

  app.get('/me', async (req) => toMe(req.user!));

  app.post('/change-password', async (req) => {
    const b = parse(changePasswordSchema, req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verify(u.passwordHash, b.currentPassword))) throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    if (b.currentPassword === b.newPassword) throw badRequest('รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม');
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: { passwordHash: await hashPassword(b.newPassword), mustChangePassword: false },
      });
      // revoke other sessions
      await tx.session.deleteMany({ where: { userId: u.id, id: { not: req.user!.sessionId } } });
      await audit(tx, req, { action: 'PASSWORD_CHANGE', entityType: 'User', entityId: u.id });
    });
    return { ok: true };
  });
}
