import { test, expect, type Page } from '@playwright/test';
import { errorText, m } from '../../src/messages.ts';

// Ten backoffice states that the UX matrix still listed as "exists without a test".
// Every case runs the real application shell and asserts visible text or a role, not just that a page opened.

const gateway = { paused: false, reason: null, changedAt: null, changedBy: null };
const customerRow = { username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-23T00:00:00.000Z', postedMicro: '5000000', heldMicro: '0' };
const customerDetail = { username: 'pelanggan', tenantStatus: 'ACTIVE', version: '1', currency: 'TOKEN', postedMicro: '5000000', heldMicro: '0', availableMicro: '5000000', entries: [] };
const upstream = { id: '11111111-1111-4111-8111-111111111111', name: 'Hulu uji', status: 'PENDING', archived: false, baseUrls: { CHAT: 'https://chat.example.test/v1', ANTHROPIC: null, RESPONSES: null }, keySet: true, keySetAt: '2026-11-23T00:00:00.000Z', termsNote: '', version: '2' };
const model = { id: 'vendor/model', displayName: 'Model uji', version: '1', sellable: false, published: null, draft: null };

/** Shell baseline: the admin probe, the menu, and every list screen the shell can prefetch. */
async function adminShell(page: Page, overrides: Record<string, (route: import('@playwright/test').Route) => Promise<unknown> | unknown> = {}) {
  await page.route('**/admin/api/**', route => {
    const url = new URL(route.request().url());
    for (const [path, handler] of Object.entries(overrides)) {
      if (url.pathname === path) return handler(route);
    }
    if (url.pathname === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (url.pathname === '/admin/api/customers') return route.fulfill({ json: { customers: [customerRow], nextAfter: null } });
    if (url.pathname === '/admin/api/customers/pelanggan') return route.fulfill({ json: customerDetail });
    if (url.pathname === '/admin/api/requests/unresolved') return route.fulfill({ json: { requests: [] } });
    if (url.pathname === '/admin/api/requests') return route.fulfill({ json: { requests: [], nextBefore: null } });
    if (url.pathname === '/admin/api/upstreams') return route.fulfill({ json: { upstreams: [upstream] } });
    if (url.pathname === '/admin/api/models') return route.fulfill({ json: { models: [model] } });
    if (url.pathname === '/admin/api/routes') return route.fulfill({ json: { routes: [] } });
    if (url.pathname === '/admin/api/settings/gateway') return route.fulfill({ json: gateway });
    if (url.pathname === '/admin/api/second-factor') return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
}

test('daftar pelanggan kosong membedakan belum ada pelanggan dari tanpa hasil filter', async ({ page }) => {
  await adminShell(page, {
    '/admin/api/customers': route => route.fulfill({ json: { customers: [], nextAfter: null } }),
  });
  await page.goto('/admin/pelanggan');
  await expect(page.getByRole('heading', { name: m.customers, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: m.customerListEmpty, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: m.customerNoMatches, exact: true })).toHaveCount(0);
  await expect(page.locator('.customer-list-row')).toHaveCount(0);
});

test('detail pelanggan yang tidak ditemukan menjelaskan username tidak ditemukan dan menyediakan muat ulang', async ({ page }) => {
  await adminShell(page, {
    '/admin/api/customers/pelanggan': route => route.fulfill({ status: 404, json: { error: { code: 'username_not_found' } } }),
  });
  await page.goto('/admin/pelanggan?customer=pelanggan&tab=summary');
  const alert = page.locator('#main').getByRole('alert');
  await expect(alert).toContainText(errorText.username_not_found);
  await expect(alert.getByRole('button', { name: m.retry, exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: m.customerDetailTabs })).toHaveCount(0);
});

test('undangan menampilkan keadaan mengundang sampai server menjawab', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let posts = 0;
  await adminShell(page, {
    '/admin/api/invites': async route => {
      posts += 1;
      await gate;
      return route.fulfill({ json: { inviteId: 'inv-1', emailSent: true, activationLink: null } });
    },
  });
  await page.goto('/admin/pelanggan');
  await page.getByLabel(m.email).fill('baru@example.test');
  await page.getByRole('button', { name: m.inviteCustomer, exact: true }).click();
  await expect(page.locator('#main').getByRole('status').filter({ hasText: m.saving })).toBeVisible();
  await expect(page.getByRole('button', { name: m.inviteCustomer, exact: true })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: m.inviteCreated, exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: m.inviteCreated, exact: true })).toBeVisible();
  expect(posts).toBe(1);
});

test('undangan yang dikirim lewat email menyebut kanal email, bukan tautan manual', async ({ page }) => {
  await adminShell(page, {
    '/admin/api/invites': route => route.fulfill({ json: { inviteId: 'inv-2', emailSent: true, activationLink: null } }),
  });
  await page.goto('/admin/pelanggan');
  await page.getByLabel(m.email).fill('terkirim@example.test');
  await page.getByRole('button', { name: m.inviteCustomer, exact: true }).click();
  const receipt = page.locator('#main').getByRole('status').filter({ hasText: m.inviteCreated });
  await expect(receipt).toContainText(m.inviteSentByEmail);
  await expect(receipt).not.toContainText(m.inviteManualDelivery);
  await expect(page.getByRole('button', { name: m.copyActivationLink, exact: true })).toHaveCount(0);
});

test('tambah saldo yang gagal tanpa jawaban server tidak mengaku berhasil dan menawarkan periksa transaksi', async ({ page }) => {
  await adminShell(page, {
    '/admin/api/topups': route => route.abort('failed'),
  });
  await page.goto('/admin/pelanggan?customer=pelanggan&tab=balance');
  await page.getByLabel(m.tokens, { exact: true }).fill('10');
  await page.getByLabel(m.saleRef).fill('penjualan-gagal');
  await page.getByRole('button', { name: m.topup, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.topupConfirm });
  await dialog.getByRole('button', { name: m.topup, exact: true }).click();
  await expect(dialog).toContainText(m.unknown);
  await expect(page.getByRole('heading', { name: m.topupReceipt, exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('upstream dan route kosong memakai pesan kosong masing-masing', async ({ page }) => {
  await adminShell(page, {
    '/admin/api/upstreams': route => route.fulfill({ json: { upstreams: [] } }),
    '/admin/api/routes': route => route.fulfill({ json: { routes: [] } }),
  });
  await page.goto('/admin/upstream');
  await expect(page.getByRole('heading', { name: m.noUpstreams, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: m.noRoutes, exact: true })).toBeVisible();
  await expect(page.locator('.upstream-row')).toHaveCount(0);
});

test('status upstream layak dan diblokir tampil berlabel, bukan kode mentah', async ({ page }) => {
  const eligible = { ...upstream, id: '22222222-2222-4222-8222-222222222222', name: 'Hulu layak', status: 'ELIGIBLE', version: '3' };
  const blocked = { ...upstream, id: '33333333-3333-4333-8333-333333333333', name: 'Hulu diblokir', status: 'BLOCKED', version: '4' };
  await adminShell(page, {
    '/admin/api/upstreams': route => route.fulfill({ json: { upstreams: [upstream, eligible, blocked] } }),
  });
  await page.goto('/admin/upstream');
  const pendingRow = page.locator('.upstream-row').filter({ hasText: upstream.name });
  const eligibleRow = page.locator('.upstream-row').filter({ hasText: eligible.name });
  const blockedRow = page.locator('.upstream-row').filter({ hasText: blocked.name });
  await expect(pendingRow.locator('.badge')).toHaveText(m.stateText.PENDING);
  await expect(eligibleRow.locator('.badge')).toHaveText(m.stateText.ELIGIBLE);
  await expect(blockedRow.locator('.badge')).toHaveText(m.stateText.BLOCKED);
  await expect(page.locator('#main').getByText('ELIGIBLE', { exact: true })).toHaveCount(0);
  await expect(page.locator('#main').getByText('BLOCKED', { exact: true })).toHaveCount(0);
});

test('perubahan upstream yang bentrok versi menjelaskan data telah berubah tanpa menimpa', async ({ page }) => {
  let calls = 0;
  await adminShell(page, {
    '/admin/api/upstreams/11111111-1111-4111-8111-111111111111': route => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
      return route.fulfill({ status: 409, json: { error: { code: 'version_conflict' } } });
    },
  });
  await page.goto('/admin/upstream');
  await page.locator('.upstream-row').filter({ hasText: upstream.name }).getByRole('button', { name: m.edit, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.editUpstream });
  await dialog.getByLabel('Base URL CHAT').fill('https://chat2.example.test/v1');
  await dialog.locator('input[type="password"]').fill('synthetic-key-for-conflict');
  await dialog.getByLabel(m.reason).fill('Mengubah endpoint setelah konflik.');
  await dialog.getByRole('button', { name: m.save, exact: true }).click();
  const stepUp = page.getByRole('dialog', { name: m.stepUp });
  await stepUp.getByLabel(m.code).fill('123456');
  await stepUp.getByRole('button', { name: m.verify }).click();
  await expect(dialog.getByRole('alert')).toContainText(m.stale);
  await expect(page.locator('.upstream-row').filter({ hasText: 'https://chat2.example.test/v1' })).toHaveCount(0);
});

test('antrean request menunggu keputusan menampilkan keadaan memuat sebelum daftar', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await adminShell(page, {
    '/admin/api/requests/unresolved': async route => { await gate; return route.fulfill({ json: { requests: [] } }); },
  });
  await page.goto('/admin/rekonsiliasi');
  await expect(page.getByRole('heading', { name: m.unresolved, exact: true })).toBeVisible();
  await expect(page.locator('#main').getByRole('status').filter({ hasText: m.loading })).toBeVisible();
  await expect(page.getByRole('heading', { name: m.noUnresolved, exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: m.noUnresolved, exact: true })).toBeVisible();
});

test('penyelesaian request mengumumkan menunggu jawaban server selama POST berjalan', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = { id: 'req_00000000-0000-4000-8000-000000000003', username: 'pelanggan', model: 'uji/model', heldMicro: '3000000', maxOutput: 80, createdAt: '2026-11-23T01:00:00.000Z' };
  let posts = 0;
  await adminShell(page, {
    '/admin/api/requests/unresolved': route => route.fulfill({ json: { requests: [pending] } }),
    '/admin/api/requests/req_00000000-0000-4000-8000-000000000003/resolve': async route => {
      posts += 1;
      await gate;
      return route.fulfill({ json: { id: pending.id, state: 'RESOLVED', debitMicro: '1000000', resolvedAt: '2026-11-23T02:00:00.000Z', replayed: false } });
    },
  });
  await page.goto('/admin/rekonsiliasi');
  await page.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.resolveRequest });
  await dialog.getByLabel(m.debitTokens).fill('1');
  await dialog.getByLabel(m.reason).fill('Sebagian ditagihkan.');
  await dialog.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  await expect(dialog).toContainText(m.saving);
  await expect(dialog.getByRole('button', { name: m.resolveRequest, exact: true })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: m.resolveReceipt, exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: m.resolveReceipt, exact: true })).toBeVisible();
  expect(posts).toBe(1);
});
