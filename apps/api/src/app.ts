import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { config } from './config';
import { registerErrorHandler } from './lib/errors';
import { prisma } from './lib/prisma';
import adminRoutes from './modules/admin/routes';
import authRoutes from './modules/auth/routes';
import catchRoutes from './modules/catch/routes';
import dashboardRoutes from './modules/dashboard/routes';
import employeeRoutes from './modules/employees/routes';
import fileRoutes from './modules/files/routes';
import notificationRoutes from './modules/notifications/routes';
import tripRoutes from './modules/trips/routes';
import vesselRoutes from './modules/vessels/routes';
import { authPlugin } from './plugins/auth';

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
    logger: config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'] },
    ...opts,
  });

  // JSON: BigInt -> string (audit ids, GPS ids); Prisma Decimal serialises to string by itself.
  app.setReplySerializer((payload) => JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, { origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: config.NODE_ENV === 'test' ? 10_000 : 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
  await app.register(authPlugin);
  registerErrorHandler(app);

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(adminRoutes);
      await api.register(fileRoutes, { prefix: '/files' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(vesselRoutes, { prefix: '/vessels' });
      await api.register(employeeRoutes, { prefix: '/employees' });
      await api.register(tripRoutes, { prefix: '/trips' });
      await api.register(catchRoutes, { prefix: '/catch' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
    },
    { prefix: '/api/v1' },
  );

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `ไม่พบเส้นทาง ${req.method} ${req.url.split('?')[0]}` } }),
  );
  return app;
}
