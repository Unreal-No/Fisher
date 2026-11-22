import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptExistingPii } from '../src/lib/pii';
import { createUser, fixtures, iso, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
let viewer: Agent;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  await createUser('viewer', 'VIEWER');
  admin = await login(app, 'admin');
  viewer = await login(app, 'viewer');
});
afterAll(() => app.close());

const raw = async (id: string) =>
  (await prisma.$queryRaw<{ n: string | null; b: string | null }[]>`SELECT national_id_no AS n, bank_account_no AS b FROM employees WHERE id = ${id}::uuid`)[0]!;

describe('personal data encryption at rest', () => {
  it('stores ciphertext, returns plaintext to authorised users and masks for others', async () => {
    const e = await admin.post('/employees', { firstName: 'สมชาย', lastName: 'ทดสอบ', nationality: 'TH', position: 'DECKHAND', startDate: iso(-10), nationalIdNo: '1101700203451', bankName: 'กสิกรไทย', bankAccountNo: '123-4-56789-0' });
    expect(e.status).toBe(201);
    const r = await raw(e.body.id);
    expect(r.n).toMatch(/^v1:/);
    expect(r.b).toMatch(/^v1:/);
    expect(r.n).not.toContain('1101700203451');
    expect((await admin.get(`/employees/${e.body.id}`)).body).toMatchObject({ nationalIdNo: '1101700203451', bankAccountNo: '123-4-56789-0' });
    const masked = (await viewer.get(`/employees/${e.body.id}`)).body;
    expect(masked.nationalIdNo).not.toBe('1101700203451');
    expect(masked.nationalIdNo).toMatch(/^11\*+51$/);

    // update keeps it encrypted; ciphertext changes (random IV)
    expect((await admin.patch(`/employees/${e.body.id}`, { bankAccountNo: '999-9-99999-9' })).status).toBe(200);
    const r2 = await raw(e.body.id);
    expect(r2.b).toMatch(/^v1:/);
    expect(r2.n).toBe(r.n);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: e.body.id } })).bankAccountNo).toBe('999-9-99999-9');

    // nested reads decrypt too (payslip / bank file paths include the employee)
    const viaInclude = await prisma.employeeDocument.findMany({ take: 1, include: { employee: { select: { nationalIdNo: true } } } });
    if (viaInclude[0]) expect(viaInclude[0].employee.nationalIdNo ?? '').not.toMatch(/^v1:/);
  });

  it('documents numbers are encrypted; audit snapshots hold masked values only', async () => {
    const f = await fixtures(admin);
    const doc = await prisma.employeeDocument.findFirstOrThrow({ where: { employeeId: f.crew.id } });
    const [rawDoc] = await prisma.$queryRaw<{ d: string }[]>`SELECT document_no AS d FROM employee_documents WHERE id = ${doc.id}::uuid`;
    expect(rawDoc!.d).toMatch(/^v1:/);
    expect(doc.documentNo).not.toMatch(/^v1:/);
    const logs = await prisma.auditLog.findMany({ where: { entityType: 'Employee' } });
    expect(JSON.stringify(logs.map((l) => [l.before, l.after]))).not.toMatch(/v1:|1101700203451/);
  });

  it('upgrades plaintext rows written by earlier versions', async () => {
    const id = (await prisma.employee.findFirstOrThrow()).id;
    await prisma.$executeRaw`UPDATE employees SET national_id_no = '3100500000011', bank_account_no = NULL WHERE id = ${id}::uuid`;
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).nationalIdNo).toBe('3100500000011'); // legacy plaintext still readable
    const res = await encryptExistingPii(prisma);
    expect(res.employees).toBe(1);
    expect((await raw(id)).n).toMatch(/^v1:/);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).nationalIdNo).toBe('3100500000011');
    expect((await encryptExistingPii(prisma)).employees).toBe(0); // idempotent
  });
});

describe('wrong key', () => {
  it('fails with a clear error instead of returning garbage', async () => {
    const { decrypt } = await import('../src/lib/crypto');
    const tampered = 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA';
    expect(() => decrypt(tampered)).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
