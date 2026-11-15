import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function customer(page: import('@playwright/test').Page) {
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'state_user', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/balance', route => route.fulfill({ json: { postedMicro: '0', heldMicro: '0', availableMicro: '0', currency: 'TOKEN' } }));
}
test('redeem pending, kode tidak terpakai dan cooldown punya state sendiri', async ({ page }) => {
  await customer(page);
  let calls = 0;
  await page.route('**/api/redeem', async route => {
    calls++;
    if (calls === 1) { await new Promise(resolve => setTimeout(resolve, 250)); await route.fulfill({ status: 400, json: { error: { code: 'code_unusable' } } }); }
    else await route.fulfill({ status: 429, headers: { 'retry-after': '900' }, json: { error: { code: 'rate_limited' } } });
  });
  await page.goto('/isi-saldo'); await page.getByLabel('Kode redeem', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: 'Tukar kode' }).click(); await expect(page.getByText('Menunggu jawaban server…')).toBeVisible();
  await expect.poll(() => calls).toBe(1); await expect(page.locator('.receipt')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Kode ini tidak dapat dipakai.');
  await page.getByRole('button', { name: 'Tukar kode' }).click(); await expect(page.getByRole('alert')).toContainText('900 detik');
});

test('loading, gagal dan kosong transaksi; reflow 360,768,1280 dan reduced motion', async ({ page }) => {
  await customer(page); let fail = true;
  await page.route('**/api/ledger?*', route => route.fulfill(fail ? { status: 503, json: { error: { code: 'internal_error' } } } : { json: { entries: [], nextBefore: null } }));
  await page.goto('/transaksi'); await expect(page.getByRole('alert')).toBeVisible(); fail = false;
  await page.getByRole('button', { name: 'Coba lagi' }).click(); await expect(page.getByRole('heading', { name: 'Belum ada data.' })).toBeVisible();
  for (const width of [360, 768, 1280]) { await page.setViewportSize({ width, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy(); }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.getByRole('button', { name: 'Keluar' }).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('secret tidak berada di URL/storage, copy gagal tetap tampil, escape meminta kepastian', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } } }); });
  const secret = 'synthetic-only-once-secret';
  await page.route('**/api/**', route => route.fulfill({ json: { ok: true } }));
  await customer(page);
  await page.route('**/api/keys?*', route => route.fulfill({ json: { keys: [], nextAfter: null } }));
  await page.route('**/api/keys', route => route.fulfill({ status: 201, json: { key: { id: 'test-key' }, secret } }));
  await page.goto('/api-key'); await page.getByLabel('Nama key').fill('Uji'); await page.getByRole('button', { name: 'Buat API key', exact: true }).click();
  await expect(page.locator('.secret')).toHaveText(secret); await page.getByRole('button', { name: 'Salin', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tidak dapat menyalin otomatis.' })).toBeVisible();
  expect(page.url()).not.toContain(secret); expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.keyboard.press('Escape'); await expect(page.getByText('Tutup tanpa menyalin? Secret tidak dapat ditampilkan lagi.')).toBeVisible();
  await page.getByRole('button', { name: 'Tutup dan buang secret' }).click(); await expect(page.locator('.secret')).toHaveCount(0);
});

test('401 pembacaan memindah ke masuk tanpa memutar ulang mutasi', async ({ page }) => {
  await customer(page); let requests = 0;
  await page.route('**/api/ledger?*', route => route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } }));
  page.on('request', req => { if (req.method() === 'POST') requests++; });
  await page.goto('/transaksi'); await expect(page).toHaveURL(/\/masuk$/); expect(requests).toBe(0);
});
