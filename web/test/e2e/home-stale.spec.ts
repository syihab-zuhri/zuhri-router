import { test, expect } from '@playwright/test';
import { m } from '../../src/messages.ts';

const staleNotice = 'Saldo belum berhasil diperbarui. Data mungkin usang; saldo terakhir tetap ditampilkan.';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'balance_customer', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/api/keys?*', route => route.fulfill({ json: { keys: [], nextAfter: null } }));
});

test('saldo gagal diperbarui mempertahankan nilai dan waktu terakhir lalu pulih lewat keyboard', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-23T09:00:00Z') });
  let mode: 'fresh' | 'failed' | 'recovered' = 'fresh';
  let calls = 0;
  await page.route('**/api/balance', route => {
    calls++;
    if (mode === 'failed') return route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } });
    return route.fulfill({ json: { currency: 'TOKEN', postedMicro: mode === 'fresh' ? '12500001' : '13750002', heldMicro: '2500000', availableMicro: mode === 'fresh' ? '10000001' : '11250002' } });
  });
  await page.goto('/beranda');
  const available = page.locator('.metric').filter({ has: page.getByRole('heading', { name: m.available, exact: true }) });
  await expect(available).toContainText('10,000001');
  const updated = page.locator('#main').getByText(`${m.updated}:`, { exact: false });
  const lastUpdated = await updated.innerText();
  expect(lastUpdated).toContain('WIB');
  const metrics = await page.locator('.metrics').elementHandle();
  const before = calls;
  mode = 'failed';
  await page.clock.fastForward('02:00');
  const refresh = page.locator('#main').getByRole('button', { name: m.refresh, exact: true });
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => calls).toBeGreaterThan(before);
  await expect(page.getByRole('status').filter({ hasText: staleNotice })).toBeVisible();
  await expect(available).toContainText('10,000001');
  await expect(updated).toHaveText(lastUpdated);
  expect(await metrics!.evaluate(node => node === document.querySelector('.metrics'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mode = 'recovered';
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect(available).toContainText('11,250002');
  await expect(page.getByText(staleNotice, { exact: true })).toHaveCount(0);
  await expect(updated).not.toHaveText(lastUpdated);
});

test('saldo gagal pertama kali tetap memakai layar galat tanpa angka rekaan', async ({ page }) => {
  await page.route('**/api/balance', route => route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } }));
  await page.goto('/beranda');
  await expect(page.locator('#main').getByRole('alert')).toBeVisible();
  await expect(page.locator('#main').getByRole('button', { name: m.retry })).toBeVisible();
  await expect(page.locator('.metrics')).toHaveCount(0);
  await expect(page.getByText(staleNotice, { exact: true })).toHaveCount(0);
  await expect(page.locator('#main').getByText(`${m.updated}:`, { exact: false })).toHaveCount(0);
});
