import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPool, withTx } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { activateInvite, createInvite } from '../../server/src/identity.ts';
import * as ledger from '../../server/src/ledger.ts';
import * as pricing from '../../server/src/pricing.ts';
import { recoverStuck, resetRouteHealth } from '../../server/src/gateway.ts';
import { newToken, seal, tokenHash, totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';
import { m, ov, statusText } from '../src/messages.ts';

// Child mode: open one streaming request against the shared test schema until the first SSE byte
// arrives (so state='STREAMING' with an active hold consistent with ledger), then stay alive until SIGKILL.
if (process.argv.includes('--child-stuck-stream')) {
  const schema = process.env.STUCK_SCHEMA;
  const keyHex = process.env.STUCK_KEY_HEX;
  const apiKey = process.env.STUCK_API_KEY;
  const modelId = process.env.STUCK_MODEL_ID;
  assert.ok(schema && keyHex && apiKey && modelId, 'Child stuck-stream env missing');

  const url = new URL(DB_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = createPool(url.href, 4);
  const mailer = { invite: async () => {}, passwordReset: async () => {} };
  const app = await buildApp({
    db: pool,
    key: Buffer.from(keyHex, 'hex'),
    mailer,
    secureCookies: false,
    resolveHost: async () => ['93.184.216.34'],
    gateway: {
      unsafeAllowAnyUpstreamUrl: true,
      firstByteTimeoutMs: 5_000,
      idleTimeoutMs: 60_000,
      requestsPerMinutePerKey: 1000,
      concurrentPerTenant: 50,
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelId, stream: true, max_tokens: 32, messages: [{ role: 'user', content: 'audit stuck probe' }] }),
  });
  assert.equal(res.status, 200, `Child stuck stream unexpected HTTP ${res.status}`);
  const reqId = res.headers.get('x-request-id');
  assert.ok(reqId, 'Child stuck stream missing x-request-id');
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false, 'Child stuck stream closed before first chunk');
  process.stdout.write(`STUCK_READY:${reqId}\n`);
  await new Promise(() => {});
}

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_admin_audit_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const C = 1_000_000n;

const adminUsername = 'admin_audit_verify';
const adminPassword = 'local-admin-audit-14';
const custUsername = 'audit_pelanggan_1';
const custPassword = 'local-audit-cust-10';
const modelId = 'audit/stream-model';
const upstreamApiKey = 'sk-audit-mock-upstream-777';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of value) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) throw new Error(`Karakter base32 tidak valid: ${char}`);
    buffer = (buffer << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function expectVisible(locator, message, timeout = 10_000) {
  return locator.waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(message);
  });
}

async function waitFor(url) {
  let last;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(`Server tidak siap: ${url} ${last instanceof Error ? last.message : ''}`);
}

let lastTotpStep = -1n;
async function nextTotpCode(seed) {
  for (;;) {
    const cur = totpStep(Date.now());
    const candidate = lastTotpStep + 1n > cur - 1n ? lastTotpStep + 1n : cur - 1n;
    if (candidate <= cur + 1n) {
      lastTotpStep = candidate;
      return totpAt(seed, candidate);
    }
    const remaining = 30_000 - (Date.now() % 30_000);
    await delay(remaining + 250);
  }
}

function startHangMockUpstream() {
  const openHangResponses = new Set();
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    void raw;
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      assert.equal(req.headers.authorization, `Bearer ${upstreamApiKey}`, 'Auth header upstream tidak cocok');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'potongan awal audit' } }] })}\n\n`);
      openHangResponses.add(res);
      res.on('close', () => openHangResponses.delete(res));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        port: typeof addr === 'object' && addr ? addr.port : 0,
        closeHangs: () => {
          for (const r of openHangResponses) r.destroy();
          openHangResponses.clear();
        },
      });
    });
  });
}

async function spawnAndKillStuckStream({ schemaName, keyHex, apiKey, targetModel }) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child-stuck-stream'], {
    env: {
      ...process.env,
      STUCK_SCHEMA: schemaName,
      STUCK_KEY_HEX: keyHex,
      STUCK_API_KEY: apiKey,
      STUCK_MODEL_ID: targetModel,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrBuf = '';
  child.stderr.on('data', chunk => { stderrBuf += String(chunk); });
  const requestId = await new Promise((resolve, reject) => {
    let stdoutBuf = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timeout menunggu child stuck stream: ${stderrBuf}`));
    }, 15_000);
    child.stdout.on('data', chunk => {
      stdoutBuf += String(chunk);
      const match = stdoutBuf.match(/STUCK_READY:(req_[0-9a-f-]{36})/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Child stuck stream keluar terlalu cepat (code=${code}): ${stderrBuf}`));
    });
  });
  const exited = new Promise(resolve => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
  return requestId;
}

const root = createPool(DB_URL, 2);
let pool;
let app;
let vite;
let browser;
let mock;

try {
  await root.query(`create schema "${schema}"`);
  const schemaUrl = new URL(DB_URL);
  schemaUrl.searchParams.set('options', `-c search_path=${schema}`);
  pool = createPool(schemaUrl.href, 12);
  await migrate(pool);

  const mail = { invites: [] };
  const mailer = {
    invite: async (to, token) => { mail.invites.push({ to, token }); },
    passwordReset: async () => {},
  };

  const adm = await bootstrapAdmin(pool, key, {
    username: adminUsername,
    email: 'admin-audit@example.test',
    password: adminPassword,
  });
  const totpSeed = base32Decode(adm.totpSecretBase32);

  await createInvite(pool, { email: 'audit-cust@example.test', adminUser: adm.userId }, mailer);
  const cust = await activateInvite(pool, { token: mail.invites.at(-1).token, username: custUsername, password: custPassword });

  // Seed initial balance for customer so gateway can place a hold, plus an API key
  await withTx(pool, tx => ledger.grantAdminTopup(tx, {
    tenantId: cust.tenantId,
    amount: 500_000n * C,
    saleRef: 'AUDIT-INITIAL-SEED',
    actorUser: adm.userId,
    idemKey: 'audit-initial-seed-1',
  }));
  const apiKeySecret = 'rtr_' + newToken();
  await pool.query(
    'insert into api_key(tenant_id, name, prefix, token_hash, creation_key_hash) values($1,$2,$3,$4,$5)',
    [cust.tenantId, 'kunci-audit', apiKeySecret.slice(0, 12), tokenHash(apiKeySecret), tokenHash('audit-key-seed-1')],
  );

  // Set baseline overdraft = 50 tokens so later admin API change to 125 records beforeMicro=50000000 & afterMicro=125000000
  await withTx(pool, tx => ledger.setOverdraft(tx, { micro: 50n * C, actorUser: adm.userId }));

  // Publish model & route on mock upstream to produce one genuine UNRESOLVED request via crash + recoverStuck
  mock = await startHangMockUpstream();
  resetRouteHealth();
  const up = (await pool.query(
    'insert into upstream(name, status, base_url_chat, key_enc, key_set_at) values($1,$2,$3,$4,now()) returning id',
    ['audit-verify-upstream', 'ELIGIBLE', `http://127.0.0.1:${mock.port}/v1`, seal(key, Buffer.from(upstreamApiKey))],
  )).rows[0];
  const createdModel = await pricing.createModel(pool, { id: modelId, displayName: 'Audit Stream Model', actorUser: adm.userId });
  const draftedModel = await pricing.saveDraft(pool, {
    id: modelId,
    expectedVersion: createdModel.version,
    price: pricing.priceInput({ multiplier: '1' }),
    actorUser: adm.userId,
  });
  await pricing.publish(pool, {
    id: modelId,
    expectedVersion: draftedModel.version,
    reason: 'Harga awal uji audit',
    actorUser: adm.userId,
  });
  await pool.query(
    'insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,1)',
    [modelId, up.id, 'CHAT', 'upstream-audit-hang'],
  );

  // Create one UNRESOLVED request via genuine mid-stream process crash + recoverStuck (also emits request.mark_unresolved with empty summary)
  const unresolvedReqId = await spawnAndKillStuckStream({
    schemaName: schema,
    keyHex: key.toString('hex'),
    apiKey: apiKeySecret,
    targetModel: modelId,
  });
  mock.closeHangs();
  await delay(60);
  const rec = await recoverStuck(pool, 0);
  assert.equal(rec.unresolved, 1, `recoverStuck harus menandai 1 request UNRESOLVED (got ${JSON.stringify(rec)})`);

  app = await buildApp({
    db: pool,
    key,
    mailer,
    secureCookies: false,
    resolveHost: async () => ['93.184.216.34'],
    gateway: { unsafeAllowAnyUpstreamUrl: true },
  });
  await app.listen({ host: '127.0.0.1', port: apiPort });

  vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    {
      cwd: process.cwd(),
      env: { ...process.env, ROUTER_API_TARGET: apiBase, WEB_PORT: String(webPort) },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  vite.stderr.on('data', chunk => { process.stderr.write(`vite:${String(chunk)}`); });
  await waitFor(`${webBase}/`);

  browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    headless: true,
    args: ['--no-proxy-server'],
  });

  // Warmup Vite pre-bundling
  {
    const warmCtx = await browser.newContext();
    const warmPage = await warmCtx.newPage();
    await warmPage.goto(`${webBase}/admin/masuk`);
    await expectVisible(warmPage.getByRole('heading', { name: m.adminLogin, exact: true }), 'Warmup Vite /admin/masuk gagal', 25_000);
    await warmCtx.close();
  }

  const pageErrors = [];
  const serverErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', res => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
  });

  // Admin login + 2FA
  await page.goto(`${webBase}/admin/masuk`);
  await page.getByLabel(m.identifier).fill(adminUsername);
  await page.getByLabel(m.password, { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(page.getByLabel(m.code, { exact: true }), 'Form 2FA admin tidak muncul');
  await page.getByLabel(m.code, { exact: true }).fill(await nextTotpCode(totpSeed));
  await page.getByRole('button', { name: m.verify, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Login admin tidak mendarat di Ringkasan Operasi');

  // Execute the target admin actions through real authenticated admin API endpoints (within fresh step-up window)
  const topupSaleRef = 'AUDIT-TOPUP-REF-25';
  const suspendReason = 'Penangguhan uji rincian audit';
  const restoreReason = 'Pemulihan uji rincian audit';
  const resolveReason = 'Penyelesaian uji rincian audit';

  const apiCall = (path, body) => page.evaluate(
    async ({ p, b }) => {
      const res = await fetch(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-router-csrf': '1' },
        body: JSON.stringify(b),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    { p: path, b: body },
  );

  // 1. Tambah saldo: +25 kredit token (amountMicro=25000000, saleRef=AUDIT-TOPUP-REF-25)
  const topupRes = await apiCall('/admin/api/topups', {
    username: custUsername,
    amountTokens: '25',
    saleRef: topupSaleRef,
    idempotencyKey: 'audit-ui-topup-25-001',
  });
  assert.equal(topupRes.status, 201, `POST /admin/api/topups gagal: ${JSON.stringify(topupRes)}`);

  // 2. Tangguhkan & pulihkan pelanggan (reason, previousStatus, nextStatus)
  const suspRes = await apiCall(`/admin/api/customers/${encodeURIComponent(custUsername)}/suspend`, {
    expectedVersion: '1',
    reason: suspendReason,
  });
  assert.equal(suspRes.status, 200, `POST suspend gagal: ${JSON.stringify(suspRes)}`);

  const restRes = await apiCall(`/admin/api/customers/${encodeURIComponent(custUsername)}/restore`, {
    expectedVersion: '2',
    reason: restoreReason,
  });
  assert.equal(restRes.status, 200, `POST restore gagal: ${JSON.stringify(restRes)}`);

  // 3. Ubah batas lebih-pakai: 50 -> 125 kredit token (beforeMicro=50000000, afterMicro=125000000)
  const odRes = await apiCall('/admin/api/settings/overdraft', { tokens: '125' });
  assert.equal(odRes.status, 200, `POST /admin/api/settings/overdraft gagal: ${JSON.stringify(odRes)}`);

  // 4. Selesaikan request UNRESOLVED: 3 kredit token (debitMicro=3000000, reason)
  const resolveRes = await apiCall(`/admin/api/requests/${encodeURIComponent(unresolvedReqId)}/resolve`, {
    debitTokens: '3',
    reason: resolveReason,
  });
  assert.equal(resolveRes.status, 200, `POST resolve request gagal: ${JSON.stringify(resolveRes)}`);

  // Open /admin/audit and inspect "Rincian" for every event
  await page.locator('aside.desktop-nav nav').getByRole('link', { name: m.audit, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: m.audit, exact: true }), 'Halaman /admin/audit tidak terbuka');
  await page.waitForFunction(() => document.querySelectorAll('article.data-row').length >= 10, null, { timeout: 10_000 });

  async function openAndReadDetails(rowLocator, label) {
    await expectVisible(rowLocator, `Baris audit '${label}' tidak tampil`);
    const details = rowLocator.locator('details.audit-details');
    await expectVisible(details.locator('summary', { hasText: m.details }), `Ringkasan '${m.details}' tidak tampil pada '${label}'`);
    await details.locator('summary').click();
    await expectVisible(details.locator('dl'), `Daftar rincian tidak terbuka pada '${label}'`);
    return details.evaluate(el => {
      const pairs = [];
      for (const div of el.querySelectorAll('dl > div')) {
        const dt = div.querySelector('dt')?.textContent?.trim() ?? '';
        const dd = div.querySelector('dd')?.textContent?.trim() ?? '';
        pairs.push([dt, dd]);
      }
      return Object.fromEntries(pairs);
    });
  }

  // Verify ledger.admin_topup (newest topup with saleRef = topupSaleRef)
  const topupRow = page.locator('article.data-row')
    .filter({ has: page.locator('h2', { hasText: m.auditActionText['ledger.admin_topup'] }) })
    .first();
  const topupDetails = await openAndReadDetails(topupRow, 'ledger.admin_topup');
  assert.equal(topupDetails[m.amount], `25 ${m.credits}`, `Nilai ${m.amount} topup tidak cocok: ${JSON.stringify(topupDetails)}`);
  assert.equal(topupDetails[m.saleRef], topupSaleRef, `Nilai ${m.saleRef} topup tidak cocok: ${JSON.stringify(topupDetails)}`);

  // Verify tenant.suspend
  const suspendRow = page.locator('article.data-row')
    .filter({ has: page.locator('h2', { hasText: m.auditActionText['tenant.suspend'] }) })
    .first();
  const suspendDetails = await openAndReadDetails(suspendRow, 'tenant.suspend');
  assert.equal(suspendDetails[m.auditReason], suspendReason, `Alasan suspend tidak cocok: ${JSON.stringify(suspendDetails)}`);
  assert.equal(suspendDetails[m.auditPreviousStatus], m.stateText.ACTIVE, `previousStatus suspend harus '${m.stateText.ACTIVE}': ${JSON.stringify(suspendDetails)}`);
  assert.equal(suspendDetails[m.auditNextStatus], statusText.SUSPENDED, `nextStatus suspend harus '${statusText.SUSPENDED}': ${JSON.stringify(suspendDetails)}`);

  // Verify tenant.restore
  const restoreRow = page.locator('article.data-row')
    .filter({ has: page.locator('h2', { hasText: m.auditActionText['tenant.restore'] }) })
    .first();
  const restoreDetails = await openAndReadDetails(restoreRow, 'tenant.restore');
  assert.equal(restoreDetails[m.auditReason], restoreReason, `Alasan restore tidak cocok: ${JSON.stringify(restoreDetails)}`);
  assert.equal(restoreDetails[m.auditPreviousStatus], statusText.SUSPENDED, `previousStatus restore harus '${statusText.SUSPENDED}': ${JSON.stringify(restoreDetails)}`);
  assert.equal(restoreDetails[m.auditNextStatus], m.stateText.ACTIVE, `nextStatus restore harus '${m.stateText.ACTIVE}': ${JSON.stringify(restoreDetails)}`);

  // Verify setting.overdraft (newest: 50 -> 125)
  const overdraftRow = page.locator('article.data-row')
    .filter({ has: page.locator('h2', { hasText: m.auditActionText['setting.overdraft'] }) })
    .first();
  const overdraftDetails = await openAndReadDetails(overdraftRow, 'setting.overdraft');
  assert.equal(overdraftDetails[m.auditBefore], `50 ${m.credits}`, `Nilai ${m.auditBefore} overdraft tidak cocok: ${JSON.stringify(overdraftDetails)}`);
  assert.equal(overdraftDetails[m.auditAfter], `125 ${m.credits}`, `Nilai ${m.auditAfter} overdraft tidak cocok: ${JSON.stringify(overdraftDetails)}`);

  // Verify request.resolve (debitMicro=3000000 -> 3 kredit token, reason)
  const resolveRow = page.locator('article.data-row')
    .filter({ has: page.locator('h2', { hasText: m.auditActionText['request.resolve'] }) })
    .first();
  const resolveDetails = await openAndReadDetails(resolveRow, 'request.resolve');
  assert.equal(resolveDetails[m.adminRequestDebit], `3 ${m.credits}`, `Nilai ${m.adminRequestDebit} resolve tidak cocok: ${JSON.stringify(resolveDetails)}`);
  assert.equal(resolveDetails[m.auditReason], resolveReason, `Alasan resolve tidak cocok: ${JSON.stringify(resolveDetails)}`);

  // Verify events without summary have NO "Rincian" (<details class="audit-details">)
  for (const emptyAction of ['request.mark_unresolved', 'admin.bootstrap']) {
    const emptyRow = page.locator('article.data-row')
      .filter({ has: page.locator('h2', { hasText: m.auditActionText[emptyAction] }) })
      .first();
    await expectVisible(emptyRow, `Baris event tanpa ringkasan '${emptyAction}' tidak tampil`);
    assert.equal(await emptyRow.locator('details.audit-details').count(), 0, `Event tanpa ringkasan '${emptyAction}' tidak boleh memiliki ${m.details}`);
  }

  // Secret hygiene check on page URL & storage
  const hygiene = await page.evaluate(() => ({
    href: location.href,
    localLen: localStorage.length,
    sessionLen: sessionStorage.length,
  }));
  assert.equal(hygiene.localLen, 0, 'localStorage harus kosong');
  assert.equal(hygiene.sessionLen, 0, 'sessionStorage harus kosong');
  assert.equal(hygiene.href.includes(apiKeySecret), false, 'API key bocor di URL');
  assert.equal(hygiene.href.includes(adm.totpSecretBase32), false, 'TOTP secret bocor di URL');

  await ctx.close();

  assert.deepEqual(pageErrors, [], `Ada pageerror browser: ${pageErrors.join('; ')}`);
  assert.deepEqual(serverErrors, [], `Ada respons >=500: ${serverErrors.join('; ')}`);
  assert.deepEqual(await ledger.invariantViolations(pool), [], 'Ada pelanggaran invariant ledger');

  process.stdout.write('admin-audit-local-verify: PASS (topup/suspend/restore/overdraft/resolve details, micro formatting, status labels, empty summary without Rincian, invariantViolations=[])\n');
} finally {
  mock?.closeHangs();
  mock?.server.closeAllConnections();
  mock?.server.close();
  await browser?.close().catch(() => {});
  vite?.kill('SIGTERM');
  await app?.close().catch(() => {});
  if (pool) await pool.end().catch(() => {});
  await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
  await root.end().catch(() => {});
}
