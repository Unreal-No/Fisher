import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESET_CONFIRM_TEXT } from '@fisher/shared';
import { createUser, departedTrip, fixtures, login, makeApp, PASSWORD, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('owner', 'OWNER');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

describe('first installation: wipe data, then go live', () => {
  it('removes all business data and other users, keeps reference data and the administrator, restarts numbering', async () => {
    const f = await fixtures(admin);
    await departedTrip(admin, f);
    const accountsBefore = await prisma.account.count();
    const st = (await admin.get('/system')).body;
    expect(st).toMatchObject({ canReset: true, goLiveAt: null });
    expect(st.counts.vessels).toBe(1);

    const owner = await login(app, 'owner');
    expect((await owner.post('/system/reset', { password: PASSWORD, confirm: RESET_CONFIRM_TEXT })).status).toBe(403);
    expect((await admin.post('/system/reset', { password: 'wrong', confirm: RESET_CONFIRM_TEXT })).status).toBe(400);
    expect((await admin.post('/system/reset', { password: PASSWORD, confirm: 'ok' })).status).toBe(400);

    const r = await admin.post('/system/reset', { password: PASSWORD, confirm: RESET_CONFIRM_TEXT });
    expect(r.status).toBe(200);
    expect(r.body.status.counts).toEqual({ vessels: 0, employees: 0, trips: 0, journals: 0, users: 1, positions: 0 });
    expect(await prisma.fishingTrip.count()).toBe(0);
    expect(await prisma.account.count()).toBe(accountsBefore); // chart of accounts kept
    expect(await prisma.fishSpecies.count()).toBeGreaterThan(0);
    expect(await prisma.user.findUnique({ where: { username: 'owner' } })).toBeNull();
    expect((await admin.get('/auth/me')).status).toBe(200); // still signed in
    const fk = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_constraint WHERE conname = 'users_employee_id_fkey'`;
    expect(Number(fk[0]!.n)).toBe(1); // foreign key restored
    const audits = await prisma.auditLog.findMany({ where: { action: 'SYSTEM_RESET' } });
    expect(audits).toHaveLength(1);

    // numbering starts again
    const f2 = await fixtures(admin);
    const t = await departedTrip(admin, f2);
    expect(t.tripNo).toMatch(/-0001$/);
  });

  it('after go-live the data can no longer be wiped', async () => {
    expect((await admin.post('/system/go-live', { password: 'wrong' })).status).toBe(400);
    const g = await admin.post('/system/go-live', { password: PASSWORD });
    expect(g.body).toMatchObject({ canReset: false });
    expect(g.body.goLiveAt).toBeTruthy();
    const again = await admin.post('/system/reset', { password: PASSWORD, confirm: RESET_CONFIRM_TEXT });
    expect(again.body.error.code).toBe('LOCKED');
    expect((await admin.post('/system/go-live', { password: PASSWORD })).body.error.code).toBe('LOCKED');
    expect(await prisma.vessel.count()).toBe(1);
  });
});
