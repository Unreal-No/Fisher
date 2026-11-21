import type { FastifyInstance } from 'fastify';
import { idParam, paged, paging, parseList } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { scanExpirations } from './service';

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const q = parseList(req);
    const unread = (req.query as { unread?: string }).unread === 'true';
    const where = { userId: req.user!.id, ...(unread ? { readAt: null } : {}) };
    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: [{ readAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], ...paging(q) }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    ]);
    return { ...paged(items, total, q), unreadCount };
  });
  app.post('/:id/read', async (req) => {
    await prisma.notification.updateMany({ where: { id: idParam(req), userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
  app.post('/read-all', async (req) => {
    const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, count: r.count };
  });
  app.post('/scan', { preHandler: app.canAny('settings.manage', 'employee_doc.manage') }, async () => scanExpirations());
}
