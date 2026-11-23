import { test, expect, type Page } from '@playwright/test';
import { formatDate } from '../../src/credits.ts';
import { errorText, m } from '../../src/messages.ts';

test.beforeEach(async ({ page }) => {
  await page.route('**/admin/api/**', route => route.fulfill({ status: 404, json: { error: { code: 'not_found' } } }));
  await page.route('**/__admin-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' }));
});

async function mount(page: Page, component: 'UnresolvedPage' | 'OverdraftPage' | 'AuditPage') {
  const hooks = await (await page.request.get('/src/hooks.tsx')).text();
  const queryUrl = hooks.match(/from "([^"]*@tanstack_react-query[^\"]*)"/)?.[1];
  const routerUrl = hooks.match(/from "([^"]*react-router[^\"]*)"/)?.[1];
  if (!queryUrl || !routerUrl) throw new Error('Vite dependency paths unavailable');
  await page.goto('/__admin-test');
  await page.addScriptTag({ type: 'module', content: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    const { createRoot } = ReactDOM;
    import { QueryClient, QueryClientProvider } from '${queryUrl}';
    import { BrowserRouter } from '${routerUrl}';
    const { ${component} } = await import('/src/admin-operations.tsx');
    createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider, {client: new QueryClient({defaultOptions:{queries:{retry:false}}})}, React.createElement(BrowserRouter, null, React.createElement(${component}))));
  ` });
}

const unresolved = { id: 'req_00000000-0000-4000-8000-000000000001', username: 'pelanggan', model: 'uji/model', heldMicro: '25000000', maxOutput: 120, createdAt: '2026-11-14T00:00:00.000Z' };

test('penyelesaian request menampilkan hold dan menahan mutasi sampai step-up', async ({ page }) => {
  const payloads: Record<string, unknown>[] = [];
  let rows = [unresolved];
  await page.route('**/admin/api/requests/unresolved', route => route.fulfill({ json: { requests: rows } }));
  await page.route(`**/admin/api/requests/${unresolved.id}/resolve`, route => {
    payloads.push(route.request().postDataJSON());
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    if (payloads.length === 1) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
    rows = [];
    return route.fulfill({ json: { id: unresolved.id, state: 'RESOLVED', debitMicro: '0', resolvedAt: '2026-11-14T00:00:05.000Z', replayed: false } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'UnresolvedPage');
  await expect(page.getByText('25 kredit token', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.resolveRequest });
  await expect(dialog).toContainText('pelanggan');
  await expect(dialog).toContainText('25 kredit token');
  await dialog.getByLabel(m.debitTokens).fill('0');
  await dialog.getByLabel(m.reason).fill('Konten tidak diteruskan.');
  await dialog.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  await expect(page.getByRole('dialog', { name: m.stepUp })).toBeVisible();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(dialog).toHaveCount(0);
  expect(payloads).toEqual([{ debitTokens: '0', reason: 'Konten tidak diteruskan.' }, { debitTokens: '0', reason: 'Konten tidak diteruskan.' }]);
  await expect(page.getByRole('heading', { name: m.noUnresolved, exact: true })).toBeVisible();
});

test('batas lebih-pakai memakai token integer dan menunggu step-up sebelum tersimpan', async ({ page }) => {
  const payloads: Record<string, unknown>[] = [];
  let value = '500000000';
  await page.route('**/admin/api/settings/overdraft', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { overdraftMicro: value } });
    payloads.push(route.request().postDataJSON());
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    if (payloads.length === 1) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
    value = '25000000';
    return route.fulfill({ json: { overdraftMicro: value } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'OverdraftPage');
  await expect(page.getByText('500 kredit token', { exact: true })).toBeVisible();
  await page.getByLabel(m.overdraftTokens).fill('25');
  await page.getByRole('button', { name: m.save, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.confirmOverdraft });
  await expect(dialog).toContainText('25 kredit token');
  await dialog.getByRole('button', { name: m.save, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(dialog).toHaveCount(0);
  expect(payloads).toEqual([{ tokens: '25' }, { tokens: '25' }]);
  await expect(page.getByText('25 kredit token', { exact: true })).toBeVisible();
});

test('penyelesaian request menampilkan receipt debit dan waktu sesudah server menjawab', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/admin/api/requests/unresolved', route => route.fulfill({ json: { requests: calls > 1 ? [] : [unresolved] } }));
  await page.route(`**/admin/api/requests/${unresolved.id}/resolve`, async route => {
    calls += 1;
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    if (calls === 1) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
    await gate;
    return route.fulfill({ json: { id: unresolved.id, state: 'RESOLVED', debitMicro: '15000000', resolvedAt: '2026-11-23T10:15:00.000Z', replayed: false } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'UnresolvedPage');
  await page.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.resolveRequest });
  await dialog.getByLabel(m.debitTokens).fill('15');
  await dialog.getByLabel(m.reason).fill('Konten sebagian diteruskan.');
  await dialog.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(dialog).toContainText(m.saving);
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole('status').filter({ hasText: m.resolveReceipt })).toHaveCount(0);
  release();
  const receipt = page.getByRole('status').filter({ hasText: m.resolveReceipt });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('15 kredit token');
  await expect(receipt).toContainText(formatDate('2026-11-23T10:15:00.000Z'));
  await expect(receipt).toContainText(unresolved.id);
  await expect(receipt).toBeFocused();
  await expect(page.getByRole('heading', { name: m.noUnresolved, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('penyelesaian yang diulang menandai sudah tercatat sebelumnya tanpa perubahan kedua', async ({ page }) => {
  let calls = 0;
  await page.route('**/admin/api/requests/unresolved', route => route.fulfill({ json: { requests: [unresolved] } }));
  await page.route(`**/admin/api/requests/${unresolved.id}/resolve`, route => {
    calls += 1;
    expect(route.request().postDataJSON()).toEqual({ debitTokens: '0', reason: 'Dana dilepas.' });
    if (calls === 1) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
    return route.fulfill({ json: { id: unresolved.id, state: 'RESOLVED', debitMicro: '0', resolvedAt: '2026-11-23T09:40:00.000Z', replayed: true } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'UnresolvedPage');
  await page.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.resolveRequest });
  await dialog.getByLabel(m.debitTokens).fill('0');
  await dialog.getByLabel(m.reason).fill('Dana dilepas.');
  await dialog.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  const receipt = page.getByRole('status').filter({ hasText: m.resolveReceiptReplay });
  await expect(receipt).toBeVisible();
  await expect(page.getByText(m.resolveReceipt, { exact: true })).toHaveCount(0);
  await expect(receipt).toContainText(m.resolveReceiptReplayNote);
  await expect(receipt).toContainText('0 kredit token');
  await expect(receipt).toContainText(formatDate('2026-11-23T09:40:00.000Z'));
  expect(calls).toBe(2);
});

test('keputusan berbeda pada request yang sudah diputuskan menjelaskan already_resolved dan dapat memuat ulang antrean', async ({ page }) => {
  let reads = 0;
  let calls = 0;
  await page.route('**/admin/api/requests/unresolved', route => { reads += 1; return route.fulfill({ json: { requests: reads > 1 ? [] : [unresolved] } }); });
  await page.route(`**/admin/api/requests/${unresolved.id}/resolve`, route => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
    return route.fulfill({ status: 409, json: { error: { code: 'already_resolved' } } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'UnresolvedPage');
  await page.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: m.resolveRequest });
  await dialog.getByLabel(m.debitTokens).fill('5');
  await dialog.getByLabel(m.reason).fill('Sebagian ditagihkan.');
  await dialog.getByRole('button', { name: m.resolveRequest, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(dialog.getByText(errorText.already_resolved, { exact: true })).toBeVisible();
  await expect(dialog.getByText(m.resolveConflictHelp, { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: m.resolveReceipt })).toHaveCount(0);
  await dialog.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: m.noUnresolved, exact: true })).toBeVisible();
});

test('audit menerjemahkan aksi, memfilter aksi/pelaku/target dan memakai username serta cursor server', async ({ page }) => {
  const calls: URL[] = [];
  await page.route('**/admin/api/audit**', route => {
    const url = new URL(route.request().url()); calls.push(url);
    if (url.searchParams.get('targetId') === 'tidak-ada' || url.searchParams.has('before')) return route.fulfill({ json: { events: [], nextBefore: null } });
    const customAction = url.searchParams.get('action') === 'vendor.custom.';
    return route.fulfill({ json: { events: [{ id: '81', actorUser: '0e1e24d7-0000-4000-8000-123456789abc', actorUsername: 'admin_uji', actorKind: 'ADMIN', action: customAction ? 'vendor.custom.change' : 'ledger.admin_topup', targetType: 'tenant', targetId: 'tenant_uji', summary: { amountMicro: '25000000' }, createdAt: '2026-11-14T00:00:00.000Z' }], nextBefore: '80' } });
  });
  await mount(page, 'AuditPage');
  await expect(page.getByText(m.auditActionText['ledger.admin_topup'], { exact: true })).toBeVisible();
  await expect(page.getByText('ledger.admin_topup', { exact: true })).toHaveCount(0);
  await expect(page.getByText('admin_uji', { exact: true })).toBeVisible();
  await expect(page.getByText('0e1e24d7-0000-4000-8000-123456789abc', { exact: true })).toHaveCount(0);
  const actionFilter = page.getByLabel(m.auditActionFilter);
  for (const value of ['setting.', 'voucher.', 'tenant.', 'api_key.', 'request.']) await expect(actionFilter.locator(`option[value="${value}"]`)).toHaveCount(1);
  await actionFilter.selectOption('request.');
  await page.getByLabel(m.auditActorUsername).fill('admin_uji');
  await page.getByLabel(m.auditTargetType).fill('request');
  await page.getByLabel(m.auditTargetId).fill('req_1');
  await page.getByRole('button', { name: m.search, exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('action')).toBe('request.');
  expect(calls.at(-1)?.searchParams.get('actor')).toBe('admin_uji');
  expect(calls.at(-1)?.searchParams.get('targetType')).toBe('request');
  expect(calls.at(-1)?.searchParams.get('targetId')).toBe('req_1');
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('before')).toBe('80');
  expect(calls.at(-1)?.searchParams.get('actor')).toBe('admin_uji');
  await expect(page.getByRole('heading', { name: m.noMoreData, exact: true })).toBeVisible();
  await page.getByLabel(m.auditTargetId).fill('tidak-ada');
  await page.getByRole('button', { name: m.search, exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('targetId')).toBe('tidak-ada');
  await expect(page).toHaveURL(/targetId=tidak-ada/);
  await expect(page.getByRole('heading', { name: m.auditNoMatches, exact: true })).toBeVisible();
  await page.getByLabel(m.auditActionFilter).selectOption('__custom');
  await expect(page.getByLabel(m.auditCustomAction)).toBeVisible();
  await page.getByLabel(m.auditCustomAction).fill('vendor.custom.');
  await page.getByLabel(m.auditTargetId).fill('target-uji');
  await page.getByRole('button', { name: m.search, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'vendor.custom.change', exact: true })).toBeVisible();
  await expect.poll(() => calls.at(-1)?.searchParams.get('action')).toBe('vendor.custom.');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('audit membedakan loading dan daftar yang memang kosong', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/admin/api/audit**', async route => { await gate; return route.fulfill({ json: { events: [], nextBefore: null } }); });
  await mount(page, 'AuditPage');
  await expect(page.getByText(m.loading, { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: m.noAudit, exact: true })).toBeVisible();
});

test('audit menampilkan rincian terlokalisasi, nilai mikro-kredit, JSON pendek, dan melewati summary kosong', async ({ page }) => {
  await page.route('**/admin/api/audit**', route => route.fulfill({ json: { events: [
    { id: 'detail-1', actorUser: 'admin_uji', actorUsername: 'admin_uji', actorKind: 'ADMIN', action: 'tenant.suspend', targetType: 'tenant', targetId: 'tenant_uji', summary: { reason: 'Pemeriksaan selesai', previousStatus: 'ACTIVE', nextStatus: 'CLOSED', amountMicro: '25000000', customField: 'nilai mentah', method: 'SUSPENDED', keyReplaced: true, isPromo: false, nested: { key: 'value', large: 'x'.repeat(240) } }, createdAt: '2026-11-14T00:00:00.000Z' },
    { id: 'detail-2', actorUser: null, actorUsername: null, actorKind: 'SYSTEM', action: 'request.recover_release', targetType: 'request', targetId: 'request_uji', summary: {}, createdAt: '2026-11-14T00:00:01.000Z' },
  ], nextBefore: null } }));
  await mount(page, 'AuditPage');
  const events = page.getByRole('region', { name: m.audit });
  const first = events.locator('.data-row').filter({ hasText: 'tenant_uji' });
  const details = first.locator('details');
  await expect(details).toHaveCount(1);
  await details.getByText(m.details, { exact: true }).click();
  await expect(details).toContainText('Alasan');
  await expect(details).toContainText('Pemeriksaan selesai');
  await expect(details).toContainText('Status sebelumnya');
  await expect(details).toContainText('Aktif');
  await expect(details).toContainText('Status berikutnya');
  await expect(details).toContainText('Ditutup');
  // A status code under a key that is not a status key stays raw.
  await expect(details.locator('div').filter({ hasText: m.auditMethod }).locator('dd')).toHaveText('SUSPENDED');
  await expect(details.locator('div').filter({ hasText: m.auditKeyReplaced }).locator('dd')).toHaveText(m.auditYes);
  await expect(details.locator('div').filter({ hasText: m.auditIsPromo }).locator('dd')).toHaveText(m.auditNo);
  await expect(details).toContainText('Nominal');
  await expect(details).toContainText('25 kredit token');
  await expect(details).toContainText('customField');
  await expect(details).toContainText('nilai mentah');
  const nested = details.locator('dd').filter({ hasText: '"key"' });
  await expect(nested).toContainText('"value"');
  expect((await nested.innerText()).length).toBeLessThanOrEqual(180);
  await expect(events.locator('.data-row').filter({ hasText: 'request_uji' }).locator('details')).toHaveCount(0);
});

test('audit memberi pesan dan aksi ulang saat server gagal', async ({ page }) => {
  await page.route('**/admin/api/audit**', route => route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } }));
  await mount(page, 'AuditPage');
  await expect(page.getByRole('alert')).toContainText('Server belum dapat menyelesaikan tindakan. Muat ulang data dan periksa hasil sebelum mencoba lagi.');
  await expect(page.getByRole('alert').getByRole('button', { name: m.retry, exact: true })).toBeVisible();
});

test('audit menandai halaman lanjutan kosong dan menyediakan jalan ke halaman awal', async ({ page }) => {
  const calls: URL[] = [];
  await page.route('**/admin/api/audit**', route => {
    const url = new URL(route.request().url()); calls.push(url);
    if (url.searchParams.has('before')) return route.fulfill({ json: { events: [], nextBefore: null } });
    return route.fulfill({ json: { events: [{ id: 'cursor-row', actorUser: 'admin_uji', actorUsername: 'admin_uji', actorKind: 'ADMIN', action: 'ledger.admin_topup', targetType: 'tenant', targetId: 'tenant_uji', summary: {}, createdAt: '2026-11-14T00:00:00.000Z' }], nextBefore: 'cursor-1' } });
  });
  await mount(page, 'AuditPage');
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('before')).toBe('cursor-1');
  await expect(page.getByRole('heading', { name: m.noMoreData, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: m.first, exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: m.first, exact: true }).click();
  await expect(page.getByRole('heading', { name: m.auditActionText['ledger.admin_topup'], exact: true })).toBeVisible();
});

test('audit memuat metadata dan meneruskan cursor sebelum ke server', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/admin/api/audit**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { events: url.searchParams.has('before') ? [] : [{ id: '81', actorUser: 'admin_uji', actorUsername: 'admin_uji', actorKind: 'ADMIN', action: 'ledger.admin_topup', targetType: 'tenant', targetId: 'tenant_uji', summary: { amountMicro: '25000000' }, createdAt: '2026-11-14T00:00:00.000Z' }], nextBefore: url.searchParams.has('before') ? null : '80' } });
  });
  await mount(page, 'AuditPage');
  await expect(page.getByText(m.auditActionText['ledger.admin_topup'], { exact: true })).toBeVisible();
  await expect(page.getByText('admin_uji', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('before')).toBe('80');
  await expect(page.getByRole('heading', { name: m.noMoreData, exact: true })).toBeVisible();
});
