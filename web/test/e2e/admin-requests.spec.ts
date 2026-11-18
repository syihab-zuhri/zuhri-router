import { test, expect, type Page } from '@playwright/test';
import { m } from '../../src/messages.ts';

// SCR-017 request list across customers, inside the full app (Shell, routing, focus).

const row = (over: Record<string, unknown>) => ({
  id: 'req_1', username: 'budi', keyName: 'Key kerja', model: 'gp/model-15x', protocol: 'CHAT', stream: true, state: 'SETTLED',
  outcome: 'completed', final: true, heldMicro: '0', debitMicro: '277500', estimated: false,
  usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }, createdAt: '2026-11-18T10:00:00.000Z', ...over,
});

async function mockAdmin(page: Page) {
  const calls: URLSearchParams[] = [];
  await page.route('**/admin/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (url.pathname === '/admin/api/requests/unresolved') return route.fulfill({ json: { requests: [] } });
    if (url.pathname === '/admin/api/requests') {
      calls.push(url.searchParams);
      if (url.searchParams.get('username') === 'tidak-ada') return route.fulfill({ json: { requests: [], nextBefore: null } });
      if (url.searchParams.get('before')) return route.fulfill({ json: { requests: [row({ id: 'req_old', username: 'sari', createdAt: '2026-11-17T10:00:00.000Z' })], nextBefore: null } });
      return route.fulfill({ json: { requests: [
        row({}),
        row({ id: 'req_2', username: 'sari', keyName: null, stream: false, state: 'SETTLED_ESTIMATED', outcome: 'cancelled_mid_stream', estimated: true, debitMicro: '399000', usage: null }),
        row({ id: 'req_3', state: 'UNRESOLVED', outcome: 'process_lost_mid_stream', final: false, heldMicro: '1000000', debitMicro: null }),
      ], nextBefore: '2026-11-18T09:00:00.000Z' } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  return calls;
}

test('daftar request lintas pelanggan: baris, filter, paginasi dan tautan ke pelanggan', async ({ page }) => {
  const calls = await mockAdmin(page);
  await page.goto('/admin/rekonsiliasi');
  const list = page.getByRole('region', { name: m.allCustomerRequests });
  await expect(list.getByRole('link', { name: 'budi' }).first()).toHaveAttribute('href', '/admin/pelanggan?customer=budi&tab=summary');
  await expect(list.locator('.badge', { hasText: m.requestStateText.SETTLED_ESTIMATED }).first()).toBeVisible();
  await expect(list.getByText(m.requestOutcomeText.cancelled_mid_stream)).toBeVisible();
  await expect(list.getByText(m.adminRequestNoKey)).toBeVisible();

  // The state filter offers every stored state, including RESOLVED.
  await expect(list.getByLabel(m.adminRequestState).locator('option[value="RESOLVED"]')).toHaveCount(1);
  await list.getByLabel(m.adminRequestUsername).fill(' budi ');
  await list.getByLabel(m.adminRequestState).selectOption('UNRESOLVED');
  await list.getByLabel(m.adminRequestModel).fill('gp/model-15x');
  await list.getByRole('button', { name: m.search, exact: true }).click();
  await expect.poll(() => calls.at(-1)?.toString()).toContain('username=budi');
  expect(calls.at(-1)!.get('state')).toBe('UNRESOLVED');
  expect(calls.at(-1)!.get('model')).toBe('gp/model-15x');

  await list.getByRole('button', { name: m.next, exact: true }).click();
  await expect(list.getByRole('link', { name: 'sari' })).toBeVisible();
  expect(calls.at(-1)!.get('before')).toBe('2026-11-18T09:00:00.000Z');
  await list.getByRole('button', { name: m.first, exact: true }).click();
  await expect.poll(() => calls.at(-1)?.get('before') ?? null).toBeNull();

  await list.getByLabel(m.adminRequestUsername).fill('tidak-ada');
  await list.getByRole('button', { name: m.search, exact: true }).click();
  await expect(list.getByText(m.adminRequestsNoMatches)).toBeVisible();

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('fokus berpindah ke judul halaman sesudah Shell selesai memuat, juga pada halaman masuk', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let signedIn = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login') { signedIn = true; return route.fulfill({ json: { ok: true } }); }
    if (path === '/api/me') {
      if (!signedIn) return route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } });
      await gate; // keep the Shell loading so route focus runs before the page exists
      return route.fulfill({ json: { username: 'uji', tenantStatus: 'ACTIVE', version: '1' } });
    }
    if (path === '/api/balance') return route.fulfill({ json: { postedMicro: '0', heldMicro: '0', availableMicro: '0', currency: 'TOKEN' } });
    if (path === '/api/keys') return route.fulfill({ json: { keys: [], nextAfter: null } });
    if (path === '/api/packs') return route.fulfill({ json: { packs: [] } });
    return route.fulfill({ json: { entries: [], nextBefore: null } });
  });
  await page.goto('/masuk');
  await expect(page.getByRole('heading', { name: m.login, level: 1 })).toBeFocused();
  await page.getByLabel(m.identifier, { exact: true }).fill('uji');
  await page.getByLabel(m.password, { exact: true }).fill('customer-password-1');
  await page.getByRole('button', { name: m.login, exact: true }).click();
  await expect(page).toHaveURL(/\/beranda$/);
  release();
  await expect(page.getByRole('heading', { name: m.home, level: 1 })).toBeFocused();
});
