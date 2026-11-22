import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, fixtures, login, makeApp, PASSWORD, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let base: string;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

async function cookieFor(username: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) });
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
/** read SSE events until `n` position events arrive or timeout */
async function readEvents(res: Response, n: number, ms = 4000) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: unknown[] = [];
  const deadline = Date.now() + ms;
  while (events.length < n && Date.now() < deadline) {
    const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), deadline - Date.now()))]);
    if (r.done || !r.value) break;
    buf += dec.decode(r.value, { stream: true });
    for (const block of buf.split('\n\n').slice(0, -1)) if (block.startsWith('event: position')) events.push(JSON.parse(block.split('\ndata: ')[1]!));
    buf = buf.split('\n\n').at(-1)!;
  }
  await reader.cancel();
  return events;
}

describe('live GPS stream (SSE)', () => {
  it('pushes new positions to subscribers within their vessel scope', async () => {
    const f1 = await fixtures(admin);
    const f2 = await fixtures(admin);
    await createUser('cap', 'CAPTAIN', { vesselIds: [f1.vessel.id] });
    const dev1 = (await admin.post('/gps/devices', { vesselId: f1.vessel.id, source: 'DEDICATED', identifier: 'LIVE-1' })).body.apiKey;
    const dev2 = (await admin.post('/gps/devices', { vesselId: f2.vessel.id, source: 'DEDICATED', identifier: 'LIVE-2' })).body.apiKey;

    const anon = await fetch(`${base}/api/v1/gps/stream`);
    expect(anon.status).toBe(401);
    const adminStream = await fetch(`${base}/api/v1/gps/stream`, { headers: { cookie: await cookieFor('admin') } });
    const capStream = await fetch(`${base}/api/v1/gps/stream`, { headers: { cookie: await cookieFor('cap') } });
    expect(adminStream.headers.get('content-type')).toContain('text/event-stream');

    const post = (key: string, lat: number) =>
      fetch(`${base}/api/v1/gps/ingest/generic`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': key }, body: JSON.stringify({ positions: [{ recordedAt: new Date().toISOString(), lat, lng: 100.6, speedKnots: 5 }] }) });
    setTimeout(() => void post(dev1, 7.3).then(() => post(dev2, 7.4)), 300);

    const [a, c] = await Promise.all([readEvents(adminStream, 2), readEvents(capStream, 2, 2500)]);
    expect(a.map((e) => (e as { vesselId: string }).vesselId).sort()).toEqual([f1.vessel.id, f2.vessel.id].sort());
    expect(c).toEqual([expect.objectContaining({ vesselId: f1.vessel.id, lat: 7.3, speedKnots: 5 })]); // captain: own vessel only
    expect(await prisma.gpsPosition.count()).toBe(2);
  });
});
