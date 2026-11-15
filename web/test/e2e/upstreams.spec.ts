import { test, expect, type Page } from '@playwright/test';
import { m } from '../../src/messages.ts';

async function mount(page: Page, module: string, name: string) {
  const hooks = await (await page.request.get('/src/hooks.tsx')).text();
  const app = await (await page.request.get('/src/app.tsx')).text();
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
    const modules = await import('/src/${module}.tsx');
    const Component = modules.${name};
    if (!${JSON.stringify(app.includes("/admin/upstream") && app.includes("UpstreamsPage") )}) throw new Error('upstream route is not registered');
    const html = await (await fetch('/')).text();
    if (!html.includes('/src/bootstrap.ts')) throw new Error('SPA entry point missing');
    createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider, {client: new QueryClient({defaultOptions:{queries:{retry:false}}})}, React.createElement(BrowserRouter, null, React.createElement(Component))));
  ` });
}

const upstream = { id: '11111111-1111-4111-8111-111111111111', name: 'Router hulu uji', status: 'PENDING', archived: false, baseUrls: { CHAT: 'https://chat.example.test/v1', ANTHROPIC: null, RESPONSES: null }, keySet: true, keySetAt: '2026-11-14T01:00:00.000Z', termsNote: 'Catatan yang sudah tersimpan.', version: '4' };
const model = { id: 'vendor/model', displayName: 'Model uji', version: '3', sellable: false, published: null, draft: null };

test('upstream tidak memuat ulang key dan penggantian URL meminta key baru, version dan step-up', async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  let current = upstream;
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/admin/api/models', route => route.fulfill({ json: { models: [model] } }));
  await page.route('**/admin/api/routes**', route => route.fulfill({ json: { routes: [] } }));
  await page.route('**/admin/api/upstreams', route => route.fulfill({ json: { upstreams: [current] } }));
  await page.route(`**/admin/api/upstreams/${upstream.id}`, route => {
    const payload = route.request().postDataJSON(); writes.push(payload);
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    current = { ...current, name: payload.name, baseUrls: payload.baseUrls, termsNote: payload.termsNote, keySet: true, version: '5' };
    return writes.length === 1 ? route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } }) : route.fulfill({ json: current });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'admin-upstreams', 'UpstreamsPage');
  await expect(page.getByRole('heading', { name: m.upstreams, exact: true })).toBeVisible();
  await expect(page.getByText('Menunggu tinjauan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: m.edit, exact: true }).click();
  const upstreamForm = page.getByRole('dialog', { name: m.editUpstream });
  await expect(upstreamForm.locator('input[type="password"]')).toHaveValue('');
  await upstreamForm.getByLabel('Base URL CHAT').fill('https://new-chat.example.test/v1');
  await upstreamForm.locator('input[type="password"]').fill('synthetic-key-value-only');
  await upstreamForm.getByLabel(m.termsNote).fill('Kebijakan retensi dicatat.');
  await upstreamForm.getByLabel(m.reason).fill('Mengganti endpoint yang disetujui.');
  await upstreamForm.getByRole('button', { name: m.save, exact: true }).click();
  await expect(page.getByRole('dialog', { name: m.stepUp })).toBeVisible();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(upstreamForm).toHaveCount(0);
  await expect(page.getByText('https://new-chat.example.test/v1', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0]).toMatchObject({ expectedVersion: '4', apiKey: 'synthetic-key-value-only', baseUrls: { CHAT: 'https://new-chat.example.test/v1' } });
  await expect(page.getByText('synthetic-key-value-only', { exact: true })).toHaveCount(0);
});

test('route membatasi protokol ke yang ditawarkan dan menahan POST sampai step-up', async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route('**/admin/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await page.route('**/admin/api/models', route => route.fulfill({ json: { models: [model] } }));
  await page.route('**/admin/api/upstreams', route => route.fulfill({ json: { upstreams: [upstream] } }));
  await page.route('**/admin/api/routes**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { routes: [] } });
    writes.push(route.request().postDataJSON());
    expect(route.request().headers()['x-router-csrf']).toBe('1');
    return writes.length === 1 ? route.fulfill({ status: 403, json: { error: { code: 'step_up_required' } } }) : route.fulfill({ status: 201, json: { id: 'route-1', ...writes[0], version: '1' } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'admin-upstreams', 'UpstreamsPage');
  await page.getByRole('button', { name: m.createRoute, exact: true }).click();
  const routeForm = page.getByRole('dialog', { name: m.createRoute });
  const modelSelect = routeForm.locator('#route-model');
  await modelSelect.selectOption(model.id);
  const upstreamSelect = routeForm.locator('#route-upstream');
  await upstreamSelect.selectOption(upstream.id);
  const protocols = await routeForm.getByLabel(m.protocol).locator('option').allTextContents();
  expect(protocols).toEqual(['CHAT']);
  await routeForm.getByLabel(m.upstreamModel).fill('provider/model');
  await routeForm.getByRole('button', { name: m.createRoute, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(routeForm).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0]).toMatchObject({ modelId: model.id, upstreamId: upstream.id, protocol: 'CHAT', upstreamModel: 'provider/model' });
});

test('daftar model upstream diminta eksplisit, dapat dipilih, dan ID manual tetap diterima', async ({ page }) => {
  const fetches: string[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route('**/admin/api/models**', route => route.fulfill({ json: { models: [model] } }));
  await page.route('**/admin/api/upstreams**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/models')) {
      fetches.push(url.searchParams.get('protocol') ?? '');
      return route.fulfill({ json: { upstreamId: upstream.id, protocol: 'CHAT', models: ['provider/model-a', 'provider/model-b'] } });
    }
    return route.fulfill({ json: { upstreams: [upstream] } });
  });
  await page.route('**/admin/api/routes**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { routes: [] } });
    writes.push(route.request().postDataJSON());
    return writes.length === 1 ? route.fulfill({ status: 403, json: { error: { code: 'step_up_required' } } }) : route.fulfill({ status: 201, json: { id: 'route-1', ...writes[0], version: '1' } });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'admin-upstreams', 'UpstreamsPage');
  await page.getByRole('button', { name: m.createRoute, exact: true }).click();
  const routeForm = page.getByRole('dialog', { name: m.createRoute });
  await routeForm.locator('#route-model').selectOption(model.id);
  await routeForm.locator('#route-upstream').selectOption(upstream.id);
  await expect(routeForm.getByLabel(m.upstreamModel)).toHaveValue('');
  await expect.poll(() => fetches).toHaveLength(0);
  await routeForm.getByRole('button', { name: 'Ambil daftar dari upstream', exact: true }).click();
  await expect.poll(() => fetches).toEqual(['CHAT']);
  await expect(routeForm.locator('#route-upstream-model-options option')).toHaveCount(2);
  await expect(routeForm.getByRole('link', { name: m.modelPriceLink, exact: true })).toHaveAttribute('href', '/admin/harga');
  await routeForm.getByLabel(m.upstreamModel).fill('manual/custom-model');
  await routeForm.getByRole('button', { name: m.createRoute, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0]).toMatchObject({ modelId: model.id, upstreamId: upstream.id, protocol: 'CHAT', upstreamModel: 'manual/custom-model' });
});

test('kegagalan daftar model upstream menjelaskan bahwa ID dapat diketik manual', async ({ page }) => {
  await page.route('**/admin/api/models**', route => route.fulfill({ json: { models: [model] } }));
  await page.route('**/admin/api/upstreams**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/models')) return route.fulfill({ status: 502, json: { error: { code: 'upstream_models_unavailable' } } });
    return route.fulfill({ json: { upstreams: [upstream] } });
  });
  await page.route('**/admin/api/routes**', route => route.fulfill({ json: { routes: [] } }));
  await mount(page, 'admin-upstreams', 'UpstreamsPage');
  await page.getByRole('button', { name: m.createRoute, exact: true }).click();
  const routeForm = page.getByRole('dialog', { name: m.createRoute });
  await routeForm.locator('#route-model').selectOption(model.id);
  await routeForm.locator('#route-upstream').selectOption(upstream.id);
  await routeForm.getByRole('button', { name: 'Ambil daftar dari upstream', exact: true }).click();
  await expect(routeForm.getByText(m.upstreamModelsUnavailable, { exact: true })).toBeVisible();
  const modelField = routeForm.getByLabel(m.upstreamModel);
  await modelField.fill('manual/model-after-error');
  await expect(modelField).toHaveValue('manual/model-after-error');
});

test('upstream dapat diarsipkan dan dipulihkan dengan step-up serta filter arsip', async ({ page }) => {
  let current = { ...upstream, archived: false };
  const reads: string[] = [];
  const writes: Record<string, unknown>[] = [];
  await page.route('**/admin/api/models**', route => route.fulfill({ json: { models: [{ ...model, version: '3' }] } }));
  await page.route('**/admin/api/routes**', route => route.fulfill({ json: { routes: [] } }));
  await page.route('**/admin/api/upstreams**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      reads.push(url.searchParams.get('includeArchived') ?? '0');
      const selectedUpstream = { ...current, archived: current.archived, version: current.archived ? '5' : '4' };
      return route.fulfill({ json: { upstreams: current.archived && url.searchParams.get('includeArchived') !== '1' ? [] : [selectedUpstream] } });
    }
    writes.push(request.postDataJSON());
    if (writes.length % 2 === 1) return route.fulfill({ status: 403, json: { error: { code: 'step_up_required' } } });
    current = { ...current, archived: Boolean(writes.at(-1)?.archived), status: writes.at(-1)?.archived ? 'BLOCKED' : current.status, version: String(Number(current.version) + 1) };
    return route.fulfill({ json: current });
  });
  await page.route('**/admin/api/second-factor', route => route.fulfill({ json: { ok: true } }));
  await mount(page, 'admin-upstreams', 'UpstreamsPage');
  const row = page.locator('.upstream-row').filter({ hasText: upstream.name });
  await row.getByRole('button', { name: m.archiveUpstream, exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: m.archiveUpstream });
  await expect(archiveDialog).toContainText(m.upstreamArchiveImpact);
  expect(writes).toHaveLength(0);
  await archiveDialog.getByRole('button', { name: m.archiveUpstream, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(page.getByRole('heading', { name: upstream.name, exact: true })).toHaveCount(0);
  await page.getByLabel(m.showArchived).click();
  expect(await page.evaluate(() => new URLSearchParams(location.search).get('includeArchived'))).toBe('1');
  await expect(page.getByLabel(m.showArchived)).toBeChecked();
  const archivedRow = page.locator('.upstream-row').filter({ hasText: upstream.name });
  await expect(archivedRow.getByRole('button', { name: m.restoreUpstream, exact: true })).toBeVisible();
  await archivedRow.getByRole('button', { name: m.restoreUpstream, exact: true }).click();
  const restoreDialog = page.getByRole('dialog', { name: m.restoreUpstream });
  await expect(restoreDialog).toContainText(m.upstreamRestoreImpact);
  await restoreDialog.getByRole('button', { name: m.restoreUpstream, exact: true }).click();
  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify }).click();
  await expect(page.getByRole('heading', { name: upstream.name, exact: true })).toBeVisible();
  expect(reads).toContain('1');
  expect(writes).toEqual([
    { archived: true, expectedVersion: '4' },
    { archived: true, expectedVersion: '4' },
    { archived: false, expectedVersion: '5' },
    { archived: false, expectedVersion: '5' },
  ]);
});
