// Session-cookie auth + CSRF (double submit) + RBAC guards.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Me, Permission } from '@fisher/shared';
import { config } from '../config';
import { AppError, forbidden } from '../lib/errors';
import { prisma } from '../lib/prisma';

export const SESSION_COOKIE = 'fsid';
export const CSRF_COOKIE = 'fcsrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  sessionId: string;
  csrf: string;
  permissions: Set<string>;
  roles: { code: string; name: string }[];
  vesselScope: string[];
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    can: (...perms: Permission[]) => (req: FastifyRequest) => Promise<void>;
    canAny: (...perms: Permission[]) => (req: FastifyRequest) => Promise<void>;
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');

const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');

export async function createSession(reply: FastifyReply, req: FastifyRequest, userId: string) {
  const raw = token();
  const csrf = token();
  await prisma.session.create({
    data: {
      id: sha256(raw),
      userId,
      csrfToken: csrf,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300),
      expiresAt: new Date(Date.now() + config.SESSION_IDLE_HOURS * 3600_000),
    },
  });
  const base = { path: '/', sameSite: 'lax' as const, secure: config.COOKIE_SECURE };
  reply.setCookie(SESSION_COOKIE, raw, { ...base, httpOnly: true, maxAge: config.SESSION_MAX_DAYS * 86400 });
  reply.setCookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false, maxAge: config.SESSION_MAX_DAYS * 86400 });
}

export function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

export function toMe(u: AuthUser): Me {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    roles: u.roles,
    permissions: [...u.permissions] as Permission[],
    vesselScope: u.vesselScope,
    mustChangePassword: u.mustChangePassword,
  };
}

async function loadUser(req: FastifyRequest): Promise<AuthUser | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const id = sha256(raw);
  const s = await prisma.session.findUnique({
    where: { id },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          vessels: { select: { vesselId: true } },
        },
      },
    },
  });
  const now = Date.now();
  const maxAge = config.SESSION_MAX_DAYS * 86400_000;
  if (!s || s.expiresAt.getTime() < now || now - s.createdAt.getTime() > maxAge || !s.user.isActive || s.user.deletedAt) {
    if (s) await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  // sliding expiry, throttled to one write / 5 min
  if (now - s.lastSeenAt.getTime() > 300_000) {
    await prisma.session.update({
      where: { id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(now + config.SESSION_IDLE_HOURS * 3600_000) },
    });
  }
  const perms = new Set<string>();
  for (const ur of s.user.roles) for (const rp of ur.role.permissions) perms.add(rp.permission.code);
  return {
    id: s.user.id,
    username: s.user.username,
    fullName: s.user.fullName,
    sessionId: id,
    permissions: perms,
    roles: s.user.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
    vesselScope: s.user.vessels.map((v) => v.vesselId),
    mustChangePassword: s.user.mustChangePassword,
    csrf: s.csrfToken,
  };
}

const safeEq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const PUBLIC = new Set(['/api/v1/auth/login', '/api/health']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    req.user = await loadUser(req);
    if (PUBLIC.has(url) || url.startsWith('/api/v1/gps/ingest/')) return; // device-key auth in route
    if (!req.user) throw unauthorized();
    if (MUTATING.has(req.method)) {
      const h = req.headers[CSRF_HEADER];
      const expected = req.user.csrf;
      if (typeof h !== 'string' || !safeEq(h, expected))
        throw new AppError(403, 'CSRF', 'โทเค็นความปลอดภัยไม่ถูกต้อง กรุณาโหลดหน้าใหม่');
    }
    if (req.user.mustChangePassword && !['/api/v1/auth/me', '/api/v1/auth/change-password', '/api/v1/auth/logout'].includes(url))
      throw new AppError(403, 'MUST_CHANGE_PASSWORD', 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน');
  });

  app.decorate('can', (...perms: Permission[]) => async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (!perms.every((p) => req.user!.permissions.has(p))) throw forbidden();
  });
  app.decorate('canAny', (...perms: Permission[]) => async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (!perms.some((p) => req.user!.permissions.has(p))) throw forbidden();
  });
});

export const has = (req: FastifyRequest, p: Permission) => !!req.user?.permissions.has(p);
