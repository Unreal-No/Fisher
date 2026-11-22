import { expect, test, type BrowserContext } from '@playwright/test';
import { hotp, totpStep } from '../../api/src/lib/totp';
import { login, loginOk, PASSWORD } from './helpers';

/** API call with the session + CSRF cookie of a signed-in context */
async function api(ctx: BrowserContext, method: 'GET' | 'POST', path: string) {
  const csrf = (await ctx.cookies()).find((c) => c.name === 'fcsrf')?.value ?? '';
  const r = await ctx.request.fetch(`/api/v1${path}`, { method, headers: { 'x-csrf-token': csrf }, data: method === 'POST' ? {} : undefined });
  return r.json();
}

test('enrol two-factor, then sign in with password + authenticator code', async ({ browser }) => {
  const user = 'viewer';
  // enrol
  const a = await browser.newContext();
  const page = await a.newPage();
  await loginOk(page, user);
  await page.goto('/account');
  await page.getByRole('button', { name: 'เปิดใช้งาน' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('ยืนยันรหัสผ่านของคุณ').fill(PASSWORD);
  await dlg.getByRole('button', { name: 'ถัดไป' }).click();
  const secret = (await dlg.locator('code.font-mono').textContent())!.trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(dlg.locator('svg').first()).toBeVisible(); // QR
  await dlg.getByLabel('รหัส 6 หลัก').fill(hotp(secret, totpStep()));
  await dlg.getByRole('button', { name: 'ยืนยันและเปิดใช้งาน' }).click();
  const codes = page.getByRole('dialog');
  await expect(codes.getByText(/^[a-z2-7]{4}-[a-z2-7]{4}$/).first()).toBeVisible();
  await codes.getByLabel('บันทึกรหัสไว้แล้ว').check();
  await codes.getByRole('button', { name: 'ปิด' }).last().click();
  await a.close();

  // sign in: password alone is not enough
  const b = await browser.newContext();
  const p2 = await b.newPage();
  await login(p2, user);
  await expect(p2.getByText('ยืนยันตัวตนสองขั้นตอน').first()).toBeVisible();
  expect((await b.cookies()).find((c) => c.name === 'fsid')).toBeUndefined();
  await p2.locator('input[autocomplete=one-time-code]').fill(hotp(secret, totpStep() + 1));
  await p2.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await p2.waitForURL((u) => !u.pathname.startsWith('/login'));
  await b.close();

  // clean up: an administrator resets the factor
  const c = await browser.newContext();
  const ap = await c.newPage();
  await loginOk(ap, 'admin');
  const users = await api(c, 'GET', `/users?q=${user}`);
  const id = users.items.find((u: { username: string }) => u.username === user).id;
  expect((await api(c, 'POST', `/users/${id}/reset-2fa`)).ok).toBe(true);
  await c.close();
});
