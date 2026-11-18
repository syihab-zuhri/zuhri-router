import { test, expect } from '@playwright/test';
import { m } from '../../src/messages.ts';

test('pemakaian memuat cursor dan menampilkan status estimasi serta hold', async ({ page }) => {
  const queries: string[] = [];
  await page.route('**/api/me', route => route.fulfill({ json: { username: 'uji', tenantStatus: 'ACTIVE', version: '1' } }));
  await page.route('**/api/requests?*', route => {
    const url = new URL(route.request().url()); queries.push(url.search);
    return route.fulfill({ json: url.searchParams.has('before') ? {
      requests: [{ id: 'req_00000000-0000-4000-8000-000000000002', model: 'uji/model', protocol: 'RESPONSES', stream: false, state: 'SETTLED', final: true, heldMicro: '0', debitMicro: '0', estimated: false, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, createdAt: '2026-11-14T03:00:00.000Z' }], nextBefore: null,
    } : {
      requests: [
        { id: 'req_00000000-0000-4000-8000-000000000003', model: 'uji/partial', protocol: 'CHAT', stream: true, state: 'UNRESOLVED', final: false, heldMicro: '2400000', debitMicro: null, estimated: false, usage: null, createdAt: '2026-11-14T04:00:00.000Z' },
        { id: 'req_00000000-0000-4000-8000-000000000001', model: 'uji/model', protocol: 'ANTHROPIC', stream: true, state: 'SETTLED_ESTIMATED', final: true, heldMicro: '1000000', debitMicro: '1250000', estimated: true, usage: { input: 3, output: 2, cacheRead: 1, cacheWrite: 0 }, createdAt: '2026-11-14T02:00:00.000Z' },
      ], nextBefore: '2026-11-14T02:00:00.000Z',
    } });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/pemakaian');
  await expect(page.getByRole('heading', { name: m.requests, exact: true })).toBeVisible();
  await expect(page.getByText(m.notFinal, { exact: true })).toBeVisible();
  await expect(page.getByText(m.estimated, { exact: true })).toBeVisible();
  await expect(page.getByText(m.estimated, { exact: true })).toContainText('penyedia model tidak melaporkan pemakaian');
  await expect(page.getByRole('region', { name: m.chargedUsage })).toBeVisible();
  await expect(page.locator('.request-row').first()).toContainText(m.notFinal);
  await expect(page.locator('.request-row').first()).toContainText('2,4 kredit token');
  await expect(page.locator('.request-row').last()).toContainText('1,25 kredit token');
  await expect(page.locator('.request-row').first()).toContainText('Dana ditahan sampai selesai diproses');
  await expect(page.locator('.usage-bars')).toBeVisible();
  await page.getByLabel(m.protocolFilter).selectOption('CHAT');
  await expect(page.locator('.request-row')).toHaveCount(1);
  await expect(page.getByLabel(m.modelFilter)).toHaveValue('');
  await expect(page.getByText(m.noUsage, { exact: true })).toHaveCount(1);
  await expect(page.getByText(m.noUsage, { exact: true })).toContainText('tidak melaporkan pemakaian token');
  await expect(page.getByLabel(m.protocolFilter)).toHaveValue('CHAT');
  await page.getByLabel(m.protocolFilter).selectOption('');
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect(page).toHaveURL(/before=/);
  await expect(page.getByText(m.zeroUsage, { exact: true })).toBeVisible();
  expect(queries.length).toBeGreaterThanOrEqual(2);
  expect(queries.at(-1)).toContain('before=');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
