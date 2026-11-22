import { expect, test } from '@playwright/test';
import { login, loginOk, watchErrors } from './helpers';

test('wrong password is rejected; admin can sign in and out', async ({ page }) => {
  await login(page, 'admin', 'wrong-password');
  await expect(page.getByText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')).toBeVisible();
  await loginOk(page, 'admin');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

const PAGES = [
  '/', '/trips', '/catch', '/gps', '/fuel', '/maintenance', '/vessels', '/employees', '/documents', '/payroll', '/sales', '/purchasing',
  '/inventory', '/accounting', '/accounting?tab=ap', '/accounting?tab=bank', '/accounting?tab=assets', '/accounting?tab=tax',
  '/accounting?tab=periods', '/accounting?tab=reports&report=tb', '/admin/users', '/admin/roles', '/admin/audit',
];

test('every module page renders without errors', async ({ page }) => {
  const w = watchErrors(page);
  await loginOk(page, 'admin');
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 }).first(), path).toBeVisible();
    await expect(page.getByText('เกิดข้อผิดพลาด'), path).toHaveCount(0);
  }
  w.assertClean();
});

test('accounting: automatic posting keeps the trial balance balanced', async ({ page }) => {
  const w = watchErrors(page);
  await loginOk(page, 'admin');
  await page.goto('/accounting?tab=autopost');
  const run = page.getByRole('button', { name: 'ลงบัญชีทั้งหมด' });
  if (await run.isEnabled()) {
    await run.click();
    await page.getByRole('dialog').getByRole('button', { name: 'ลงบัญชีทั้งหมด' }).click();
    await expect(page.getByText(/ผลการลงบัญชี/)).toBeVisible();
  }
  await page.goto('/accounting?tab=reports&report=tb&rfrom=2020-01-01');
  await expect(page.getByText(/^สมดุล/).first()).toBeVisible();
  await page.goto('/accounting?tab=reports&report=bs');
  await expect(page.getByText(/^สมดุล/).first()).toBeVisible();
  w.assertClean();
});

test('captain sees only their vessel and no accounting menu', async ({ page }) => {
  await loginOk(page, 'captain1');
  await expect(page.getByRole('link', { name: 'บัญชี' })).toHaveCount(0);
  await page.goto('/vessels');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('V-002')).toHaveCount(0);
});

test('mobile layout has no horizontal page overflow', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await loginOk(page, 'admin');
  for (const path of ['/', '/trips', '/sales', '/accounting?tab=reports&report=pl']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  await ctx.close();
});

test('reports export to Excel (.xlsx) and CSV', async ({ page }) => {
  await loginOk(page, 'admin');
  await page.goto('/accounting?tab=reports&report=tb&rfrom=2020-01-01');
  await expect(page.getByText(/^สมดุล/).first()).toBeVisible();
  for (const [item, ext] of [['Excel (.xlsx)', '.xlsx'], ['CSV', '.csv']] as const) {
    await page.getByRole('button', { name: 'ส่งออก' }).first().click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).click()]);
    expect(dl.suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
    if (ext === '.xlsx') {
      const bytes = await (await dl.createReadStream()).toArray();
      expect(Buffer.concat(bytes).subarray(0, 2).toString()).toBe('PK'); // zip container
    }
  }
});
