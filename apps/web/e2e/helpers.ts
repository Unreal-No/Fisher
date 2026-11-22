import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD ?? 'Admin@12345';

export async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('input[autocomplete=username]', username);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
}
export async function loginOk(page: Page, username: string) {
  await login(page, username);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Fails the test on uncaught page errors and on API 5xx responses. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.request().method()} ${r.url()} → ${r.status()}`);
  });
  return { assertClean: () => expect(errors, errors.join('\n')).toEqual([]) };
}
