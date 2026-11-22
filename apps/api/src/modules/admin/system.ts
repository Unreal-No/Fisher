// First installation: wipe demo/test data before real use, then lock ("go live") so it can never run again.
import { verify } from '@node-rs/argon2';
import type { FastifyRequest } from 'fastify';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { getSettings, invalidateSettingsCache } from '../../lib/settings';
import { storage } from '../../lib/storage';

/** Reference data and access control survive a reset. Everything else is business data. */
const KEEP = new Set([
  '_prisma_migrations', 'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
  'document_types', 'catch_grades', 'fish_species', 'accounts', 'account_mappings', 'app_settings', 'audit_logs',
  // removed through the users they belong to (keeps the administrator signed in)
  'sessions', 'login_challenges',
]);

export async function systemStatus() {
  const s = await getSettings(prisma);
  const [vessels, employees, trips, journals, users, positions] = await Promise.all([
    prisma.vessel.count(), prisma.employee.count(), prisma.fishingTrip.count(), prisma.journalEntry.count(), prisma.user.count(), prisma.gpsPosition.count(),
  ]);
  return { goLiveAt: s.goLiveAt, canReset: !s.goLiveAt, counts: { vessels, employees, trips, journals, users, positions } };
}

async function checkAdmin(req: FastifyRequest, password: string) {
  if (!req.user!.roles.some((r) => r.code === 'SUPER_ADMIN')) throw forbidden('เฉพาะผู้ดูแลระบบสูงสุด (SUPER_ADMIN)');
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verify(u.passwordHash, password))) throw badRequest('รหัสผ่านไม่ถูกต้อง');
}

export async function resetAllData(req: FastifyRequest, password: string) {
  await checkAdmin(req, password);
  if ((await getSettings(prisma)).goLiveAt) throw conflict('LOCKED', 'ระบบเริ่มใช้งานจริงแล้ว ล้างข้อมูลไม่ได้');
  const before = await systemStatus();
  const tables = (await prisma.$queryRaw<{ t: string }[]>`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`).map((r) => r.t).filter((t) => !KEEP.has(t));
  const files = await prisma.fileObject.findMany({ select: { storageKey: true } });
  const me = req.user!.id;
  await prisma.$transaction(
    async (tx) => {
      // kept tables that reference wiped ones (users.employee_id → employees): null the column, drop the FK,
      // wipe everything in one TRUNCATE, then restore the FK exactly as defined
      await tx.$executeRaw`UPDATE users SET employee_id = NULL`;
      const fks = await tx.$queryRaw<{ tbl: string; name: string; def: string; ref: string }[]>`
        SELECT c.conrelid::regclass::text AS tbl, c.conname AS name, pg_get_constraintdef(c.oid) AS def, c.confrelid::regclass::text AS ref
        FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`;
      const cross = fks.filter((f) => KEEP.has(f.tbl.replace(/"/g, '')) && !KEEP.has(f.ref.replace(/"/g, '')));
      for (const f of cross) await tx.$executeRawUnsafe(`ALTER TABLE ${f.tbl} DROP CONSTRAINT "${f.name}"`);
      // identifiers come from pg_tables (this database), quoted
      await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
      for (const f of cross) await tx.$executeRawUnsafe(`ALTER TABLE ${f.tbl} ADD CONSTRAINT "${f.name}" ${f.def}`);
      // demo accounts with known passwords must not survive; the administrator doing the reset stays
      await tx.$executeRaw`DELETE FROM users WHERE id <> ${me}::uuid`;
      await tx.appSetting.upsert({ where: { key: 'gpsSimulator' }, create: { key: 'gpsSimulator', value: false, updatedById: me }, update: { value: false, updatedById: me } });
      await audit(tx, req, { action: 'SYSTEM_RESET', entityType: 'System', before: before.counts, after: { tables: tables.length, files: files.length } });
    },
    { timeout: 120_000 },
  );
  invalidateSettingsCache();
  let removed = 0;
  for (const f of files) {
    await storage.remove(f.storageKey).then(() => removed++).catch(() => undefined);
  }
  return { ok: true, tables: tables.length, filesRemoved: removed, status: await systemStatus() };
}

export async function goLive(req: FastifyRequest, password: string) {
  await checkAdmin(req, password);
  const s = await getSettings(prisma);
  if (s.goLiveAt) throw conflict('LOCKED', 'ยืนยันเริ่มใช้งานจริงไปแล้ว');
  const at = new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({ where: { key: 'goLiveAt' }, create: { key: 'goLiveAt', value: at, updatedById: req.user!.id }, update: { value: at, updatedById: req.user!.id } });
    await audit(tx, req, { action: 'GO_LIVE', entityType: 'System', after: { goLiveAt: at } });
  });
  invalidateSettingsCache();
  return systemStatus();
}
