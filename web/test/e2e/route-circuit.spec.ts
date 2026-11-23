import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { m } from '../../src/messages.ts';
import { formatDate } from '../../src/credits.ts';

const openLabel = 'Circuit terbuka. Route dilewati sementara.';
const retryLabel = 'Dicoba lagi mulai';
const memoryNote = 'Status circuit disimpan di memori server dan hilang saat server dimulai ulang.';
const warning = 'Kegagalan berturut-turut: 2. Circuit belum terbuka.';
const routeBase = { upstreamId: 'upstream-fixture', protocol: 'CHAT', upstreamModel: 'provider/model', priority: 100, enabled: true, maxConcurrency: null, version: '1' };

test('circuit terbuka menjelaskan kegagalan dan upstream auth beserta waktu coba lagi', async ({ page }) => {
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/admin/api/models', route => route.fulfill({ json: { models: [] } }));
  await page.route('**/admin/api/upstreams', route => route.fulfill({ json: { upstreams: [] } }));
  const failuresUntil = '2026-11-23T10:00:30.000Z';
  const authUntil = '2026-11-23T10:05:00.000Z';
  await page.route('**/admin/api/routes', route => route.fulfill({ json: { routes: [
    { ...routeBase, id: 'failure-route', modelId: 'model/failures', circuit: { open: true, reason: 'failures', openUntil: failuresUntil, failures: 3 } },
    { ...routeBase, id: 'auth-route', modelId: 'model/auth', circuit: { open: true, reason: 'upstream_auth', openUntil: authUntil, failures: 1 } },
    { ...routeBase, id: 'healthy-route', modelId: 'model/healthy', circuit: { open: false, reason: null, openUntil: null, failures: 0 } },
  ] } }));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/admin/upstream');
  const failures = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'model/failures', exact: true }) });
  const auth = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'model/auth', exact: true }) });
  await expect(failures.getByRole('status')).toContainText(openLabel);
  await expect(failures.getByRole('status')).toContainText('Kegagalan berturut-turut pada upstream.');
  await expect(failures.getByRole('status')).toContainText(`${retryLabel}: ${formatDate(failuresUntil)}`);
  await expect(failures.locator('time')).toHaveAttribute('datetime', failuresUntil);
  await expect(auth.getByRole('status')).toContainText(openLabel);
  await expect(auth.getByRole('status')).toContainText('Upstream menolak autentikasi atau pembayaran (HTTP 401/402).');
  await expect(auth.getByRole('status')).toContainText(`${retryLabel}: ${formatDate(authUntil)}`);
  await expect(auth.locator('time')).toHaveAttribute('datetime', authUntil);
  await expect(page.getByText(memoryNote, { exact: true })).toBeVisible();
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'model/healthy', exact: true }) }).getByRole('status')).toHaveCount(0);
  await failures.getByRole('button', { name: m.edit, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: m.editRoute })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(failures.getByRole('button', { name: m.edit, exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('circuit tertutup dengan kegagalan memberi peringatan lalu hilang sesudah pembacaan baru', async ({ page }) => {
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/admin/api/models', route => route.fulfill({ json: { models: [] } }));
  await page.route('**/admin/api/upstreams', route => route.fulfill({ json: { upstreams: [] } }));
  let failures = 2;
  await page.route('**/admin/api/routes', route => route.fulfill({ json: { routes: [{ ...routeBase, id: 'warning-route', modelId: 'model/warning', circuit: { open: false, openUntil: null, reason: null, failures } }] } }));
  await page.goto('/admin/upstream');
  await expect(page.getByRole('status').filter({ hasText: warning })).toBeVisible();
  await expect(page.getByText(openLabel, { exact: true })).toHaveCount(0);
  await expect(page.locator('time')).toHaveCount(0);
  failures = 0;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'model/warning', exact: true })).toBeVisible();
  await expect(page.getByText(warning, { exact: true })).toHaveCount(0);
});
