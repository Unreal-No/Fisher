import { execSync } from 'node:child_process';

/** Safety: tests TRUNCATE tables, so only ever run against a database whose name ends with "_test". */
export function assertTestDb(url = process.env.TEST_DATABASE_URL ?? '') {
  const name = new URL(url).pathname.slice(1);
  if (!/_test$/.test(name)) throw new Error(`Refusing to run tests against non-test database "${name}"`);
}

export default function setup() {
  assertTestDb();
  // apply pending migrations (non-destructive)
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL } });
}
