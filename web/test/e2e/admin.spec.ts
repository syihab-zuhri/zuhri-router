import { test, expect, type Page } from '@playwright/test';
import { m } from '../../src/messages.ts';

// Isolated browser harness: only HTTP boundaries are mocked, not page components.
// It remains independent of the parent-owned application shell and route registry.
test.beforeEach(async ({ page }) => {
  await page.route('**/admin/api/**', route => route.fulfill({ status: 404, json: { error: { code: 'not_found' } } }));
  await page.route('**/__admin-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' }));
});

async function mount(page: Page, module: string, name: string) {
  const hooks = await (await page.request.get('/src/hooks.tsx')).text();
  const queryUrl = hooks.match(/from "([^"]*@tanstack_react-query[^\"]*)"/)?.[1];
  const routerUrl = hooks.match(/from "([^"]*react-router[^\"]*)"/)?.[1];
  if (!queryUrl || !routerUrl) throw new Error('Vite dependency paths unavailable');
  await page.goto('/__admin-test');
  await page.evaluate(() => { history.replaceState({ usr: {} }, '', '/'); });
  await page.addScriptTag({ type: 'module', content: `import '/src/tokens.css'; import '/src/styles.css';` });
  await page.addScriptTag({ type: 'module', content: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    const { createRoot } = ReactDOM;
    import { QueryClient, QueryClientProvider } from '${queryUrl}';
    import { BrowserRouter } from '${routerUrl}';
    const modules = await import('/src/${module}.tsx').catch(() => ({}));
    const Component = modules.${name};
    if (Component) createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider, {client: new QueryClient({defaultOptions:{queries:{retry:false}}})}, React.createElement(BrowserRouter, null, React.createElement(Component))));
  ` });
}

const customer = { username: 'pelanggan', tenantStatus: 'ACTIVE', version: '1', currency: 'TOKEN', postedMicro: '9007199254740993000000', heldMicro: '0', availableMicro: '9007199254740993000000', entries: [] };

test('pencarian username dan tambah saldo menunggu konfirmasi serta mempertahankan kunci saat step-up', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  let loaded = false;
  await page.route('**/admin/api/customers?*', route => {
    const prefix = new URL(route.request().url()).searchParams.get('prefix');
    return route.fulfill({ json: { customers: prefix === 'pelanggan' ? [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-13T00:00:00.000Z', postedMicro: customer.postedMicro, heldMicro: customer.heldMicro }] : [], nextAfter: null } });
  });
  await page.route('**/admin/api/customers/pelanggan', route => { loaded = true; return route.fulfill({ json: customer }); });
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

const pack = { id: '11111111-1111-4111-8111-111111111111', name: 'Paket uji', tokens: '100000000', displayPriceIdr: '10000', isPromo: false, active: true, version: '3' };

test('paket memakai string bilangan bulat dan versi server saat disimpan', async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  let packs = [pack];
  await page.route('**/admin/api/packs**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { packs } });
    const body = route.request().postDataJSON(); writes.push(body);
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    const value = { ...pack, ...body, version: '4' }; packs = [value];
    return route.fulfill({ json: value });
  });
  await mount(page, 'admin-packs', 'PacksPage');
  await expect(page.getByRole('heading', { name: m.packs, exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.edit, exact: true }).click();
  await page.getByLabel(m.tokens, { exact: true }).fill('999999999999');
  await page.getByLabel(m.priceIdr).fill('123456789012');
  await page.getByLabel(m.active, { exact: true }).uncheck();
  await page.getByRole('button', { name: m.updatePack }).click();
  await expect(page.getByText(m.success)).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ expectedVersion: '3', tokens: '999999999999', displayPriceIdr: '123456789012', active: false, isPromo: false });
});

const voucher = { id: '22222222-2222-4222-8222-222222222222', maskedCode: 'ZR-ABCDE…', amountMicro: '100000000000000', kind: 'SALE', saleRef: 'penjualan-kode', packId: pack.id, priceIdr: '10000', recipientBound: false, expiresAt: null, status: 'ACTIVE', issuedAt: '2026-11-14T00:00:00.000Z', closedAt: null };

test('terbit kode memerlukan konfirmasi dan secret hilang setelah panel ditutup', async ({ page }) => {
  const issued: Record<string, unknown>[] = [];
  let vouchers: typeof voucher[] = [];
  const secret = 'ZR-ABCDE-FGHJKMN-PQRSTVW-XYZ2345';
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [pack] } }));
  await page.route('**/admin/api/vouchers**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { vouchers, nextBefore: null, outstandingMicro: '100000000000000' } });
    issued.push(route.request().postDataJSON()); vouchers = [voucher];
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    return route.fulfill({ json: { voucher, code: secret, replayed: false } });
  });
  await mount(page, 'admin-vouchers', 'VouchersPage');
  await expect(page.getByRole('heading', { name: m.vouchers, exact: true })).toBeVisible();
  await expect(page.getByText(m.voucherHelp, { exact: true })).toBeVisible();
  await page.getByLabel(m.pack, { exact: true }).selectOption(pack.id);
  await page.getByLabel(m.saleRef, { exact: true }).fill('penjualan-kode');
  await page.getByRole('button', { name: m.issueVoucher, exact: true }).click();
  expect(issued).toHaveLength(0);
  const confirmation = page.getByRole('dialog', { name: m.issueVoucher });
  await expect(confirmation.getByText(m.voucherHelp, { exact: true })).toBeVisible();
  await expect(confirmation).toContainText('100.000.000');
  await confirmation.getByRole('button', { name: m.issueVoucher }).click();
  await expect(page.getByText(secret, { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: m.voucherSecretTitle })).toBeVisible();
  await expect(page.getByRole('dialog', { name: m.secretTitle })).toHaveCount(0);
  expect(issued[0]).toMatchObject({ kind: 'SALE', saleRef: 'penjualan-kode', packId: pack.id, recipientUsername: null, expiresAt: null });
  expect(issued[0].tokens).toBeUndefined();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage, location.href]))).not.toContain(secret);
  await page.getByRole('button', { name: m.copiedDone }).click();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  await expect(page.getByText(voucher.maskedCode, { exact: true })).toBeVisible();
});

test('kode promo menjelaskan alasan terbit dan menampilkannya pada konfirmasi', async ({ page }) => {
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [pack] } }));
  await page.route('**/admin/api/vouchers', route => route.fulfill({ json: { vouchers: [], nextBefore: null, outstandingMicro: '0' } }));
  await mount(page, 'admin-vouchers', 'VouchersPage');
  await page.getByLabel(m.voucherKind, { exact: true }).selectOption('PROMO');
  await expect(page.getByLabel(m.promoReasonLabel, { exact: true })).toBeVisible();
  await expect(page.getByText(m.voucherPromoHelp, { exact: true })).toBeVisible();
  await page.getByLabel(m.pack, { exact: true }).selectOption(pack.id);
  await page.getByLabel(m.promoReasonLabel, { exact: true }).fill('Bonus pengguna baru');
  await page.getByRole('button', { name: m.issueVoucher, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: m.issueVoucher });
  await expect(confirmation.getByText(m.voucherPromoHelp, { exact: true })).toBeVisible();
  await expect(confirmation.getByText(m.promoReasonLabel, { exact: true })).toBeVisible();
  await expect(confirmation).toContainText('Bonus pengguna baru');
});

test('undangan tanpa email mengungkapkan tautan server tanpa meluber di 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const writes: Record<string, unknown>[] = [];
  const activationLink = `https://zrouter.example/aktivasi#token=once-only-${'x'.repeat(180)}`;
  await page.route('**/admin/api/customers?*', route => route.fulfill({ json: { customers: [], nextAfter: null } }));
  await page.route('**/admin/api/invites', route => {
    writes.push(route.request().postDataJSON());
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    return route.fulfill({ status: 201, json: { inviteId: 'invite-test', emailSent: false, activationLink } });
  });
  await mount(page, 'admin-customers', 'CustomersPage');
  await page.getByLabel(m.email, { exact: true }).fill('new-customer@example.test');
  await page.getByRole('button', { name: m.inviteCustomer, exact: true }).click();
  await expect(page.getByText(activationLink, { exact: true })).toBeVisible();
  await expect(page.getByText(m.inviteManualDelivery, { exact: true }).first()).toBeVisible();
  const activationText = page.locator('.activation-link');
  expect(await activationText.evaluate(element => getComputedStyle(element).overflowWrap)).toBe('anywhere');
  expect(await activationText.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBeTruthy();
  expect(writes).toEqual([{ email: 'new-customer@example.test' }]);
  expect(page.url()).not.toContain('once-only-');
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

const detailCustomer = { username: 'pelanggan', tenantStatus: 'ACTIVE', version: '4', currency: 'TOKEN', postedMicro: '250000000', heldMicro: '0', availableMicro: '250000000', entries: [] };

test('suspend dan koreksi saldo meminta konfirmasi, step-up, dan mengirim nilai integer mikro-kredit', async ({ page }) => {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/admin/api/customers?*', route => route.fulfill({ json: { customers: [{ username: 'pelanggan', tenantStatus: 'ACTIVE', createdAt: '2026-11-15T00:00:00.000Z', postedMicro: detailCustomer.postedMicro, heldMicro: detailCustomer.heldMicro }], nextAfter: null } }));
  await page.route('**/admin/api/customers/pelanggan/usage?*', route => route.fulfill({ json: { username: 'pelanggan', days: 7, byDay: [], byModel: [], byKey: [], recent: [] } }));
  let tenantStatus = 'ACTIVE';
  await page.route('**/admin/api/customers/pelanggan', route => route.fulfill({ json: { ...detailCustomer, tenantStatus } }));
  let statusRequests = 0;
  let adjustmentRequests = 0;
  await page.route('**/admin/api/customers/pelanggan/suspend', route => {
    statusRequests += 1;
    writes.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    if (statusRequests === 1) return route.fulfill({ status: 403, json: { error: { code: 'step_up_required' } } });
    tenantStatus = 'SUSPENDED';
    return route.fulfill({ status: 200, json: { tenantStatus, version: '5' } });
  });
  await page.route('**/admin/api/adjustments', route => {
    adjustmentRequests += 1;
    writes.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    if (adjustmentRequests === 1) return route.fulfill({ status: 403, json: { error: { code: 'step_up_required' } } });
    return route.fulfill({ status: 201, json: { amountMicro: '-2500000', postedAfterMicro: '247500000', entryId: 'adjustment-test', replayed: false } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'admin-customers', 'CustomersPage');
  await page.getByRole('button', { name: m.customerDetails, exact: true }).click();
  const customerDetail = page.getByRole('region', { name: m.details });
  await expect(customerDetail).not.toContainText(m.adminSuspended);
  await customerDetail.getByRole('button', { name: m.suspendCustomer, exact: true }).click();
  const suspendDialog = page.getByRole('dialog', { name: m.suspendCustomer });
  await suspendDialog.getByLabel(m.reason, { exact: true }).fill('Peninjauan operator');
  await suspendDialog.getByRole('button', { name: m.suspendCustomer, exact: true }).click();
  const stepUpStatus = page.getByRole('dialog', { name: m.stepUp });
  await expect(stepUpStatus).toBeVisible();
  await stepUpStatus.getByLabel(m.code).fill('123456');
  await stepUpStatus.getByRole('button', { name: m.verify }).click();
  await expect(stepUpStatus).not.toBeVisible();
  await expect(customerDetail).toContainText(m.adminSuspended);
  expect(writes[0]).toMatchObject({ path: '/admin/api/customers/pelanggan/suspend', body: { expectedVersion: '4', reason: 'Peninjauan operator' } });
  await page.getByRole('tab', { name: m.balanceTab }).click();
  const adjustmentForm = page.getByRole('heading', { name: m.adjustCustomerBalance, exact: true }).locator('xpath=..');
  await adjustmentForm.getByLabel(m.signedTokenAmount, { exact: true }).fill('-2,5');
  await adjustmentForm.getByLabel(m.reason, { exact: true }).fill('Koreksi uji');
  await adjustmentForm.getByRole('button', { name: m.adjustCustomerBalance, exact: true }).click();
  const adjustmentDialog = page.getByRole('dialog', { name: m.adjustmentConfirm });
  await expect(adjustmentDialog).toBeVisible();
  await expect(adjustmentDialog).toContainText('-2,5');
  await expect(adjustmentDialog).toContainText('Koreksi uji');
  await adjustmentDialog.getByRole('button', { name: m.confirmAdjustment, exact: true }).click();
  const stepUpAdjustment = page.getByRole('dialog', { name: m.stepUp });
  await expect(stepUpAdjustment).toBeVisible();
  await stepUpAdjustment.getByLabel(m.code).fill('123456');
  await stepUpAdjustment.getByRole('button', { name: m.verify }).click();
  await expect(adjustmentDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: m.adjustmentReceipt, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: m.redeemed, exact: true })).toHaveCount(0);
  expect(writes[2].path).toBe('/admin/api/adjustments');
  expect(writes[2].body).toMatchObject({ username: 'pelanggan', amountMicro: '-2500000', reason: 'Koreksi uji' });
  expect(writes[2].body.idempotencyKey).toEqual(expect.any(String));
  expect(writes[2].body).toEqual(writes[3].body);
});


const price = { id: 'price-1', seq: 1, status: 'DRAFT', currency: 'TOKEN', inputRateMicro: '1000000000000', outputRateMicro: '1000000000000', cacheReadRateMicro: '1000000000000', cacheWriteRateMicro: '1000000000000', multiplier: '1', rateAsOf: null, publishedAt: null, retiredAt: null };
const model = { id: 'uji/model', displayName: 'Model uji', version: '2', sellable: false, draft: price, published: null };

test('harga model mengonversi bobot secara eksak lalu preview dan publish memakai versi terbaru', async ({ page }) => {
  let current = model;
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/admin/api/models**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET') return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? current : { models: [current] } });
    const body = route.request().postDataJSON(); requests.push({ path, body });
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    if (path.endsWith('/draft')) { current = { ...current, version: '3', draft: { ...price, ...body } }; return route.fulfill({ json: current }); }
    if (path.endsWith('/preview')) return route.fulfill({ json: { price: current.draft, usage: body.usage, debitMicro: '3750000' } });
    return route.fulfill({ json: { ...current, version: '4', draft: null, published: { ...current.draft, status: 'PUBLISHED' } } });
  });
  await mount(page, 'admin-models', 'ModelsPage');
  await expect(page.getByRole('heading', { name: m.models, exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.details, exact: true }).click();
  await page.getByLabel(m.inputRate, { exact: true }).fill('0,000001');
  await page.getByLabel(m.outputRate, { exact: true }).fill('2');
  await page.getByLabel(m.multiplier, { exact: true }).fill('1,25');
  await page.getByRole('button', { name: m.draft, exact: true }).click();
  await expect(page.getByText(m.success)).toBeVisible();
  expect(requests[0].body).toMatchObject({ id: model.id, expectedVersion: '2', inputRateMicro: '1000000', outputRateMicro: '2000000000000', multiplier: '1.25' });
  await page.getByLabel(m.inputTokens, { exact: true }).fill('3000000');
  await page.getByRole('button', { name: m.preview, exact: true }).click();
  await expect(page.getByText('3,75', { exact: false })).toBeVisible();
  expect(requests[1].body).toMatchObject({ id: model.id, which: 'draft', usage: { input: 3000000, output: 0, cacheRead: 0, cacheWrite: 0 } });
  await page.getByRole('button', { name: m.publish, exact: true }).click();
  expect(requests).toHaveLength(2);
  const confirmation = page.getByRole('dialog', { name: m.publish });
  await expect(confirmation).toContainText(model.id);
  await confirmation.getByLabel(m.reason).fill('Pengujian harga');
  await confirmation.getByRole('button', { name: m.publish }).click();
  await expect(confirmation).not.toBeVisible();
  expect(requests[2].body).toEqual({ id: model.id, expectedVersion: '3', reason: 'Pengujian harga' });
});

test('cabut kode menampilkan rincian sebelum alasan dikirim', async ({ page }) => {
  const revoked: Record<string, unknown>[] = [];
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [pack] } }));
  await page.route('**/admin/api/vouchers**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { vouchers: [voucher], nextBefore: null, outstandingMicro: voucher.amountMicro } });
    revoked.push(route.request().postDataJSON());
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    return route.fulfill({ json: { ...voucher, status: 'REVOKED', closedAt: '2026-11-14T01:00:00.000Z' } });
  });
  await mount(page, 'admin-vouchers', 'VouchersPage');
  await page.getByRole('button', { name: m.revokeVoucher, exact: true }).click();
  expect(revoked).toHaveLength(0);
  const confirmation = page.getByRole('dialog', { name: m.revokeVoucher });
  await expect(confirmation).toContainText(voucher.maskedCode);
  await expect(confirmation).toContainText('100.000.000');
  await confirmation.getByLabel(m.reason).fill('Kode pengganti');
  await confirmation.getByRole('button', { name: m.revokeVoucher }).click();
  await expect.poll(() => revoked).toEqual([{ reason: 'Kode pengganti' }]);
});

test('model dapat diarsipkan dan dipulihkan dengan step-up, daftar arsip dikendalikan filter', async ({ page }) => {
  let current = { ...model, archived: false };
  const reads: string[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route('**/admin/api/models**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      if (url.searchParams.has('id')) return route.fulfill({ json: { ...current, version: '3' } });
      reads.push(url.searchParams.get('includeArchived') ?? '0');
      return route.fulfill({ json: { models: current.archived && url.searchParams.get('includeArchived') !== '1' ? [] : [{ ...current, version: '3' }] } });
    }
    const payload = request.postDataJSON(); writes.push(payload);
    expect(request.headers()['x-router-csrf']).toBe('1');
    if (writes.length % 2 === 1) return route.fulfill({ status: 403, json: { error: { code: 'step_up_required' } } });
    current = { ...current, archived: Boolean(payload.archived), version: String(Number(current.version) + 1) };
    return route.fulfill({ json: current });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'admin-models', 'ModelsPage');
  await expect(page.getByText(model.id, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.archiveModel, exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: m.archiveModel });
  await expect(archiveDialog).toContainText(m.modelArchiveImpact);
  expect(writes).toHaveLength(0);
  await archiveDialog.getByRole('button', { name: m.archiveModel, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(page.getByText(model.id, { exact: true })).toHaveCount(0);
  await page.getByLabel(m.showArchived).click();
  expect(await page.evaluate(() => new URLSearchParams(location.search).get('includeArchived'))).toBe('1');
  await expect(page.getByLabel(m.showArchived)).toBeChecked();
  const archivedRow = page.locator('.data-row').filter({ hasText: model.id });
  await expect(archivedRow.getByRole('button', { name: m.restoreModel, exact: true })).toBeVisible();
  await archivedRow.getByRole('button', { name: m.restoreModel, exact: true }).click();
  const restoreDialog = page.getByRole('dialog', { name: m.restoreModel });
  await expect(restoreDialog).toContainText(m.modelRestoreImpact);
  await restoreDialog.getByRole('button', { name: m.restoreModel, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(page.locator('.data-row').filter({ hasText: model.id })).toBeVisible();
  expect(reads).toContain('1');
  // Each action is refused once for step-up and sent again after it: archive twice, then restore twice.
  await expect.poll(() => writes.length).toBe(4);
  expect(writes).toEqual([
    { id: model.id, archived: true, expectedVersion: '3' },
    { id: model.id, archived: true, expectedVersion: '3' },
    { id: model.id, archived: false, expectedVersion: '3' },
    { id: model.id, archived: false, expectedVersion: '3' },
  ]);
});

test('model yang masih dijual tidak dapat diarsipkan dan memberi tindakan berikutnya', async ({ page }) => {
  const listed = { ...model, version: '3', archived: false, published: { ...price, status: 'PUBLISHED' } };
  let priceRetired = false;
  const archiveMutationCalls: number[] = [];
  const draftMutationCalls: number[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route('**/admin/api/models**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      const data = priceRetired ? { ...listed, published: null, archived: false, draft: { ...price, status: 'DRAFT' } } : listed;
      return route.fulfill({ json: url.searchParams.has('id') ? data : { models: [data] } });
    }
    const payload = route.request().postDataJSON(); writes.push(payload);
    if (payload.archived === true) {
      archiveMutationCalls.push(Date.now());
      if (!priceRetired) return route.fulfill({ status: 409, json: { error: { code: 'model_on_sale' } } });
      return route.fulfill({ json: { ...listed, archived: true } });
    }
    draftMutationCalls.push(Date.now());
    priceRetired = true;
    return route.fulfill({ json: { ...listed, version: '4', published: null, draft: { ...price, status: 'DRAFT' } } });
  });
  await mount(page, 'admin-models', 'ModelsPage');
  await page.getByRole('button', { name: m.archiveModel, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: m.archiveModel });
  await confirmation.getByRole('button', { name: m.archiveModel, exact: true }).click();
  await expect(confirmation.getByText(m.modelOnSale, { exact: true })).toBeVisible();
  await expect(confirmation.getByRole('link', { name: m.retirePriceFirst, exact: true })).toHaveAttribute('href', `/admin/harga?id=${encodeURIComponent(model.id)}`);
  await expect.poll(() => archiveMutationCalls.length).toBe(1);
  expect(writes[0]).toEqual({ id: model.id, archived: true, expectedVersion: '3' });
  await page.getByRole('button', { name: m.cancel, exact: true }).click();
  await page.getByRole('button', { name: m.details, exact: true }).click();
  await page.getByLabel(m.multiplier, { exact: true }).fill('1,1');
  await page.getByRole('button', { name: m.draft, exact: true }).click();
  await expect.poll(() => draftMutationCalls.length).toBe(1);
  priceRetired = true;
  await page.getByRole('button', { name: m.archiveModel, exact: true }).click();
  const eligibleConfirmation = page.getByRole('dialog', { name: m.archiveModel });
  await eligibleConfirmation.getByRole('button', { name: m.archiveModel, exact: true }).click();
  await expect.poll(() => archiveMutationCalls.length).toBe(2);
  expect(writes.at(-1)).toEqual({ id: model.id, archived: true, expectedVersion: '3' });
});

test('tarik harga meminta alasan dan tidak mengirim sebelum konfirmasi', async ({ page }) => {
  const published = { ...price, status: 'PUBLISHED', publishedAt: '2026-11-14T00:00:00.000Z' };
  const listed = { ...model, version: '7', draft: null, published };
  const requests: Record<string, unknown>[] = [];
  await page.route('**/admin/api/models**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? listed : { models: [listed] } });
    requests.push(route.request().postDataJSON());
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    return route.fulfill({ json: { ...listed, version: '8', published: null } });
  });
  await mount(page, 'admin-models', 'ModelsPage');
  await page.getByRole('button', { name: m.details, exact: true }).click();
  await page.getByRole('button', { name: m.retire, exact: true }).click();
  expect(requests).toHaveLength(0);
  const confirmation = page.getByRole('dialog', { name: m.retire });
  await expect(confirmation).toContainText(model.id);
  await confirmation.getByLabel(m.reason).fill('Model dihentikan');
  await confirmation.getByRole('button', { name: m.retire }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests).toEqual([{ id: model.id, expectedVersion: '7', reason: 'Model dihentikan' }]);
});

