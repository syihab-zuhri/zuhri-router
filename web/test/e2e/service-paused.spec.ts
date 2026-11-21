import { test, expect } from '@playwright/test';

const pausedMessage = 'Layanan sedang dijeda sementara. Request baru ditolak; saldo Anda tidak berubah.';
const portalRoutes = ['/isi-saldo', '/api-key', '/model-harga', '/pemakaian', '/panduan', '/transaksi', '/akun'];

test('status layanan dimuat ulang saat rute berubah dan tab kembali terlihat, tanpa kehilangan data saat gagal', async ({ page }) => {
  let meCalls = 0;
  let servicePaused = true;
  let failNextMe = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      meCalls += 1;
      if (failNextMe) {
        failNextMe = false;
        return route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } });
      }
      return route.fulfill({ json: { username: 'pause_test', tenantStatus: 'ACTIVE', version: '1', servicePaused } });
    }
    if (path === '/api/balance') return route.fulfill({ json: { currency: 'TOKEN', postedMicro: '0', heldMicro: '0', availableMicro: '0' } });
    if (path === '/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path.startsWith('/api/keys')) return route.fulfill({ json: { keys: [], nextAfter: null } });
    if (path === '/api/models') return route.fulfill({ json: { models: [] } });
    if (path === '/api/requests') return route.fulfill({ json: { requests: [], nextBefore: null } });
    if (path === '/api/account/sessions') return route.fulfill({ json: { current: 'current', sessions: [] } });
    if (path === '/api/ledger') return route.fulfill({ json: { entries: [], nextBefore: null } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/beranda');
  const banner = page.getByRole('status').filter({ hasText: pausedMessage });
  await expect(banner).toBeVisible();
  const originalBanner = await banner.elementHandle();
  await page.getByRole('navigation', { name: 'Portal pelanggan' }).getByRole('link', { name: 'Isi saldo' }).click();
  await expect(page).toHaveURL(/\/isi-saldo$/);
  await expect.poll(() => meCalls).toBeGreaterThan(1);
  await expect(banner).toBeVisible();
  expect(await originalBanner?.evaluate(node => node.isConnected)).toBe(true);

  const callsBeforeVisibility = meCalls;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => meCalls).toBeGreaterThan(callsBeforeVisibility);
  await expect(banner).toBeVisible();
  expect(await originalBanner?.evaluate(node => node.isConnected)).toBe(true);

  failNextMe = true;
  const callsBeforeFailure = meCalls;
  await page.getByRole('navigation', { name: 'Portal pelanggan' }).getByRole('link', { name: 'Model dan harga' }).click();
  await expect.poll(() => meCalls).toBeGreaterThan(callsBeforeFailure);
  await expect(page.getByRole('heading', { name: 'Model dan harga' })).toBeVisible();
  await expect(banner).toBeVisible();
  expect(await originalBanner?.evaluate(node => node.isConnected)).toBe(true);

  servicePaused = false;
  const callsBeforeRouteChange = meCalls;
  await page.getByRole('navigation', { name: 'Portal pelanggan' }).getByRole('link', { name: 'Beranda' }).click();
  await expect.poll(() => meCalls).toBeGreaterThan(callsBeforeRouteChange);
  await expect(page.getByRole('region', { name: 'Status layanan' })).toContainText('Berjalan');
  await expect(banner).toHaveCount(0);
});

test('banner layanan dijeda tampil di semua halaman portal dan tidak diulang saat navigasi', async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') return route.fulfill({ json: { username: 'pause_test', tenantStatus: 'ACTIVE', version: '1', servicePaused: true } });
    if (path === '/api/balance') return route.fulfill({ json: { currency: 'TOKEN', postedMicro: '2500000', heldMicro: '0', availableMicro: '2500000' } });
    if (path === '/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path.startsWith('/api/keys')) return route.fulfill({ json: { keys: [], nextAfter: null } });
    if (path === '/api/models') return route.fulfill({ json: { models: [] } });
    if (path === '/api/requests') return route.fulfill({ json: { requests: [], nextBefore: null } });
    if (path === '/api/account/sessions') return route.fulfill({ json: { current: 'current', sessions: [] } });
    if (path === '/api/ledger') return route.fulfill({ json: { entries: [], nextBefore: null } });
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/beranda');
  const banner = page.getByRole('status').filter({ hasText: pausedMessage });
  await expect(banner).toBeVisible();
  const originalBanner = await banner.elementHandle();
  await page.getByRole('navigation', { name: 'Portal pelanggan' }).getByRole('link', { name: 'Isi saldo' }).click();
  await expect(page).toHaveURL(/\/isi-saldo$/);
  await expect(banner).toBeVisible();
  expect(await originalBanner?.evaluate(node => node.isConnected)).toBe(true);

  for (const route of portalRoutes) {
    await page.goto(route);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveCount(1);
  }

  await page.goto('/beranda');
  await expect(page.getByRole('region', { name: 'Status layanan' })).toContainText('Dijeda');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('status layanan menunjukkan Berjalan tanpa banner bila servicePaused false atau tidak ada', async ({ page }) => {
  let servicePaused: boolean | undefined = false;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') return route.fulfill({ json: { username: 'running_test', tenantStatus: 'ACTIVE', version: '1', ...(servicePaused === undefined ? {} : { servicePaused }) } });
    if (path === '/api/balance') return route.fulfill({ json: { currency: 'TOKEN', postedMicro: '0', heldMicro: '0', availableMicro: '0' } });
    if (path === '/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path.startsWith('/api/keys')) return route.fulfill({ json: { keys: [], nextAfter: null } });
    if (path === '/api/models') return route.fulfill({ json: { models: [] } });
    if (path === '/api/requests') return route.fulfill({ json: { requests: [], nextBefore: null } });
    if (path === '/api/account/sessions') return route.fulfill({ json: { current: 'current', sessions: [] } });
    if (path === '/api/ledger') return route.fulfill({ json: { entries: [], nextBefore: null } });
    return route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 360, height: 800 });
  for (const value of [false, undefined]) {
    servicePaused = value;
    await page.goto('/beranda');
    await expect(page.getByRole('region', { name: 'Status layanan' })).toContainText('Berjalan');
    await expect(page.getByRole('status').filter({ hasText: pausedMessage })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});
