import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { geofenceSchema, gpsDemoSchema, gpsDeviceSchema, gpsMobileSchema } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { assertVesselScope, idParam, parse, scopeIds } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { sha256 } from '../../plugins/auth';
import { ADAPTERS } from './adapters';
import { fleet, generateDemo, gpsBus, ingest, track, type LivePosition } from './service';

const newKey = () => `gk_${randomBytes(24).toString('base64url')}`;
const deviceSelect = { id: true, vesselId: true, source: true, identifier: true, name: true, isActive: true, lastSeenAt: true, notes: true, createdAt: true, vessel: { select: { code: true, name: true } } } as const;

export default async function gpsRoutes(app: FastifyInstance) {
  // ---------- device ingestion (no session; authenticated by device API key) ----------
  const ingestHandler = async (req: FastifyRequest) => {
    const { adapter, key: pathKey } = req.params as { adapter: string; key?: string };
    const a = ADAPTERS[adapter];
    if (!a) throw notFound(`adapter "${adapter}"`);
    const key = (req.headers['x-device-key'] as string | undefined) ?? pathKey;
    if (!key) throw new AppError(401, 'DEVICE_KEY_REQUIRED', 'ต้องระบุ device key');
    const device = await prisma.gpsDevice.findUnique({ where: { apiKeyHash: sha256(key) } });
    if (!device || !device.isActive) throw new AppError(401, 'INVALID_DEVICE_KEY', 'device key ไม่ถูกต้องหรือถูกปิดใช้งาน');
    if (a.source === 'AIS' && device.source !== 'AIS') throw badRequest('อุปกรณ์นี้ไม่ใช่แหล่งข้อมูล AIS');
    const positions = a.parse({ body: req.body, query: req.query as Record<string, string> });
    return ingest({ id: device.id, vesselId: device.vesselId, source: a.source === 'AIS' ? 'AIS' : device.source }, positions);
  };
  const ingestCfg = { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } };
  for (const url of ['/ingest/:adapter', '/ingest/:adapter/:key']) {
    app.post(url, ingestCfg, ingestHandler);
    app.get(url, ingestCfg, ingestHandler); // OsmAnd/Traccar clients may use GET
  }

  // ---------- mobile phone GPS from the logged-in PWA ----------
  app.post('/mobile', { preHandler: app.can('gps.report') }, async (req) => {
    const b = parse(gpsMobileSchema, req.body);
    assertVesselScope(req, b.vesselId);
    const v = await prisma.vessel.findFirst({ where: { id: b.vesselId, deletedAt: null } });
    if (!v) throw notFound('เรือ');
    const device = await prisma.gpsDevice.upsert({
      where: { identifier: `mobile:${req.user!.id}` },
      create: { identifier: `mobile:${req.user!.id}`, source: 'MOBILE', vesselId: b.vesselId, name: `มือถือ ${req.user!.username}` },
      update: { vesselId: b.vesselId },
    });
    return ingest({ id: device.id, vesselId: b.vesselId, source: 'MOBILE' }, b.positions.map((p) => ({ ...p, recordedAt: new Date(p.recordedAt) })));
  });

  // ---------- map data ----------
  app.get('/fleet', { preHandler: app.can('gps.view') }, async (req) => fleet(scopeIds(req)));

  /** Live positions (Server-Sent Events). Only vessels in the user's scope; ends when the session ends. */
  app.get('/stream', { preHandler: app.can('gps.view') }, async (req, reply) => {
    const scope = scopeIds(req);
    const sessionId = req.user!.sessionId;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 5000\n\n');
    const send = (p: LivePosition) => {
      if (!scope || scope.includes(p.vesselId)) res.write(`event: position\ndata: ${JSON.stringify(p)}\n\n`);
    };
    gpsBus.on('position', send);
    const close = () => {
      clearInterval(ping);
      gpsBus.off('position', send);
      res.end();
    };
    const ping = setInterval(async () => {
      const alive = await prisma.session.findUnique({ where: { id: sessionId }, select: { expiresAt: true } }).catch(() => null);
      if (!alive || alive.expiresAt < new Date()) return close();
      res.write(': ping\n\n');
    }, 25_000);
    req.raw.on('close', close);
  });
  app.get('/track', { preHandler: app.can('gps.view') }, async (req) => {
    const f = req.query as { vesselId?: string; from?: string; to?: string; includeDemo?: string };
    if (!f.vesselId) throw badRequest('ต้องระบุเรือ');
    assertVesselScope(req, f.vesselId);
    const to = f.to ? new Date(f.to) : new Date();
    const from = f.from ? new Date(f.from) : new Date(to.getTime() - 24 * 3600_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw badRequest('ช่วงเวลาไม่ถูกต้อง');
    if (to.getTime() - from.getTime() > 93 * 86400_000) throw badRequest('เลือกช่วงเวลาได้ไม่เกิน 93 วัน');
    return track(f.vesselId, from, to, f.includeDemo !== 'false');
  });

  // ---------- demo mode (flagged is_demo; never mixed with real alerts) ----------
  app.post('/demo', { preHandler: app.can('gps.manage') }, async (req) => {
    const b = parse(gpsDemoSchema, req.body);
    return generateDemo(req, b.vesselId, b.hours);
  });
  app.delete('/demo', { preHandler: app.can('gps.manage') }, async (req) => {
    const vesselId = (req.query as { vesselId?: string }).vesselId;
    const where = { isDemo: true, ...(vesselId ? { vesselId } : {}) };
    const [p, e] = await prisma.$transaction([prisma.gpsPosition.deleteMany({ where }), prisma.geofenceEvent.deleteMany({ where })]);
    await audit(prisma, req, { action: 'DELETE', entityType: 'GpsDemo', entityId: vesselId ?? null, note: `${p.count} positions, ${e.count} events` });
    return { deletedPositions: p.count, deletedEvents: e.count };
  });

  // ---------- devices ----------
  app.get('/devices', { preHandler: app.can('gps.view') }, async (req) => {
    const scope = scopeIds(req);
    return prisma.gpsDevice.findMany({
      where: { NOT: { identifier: { startsWith: 'demo:' } }, ...(scope ? { vesselId: { in: scope } } : {}) },
      select: deviceSelect, orderBy: { createdAt: 'desc' },
    });
  });
  app.post('/devices', { preHandler: app.can('gps.manage') }, async (req, reply) => {
    const b = parse(gpsDeviceSchema, req.body);
    const key = newKey();
    const d = await prisma.$transaction(async (tx) => {
      const created = await tx.gpsDevice.create({ data: { ...b, apiKeyHash: sha256(key) }, select: deviceSelect });
      await audit(tx, req, { action: 'CREATE', entityType: 'GpsDevice', entityId: created.id, after: created });
      return created;
    });
    return reply.status(201).send({ device: d, apiKey: key }); // key shown once only
  });
  app.patch('/devices/:id', { preHandler: app.can('gps.manage') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.gpsDevice.findUnique({ where: { id }, select: deviceSelect });
    if (!before) throw notFound('อุปกรณ์');
    const after = await prisma.gpsDevice.update({ where: { id }, data: parse(gpsDeviceSchema.partial(), req.body), select: deviceSelect });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'GpsDevice', entityId: id, before, after });
    return after;
  });
  app.post('/devices/:id/rotate-key', { preHandler: app.can('gps.manage') }, async (req) => {
    const id = idParam(req);
    const key = newKey();
    await prisma.gpsDevice.update({ where: { id }, data: { apiKeyHash: sha256(key) } });
    await audit(prisma, req, { action: 'ROTATE_KEY', entityType: 'GpsDevice', entityId: id });
    return { apiKey: key };
  });

  // ---------- geofences ----------
  const fenceData = (b: Partial<ReturnType<typeof geofenceSchema.parse>>) => ({ ...b, polygon: b.polygon === null ? undefined : b.polygon });
  app.get('/geofences', { preHandler: app.can('gps.view') }, async () => prisma.geofence.findMany({ orderBy: { createdAt: 'asc' } }));
  app.post('/geofences', { preHandler: app.can('gps.manage') }, async (req, reply) => {
    const b = parse(geofenceSchema, req.body);
    const g = await prisma.geofence.create({ data: { ...fenceData(b), createdById: req.user!.id } as never });
    await audit(prisma, req, { action: 'CREATE', entityType: 'Geofence', entityId: g.id, after: g });
    return reply.status(201).send(g);
  });
  app.put('/geofences/:id', { preHandler: app.can('gps.manage') }, async (req) => {
    const id = idParam(req);
    const before = await prisma.geofence.findUnique({ where: { id } });
    if (!before) throw notFound('เขตพื้นที่');
    const b = parse(geofenceSchema, req.body);
    const after = await prisma.geofence.update({ where: { id }, data: fenceData(b) as never });
    await audit(prisma, req, { action: 'UPDATE', entityType: 'Geofence', entityId: id, before, after });
    return after;
  });
  app.get('/geofence-events', { preHandler: app.can('gps.view') }, async (req) => {
    const f = req.query as { vesselId?: string };
    const scope = scopeIds(req);
    return prisma.geofenceEvent.findMany({
      where: { ...(f.vesselId ? { vesselId: f.vesselId } : {}), ...(scope ? { vesselId: { in: scope } } : {}) },
      include: { geofence: { select: { name: true } }, vessel: { select: { code: true, name: true } } },
      orderBy: { at: 'desc' }, take: 200,
    });
  });
}
