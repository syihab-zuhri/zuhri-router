import { test, expect, type Page } from '@playwright/test';
import { m } from '../../src/messages.ts';

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
    return route.fulfill({ json: { id: unresolved.id, state: 'RESOLVED', debitMicro: '0' } });
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

test('audit memuat metadata dan meneruskan cursor sebelum ke server', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/admin/api/audit**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { events: url.searchParams.has('before') ? [] : [{ id: '81', actorUser: 'admin_uji', actorKind: 'ADMIN', action: 'ledger.admin_topup', targetType: 'tenant', targetId: 'tenant_uji', summary: { amountMicro: '25000000' }, createdAt: '2026-11-14T00:00:00.000Z' }] } });
  });
  await mount(page, 'AuditPage');
  await expect(page.getByText('ledger.admin_topup', { exact: true })).toBeVisible();
  await expect(page.getByText('admin_uji', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('before')).toBe('81');
  await expect(page.getByRole('heading', { name: m.noAudit, exact: true })).toBeVisible();
});
