import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: '../../.env', quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required for API tests');

export default defineConfig({
  test: {
    env: { DATABASE_URL: url, NODE_ENV: 'test', STORAGE_LOCAL_DIR: './storage-test', STORAGE_DRIVER: 'local' },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
