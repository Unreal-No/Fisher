import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from './prisma';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const notFound = (what = 'ข้อมูล') => new AppError(404, 'NOT_FOUND', `ไม่พบ${what}`);
export const forbidden = (msg = 'ไม่มีสิทธิ์ดำเนินการนี้') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, details?: unknown) => new AppError(409, code, msg, details);
export const unprocessable = (code: string, msg: string, details?: unknown) => new AppError(422, code, msg, details);

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of err.issues) (fieldErrors[i.path.join('.') || '_'] ??= []).push(i.message);
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: 'ข้อมูลไม่ถูกต้อง', fieldErrors } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return reply.status(409).send({
          error: { code: 'DUPLICATE', message: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว', details: err.meta },
        });
      if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'ไม่พบข้อมูล' } });
      if (err.code === 'P2003')
        return reply.status(409).send({ error: { code: 'REFERENCE_ERROR', message: 'ข้อมูลอ้างอิงไม่ถูกต้องหรือถูกใช้งานอยู่' } });
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ error: { code: fe.code ?? 'ERROR', message: fe.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' } });
  });
}
