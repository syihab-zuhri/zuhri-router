import { test, expect, type Page } from '@playwright/test';
import { m } from '../../src/messages.ts';

test.beforeEach(async ({ page }) => {
  await page.route('**/admin/api/**', route => route.fulfill({ status: 404, json: { error: { code: 'not_found' } } }));
  await page.route('**/__admin-test**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' }));
});

async function render(page: Page, module: string, name: string) {
  const hooks = await (await page.request.get('/src/hooks.tsx')).text();
  const queryUrl = hooks.match(/from "([^"]*@tanstack_react-query[^\"]*)"/)?.[1];
  const routerUrl = hooks.match(/from "([^"]*react-router[^\"]*)"/)?.[1];
  if (!queryUrl || !routerUrl) throw new Error('Vite dependency paths unavailable');
  await page.addScriptTag({ type: 'module', content: `import '/src/tokens.css'; import '/src/styles.css';` });
  await page.addScriptTag({ type: 'module', content: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    const { createRoot } = ReactDOM;
    import { QueryClient, QueryClientProvider } from '${queryUrl}';
    import { BrowserRouter } from '${routerUrl}';
    const modules = await import('/src/${module}.tsx').catch(() => ({}));
    const Component = modules.${name};
    if (Component) createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider, {client: new QueryClient({defaultOptions:{queries:{retry:false}}})}, React.createElement(BrowserRouter, null, React.createElement('main', { id: 'main' }, React.createElement(Component)))));
  ` });
}

async function mount(page: Page, module: string, name: string) {
  await page.goto('/__admin-test');
  await render(page, module, name);
}

const customer = { username: 'pelanggan', tenantStatus: 'ACTIVE', version: '1', currency: 'TOKEN', postedMicro: '9007199254740993000000', heldMicro: '0', availableMicro: '9007199254740993000000', entries: [] };

test('detail pelanggan menyediakan lima tab yang bertahan di query string', async ({ page }) => {
  await page.route('**/admin/api/customers?*', route => route.fulfill({ json: { customers: [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-15T00:00:00.000Z', postedMicro: customer.postedMicro, heldMicro: customer.heldMicro }], nextAfter: null } }));
  await page.route('**/admin/api/customers/pelanggan', route => route.fulfill({ json: customer }));
  await page.route('**/admin/api/customers/pelanggan/usage?*', route => route.fulfill({ json: { username: 'pelanggan', days: 7, byDay: [], byModel: [], byKey: [], recent: [] } }));
  await page.route('**/admin/api/customers/pelanggan/keys?*', route => route.fulfill({ json: { keys: [], nextAfter: null } }));
  await page.route('**/__admin-test**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' }));
  await mount(page, 'admin-customers', 'CustomersPage');
  await expect(page.getByRole('button', { name: m.customerDetails })).toBeVisible();
  await page.getByRole('button', { name: m.customerDetails }).click();
  await expect(page).toHaveURL(/customer=pelanggan/);
  await expect(page).toHaveURL(/tab=summary/);
  await expect(page.getByRole('tablist', { name: m.customerDetailTabs })).toBeVisible();
  for (const label of [m.summary, m.balanceTab, m.usageTab, m.ledger, m.apiKeys]) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible();
  }
  const usageTab = page.getByRole('tab', { name: m.usageTab });
  await usageTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: m.ledger })).toBeFocused();
  await expect(page.getByRole('tab', { name: m.ledger })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/tab=ledger/);
  await page.evaluate(() => window.history.replaceState(window.history.state, '', '/__admin-test?customer=pelanggan&tab=ledger'));
  await page.reload();
  await render(page, 'admin-customers', 'CustomersPage');
  await expect(page.getByRole('tab', { name: m.ledger })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/customer=pelanggan&tab=ledger/);
  await expect(page.getByRole('tabpanel', { name: m.ledger })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll<HTMLElement>('*')].map(element => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, className: String(element.className), text: element.innerText.slice(0, 60), left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, insideTabs: Boolean(element.closest('.customer-tabs')) };
    }).filter(element => element.right > innerWidth + 1 && !element.insideTabs).slice(0, 20),
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
});

test('API key dapat dicabut langsung dari baris pelanggan lewat konfirmasi dan step-up', async ({ page }) => {
  let revokeCount = 0;
  const key = { id: '11111111-1111-4111-8111-111111111111', name: 'Key operasional', maskedKey: 'rtr_masked...', allowedModels: null, spendLimitMicro: null, spentMicro: '0', heldMicro: '0', expiresAt: null, status: 'ACTIVE', version: '2', createdAt: '2026-11-15T00:00:00.000Z', lastUsedAt: null, revokedAt: null };
  await page.route('**/admin/api/customers?*', route => route.fulfill({ json: { customers: [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-15T00:00:00.000Z', postedMicro: customer.postedMicro, heldMicro: customer.heldMicro }], nextAfter: null } }));
  await page.route('**/admin/api/customers/pelanggan/keys?*', route => route.fulfill({ json: { keys: [revokeCount > 1 ? { ...key, status: 'REVOKED', version: '3' } : key], nextAfter: null } }));
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/admin/api/customers/pelanggan/keys/11111111-1111-4111-8111-111111111111/revoke', route => {
    revokeCount += 1;
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: '2' });
    return revokeCount === 1
      ? route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } })
      : route.fulfill({ json: { key: { ...key, status: 'REVOKED', version: '3' } } });
  });
  await mount(page, 'admin-customers', 'CustomersPage');
  const row = page.locator('.customer-list-row');
  await expect(row).toContainText('pelanggan');
  const manageKeys = row.getByRole('button', { name: m.manageCustomerKeys });
  await manageKeys.focus();
  await page.keyboard.press('Enter');
  const keyDialog = page.getByRole('dialog', { name: m.apiKeys });
  await expect(keyDialog.getByText(key.maskedKey)).toBeVisible();
  await keyDialog.getByRole('button', { name: m.revokeKey }).click();
  const confirm = page.getByRole('dialog', { name: m.revokeConfirm });
  await expect(confirm).toContainText('pelanggan');
  await confirm.getByRole('button', { name: m.revokeKey }).click();
  const stepUp = page.getByRole('dialog', { name: m.stepUp });
  await stepUp.getByLabel(m.code).fill('123456');
  await stepUp.getByRole('button', { name: m.verify }).click();
  await expect.poll(() => revokeCount).toBe(2);
  await expect(keyDialog.getByText('Dicabut', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('tab API key memuat daftar tersamar dan pencabutan menunggu step-up', async ({ page }) => {
  let revocations = 0;
  const key = { id: '11111111-1111-4111-8111-111111111111', name: 'Key produksi', maskedKey: 'rtr_abcdefgh...', allowedModels: null, spendLimitMicro: '1000000000000', spentMicro: '1000000', heldMicro: '0', expiresAt: null, status: 'ACTIVE', version: '3', createdAt: '2026-11-15T00:00:00.000Z', lastUsedAt: null, revokedAt: null };
  await page.route('**/admin/api/customers?*', route => route.fulfill({ json: { customers: [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-15T00:00:00.000Z', postedMicro: customer.postedMicro, heldMicro: customer.heldMicro }], nextAfter: null } }));
  await page.route('**/admin/api/customers/pelanggan', route => route.fulfill({ json: customer }));
  await page.route('**/admin/api/customers/pelanggan/usage?*', route => route.fulfill({ json: { username: 'pelanggan', days: 7, byDay: [], byModel: [], byKey: [], recent: [] } }));
  await page.route('**/admin/api/customers/pelanggan/keys?*', route => route.fulfill({ json: { keys: [key], nextAfter: null } }));
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/__admin-test**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' }));
  await mount(page, 'admin-customers', 'CustomersPage');
  await page.getByRole('button', { name: m.customerDetails }).click();
  await page.getByRole('tab', { name: m.apiKeys }).click();
  await page.route('**/admin/api/customers/pelanggan/keys/11111111-1111-4111-8111-111111111111/revoke', route => {
    revocations += 1;
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: '3' });
    return revocations === 1
      ? route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } })
      : route.fulfill({ json: { key: { ...key, status: 'REVOKED', version: '4' } } });
  });
  await mount(page, 'admin-customers', 'CustomersPage');
  await page.getByRole('button', { name: m.customerDetails }).click();
  await expect(page).toHaveURL(/customer=pelanggan/);
  const apiKeysTab = page.getByRole('tab', { name: m.apiKeys });
  await expect(apiKeysTab).toBeVisible();
  await apiKeysTab.click();
  await expect(page).toHaveURL(/tab=keys/);
  const list = page.getByRole('tabpanel', { name: m.apiKeys });
  await expect(list.getByText(key.maskedKey)).toBeVisible();
  await expect(list.getByText(/synthetic|secret-placeholder/)).toHaveCount(0);
  await expect(page).not.toHaveURL(/secret=/);
  await list.getByRole('button', { name: m.revokeKey }).click();
  const confirm = list.getByRole('dialog', { name: m.revokeConfirm });
  await expect(confirm).toContainText('pelanggan');
  await confirm.getByRole('button', { name: m.revokeKey }).click();
  const stepUp = page.getByRole('dialog', { name: m.stepUp });
  await stepUp.getByLabel(m.code).fill('123456');
  await stepUp.getByRole('button', { name: m.verify }).click();
  await expect.poll(() => revocations).toBe(2);
  await expect(page.getByRole('tab', { name: m.apiKeys })).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('daftar pelanggan meminta halaman/filter ke API dan detail tetap dibuka dari pilihan', async ({ page }) => {
  const filters: URL[] = [];
  const detailReads: string[] = [];
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/admin/api/customers?*', route => {
    const url = new URL(route.request().url()); filters.push(url);
    const after = url.searchParams.get('after');
    const pageRows = after
      ? [{ username: 'pelanggan2', tenantStatus: 'SUSPENDED', createdAt: '2026-11-12T00:00:00.000Z', postedMicro: '5000000', heldMicro: '0' }]
      : [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-13T00:00:00.000Z', postedMicro: '9007199254740993000000', heldMicro: '2400000' }];
    const prefix = url.searchParams.get('prefix');
    const customers = prefix ? pageRows.filter(customerRow => customerRow.username.startsWith(prefix)) : pageRows;
    return route.fulfill({ json: { customers, nextAfter: after ? null : 'pelanggan' } });
  });
  await page.route('**/admin/api/customers/pelanggan', route => { detailReads.push('pelanggan'); return route.fulfill({ json: customer }); });
  await mount(page, 'admin-customers', 'CustomersPage');
  await expect(page.getByRole('heading', { name: m.customers, exact: true })).toBeVisible();
  await expect(page.getByText('9.007.199.254.740.993', { exact: false })).toBeVisible();
  await page.getByLabel(m.customerPrefix).fill('pelanggan');
  await page.getByRole('button', { name: m.search, exact: true }).click();
  await expect.poll(() => filters.at(-1)?.searchParams.get('prefix')).toBe('pelanggan');
  await page.getByRole('button', { name: m.next, exact: true }).click();
  await expect.poll(() => filters.at(-1)?.searchParams.get('after')).toBe('pelanggan');
  await expect(page.getByRole('heading', { name: 'pelanggan2', exact: true })).toBeVisible();
  await page.getByLabel(m.customerPrefix).fill('tidak-ada');
  await page.getByRole('button', { name: m.search, exact: true }).click();
  await expect.poll(() => filters.at(-1)?.searchParams.get('prefix')).toBe('tidak-ada');
  await expect(page.getByRole('heading', { name: m.customerNoMatches, exact: true })).toBeVisible();
  await expect(page.locator('.customer-list-row')).toHaveCount(0);
  expect(detailReads).toEqual([]);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('pencarian username dan tambah saldo menunggu konfirmasi serta mempertahankan kunci saat step-up', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  let loaded = false;
  await page.route('**/admin/api/customers?*', route => {
    const prefix = new URL(route.request().url()).searchParams.get('prefix');
    return route.fulfill({ json: { customers: prefix === 'pelanggan' ? [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-13T00:00:00.000Z', postedMicro: customer.postedMicro, heldMicro: customer.heldMicro }] : [], nextAfter: null } });
  });
  const usageQueries: string[] = [];
  await page.route('**/admin/api/customers/pelanggan', route => { loaded = true; return route.fulfill({ json: customer }); });
  await page.route('**/admin/api/customers/pelanggan/usage?*', route => {
    const url = new URL(route.request().url()); usageQueries.push(url.search);
    return route.fulfill({ json: { username: 'pelanggan', days: Number(url.searchParams.get('days')), byDay: [{ key: '2026-11-14', requests: 1, failed: 0, estimated: 1, debitMicro: '25000000', inputTokens: '3', outputTokens: '2', unbilledInputTokens: '0' }], byModel: [], byKey: [], recent: [{ id: 'req_00000000-0000-4000-8000-000000000001', model: 'uji/model', protocol: 'CHAT', state: 'SETTLED_ESTIMATED', debitMicro: '25000000', estimated: true, unbilledInputTokens: '0', createdAt: '2026-11-14T00:00:00.000Z' }] } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/admin/api/topups', route => {
    requests.push(route.request().postDataJSON());
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    return requests.length === 1 ? route.fulfill({ status: 403, json: { error: { code: 'step_up_required' } } }) : route.fulfill({ json: { username: 'pelanggan', entryId: '81', amountMicro: '25000000', postedAfterMicro: '9007199254741018000000', replayed: false } });
  });
  await mount(page, 'admin-customers', 'CustomersPage');
  await expect(page.getByRole('heading', { name: m.customers, exact: true })).toBeVisible();
  expect(loaded).toBe(false);
  await page.getByLabel(m.customerPrefix).fill('pelanggan');
  await page.getByRole('button', { name: m.search, exact: true }).click();
  await expect(page.getByText('9.007.199.254.740.993', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: m.customerDetails, exact: true }).click();
  await page.getByRole('tab', { name: m.usageTab }).click();
  await expect(page.getByRole('heading', { name: m.customerUsage, exact: true })).toBeVisible();
  await expect(page.getByText('25 kredit token', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('uji/model', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: m.balanceTab }).click();
  await page.getByLabel(m.tokens, { exact: true }).fill('25');
  await page.getByLabel(m.saleRef).fill('penjualan-uji');
  await page.getByRole('button', { name: m.topup, exact: true }).click();
  expect(requests).toHaveLength(0);
  const confirm = page.getByRole('dialog', { name: m.topupConfirm });
  await expect(confirm).toContainText('pelanggan');
  await expect(confirm).toContainText('25');
  await confirm.getByRole('button', { name: m.topup, exact: true }).click();
  const stepUp = page.getByRole('dialog', { name: m.stepUp });
  await stepUp.getByLabel(m.code).fill('123456');
  await stepUp.getByRole('button', { name: m.verify }).click();
  await expect(page.getByRole('heading', { name: m.redeemed })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0].amountTokens).toBe('25');
  expect(requests[0].idempotencyKey).toEqual(expect.any(String));
});
