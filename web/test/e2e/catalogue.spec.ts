import { test, expect } from '@playwright/test';

const equalRates = { input: '2', output: '2', cacheRead: '2', cacheWrite: '2' };
const variedRates = { input: '1', output: '2.5', cacheRead: '0.5', cacheWrite: '3' };
const models = [
  { id: 'uji/equal', displayName: 'Model setara', multiplier: '2', protocols: ['CHAT'], creditsPerToken: equalRates },
  { id: 'uji/varied', displayName: 'Model beragam', multiplier: '1', protocols: ['ANTHROPIC', 'RESPONSES'], creditsPerToken: variedRates },
];
test('katalog pelanggan menampilkan multiplier ringkas atau tarif tiap kategori dari string desimal', async ({ page }) => {
  let payload = { models };
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'katalog_uji', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/balance', route => route.fulfill({ json: { postedMicro: '0', heldMicro: '0', availableMicro: '0', currency: 'TOKEN' } }));
  await page.route('**/api/keys?limit=1', route => route.fulfill({ json: { keys: [] } }));
  await page.route('**/api/models', route => route.fulfill({ json: payload }));
  await page.goto('/model-harga');
  await expect(page.getByRole('heading', { name: 'Model dan Harga', exact: true })).toBeVisible();
  await expect(page.getByText('Daftar model tersedia dan biaya kredit untuk setiap token.', { exact: true })).toBeVisible();
  await expect(page.getByText('Biaya kredit per jenis pemakaian token', { exact: true })).toBeVisible();
  await expect(page.getByText('x2', { exact: true })).toBeVisible();
  const varied = page.locator('.data-row').filter({ hasText: 'uji/varied' });
  await expect(varied).toContainText('1 kredit token');
  await expect(varied).toContainText('2,5 kredit token');
  await expect(varied).toContainText('0,5 kredit token');
  await expect(varied).toContainText('3 kredit token');
  await expect(page.getByText('CHAT', { exact: true })).toBeVisible();
  await expect(page.getByText('ANTHROPIC', { exact: true })).toBeVisible();
  await expect(page.getByText('RESPONSES', { exact: true })).toBeVisible();
  const modelId = page.locator('.data-row').filter({ hasText: 'uji/varied' }).locator('.mono');
  const typography = await page.evaluate(({ protocol, numeric }) => ({
    protocolFamily: getComputedStyle(document.querySelector(protocol)!).fontFamily,
    numericFamily: getComputedStyle(document.querySelector(numeric)!).fontFamily,
    numericVariant: getComputedStyle(document.querySelector(numeric)!).fontVariantNumeric,
  }), { protocol: '.protocol-value', numeric: '.usage-detail .number' });
  const identifierFamily = await modelId.evaluate(element => getComputedStyle(element).fontFamily);
  expect(typography.protocolFamily).toContain('system-ui');
  expect(identifierFamily).toContain('monospace');
  expect(typography.numericFamily).toContain('system-ui');
  expect(typography.numericVariant).toContain('tabular-nums');
  await expect(modelId).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  payload = { models: [] };
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Belum ada model dijual.' })).toBeVisible();
});
