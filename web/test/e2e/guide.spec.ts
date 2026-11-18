import { test, expect } from '@playwright/test';
import { m } from '../../src/messages.ts';

test('panduan menampilkan tiga permukaan, base URL, key placeholder dan pemetaan error', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'panduan_uji', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/keys?*', route => route.fulfill({ json: { keys: [] } }));
  await page.goto('/panduan');
  await expect(page).toHaveURL(/\/panduan$/);
  await expect(page.getByRole('heading', { name: 'Panduan Integrasi', exact: true })).toBeVisible();
  await expect(page.getByText(`http://127.0.0.1:${Number(process.env.WEB_PORT ?? 5173)}/v1`, { exact: true })).toBeVisible();
  for (const endpoint of ['POST /v1/chat/completions', 'POST /v1/messages', 'POST /v1/responses', 'GET /v1/models']) await expect(page.getByText(endpoint, { exact: true })).toBeVisible();
  await expect(page.getByText(m.responsesStateless, { exact: true })).toBeVisible();
  await expect(page.getByText(m.responsesStateless, { exact: true })).toContainText('kirim konteks lengkap pada setiap permintaan');
  await expect(page.getByText(m.untestedToolVersions, { exact: false })).toContainText('Hermes, ZCode');
  await expect(page.getByText('YOUR_API_KEY', { exact: false })).toHaveCount(2);
  await expect(page.getByText('x-api-key: YOUR_API_KEY', { exact: true })).toBeVisible();
  await expect(page.getByText(m.guideAuthFormat, { exact: true })).toBeVisible();
  for (const code of ['429 limit_exceeded', '401 key_revoked', '403 service_paused', '413 request_too_large', '400 invalid_request']) await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByText('Codex CLI 0.165.0, diuji 2026-11-14', { exact: true })).toBeVisible();
  await expect(page.getByText('Hermes, ZCode.', { exact: false })).toBeVisible();
  expect(await page.locator('#main').getByRole('link', { name: m.keys, exact: true }).getAttribute('href')).toBe('/api-key');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
