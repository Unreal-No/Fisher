// Secure upload/download. Content-type is sniffed from bytes (not trusted from client).
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import { FILE_SENSITIVITY, type FileSensitivity } from '@fisher/shared';
import { audit } from '../../lib/audit';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { idParam } from '../../lib/http';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { has } from '../../plugins/auth';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export default async function fileRoutes(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
    const q = req.query as { sensitivity?: string };
    const sensitivity = (FILE_SENSITIVITY as readonly string[]).includes(q.sensitivity ?? '')
      ? (q.sensitivity as FileSensitivity)
      : 'INTERNAL';
    if (sensitivity === 'PERSONAL' && !has(req, 'employee_doc.manage') && !has(req, 'employee.edit')) throw forbidden();
    const part = await req.file();
    if (!part) throw badRequest('ไม่พบไฟล์');
    const buf = await part.toBuffer(); // throws 413 when over limit
    const ft = await fileTypeFromBuffer(buf);
    if (!ft || !ALLOWED.has(ft.mime)) throw badRequest('รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ PDF');
    const id = randomUUID();
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${ALLOWED.get(ft.mime)}`;
    await storage.put(key, buf, ft.mime);
    const file = await prisma.fileObject.create({
      data: {
        storageKey: key,
        fileName: part.filename.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150),
        mimeType: ft.mime,
        sizeBytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
        sensitivity,
        uploadedById: req.user!.id,
      },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sensitivity: true },
    });
    return reply.status(201).send(file);
  });

  app.get('/:id', async (req, reply) => {
    const f = await prisma.fileObject.findFirst({ where: { id: idParam(req), deletedAt: null } });
    if (!f) throw notFound('ไฟล์');
    if (f.sensitivity === 'PERSONAL') {
      if (!has(req, 'employee.sensitive')) throw forbidden('ไม่มีสิทธิ์ดูเอกสารส่วนบุคคล');
      await audit(prisma, req, { action: 'VIEW_SENSITIVE', entityType: 'File', entityId: f.id, note: f.fileName });
    } else if (f.sensitivity === 'CONFIDENTIAL' && !['employee.view', 'vessel.view', 'trip.view'].some((p) => has(req, p as never))) {
      throw forbidden();
    }
    const body = await storage.get(f.storageKey);
    return reply
      .header('Content-Type', f.mimeType)
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`)
      .header('Cache-Control', 'private, max-age=300')
      .header('X-Content-Type-Options', 'nosniff')
      .send(body);
  });
}
