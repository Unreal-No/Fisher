import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { config } from '../config';
import { decField, encData, type PiiModel } from './pii';

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert']);
/** encrypt personal-data columns on every write of the model */
const encryptWrites = (model: PiiModel) => ({
  async $allOperations({ operation, args, query }: { operation: string; args: Record<string, unknown>; query: (a: unknown) => Promise<unknown> }) {
    if (WRITES.has(operation)) {
      const a = { ...args };
      if ('data' in a) a.data = encData(model, a.data);
      if ('create' in a) a.create = encData(model, a.create);
      if ('update' in a) a.update = encData(model, a.update);
      return query(a);
    }
    return query(args);
  },
});

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
export const prisma = base.$extends({
  query: { employee: encryptWrites('employee'), employeeDocument: encryptWrites('employeeDocument') },
  // decrypted on read, including nested include/select of other models
  result: {
    employee: {
      nationalIdNo: { needs: { nationalIdNo: true }, compute: (e) => decField(e.nationalIdNo) },
      bankAccountNo: { needs: { bankAccountNo: true }, compute: (e) => decField(e.bankAccountNo) },
    },
    employeeDocument: { documentNo: { needs: { documentNo: true }, compute: (d) => decField(d.documentNo) } },
  },
});
export type Db = typeof prisma;
/** Interactive-transaction client type */
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
export { Prisma } from '../generated/prisma/client';
