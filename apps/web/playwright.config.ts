import { defineConfig, devices } from '@playwright/test';

// Local: run against `pnpm dev` (http://localhost:5173). CI: built API + `vite preview` are started here.
const ci = !!process.env.CI;
const baseURL = process.env.E2E_BASE_URL ?? (ci ? 'http://localhost:4173' : 'http://localhost:5173');

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  timeout: 60_000,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'off', screenshot: 'only-on-failure', locale: 'th-TH', timezoneId: 'Asia/Bangkok' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: ci
    ? [
        { command: 'node ../api/dist/server.js', url: 'http://localhost:3000/api/health', timeout: 60_000, reuseExistingServer: false },
        { command: 'pnpm preview --port 4173 --strictPort', url: 'http://localhost:4173', timeout: 60_000, reuseExistingServer: false },
      ]
    : undefined,
});
