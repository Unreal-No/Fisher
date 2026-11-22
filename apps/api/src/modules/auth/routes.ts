import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import {
  changePasswordSchema, loginSchema, loginTwoFactorSchema, twoFactorConfirmSchema, twoFactorDisableSchema, twoFactorPasswordSchema,
} from '@fisher/shared';
import { decrypt, encrypt } from '../../lib/crypto';
import { getSettings } from '../../lib/settings';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from '../../lib/totp';
import { audit } from '../../lib/audit';
import { AppError, badRequest, conflict, forbidden } from '../../lib/errors';
import { config } from '../../config';
import { parse } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { clearSessionCookies, createSession, sha256, toMe, token } from '../../plugins/auth';

const MAX_FAILS = 5;
const LOCK_MIN = 15;
const CHALLENGE_MIN = 5;
const CHALLENGE_TRIES = 5;
export const hashPassword = (p: string) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
// equalise timing for unknown users (avoid username enumeration)
let dummyHash: Promise<string> | undefined;

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: config.NODE_ENV === 'test' ? 1000 : config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } }, async (req, reply) => {
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
    if (user.totpEnabledAt) {
      // password ok → second factor; no session yet
      const raw = token();
      await prisma.loginChallenge.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date() } }] } });
      await prisma.loginChallenge.create({ data: { id: sha256(raw), userId: user.id, ip: req.ip, expiresAt: new Date(Date.now() + CHALLENGE_MIN * 60_000) } });
      return { ok: false, mfaRequired: true, challenge: raw };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await createSession(reply, req, user.id);
    await audit(prisma, req, { action: 'LOGIN', entityType: 'User', entityId: user.id, userId: user.id, username: user.username });
    return { ok: true };
  });

  app.post('/login/2fa', { config: { rateLimit: { max: config.NODE_ENV === 'test' ? 1000 : config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { challenge, code } = parse(loginTwoFactorSchema, req.body);
    const expired = () => new AppError(401, 'CHALLENGE_EXPIRED', 'หมดเวลายืนยัน กรุณาเข้าสู่ระบบใหม่');
    const result = await prisma.$transaction(async (tx) => {
      const id = sha256(challenge);
      await tx.$queryRaw`SELECT id FROM login_challenges WHERE id = ${id} FOR UPDATE`;
      const ch = await tx.loginChallenge.findUnique({ where: { id }, include: { user: true } });
      if (!ch || ch.expiresAt < new Date() || ch.attempts >= CHALLENGE_TRIES) return { kind: 'expired' as const };
      const u = ch.user;
      if (!u.isActive || u.deletedAt || !u.totpSecret) return { kind: 'expired' as const };
      if (u.lockedUntil && u.lockedUntil > new Date()) return { kind: 'locked' as const };
      const step = verifyTotp(decrypt(u.totpSecret), code, u.totpLastStep);
      const rc = step === null ? hashRecoveryCode(code) : null;
      const usedRecovery = rc !== null && u.recoveryCodes.includes(rc);
      if (step === null && !usedRecovery) {
        const fails = u.failedLogins + 1;
        await tx.loginChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
        await tx.user.update({ where: { id: u.id }, data: { failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null } });
        await audit(tx, req, { action: 'LOGIN_2FA_FAILED', entityType: 'User', entityId: u.id });
        return { kind: 'bad' as const };
      }
      await tx.loginChallenge.delete({ where: { id } });
      await tx.user.update({
        where: { id: u.id },
        data: {
          failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(),
          ...(step !== null ? { totpLastStep: step } : { recoveryCodes: u.recoveryCodes.filter((h) => h !== rc) }),
        },
      });
      await audit(tx, req, { action: 'LOGIN', entityType: 'User', entityId: u.id, userId: u.id, username: u.username, note: usedRecovery ? 'รหัสกู้คืน' : '2FA' });
      return { kind: 'ok' as const, userId: u.id, recoveryLeft: usedRecovery ? u.recoveryCodes.length - 1 : null };
    });
    if (result.kind === 'expired') throw expired();
    if (result.kind === 'locked') throw new AppError(423, 'LOCKED', `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่หลัง ${LOCK_MIN} นาที`);
    if (result.kind === 'bad') throw new AppError(401, 'INVALID_CODE', 'รหัสยืนยันไม่ถูกต้อง');
    await createSession(reply, req, result.userId);
    return { ok: true, recoveryCodesLeft: result.recoveryLeft };
  });

  // ---------- two-factor enrolment (own account) ----------
  const checkPassword = async (userId: string, password: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verify(u.passwordHash, password))) throw badRequest('รหัสผ่านไม่ถูกต้อง');
    return u;
  };
  /** current code (6 digits) or an unused recovery code */
  const checkSecondFactor = async (u: { id: string; totpSecret: string | null; totpLastStep: number | null; recoveryCodes: string[] }, code: string) => {
    if (!u.totpSecret) throw conflict('NOT_ENABLED', 'ยังไม่ได้เปิดใช้ 2FA');
    const step = verifyTotp(decrypt(u.totpSecret), code, u.totpLastStep);
    if (step !== null) return { totpLastStep: step };
    const rc = hashRecoveryCode(code);
    if (u.recoveryCodes.includes(rc)) return { recoveryCodes: u.recoveryCodes.filter((h) => h !== rc) };
    throw badRequest('รหัสยืนยันไม่ถูกต้อง');
  };

  app.get('/2fa', async (req) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const required = (await getSettings(prisma)).require2faRoles;
    return { enabled: !!u.totpEnabledAt, enabledAt: u.totpEnabledAt, recoveryCodesLeft: u.recoveryCodes.length, required: req.user!.roles.some((r) => required.includes(r.code)) };
  });
  app.post('/2fa/setup', async (req) => {
    const { password } = parse(twoFactorPasswordSchema, req.body);
    const u = await checkPassword(req.user!.id, password);
    if (u.totpEnabledAt) throw conflict('ALREADY_ENABLED', 'เปิดใช้ 2FA อยู่แล้ว');
    const secret = newTotpSecret();
    await prisma.user.update({ where: { id: u.id }, data: { totpPendingSecret: encrypt(secret) } });
    const issuer = (await getSettings(prisma)).companyName || 'Fisher ERP';
    const uri = otpauthUri(secret, u.username, `Fisher ERP (${issuer})`.slice(0, 60));
    return { secret, otpauthUrl: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 200 }) };
  });
  app.post('/2fa/enable', async (req) => {
    const { code } = parse(twoFactorConfirmSchema, req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (u.totpEnabledAt) throw conflict('ALREADY_ENABLED', 'เปิดใช้ 2FA อยู่แล้ว');
    if (!u.totpPendingSecret) throw conflict('NO_SETUP', 'เริ่มตั้งค่า 2FA ใหม่อีกครั้ง');
    const step = verifyTotp(decrypt(u.totpPendingSecret), code, null);
    if (step === null) throw badRequest('รหัสไม่ถูกต้อง — ตรวจเวลาในโทรศัพท์และสแกน QR ใหม่ถ้าจำเป็น');
    const codes = newRecoveryCodes();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: u.id },
        data: { totpSecret: u.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: codes.map(hashRecoveryCode) },
      });
      await tx.session.deleteMany({ where: { userId: u.id, id: { not: req.user!.sessionId } } });
      await audit(tx, req, { action: '2FA_ENABLE', entityType: 'User', entityId: u.id });
    });
    return { recoveryCodes: codes };
  });
  app.post('/2fa/disable', async (req) => {
    const b = parse(twoFactorDisableSchema, req.body);
    const u = await checkPassword(req.user!.id, b.password);
    const required = (await getSettings(prisma)).require2faRoles;
    if (req.user!.roles.some((r) => required.includes(r.code))) throw forbidden('บทบาทของคุณต้องใช้ 2FA ปิดไม่ได้ (ติดต่อผู้ดูแลระบบ)');
    await checkSecondFactor(u, b.code);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
      await audit(tx, req, { action: '2FA_DISABLE', entityType: 'User', entityId: u.id });
    });
    return { ok: true };
  });
  app.post('/2fa/recovery-codes', async (req) => {
    const b = parse(twoFactorDisableSchema, req.body);
    const u = await checkPassword(req.user!.id, b.password);
    const used = await checkSecondFactor(u, b.code);
    const codes = newRecoveryCodes();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { ...used, recoveryCodes: codes.map(hashRecoveryCode) } });
      await audit(tx, req, { action: '2FA_RECOVERY_CODES', entityType: 'User', entityId: u.id });
    });
    return { recoveryCodes: codes };
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
