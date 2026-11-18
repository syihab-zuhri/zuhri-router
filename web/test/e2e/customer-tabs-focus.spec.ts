import { test, expect, type Page } from '@playwright/test';
import { m } from '../../src/messages.ts';

// Runs inside the full app (Shell + RouteFocus), unlike the component harness in admin-customers.spec.ts,
// because the focus bugs came from the app-level route focus handling.

const customer = { username: 'pelanggan', tenantStatus: 'ACTIVE', version: '1', currency: 'TOKEN', postedMicro: '5000000', heldMicro: '0', availableMicro: '5000000', entries: [] };
const activeKey = { id: '11111111-1111-4111-8111-111111111111', name: 'Key produksi', maskedKey: 'rtr_abcdefgh...', allowedModels: null, spendLimitMicro: null, spentMicro: '0', heldMicro: '0', expiresAt: null, status: 'ACTIVE', version: '3', createdAt: '2026-11-15T00:00:00.000Z', lastUsedAt: null, revokedAt: null };

async function mockAdmin(page: Page) {
  const state = { revoked: false };
  await page.route('**/admin/api/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/admin/api/customers') return route.fulfill({ json: { customers: [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-15T00:00:00.000Z', postedMicro: customer.postedMicro, heldMicro: '0' }], nextAfter: null } });
    if (path === '/admin/api/customers/pelanggan') return route.fulfill({ json: customer });
    if (path === '/admin/api/customers/pelanggan/usage') return route.fulfill({ json: { username: 'pelanggan', days: 7, byDay: [], byModel: [], byKey: [], recent: [] } });
    if (path === '/admin/api/customers/pelanggan/keys') return route.fulfill({ json: { keys: [state.revoked ? { ...activeKey, status: 'REVOKED', version: '4', revokedAt: '2026-11-18T03:00:00.000Z' } : activeKey], nextAfter: null } });
    if (path === `/admin/api/customers/pelanggan/keys/${activeKey.id}/revoke`) {
      state.revoked = true;
      return route.fulfill({ json: { key: { ...activeKey, status: 'REVOKED', version: '4' } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
}

/** RouteFocus moves focus one animation frame after navigation; wait past it before asserting focus. */
async function afterRouteFocus(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('navigasi panah, Home dan End pada tab detail pelanggan tidak memindahkan fokus ke judul halaman', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/admin/pelanggan?customer=pelanggan&tab=summary');
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await expect(tab(m.summary)).toHaveAttribute('aria-selected', 'true');
  await tab(m.summary).focus();
  const steps: [string, string, RegExp][] = [
    ['ArrowRight', m.balanceTab, /tab=balance/],
    ['End', m.apiKeys, /tab=keys/],
    ['ArrowLeft', m.ledger, /tab=ledger/],
    ['Home', m.summary, /tab=summary/],
  ];
  for (const [key, name, url] of steps) {
    await page.keyboard.press(key);
    await expect(page).toHaveURL(url);
    await afterRouteFocus(page);
    await expect(tab(name)).toBeFocused();
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
  }
  // A real page change still moves focus to the new page title.
  await page.getByRole('link', { name: m.packs, exact: true }).first().click();
  await afterRouteFocus(page);
  await expect(page.locator('h1')).toBeFocused();
});

test('hover pada tab aktif mempertahankan kontras teks', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/admin/pelanggan?customer=pelanggan&tab=summary');
  const selected = page.getByRole('tab', { name: m.summary, exact: true });
  await selected.hover();
  expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), 'the hover rule only applies to fine pointers').toBe(true);
  // Read the colours after the background transition has finished, not mid-way.
  const colors = await selected.evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await Promise.all(el.getAnimations().map(a => a.finished));
    const s = getComputedStyle(el); return { color: s.color, background: s.backgroundColor };
  });
  const luminance = (rgb: string) => {
    const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(colors.color), luminance(colors.background)].sort((a, b) => b - a);
  expect((hi + 0.05) / (lo + 0.05), JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
});

test('fokus kembali ke tombol cabut saat dialog ditutup dan ke judul panel sesudah key dicabut', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/admin/pelanggan?customer=pelanggan&tab=keys');
  const panel = page.getByRole('tabpanel', { name: m.apiKeys });
  const trigger = panel.getByRole('button', { name: m.revokeKey, exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: m.revokeConfirm });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole('button', { name: m.revokeKey, exact: true }).click();
  await expect(panel.getByRole('button', { name: m.revokeKey, exact: true })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: m.apiKeys, level: 2 })).toBeFocused();
});
