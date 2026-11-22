import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendNotificationDigests } from '../src/lib/mail';
import { createUser, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

describe('outgoing email (simulated without SMTP)', () => {
  it('records test emails and daily digests in the outbox without sending', async () => {
    expect((await admin.post('/outbox/test', { to: 'not-an-email' })).status).toBe(400);
    const t = await admin.post('/outbox/test', { to: 'owner@example.com' });
    expect(t.body).toMatchObject({ status: 'SIMULATED', to: 'owner@example.com' });

    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.user.update({ where: { id: u.id }, data: { email: 'admin@example.com' } });
    await prisma.notification.createMany({
      data: [
        { userId: u.id, type: 'DOC_EXPIRY', severity: 'WARNING', title: 'เอกสารใกล้หมดอายุ 3 รายการ', message: 'Seabook ของ Aung', dedupeKey: 't1' },
        { userId: u.id, type: 'LOW_STOCK', severity: 'INFO', title: 'ข้อมูลทั่วไป', message: '-', dedupeKey: 't2' },
      ],
    });
    expect((await sendNotificationDigests()).sent).toBe(1);
    expect((await sendNotificationDigests()).sent).toBe(0); // once a day
    const box = (await admin.get('/outbox')).body;
    expect(box.mode).toBe('SIMULATED');
    expect(box.total).toBe(2);
    const digest = box.items.find((m: { relatedType: string }) => m.relatedType === 'DIGEST');
    expect(digest.body).toContain('เอกสารใกล้หมดอายุ 3 รายการ');
    expect(digest.body).not.toContain('ข้อมูลทั่วไป'); // info-level not emailed
  });
});
