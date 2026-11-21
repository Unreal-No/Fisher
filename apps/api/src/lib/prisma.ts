import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { config } from '../config';

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
export type Db = typeof prisma;
/** Interactive-transaction client type */
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
export { Prisma } from '../generated/prisma/client';
