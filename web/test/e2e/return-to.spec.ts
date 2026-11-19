import { test, expect, type Page } from '@playwright/test';
import { m } from '../../src/messages.ts';

const portalRoutes = [
  '/beranda',
  '/isi-saldo',
  '/api-key',
  '/model-harga',
  '/pemakaian',
  '/panduan',
  '/transaksi',
  '/akun',
];

const adminRoutes = [
  '/admin/ringkasan',
  '/admin/pelanggan',
  '/admin/paket',
  '/admin/kode',
  '/admin/harga',
  '/admin/upstream',
  '/admin/rekonsiliasi',
  '/admin/batas-lebih-pakai',
  '/admin/audit',
  '/admin/akun',
];

async function mockPortalApi(page: Page, isSignedIn: () => boolean, onLogin: () => void) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/auth/login') {
      onLogin();
      return route.fulfill({ json: { ok: true } });
    }
    if (!isSignedIn()) {
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    }
    if (path === '/api/me') return route.fulfill({ json: { username: 'uji_return', tenantStatus: 'ACTIVE', version: '1' } });
    if (path === '/api/balance') return route.fulfill({ json: { currency: 'TOKEN', postedMicro: '5000000', heldMicro: '0', availableMicro: '5000000' } });
    if (path === '/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/api/keys') return route.fulfill({ json: { keys: [], nextAfter: null } });
    if (path === '/api/models') return route.fulfill({ json: { models: [] } });
    if (path === '/api/requests') {
      return route.fulfill({
        json: {
          requests: [{
            id: 'req-1', model: 'uji/model', protocol: 'CHAT', stream: false, state: 'SETTLED',
            final: true, heldMicro: '1000', debitMicro: '1000', estimated: false,
            usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, createdAt: '2026-11-15T10:00:00.000Z',
          }],
          nextBefore: '2026-11-15T00:00:00.000Z',
        },
      });
    }
    if (path === '/api/ledger') {
      return route.fulfill({
        json: {
          entries: [{ id: '121', kind: 'GRANT_REDEEM', amount: '5000000', createdAt: '2026-11-15T10:00:00.000Z' }],
          nextBefore: '120',
        },
      });
    }
    if (path === '/api/account/sessions') {
      return route.fulfill({
        json: {
          current: 'ses-1',
          sessions: [{ id: 'ses-1', createdAt: '2026-11-15T10:00:00.000Z', lastSeenAt: '2026-11-15T10:05:00.000Z' }],
        },
      });
    }
    return route.fulfill({ json: {} });
  });
}

async function mockAdminApi(page: Page, isSignedIn: () => boolean, onSecondFactor: () => void) {
  await page.route('**/admin/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/admin/api/login') {
      return route.fulfill({ json: { ok: true, secondFactorRequired: true } });
    }
    if (path === '/admin/api/second-factor') {
      onSecondFactor();
      return route.fulfill({ json: { ok: true } });
    }
    if (!isSignedIn()) {
      return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
    }
    if (path === '/admin/api/packs' && route.request().method() === 'POST') {
      return route.fulfill({ status: 201, json: { id: 'p-1', name: 'Paket Uji', tokens: '100', displayPriceIdr: '1000', isPromo: false, active: true, version: '1' } });
    }
    if (path === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/admin/api/customers') return route.fulfill({ json: { customers: [], nextAfter: null } });
    if (path === '/admin/api/vouchers') return route.fulfill({ json: { vouchers: [], nextBefore: null, outstandingMicro: '0' } });
    if (path === '/admin/api/models') return route.fulfill({ json: { models: [] } });
    if (path === '/admin/api/upstreams') return route.fulfill({ json: { upstreams: [] } });
    if (path === '/admin/api/routes') return route.fulfill({ json: { routes: [] } });
    if (path === '/admin/api/overview') return route.fulfill({ json: { generatedAt: '2026-11-16T00:00:00.000Z', customers: { ACTIVE: 0, SUSPENDED: 0, CLOSED: 0 }, balances: { postedMicro: '0', heldMicro: '0', positiveMicro: '0', negativeAccounts: 0, negativeMicro: '0' }, activeVouchers: { count: 0, amountMicro: '0' }, requests24h: { total: 0, failed: 0, estimated: 0, debitMicro: '0' }, unresolved: { count: 0, heldMicro: '0' }, upstreams: { PENDING: 0, ELIGIBLE: 0, BLOCKED: 0 } } });
    if (path === '/admin/api/requests/unresolved') return route.fulfill({ json: { requests: [] } });
    if (path === '/admin/api/requests') return route.fulfill({ json: { requests: [], nextBefore: null } });
    if (path === '/admin/api/settings/overdraft') return route.fulfill({ json: { overdraftMicro: '0' } });
    if (path === '/admin/api/audit') {
      return route.fulfill({
        json: {
          events: [{ id: '50', actorUser: 'admin_return', actorUsername: 'admin_return', actorKind: 'ADMIN', action: 'pack.create', targetType: 'pack', targetId: 'p-1', summary: {}, createdAt: '2026-11-15T10:00:00.000Z' }],
          nextBefore: '50',
        },
      });
    }
    return route.fulfill({ json: {} });
  });
}

async function waitSettled(page: Page) {
  await expect(page.getByText(m.loading)).toHaveCount(0);
}

async function loginCustomer(page: Page) {
  await expect(page).toHaveURL(/\/masuk$/);
  await expect(page.getByText(m.sessionExpired, { exact: true })).toBeVisible();
  await page.getByLabel(m.identifier).fill('uji_return');
  await page.getByLabel(m.password, { exact: true }).fill('customer-password-10');
  await page.getByRole('button', { name: m.login, exact: true }).click();
}

async function loginAdmin(page: Page) {
  await expect(page).toHaveURL(/\/admin\/masuk$/);
  await expect(page.getByText(m.sessionExpired, { exact: true })).toBeVisible();
  await page.getByLabel(m.identifier).fill('admin_return');
  await page.getByLabel(m.password, { exact: true }).fill('admin-password-panjang-14');
  await page.getByRole('button', { name: m.login, exact: true }).click();
  await expect(page.getByLabel(m.code, { exact: true })).toBeVisible();
  await page.getByLabel(m.code, { exact: true }).fill('123456');
  await page.getByRole('button', { name: m.verify, exact: true }).click();
}

test('aksi portal yang mendapat 401 di dalam Shell mengembalikan ke rute asal sesudah masuk kembali', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockPortalApi(page, () => signedIn, () => { signedIn = true; });

  await page.goto('/isi-saldo');
  await expect(page.getByRole('heading', { name: m.redeem, exact: true })).toBeVisible();
  await waitSettled(page);
  await page.getByLabel(m.redeemCode).fill('KODE-UJI-1234');
  signedIn = false;
  await page.getByRole('button', { name: m.redeemAction, exact: true }).click();
  await expect(page).toHaveURL(/\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/isi-saldo');
  await loginCustomer(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/isi-saldo');
  await waitSettled(page);

  await page.locator('aside.desktop-nav nav a[href="/api-key"]').click();
  await expect(page.getByRole('heading', { name: m.keys, exact: true })).toBeVisible();
  await waitSettled(page);
  await page.getByLabel(m.keyName).fill('Key Uji ReturnTo');
  signedIn = false;
  await page.getByRole('button', { name: m.createKey, exact: true }).click();
  await expect(page).toHaveURL(/\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/api-key');
  await loginCustomer(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/api-key');
  await waitSettled(page);

  await page.locator('aside.desktop-nav nav a[href="/akun"]').click();
  await expect(page.getByRole('heading', { name: 'Akun dan Keamanan', exact: true })).toBeVisible();
  await waitSettled(page);
  await page.getByLabel('Password saat ini').fill('customer-password-10');
  await page.getByLabel('Password baru').fill('customer-password-baru-10');
  signedIn = false;
  await page.getByRole('button', { name: 'Ubah password', exact: true }).click();
  await expect(page).toHaveURL(/\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/akun');
  await loginCustomer(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/akun');
});

test('aksi admin yang mendapat 401 di dalam Shell mengembalikan ke rute asal sesudah 2FA ulang', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockAdminApi(page, () => signedIn, () => { signedIn = true; });

  await page.goto('/admin/paket');
  await expect(page.getByRole('heading', { name: m.packs, exact: true })).toBeVisible();
  await waitSettled(page);
  await page.getByRole('button', { name: m.createPack, exact: true }).click();
  const packDialog = page.getByRole('dialog', { name: m.createPack });
  await packDialog.getByLabel(m.packName).fill('Paket ReturnTo');
  await packDialog.getByLabel(m.tokens).fill('100');
  await packDialog.getByLabel(m.priceIdr).fill('1000');
  signedIn = false;
  await packDialog.getByRole('button', { name: m.createPack, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/admin/paket');
  await loginAdmin(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/paket');
  await waitSettled(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/ringkasan$/);
  await expect(page.getByRole('heading', { name: 'Ringkasan Operasi', exact: true })).toBeVisible();

  await page.locator('aside.desktop-nav nav a[href="/admin/akun"]').click();
  await expect(page.getByRole('heading', { name: 'Akun Admin', exact: true })).toBeVisible();
  await waitSettled(page);
  signedIn = false;
  await page.getByRole('button', { name: 'Mulai ganti autentikator', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/admin/akun');
  await loginAdmin(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/akun');
});

test('rute portal tunggal-query di dalam Shell (termasuk query string) memulihkan rute asal saat 401', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockPortalApi(page, () => signedIn, () => { signedIn = true; });

  await page.goto('/isi-saldo');
  await expect(page.getByRole('heading', { name: m.redeem, exact: true })).toBeVisible();
  await waitSettled(page);

  for (const target of ['/api-key', '/pemakaian', '/panduan', '/transaksi']) {
    signedIn = false;
    await page.locator(`aside.desktop-nav nav a[href="${target}"]`).click();
    await expect(page).toHaveURL(/\/masuk$/);
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe(target);
    await loginCustomer(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe(target);
    await waitSettled(page);
  }
});

test('rute portal dengan query string memulihkan path dan query setelah 401', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockPortalApi(page, () => signedIn, () => { signedIn = true; });

  await page.goto('/isi-saldo');
  await expect(page.getByRole('heading', { name: m.redeem, exact: true })).toBeVisible();
  await waitSettled(page);

  await page.locator('aside.desktop-nav nav a[href="/transaksi"]').click();
  await expect(page).toHaveURL(/\/transaksi$/);
  await expect(page.getByRole('heading', { name: m.ledger, exact: true })).toBeVisible();
  await waitSettled(page);
  await expect(page.getByRole('button', { name: m.next, exact: true })).toBeVisible();
  signedIn = false;
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect(page).toHaveURL(/\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/transaksi?before=120');
  await loginCustomer(page);
  await expect.poll(() => { const u = new URL(page.url()); return u.pathname + u.search; }).toBe('/transaksi?before=120');
  await waitSettled(page);

  await page.locator('aside.desktop-nav nav a[href="/pemakaian"]').click();
  await expect(page).toHaveURL(/\/pemakaian$/);
  await expect(page.getByRole('heading', { name: m.requests, exact: true })).toBeVisible();
  await waitSettled(page);
  await expect(page.getByRole('button', { name: m.next, exact: true })).toBeVisible();
  signedIn = false;
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect(page).toHaveURL(/\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/pemakaian?before=2026-11-15T00%3A00%3A00.000Z');
  await loginCustomer(page);
  await expect.poll(() => { const u = new URL(page.url()); return u.pathname + u.search; }).toBe('/pemakaian?before=2026-11-15T00%3A00%3A00.000Z');
});

test('rute admin tunggal-query di dalam Shell (termasuk query string) memulihkan rute asal saat 401', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockAdminApi(page, () => signedIn, () => { signedIn = true; });

  await page.goto('/admin/paket');
  await expect(page.getByRole('heading', { name: m.packs, exact: true })).toBeVisible();
  await waitSettled(page);

  for (const target of ['/admin/pelanggan', '/admin/harga', '/admin/rekonsiliasi', '/admin/batas-lebih-pakai', '/admin/audit']) {
    signedIn = false;
    await page.locator(`aside.desktop-nav nav a[href="${target}"]`).click();
    await expect(page).toHaveURL(/\/admin\/masuk$/);
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe(target);
    await loginAdmin(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe(target);
    await waitSettled(page);
  }
});

test('rute admin dengan query string memulihkan path dan query setelah 401', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockAdminApi(page, () => signedIn, () => { signedIn = true; });

  await page.goto('/admin/paket');
  await expect(page.getByRole('heading', { name: m.packs, exact: true })).toBeVisible();
  await waitSettled(page);

  await page.locator('aside.desktop-nav nav a[href="/admin/pelanggan"]').click();
  await expect(page).toHaveURL(/\/admin\/pelanggan$/);
  await expect(page.getByRole('heading', { name: m.customers, exact: true })).toBeVisible();
  await waitSettled(page);
  await expect(page.getByLabel(m.customerPrefix)).toBeVisible();
  await page.getByLabel(m.customerPrefix).fill('uji');
  signedIn = false;
  await page.getByRole('button', { name: m.search, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/admin/pelanggan?prefix=uji');
  await loginAdmin(page);
  await expect.poll(() => { const u = new URL(page.url()); return u.pathname + u.search; }).toBe('/admin/pelanggan?prefix=uji');
  await waitSettled(page);

  await page.locator('aside.desktop-nav nav a[href="/admin/audit"]').click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(page.getByRole('heading', { name: m.audit, exact: true })).toBeVisible();
  await waitSettled(page);
  await expect(page.getByRole('button', { name: m.next, exact: true })).toBeVisible();
  signedIn = false;
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/admin/audit?before=50');
  await loginAdmin(page);
  await expect.poll(() => { const u = new URL(page.url()); return u.pathname + u.search; }).toBe('/admin/audit?before=50');
});

test('rute multi-query dan shared probe memulihkan returnTo saat 401 di dalam Shell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockPortalApi(page, () => signedIn, () => { signedIn = true; });
  await page.goto('/isi-saldo');
  await expect(page.getByRole('heading', { name: m.redeem, exact: true })).toBeVisible();
  await waitSettled(page);

  for (const target of ['/beranda', '/akun']) {
    signedIn = true;
    if (new URL(page.url()).pathname !== '/isi-saldo') {
      await page.goto('/isi-saldo');
      await expect(page.getByRole('heading', { name: m.redeem, exact: true })).toBeVisible();
      await waitSettled(page);
    }
    signedIn = false;
    await page.locator(`aside.desktop-nav nav a[href="${target}"]`).click();
    await expect(page).toHaveURL(/\/masuk$/);
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe(target);
    await loginCustomer(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe(target);
  }

  await mockAdminApi(page, () => signedIn, () => { signedIn = true; });
  for (const target of ['/admin/kode', '/admin/upstream']) {
    signedIn = true;
    await page.goto('/admin/paket');
    await expect(page.getByRole('heading', { name: m.packs, exact: true })).toBeVisible();
    await waitSettled(page);
    signedIn = false;
    await page.locator(`aside.desktop-nav nav a[href="${target}"]`).click();
    await expect(page).toHaveURL(/\/admin\/masuk$/);
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe(target);
    await loginAdmin(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe(target);
  }

  signedIn = true;
  await page.goto('/admin/paket');
  await expect(page.getByRole('heading', { name: m.packs, exact: true })).toBeVisible();
  await waitSettled(page);
  signedIn = false;
  await page.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/admin/paket');
  await loginAdmin(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/paket');
});

test('/model-harga mengarahkan ke /masuk dengan returnTo saat /api/models menjawab 401 di dalam Shell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let signedIn = true;
  await mockPortalApi(page, () => signedIn, () => { signedIn = true; });
  await page.goto('/isi-saldo');
  await expect(page.getByRole('heading', { name: m.redeem, exact: true })).toBeVisible();
  await waitSettled(page);

  signedIn = false;
  await page.locator('aside.desktop-nav nav a[href="/model-harga"]').click();
  await expect(page).toHaveURL(/\/masuk$/);
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe('/model-harga');
  await loginCustomer(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/model-harga');
});

test('membuka langsung tiap rute portal dan admin saat sesi berakhir memulihkan returnTo rute asal', async ({ page }) => {
  let signedIn = false;
  await mockPortalApi(page, () => signedIn, () => { signedIn = true; });

  for (const targetRoute of portalRoutes) {
    signedIn = false;
    await page.goto(targetRoute);
    await expect(page).toHaveURL(/\/masuk$/);
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe(targetRoute);
    await loginCustomer(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe(targetRoute);
  }

  await mockAdminApi(page, () => signedIn, () => { signedIn = true; });
  for (const targetRoute of adminRoutes) {
    signedIn = false;
    await page.goto(targetRoute);
    await expect(page).toHaveURL(/\/admin\/masuk$/);
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.returnTo ?? null)).toBe(targetRoute);
    await loginAdmin(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe(targetRoute);
  }
});

test('returnTo tidak valid pada login pelanggan mendarat di halaman bawaan /beranda', async ({ browser }) => {
  const invalidCustomerReturnTo = [
    '//evil.example',
    'https://evil.example/beranda',
    '/rute-tidak-dikenal',
    '/admin/pelanggan',
    '/admin/akun',
    '/beranda#fragmen',
    '/transaksi?before=10#fragmen',
  ];

  for (const badReturnTo of invalidCustomerReturnTo) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let signedIn = true;
    await mockPortalApi(page, () => signedIn, () => { signedIn = true; });

    await page.addInitScript(value => {
      if (location.pathname === '/masuk') {
        history.replaceState({ usr: { expired: true, returnTo: value }, idx: 0 }, '', '/masuk');
      }
    }, badReturnTo);

    await page.goto('/masuk');
    await loginCustomer(page);

    await expect.poll(() => {
      const current = new URL(page.url());
      return current.pathname + current.search + current.hash;
    }).toBe('/beranda');
    await context.close();
  }
});

test('login admin tanpa returnTo menuju ringkasan operasi', async ({ page }) => {
  let signedIn = false;
  await mockAdminApi(page, () => signedIn, () => { signedIn = true; });
  await page.goto('/admin/masuk');
  await page.getByLabel(m.identifier).fill('admin_baru');
  await page.getByLabel(m.password, { exact: true }).fill('admin-password-panjang-14');
  await page.getByRole('button', { name: m.login, exact: true }).click();
  await page.getByLabel(m.code, { exact: true }).fill('123456');
  await page.getByRole('button', { name: m.verify, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ringkasan$/);
  await expect(page.getByRole('heading', { name: 'Ringkasan Operasi', exact: true })).toBeVisible();
});

test('returnTo tidak valid pada login admin mendarat di halaman bawaan /admin/ringkasan', async ({ browser }) => {
  const invalidAdminReturnTo = [
    '//evil.example',
    'https://evil.example/admin/pelanggan',
    '/admin/rute-tidak-dikenal',
    '/beranda',
    '/akun',
    '/admin/pelanggan#fragmen',
    '/admin/audit?before=10#fragmen',
  ];

  for (const badReturnTo of invalidAdminReturnTo) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let signedIn = true;
    await mockAdminApi(page, () => signedIn, () => { signedIn = true; });

    await page.addInitScript(value => {
      if (location.pathname === '/admin/masuk') {
        history.replaceState({ usr: { expired: true, returnTo: value }, idx: 0 }, '', '/admin/masuk');
      }
    }, badReturnTo);

    await page.goto('/admin/masuk');
    await loginAdmin(page);

    await expect.poll(() => {
      const current = new URL(page.url());
      return current.pathname + current.search + current.hash;
    }).toBe('/admin/ringkasan');
    await expect(page.getByRole('heading', { name: 'Ringkasan Operasi', exact: true })).toBeVisible();
    await context.close();
  }
});
