import type { FastifyInstance } from 'fastify';
import { hash } from '@node-rs/argon2';
import { buildApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { seedCore } from '../src/lib/seed-core';
import { assertTestDb } from './global-setup';

export { prisma };
export const PASSWORD = 'Test@12345';
let pwHash: string | undefined;

export async function resetDb() {
  assertTestDb(process.env.DATABASE_URL);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seedCore(prisma);
}

export async function makeApp() {
  const app = await buildApp();
  await app.ready();
  return app;
}

export interface Agent {
  userId: string;
  get: (url: string) => Promise<Res>;
  post: (url: string, body?: unknown) => Promise<Res>;
  patch: (url: string, body?: unknown) => Promise<Res>;
  put: (url: string, body?: unknown) => Promise<Res>;
  del: (url: string) => Promise<Res>;
}
export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export async function createUser(username: string, roleCode: string, opts: { vesselIds?: string[]; mustChange?: boolean } = {}) {
  pwHash ??= await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  return prisma.user.create({
    data: {
      username, fullName: username, passwordHash: pwHash, mustChangePassword: !!opts.mustChange,
      roles: { create: [{ roleId: role.id }] },
      vessels: { create: (opts.vesselIds ?? []).map((vesselId) => ({ vesselId })) },
    },
  });
}

export async function login(app: FastifyInstance, username: string, password = PASSWORD): Promise<Agent> {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  if (r.statusCode !== 200) throw new Error(`login failed ${r.statusCode} ${r.body}`);
  const cookies = Object.fromEntries(r.cookies.map((c) => [c.name, c.value]));
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  const call = async (method: string, url: string, body?: unknown): Promise<Res> => {
    const res = await app.inject({
      method: method as never,
      url: `/api/v1${url}`,
      headers: { cookie: cookieHeader, 'x-csrf-token': cookies.fcsrf! },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return {
    userId: user.id,
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b ?? {}),
    patch: (u, b) => call('PATCH', u, b ?? {}),
    put: (u, b) => call('PUT', u, b ?? {}),
    del: (u) => call('DELETE', u),
  };
}

export const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400_000).toISOString().slice(0, 10);
export const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

/** Creates a vessel + an ACTIVE Thai captain & foreign crew with all required documents valid. */
export async function fixtures(admin: Agent) {
  const v = await admin.post('/vessels', { name: 'ทดสอบ 1', registrationNo: `REG-${Math.random().toString(36).slice(2, 8)}`, vesselType: 'อวนลาก' });
  const types = (await admin.get('/document-types')).body as { id: string; code: string; appliesTo: string; isRequired: boolean; requiresExpiry: boolean }[];
  const mk = async (firstName: string, nationality: string, position: string, withDocs = true) => {
    const e = await admin.post('/employees', { firstName, lastName: 'ทดสอบ', nationality, position, startDate: iso(-100) });
    if (withDocs)
      for (const t of types.filter((t) => t.isRequired && (t.appliesTo === 'ALL' || (t.appliesTo === 'THAI') === (nationality === 'TH'))))
        await admin.post(`/employees/${e.body.id}/documents`, { documentTypeId: t.id, documentNo: `${t.code}-${firstName}`, expiryDate: t.requiresExpiry ? iso(365) : '' });
    return e.body;
  };
  const captain = await mk('ไต้ก๋ง', 'TH', 'CAPTAIN');
  const crew = await mk('Aung', 'MM', 'DECKHAND');
  return { vessel: v.body, captain, crew, types };
}

export async function departedTrip(admin: Agent, f: Awaited<ReturnType<typeof fixtures>>) {
  const t = (await admin.post('/trips', { vesselId: f.vessel.id, captainId: f.captain.id })).body;
  await admin.put(`/trips/${t.id}/crew`, { members: [{ employeeId: f.captain.id, role: 'CAPTAIN' }, { employeeId: f.crew.id, role: 'DECKHAND' }] });
  await admin.post(`/trips/${t.id}/status`, { status: 'PREPARING' });
  const d = await admin.post(`/trips/${t.id}/depart`, { departedAt: ago(48), departurePort: 'สงขลา', fuelAtDepartureL: 500 });
  if (d.status !== 200) throw new Error(`depart failed ${JSON.stringify(d.body)}`);
  return t as { id: string; tripNo: string };
}
