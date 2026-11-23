import { test, expect } from '@playwright/test';
import { errorText, m, ov } from '../../src/messages.ts';
import { formatDate } from '../../src/credits.ts';

const staleNotice = 'Ringkasan belum berhasil diperbarui. Data mungkin usang; data terakhir tetap ditampilkan.';

const gateway = { paused: false, reason: null, changedAt: null, changedBy: null };

const firstOverview = {
  generatedAt: '2026-11-23T02:10:00.000Z',
  customers: { ACTIVE: 7, SUSPENDED: 1, CLOSED: 0 },
  balances: { postedMicro: '41000000', heldMicro: '2000000', positiveMicro: '41000000', negativeAccounts: 0, negativeMicro: '0' },
  activeVouchers: { count: 2, amountMicro: '8000000' },
  requests24h: { total: 33, failed: 1, estimated: 2, debitMicro: '3600000' },
  unresolved: { count: 1, heldMicro: '2000000' },
  upstreams: { PENDING: 0, ELIGIBLE: 2, BLOCKED: 0 },
  gateway,
};

const secondOverview = {
  ...firstOverview,
  generatedAt: '2026-11-23T03:25:00.000Z',
  requests24h: { total: 44, failed: 0, estimated: 0, debitMicro: '5100000' },
};

type Mode = 'first' | 'failed' | 'second';

async function mockAdmin(page: import('@playwright/test').Page, read: () => Mode) {
  await page.route('**/admin/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/admin/api/customers') return route.fulfill({ json: { customers: [], nextAfter: null } });
    if (path === '/admin/api/requests/unresolved') return route.fulfill({ json: { requests: [] } });
    if (path === '/admin/api/upstreams') return route.fulfill({ json: { upstreams: [] } });
    if (path === '/admin/api/models') return route.fulfill({ json: { models: [] } });
    if (path === '/admin/api/routes') return route.fulfill({ json: { routes: [] } });
    if (path === '/admin/api/settings/gateway') return route.fulfill({ json: gateway });
    if (path === '/admin/api/overview') {
      const mode = read();
      if (mode === 'failed') return route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } });
      return route.fulfill({ json: mode === 'first' ? firstOverview : secondOverview });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
}

test('pembacaan ulang gagal mempertahankan angka dan waktu terakhir dengan penanda usang', async ({ page }) => {
  let mode: Mode = 'first';
  await mockAdmin(page, () => mode);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/ringkasan');

  const requestsCard = page.locator('section.metric', { hasText: ov.requests24hCard });
  await expect(requestsCard).toContainText('33');
  const stamp = page.locator('#main').getByText(`${ov.generatedAt}:`, { exact: false });
  const lastStamp = await stamp.innerText();
  expect(lastStamp).toContain(formatDate(firstOverview.generatedAt));
  const metrics = await page.locator('.metrics').elementHandle();
  await expect(page.locator('#main').getByText(staleNotice, { exact: true })).toHaveCount(0);

  mode = 'failed';
  const refresh = page.locator('#main').getByRole('button', { name: m.refresh, exact: true });
  await refresh.focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('#main').getByText(staleNotice, { exact: true })).toBeVisible();
  await expect(requestsCard).toContainText('33');
  await expect(requestsCard).not.toContainText('44');
  await expect(stamp).toHaveText(lastStamp);
  expect(await metrics!.evaluate(node => node === document.querySelector('.metrics'))).toBe(true);
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();
  await expect(page.locator('#main').getByRole('alert')).toHaveCount(0);

  mode = 'second';
  await page.locator('#main').getByRole('button', { name: m.refresh, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(requestsCard).toContainText('44');
  await expect(page.locator('#main').getByText(staleNotice, { exact: true })).toHaveCount(0);
  await expect(stamp).not.toHaveText(lastStamp);
});

test('pembacaan pertama yang gagal tetap layar galat tanpa angka rekaan', async ({ page }) => {
  await mockAdmin(page, () => 'failed');
  await page.goto('/admin/ringkasan');
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();
  await expect(page.locator('#main').getByRole('alert')).toContainText(errorText.internal_error);
  await expect(page.locator('#main').getByRole('button', { name: m.retry, exact: true })).toBeVisible();
  await expect(page.locator('.metrics')).toHaveCount(0);
  await expect(page.locator('#main').getByText(staleNotice, { exact: true })).toHaveCount(0);
});

test('penanda usang terbaca dan tidak meluber pada 360 px', async ({ page }) => {
  let mode: Mode = 'first';
  await mockAdmin(page, () => mode);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/admin/ringkasan');
  await expect(page.locator('section.metric', { hasText: ov.requests24hCard })).toContainText('33');
  mode = 'failed';
  await page.locator('#main').getByRole('button', { name: m.refresh, exact: true }).click();
  const notice = page.locator('#main').getByText(staleNotice, { exact: true });
  await expect(notice).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const retry = page.locator('#main').getByRole('button', { name: m.refresh, exact: true });
  await retry.focus();
  await expect(retry).toBeFocused();
});
