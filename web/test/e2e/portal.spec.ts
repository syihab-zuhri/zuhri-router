import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('masuk keyboard, CSRF, shell 360px dan fokus navigasi', async ({ page }) => {
  let signedIn = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') { expect(route.request().headers()['x-router-csrf']).toBe('1'); signedIn = true; return route.fulfill({ json: { ok: true } }); }
    if (path === '/api/me') return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { username: 'uji', tenantStatus: 'ACTIVE', version: '1' } : { error: { code: 'unauthorized' } } });
    if (path === '/api/balance') return route.fulfill({ json: { postedMicro: '9223372036854775807', heldMicro: '0', availableMicro: '9223372036854775807', currency: 'TOKEN' } });
    if (path === '/api/packs') return route.fulfill({ json: { packs: [] } });
    return route.fulfill({ json: { entries: [], nextBefore: null } });
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/masuk');
  await expect(page.getByRole('heading', { name: 'Masuk', exact: true })).toBeVisible();
  await page.getByLabel('Username atau email').focus();
  await page.keyboard.type('uji'); await page.keyboard.press('Tab'); await page.keyboard.type('customer-password-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Beranda', exact: true })).toBeVisible();
  await expect(page.getByText('9.223.372.036.854,775807', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).focus(); await page.keyboard.press('Enter');
  const modal = page.getByRole('dialog'); await expect(modal).toBeVisible();
  await page.keyboard.press('Escape'); await expect(modal).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  const scan = await new AxeBuilder({ page }).analyze(); expect(scan.violations).toEqual([]);
});

test('aktivasi menghapus fragment sebelum request dan merender hasil server', async ({ page }) => {
  let payload: unknown;
  await page.route('**/api/auth/activate', async route => { payload = route.request().postDataJSON(); await route.fulfill({ status: 201, json: { ok: true } }); });
  await page.goto('/aktivasi#token=test-fragment-only');
  await expect(page).toHaveURL(/\/aktivasi$/);
  await page.getByLabel('Username', { exact: true }).fill('pengguna');
  await page.getByLabel('Password baru', { exact: true }).fill('customer-password-1');
  await page.getByRole('button', { name: 'Aktifkan akun' }).click();
  await expect(page.getByText('Akun sudah aktif. Silakan masuk.')).toBeVisible();
  expect(payload).toEqual({ token: 'test-fragment-only', username: 'pengguna', password: 'customer-password-1' });
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
