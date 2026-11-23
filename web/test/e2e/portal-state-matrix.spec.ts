import { test, expect } from '@playwright/test';
import { m, errorText } from '../../src/messages.ts';
import type { Page } from '@playwright/test';

async function portal(page: Page) {
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'state_customer', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/balance', route => route.fulfill({ json: { currency: 'TOKEN', postedMicro: '0', heldMicro: '0', availableMicro: '0' } }));
  await page.route('**/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/api/keys?*', route => route.fulfill({ json: { keys: [], nextAfter: null } }));
}

async function submitLogin(page: Page) {
  await page.getByLabel(m.identifier).fill('state_customer');
  await page.getByLabel(m.password, { exact: true }).fill('login-password-fixture');
  await page.getByRole('button', { name: m.login, exact: true }).focus();
  await page.keyboard.press('Enter');
}

async function expectReflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('masuk menampilkan submitting sampai respons diterima', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/login', async route => {
    await gate;
    await route.fulfill({ status: 401, json: { error: { code: 'auth_invalid' } } });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/masuk');
  await submitLogin(page);
  try {
    await expect(page.getByRole('status')).toHaveText(m.saving);
    await expect(page.getByRole('button', { name: m.login, exact: true })).toHaveAttribute('aria-busy', 'true');
    await expectReflow(page);
  } finally { release(); }
  await expect(page.getByRole('alert')).toHaveText(errorText.auth_invalid);
});

test('masuk dibatasi menampilkan waktu tunggu dari Retry-After', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.fulfill({ status: 429, headers: { 'retry-after': '120' }, json: { error: { code: 'rate_limited' } } }));
  await page.goto('/masuk');
  await submitLogin(page);
  await expect(page.getByRole('alert')).toHaveText(m.limitedSeconds('120'));
  await expect(page.getByRole('button', { name: m.login, exact: true })).not.toHaveAttribute('aria-busy', 'true');
});

test('masuk menampilkan server-error tanpa mengaku berhasil', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } }));
  await page.goto('/masuk');
  await submitLogin(page);
  await expect(page.getByRole('alert')).toHaveText(errorText.internal_error);
  await expect(page).toHaveURL(/\/masuk$/);
});

test('aktivasi username sudah dipakai menampilkan arahan memilih nama lain', async ({ page }) => {
  await page.route('**/api/auth/activate', route => route.fulfill({ status: 409, json: { error: { code: 'username_taken' } } }));
  await page.goto('/aktivasi#token=activation-state-fixture');
  await page.getByLabel(m.username, { exact: true }).fill('state_customer');
  await page.getByLabel(m.newPassword, { exact: true }).fill('activation-password-fixture');
  await page.getByRole('button', { name: m.activate, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(errorText.username_taken);
  await expect(page.getByLabel(m.username, { exact: true })).toHaveValue('state_customer');
  await expect(page.getByText(m.activated, { exact: true })).toHaveCount(0);
});

test('pemulihan terkirim memakai pesan sama untuk email terdaftar dan tidak dikenal', async ({ page }) => {
  const emails: string[] = [];
  await page.route('**/api/auth/reset/request', route => {
    emails.push(route.request().postDataJSON().email);
    return route.fulfill({ json: { ok: true } });
  });
  for (const email of ['registered@example.test', 'unknown@example.test']) {
    await page.goto('/lupa-password');
    await page.getByLabel(m.email, { exact: true }).fill(email);
    await page.getByRole('button', { name: m.requestReset, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(m.resetSent);
    await expect(page.getByRole('link', { name: m.backLogin })).toBeVisible();
  }
  expect(emails).toEqual(['registered@example.test', 'unknown@example.test']);
});

test('pemulihan token tidak valid memberi arahan tanpa form sukses', async ({ page }) => {
  await page.goto('/atur-ulang');
  await expect(page.getByRole('alert')).toHaveText(m.tokenMissing);
  await expect(page.getByRole('button', { name: m.reset, exact: true })).toHaveCount(0);
  await page.route('**/api/auth/reset/complete', route => route.fulfill({ status: 400, json: { error: { code: 'reset_invalid' } } }));
  await page.goto('/lupa-password');
  await page.goto('/atur-ulang#token=expired-reset-fixture');
  await page.getByLabel(m.newPassword, { exact: true }).fill('reset-password-fixture');
  await page.getByRole('button', { name: m.reset, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(errorText.reset_invalid);
  await expect(page.getByText(m.resetDone, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: m.backLogin })).toBeVisible();
});

test('beranda loading tidak menampilkan saldo nol sebelum data diterima', async ({ page }) => {
  await portal(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/balance', async route => {
    await gate;
    await route.fulfill({ json: { currency: 'TOKEN', postedMicro: '0', heldMicro: '0', availableMicro: '0' } });
  });
  await page.goto('/beranda');
  try {
    await expect(page.locator('#main > [role="status"][aria-busy="true"]')).toHaveText(m.loading);
    await expect(page.getByRole('heading', { name: m.available, exact: true })).toHaveCount(0);
    await expect(page.getByText(m.zeroBalance, { exact: false })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('heading', { name: m.available, exact: true })).toBeVisible();
});

test('beranda saldo nol mengajak isi saldo dengan tautan keyboard', async ({ page }) => {
  await portal(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/beranda');
  const notice = page.getByRole('status').filter({ hasText: m.zeroBalance });
  await expect(notice).toContainText(m.zeroBalance);
  const link = notice.getByRole('link', { name: m.redeem, exact: true });
  await expect(link).toHaveAttribute('href', '/isi-saldo');
  await expectReflow(page);
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/isi-saldo$/);
});

test('API key empty menampilkan belum ada key tanpa tombol cabut', async ({ page }) => {
  await portal(page);
  await page.goto('/api-key');
  await expect(page.getByRole('heading', { name: m.keyEmpty, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: m.createKey, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: m.revoke, exact: true })).toHaveCount(0);
});

test('panduan tanpa key menampilkan ajakan dan tautan membuat key', async ({ page }) => {
  await portal(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/panduan');
  await expect(page.getByRole('status').filter({ hasText: m.guideNoKey })).toContainText(m.guideNoKey);
  const link = page.locator('#main').getByRole('link', { name: m.keys, exact: true });
  await expect(link).toHaveAttribute('href', '/api-key');
  await expectReflow(page);
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/api-key$/);
});

test('aktivasi mengumumkan submitting sampai server menjawab', async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route('**/api/auth/activate', async route => {
    await responseGate;
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/aktivasi#token=activation-state-fixture');
  await page.getByLabel(m.username, { exact: true }).fill('state_customer');
  await page.getByLabel(m.newPassword, { exact: true }).fill('activation-password-fixture');
  await page.getByRole('button', { name: m.activate, exact: true }).focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('status')).toHaveText(m.saving);
    await expect(page.getByRole('button', { name: m.activate, exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText(m.activated, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    releaseResponse();
  }
  await expect(page.getByRole('status')).toHaveText(m.activated);
  await expect(page.getByText(m.saving, { exact: true })).toHaveCount(0);
});

test('pemulihan akses mengumumkan submitting pada permintaan dan penyelesaian reset', async ({ page }) => {
  const releases: (() => void)[] = [];
  for (const path of ['request', 'complete']) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    releases.push(release);
    await page.route(`**/api/auth/reset/${path}`, async route => {
      await gate;
      await route.fulfill({ json: { ok: true } });
    });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/lupa-password');
  await page.getByLabel(m.email, { exact: true }).fill('reset-state@example.test');
  await page.getByRole('button', { name: m.requestReset, exact: true }).focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('status')).toHaveText(m.saving);
    await expect(page.getByRole('button', { name: m.requestReset, exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText(m.resetSent, { exact: true })).toHaveCount(0);
  } finally {
    releases[0]();
  }
  await expect(page.getByRole('status')).toHaveText(m.resetSent);
  await page.goto('/atur-ulang#token=reset-state-fixture');
  await page.getByLabel(m.newPassword, { exact: true }).fill('reset-password-fixture');
  await page.getByRole('button', { name: m.reset, exact: true }).focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('status')).toHaveText(m.saving);
    await expect(page.getByRole('button', { name: m.reset, exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText(m.resetDone, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    releases[1]();
  }
  await expect(page.getByRole('status')).toHaveText(m.resetDone);
  await expect(page.getByText(m.saving, { exact: true })).toHaveCount(0);
});
