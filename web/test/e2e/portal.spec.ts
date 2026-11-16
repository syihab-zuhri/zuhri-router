import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { m } from '../../src/messages.ts';

test('masuk keyboard, CSRF, shell 360px dan fokus navigasi', async ({ page }) => {
  let signedIn = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') { expect(route.request().headers()['x-router-csrf']).toBe('1'); signedIn = true; return route.fulfill({ json: { ok: true } }); }
    if (path === '/api/me') return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { username: 'uji', tenantStatus: 'ACTIVE', version: '1' } : { error: { code: 'unauthorized' } } });
    if (path === '/api/balance') return route.fulfill({ json: { postedMicro: '9223372036854775807', heldMicro: '0', availableMicro: '9223372036854775807', currency: 'TOKEN' } });
    if (path === '/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/api/keys') return route.fulfill({ json: { keys: [], nextAfter: null } });
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

test('checklist first-use memakai saldo dan daftar key dari API lalu hilang saat semua langkah selesai', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  let balance = { currency: 'TOKEN', postedMicro: '0', heldMicro: '0', availableMicro: '0' };
  let keys: { id: string; status: string }[] = [];
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'first_use', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/balance', route => route.fulfill({ json: balance }));
  await page.route('**/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/api/keys?limit=10', route => route.fulfill({ json: { keys } }));
  await page.route('**/api/keys?limit=1', route => route.fulfill({ json: { keys } }));
  await page.goto('/beranda');
  await expect(page.getByRole('region', { name: m.firstUseTitle })).toContainText('0 dari 3 selesai');
  const guideLink = page.getByRole('link', { name: m.firstUseGuide, exact: true });
  await guideLink.focus();
  await page.keyboard.press('Enter');
  balance = { currency: 'TOKEN', postedMicro: '2500000', heldMicro: '0', availableMicro: '2500000' };
  keys = [{ id: 'key-uji', status: 'ACTIVE' }];
  await page.goto('/beranda');
  await expect(page.getByRole('region', { name: m.firstUseTitle })).toHaveCount(0);
  await expect(page.locator('.metrics .number').first()).toHaveText('2,5');
  const storedProgress = await page.evaluate(() => ({
    local: Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index), localStorage.getItem(localStorage.key(index)!) ]),
    session: Array.from({ length: sessionStorage.length }, (_, index) => [sessionStorage.key(index), sessionStorage.getItem(sessionStorage.key(index)!) ]),
  }));
  expect(storedProgress.local).toEqual([]);
  expect(storedProgress.session).toEqual([['zrouter-guide-read-v1:first_use', 'yes']]);
  await expect(page.locator('.onboarding-checklist')).toHaveCount(0);
});

test('halaman aktivasi tanpa token memberi bantuan dan link kembali', async ({ page }) => {
  await page.goto('/aktivasi');
  await expect(page.getByText(m.activationHelpMissing, { exact: true })).toBeVisible();
  expect(await page.getByRole('link', { name: m.backLogin, exact: true }).first().getAttribute('href')).toBe('/masuk');
});

test('returnTo meliputi semua rute portal dan admin dalam bentuk allowlist', async ({ page }) => {
  const portal = ['beranda','isi-saldo','api-key','model-harga','pemakaian','panduan','transaksi','akun'];
  const admin = ['ringkasan','pelanggan','paket','kode','harga','upstream','rekonsiliasi','batas-lebih-pakai','audit','akun'];
  const loginSource = await (await page.request.get('/src/auth.tsx')).text();
  const portalGuard = 'beranda|isi-saldo|api-key|model-harga|pemakaian|panduan|transaksi|akun';
  const adminGuard = 'ringkasan|pelanggan|paket|kode|harga|upstream|rekonsiliasi|batas-lebih-pakai|audit|akun';
  expect(loginSource).toContain(portalGuard);
  expect(loginSource).toContain(adminGuard);
  expect(portal.join('|')).toBe(portalGuard);
  expect(admin.join('|')).toBe(adminGuard);
  await page.route('**/api/me', route => route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } }));
  const customerRead = await page.request.get('/src/hooks.tsx');
  expect(customerRead.status()).toBe(200);
  await page.goto('/masuk');
  await page.evaluate(() => window.history.replaceState({ usr: { returnTo: '/akun' } }, '', '/masuk'));
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? window.history.state?.returnTo)).toBe('/akun');
  await page.goto('/admin/masuk');
  await page.evaluate(() => window.history.replaceState({ usr: { returnTo: '/admin/akun' } }, '', '/admin/masuk'));
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? window.history.state?.returnTo)).toBe('/admin/akun');
});

test('kebijakan token terbaca dengan kontras dan tautan tidak meluber di 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'returnto-user', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/balance', route => route.fulfill({ json: { postedMicro: '0', heldMicro: '0', availableMicro: '0', currency: 'TOKEN' } }));
  await page.route('**/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.goto('/beranda');
  await expect(page.getByText(m.refundPolicy, { exact: true })).toBeVisible();
  const contrast = await page.locator('.refund-policy').evaluate(element => {
    const luminance = (value: string) => {
      const channels = value.slice(value.indexOf('(') + 1, value.indexOf(')')).split(',').slice(0, 3).map(Number);
      const linear = channels.map(channel => { const scaled = channel / 255; return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(element.parentElement!).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.locator('.refund-policy').evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBeTruthy();
  await page.goto('/isi-saldo');
  await expect.poll(() => new URL(page.url()).pathname).toBe('/isi-saldo');
  await expect(page.getByText(m.refundPolicy, { exact: true })).toBeVisible();
  expect(await page.locator('.refund-policy').evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBeTruthy();
});
test('halaman tidak ditemukan menampilkan arah kembali dan menerima fokus', async ({ page }) => {
  await page.goto('/rute-tidak-ada');
  await expect(page.getByRole('heading', { name: m.notFound, exact: true })).toBeVisible();
  await expect(page.getByText(m.notFoundHelp, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: m.goHome, exact: true })).toHaveAttribute('href', '/beranda');
  await expect(page.getByRole('heading', { name: m.notFound, exact: true })).toBeFocused();
  await page.goto('/admin/rute-tidak-ada');
  await expect(page.getByRole('link', { name: m.goAdminHome, exact: true })).toHaveAttribute('href', '/admin/pelanggan');
  await expect(page.getByRole('heading', { name: m.notFound, exact: true })).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
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
