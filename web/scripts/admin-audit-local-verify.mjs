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
import { formatCredits } from '../src/credits.ts';
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
const custCloseUsername = 'audit_pelanggan_tutup';
const custPassword = 'local-audit-cust-10';
const modelId = 'audit/stream-model';
const retireModelId = 'audit/retire-model';
const upstreamApiKey = 'sk-audit-mock-upstream-777';

const expectedSummaryLabels = {
  reason: m.auditReason,
  previousReason: m.auditPreviousReason,
  previousStatus: m.auditPreviousStatus,
  nextStatus: m.auditNextStatus,
  amountMicro: m.amount,
  debitMicro: m.adminRequestDebit,
  beforeMicro: m.auditBefore,
  afterMicro: m.auditAfter,
  saleRef: m.saleRef,
  after: m.auditAfter,
  anthropic: m.auditAnthropic,
  before: m.auditBefore,
  chat: m.auditChat,
  displayPriceIdr: m.auditDisplayPriceIdr,
  entryId: m.auditEntryId,
  from: m.auditFrom,
  isPromo: m.auditIsPromo,
  keyReplaced: m.auditKeyReplaced,
  method: m.auditMethod,
  modelId: m.auditModelId,
  multiplier: m.auditMultiplier,
  name: m.auditName,
  previousVersion: m.auditPreviousVersion,
  priority: m.auditPriority,
  recipientBound: m.auditRecipientBound,
  responses: m.auditResponses,
  seq: m.auditSequence,
  tenantId: m.auditTenantId,
  to: m.auditTo,
  tokens: m.auditTokens,
  upstream: m.auditUpstream,
  upstreamModel: m.auditUpstreamModel,
  version: m.auditVersion,
  email: m.email,
  username: m.username,
  kind: m.kind,
  protocol: m.protocol,
  urlChanged: m.auditUrlChanged,
};
const auditStatusKeys = new Set(['previousStatus', 'nextStatus', 'from', 'to']);

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

  // Seed initial balance & key so gateway can place a hold for the UNRESOLVED request
  await withTx(pool, tx => ledger.grantAdminTopup(tx, {
    tenantId: cust.tenantId,
    amount: 500_000n * C,
    saleRef: 'AUDIT-INITIAL-SEED',
    actorUser: adm.userId,
    idemKey: 'audit-initial-seed-1',
  }));
  const seedApiKeySecret = 'rtr_' + newToken();
  await pool.query(
    'insert into api_key(tenant_id, name, prefix, token_hash, creation_key_hash) values($1,$2,$3,$4,$5)',
    [cust.tenantId, 'kunci-audit-seed', seedApiKeySecret.slice(0, 12), tokenHash(seedApiKeySecret), tokenHash('audit-key-seed-1')],
  );

  // Set baseline overdraft = 50 tokens so later admin API change to 125 records beforeMicro=50000000 & afterMicro=125000000
  await withTx(pool, tx => ledger.setOverdraft(tx, { micro: 50n * C, actorUser: adm.userId }));

  // Publish stream model & route on mock upstream to produce one genuine UNRESOLVED request via crash + recoverStuck
  mock = await startHangMockUpstream();
  resetRouteHealth();
  const upHang = (await pool.query(
    'insert into upstream(name, status, base_url_chat, key_enc, key_set_at) values($1,$2,$3,$4,now()) returning id',
    ['audit-hang-upstream', 'ELIGIBLE', `http://127.0.0.1:${mock.port}/v1`, seal(key, Buffer.from(upstreamApiKey))],
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
    [modelId, upHang.id, 'CHAT', 'upstream-audit-hang'],
  );

  // Create one UNRESOLVED request via genuine mid-stream process crash + recoverStuck (emits request.mark_unresolved with empty summary)
  const unresolvedReqId = await spawnAndKillStuckStream({
    schemaName: schema,
    keyHex: key.toString('hex'),
    apiKey: seedApiKeySecret,
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
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
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

  // Admin login + 2FA (emits admin.second_factor with { method })
  await page.goto(`${webBase}/admin/masuk`);
  await page.getByLabel(m.identifier).fill(adminUsername);
  await page.getByLabel(m.password, { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(page.getByLabel(m.code, { exact: true }), 'Form 2FA admin tidak muncul');
  await page.getByLabel(m.code, { exact: true }).fill(await nextTotpCode(totpSeed));
  await page.getByRole('button', { name: m.verify, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Login admin tidak mendarat di Ringkasan Operasi');

  const apiCall = (targetPage, path, body, method = 'POST') => targetPage.evaluate(
    async ({ p, b, meth }) => {
      const res = await fetch(p, {
        method: meth,
        headers: {
          ...(meth !== 'GET' ? { 'content-type': 'application/json', 'x-router-csrf': '1' } : {}),
        },
        ...(meth !== 'GET' ? { body: JSON.stringify(b) } : {}),
      });
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    { p: path, b: body, meth: method },
  );

  // ---- Trigger ALL 28 summary-writing audit actions (all 38 summary keys) via real API endpoints ----
  // 1. Saldo: topup (+25 kredit -> amountMicro, saleRef, entryId) & adjustment (-2,5 kredit -> amountMicro, reason, entryId)
  const topupSaleRef = 'AUDIT-TOPUP-REF-25';
  assert.equal((await apiCall(page, '/admin/api/topups', {
    username: custUsername,
    amountTokens: '25',
    saleRef: topupSaleRef,
    idempotencyKey: 'audit-ui-topup-25-001',
  })).status, 201);
  assert.equal((await apiCall(page, '/admin/api/adjustments', {
    username: custUsername,
    amountMicro: '-2500000',
    reason: 'Koreksi uji rincian audit',
    idempotencyKey: 'audit-ui-adjust-001',
  })).status, 201);

  // 2. Pelanggan: suspend & restore (reason, previousStatus, nextStatus, version)
  const suspendReason = 'Penangguhan uji rincian audit';
  const restoreReason = 'Pemulihan uji rincian audit';
  assert.equal((await apiCall(page, `/admin/api/customers/${encodeURIComponent(custUsername)}/suspend`, {
    expectedVersion: '1',
    reason: suspendReason,
  })).status, 200);
  assert.equal((await apiCall(page, `/admin/api/customers/${encodeURIComponent(custUsername)}/restore`, {
    expectedVersion: '2',
    reason: restoreReason,
  })).status, 200);

  // 3. Batas lebih-pakai: 50 -> 125 kredit (beforeMicro, afterMicro)
  assert.equal((await apiCall(page, '/admin/api/settings/overdraft', { tokens: '125' })).status, 200);

  // 4. Kill switch: pause (reason) & resume (previousReason)
  assert.equal((await apiCall(page, '/admin/api/settings/gateway', { paused: true, reason: 'Jeda uji rincian audit' })).status, 200);
  assert.equal((await apiCall(page, '/admin/api/settings/gateway', { paused: false })).status, 200);

  // 5. Penyelesaian request UNRESOLVED (debitMicro, reason)
  const resolveReason = 'Penyelesaian uji rincian audit';
  assert.equal((await apiCall(page, `/admin/api/requests/${encodeURIComponent(unresolvedReqId)}/resolve`, {
    debitTokens: '3',
    reason: resolveReason,
  })).status, 200);

  // 6. Paket: buat (tokens, displayPriceIdr, isPromo: true -> Ya) & ubah (before, after)
  const packCreate = await apiCall(page, '/admin/api/packs', {
    name: 'Paket Audit Promo',
    tokens: '100',
    displayPriceIdr: '50000',
    isPromo: true,
    active: true,
  });
  assert.equal(packCreate.status, 201, `pack.create gagal: ${JSON.stringify(packCreate)}`);
  const packUpdate = await apiCall(page, `/admin/api/packs/${packCreate.data.id}`, {
    name: 'Paket Audit Diperbarui',
    tokens: '120',
    displayPriceIdr: '60000',
    isPromo: false,
    active: true,
    expectedVersion: packCreate.data.version,
  });
  assert.equal(packUpdate.status, 200, `pack.update gagal: ${JSON.stringify(packUpdate)}`);

  // 7. Voucher: terbit (recipientBound: true -> Ya, dan recipientBound: false -> Tidak), cabut (reason), redeem (amountMicro, tenantId)
  const voucherRedeemable = await apiCall(page, '/admin/api/vouchers', {
    kind: 'SALE',
    tokens: '15',
    saleRef: 'AUDIT-VOUCHER-BOUND-1',
    recipientUsername: custUsername,
    idempotencyKey: 'audit-voucher-bound-1',
  });
  assert.equal(voucherRedeemable.status, 201, `voucher.issue bound gagal: ${JSON.stringify(voucherRedeemable)}`);
  const voucherRevocable = await apiCall(page, '/admin/api/vouchers', {
    kind: 'PROMO',
    tokens: '10',
    saleRef: 'Promo uji cabut audit',
    idempotencyKey: 'audit-voucher-unbound-1',
  });
  assert.equal(voucherRevocable.status, 201, `voucher.issue unbound gagal: ${JSON.stringify(voucherRevocable)}`);
  const voucherRevoke = await apiCall(page, `/admin/api/vouchers/${voucherRevocable.data.voucher.id}/revoke`, {
    reason: 'Cabut voucher uji audit',
  });
  assert.equal(voucherRevoke.status, 200, `voucher.revoke gagal: ${JSON.stringify(voucherRevoke)}`);

  // 8. Model & Harga: create (empty summary), draft_save (multiplier), publish (reason, before, after), retire (reason, seq)
  const modelCreate = await apiCall(page, '/admin/api/models', { id: retireModelId, displayName: 'Audit Retire Model' });
  assert.equal(modelCreate.status, 201, `model.create gagal: ${JSON.stringify(modelCreate)}`);
  const draft1 = await apiCall(page, '/admin/api/models/price/draft', {
    id: retireModelId,
    expectedVersion: modelCreate.data.version,
    multiplier: '1.5',
  });
  assert.equal(draft1.status, 200, `price.draft_save gagal: ${JSON.stringify(draft1)}`);
  const pub1 = await apiCall(page, '/admin/api/models/price/publish', {
    id: retireModelId,
    expectedVersion: draft1.data.version,
    reason: 'Terbit harga uji audit',
  });
  assert.equal(pub1.status, 200, `price.publish gagal: ${JSON.stringify(pub1)}`);
  const ret1 = await apiCall(page, '/admin/api/models/price/retire', {
    id: retireModelId,
    expectedVersion: pub1.data.version,
    reason: 'Pensiun harga uji audit',
  });
  assert.equal(ret1.status, 200, `price.retire gagal: ${JSON.stringify(ret1)}`);

  // 9. Upstream (buat: name/chat/anthropic/responses; ubah: urlChanged & keyReplaced true/false; status: from/to/reason; arsip & pulihkan: name)
  const upCreate = await apiCall(page, '/admin/api/upstreams', {
    name: 'Upstream Audit Lengkap',
    baseUrls: {
      CHAT: 'https://chat.audit.example/v1',
      ANTHROPIC: 'https://anthropic.audit.example',
      RESPONSES: 'https://responses.audit.example/v1',
    },
    apiKey: 'sk-audit-upstream-create-1',
    termsNote: 'Catatan awal upstream audit',
  });
  assert.equal(upCreate.status, 201, `upstream.create gagal: ${JSON.stringify(upCreate)}`);
  // Update without URL/key change -> urlChanged: false (Tidak), keyReplaced: false (Tidak)
  const upUpdateNoUrl = await apiCall(page, `/admin/api/upstreams/${upCreate.data.id}`, {
    name: 'Upstream Audit Lengkap',
    baseUrls: {
      CHAT: 'https://chat.audit.example/v1',
      ANTHROPIC: 'https://anthropic.audit.example',
      RESPONSES: 'https://responses.audit.example/v1',
    },
    termsNote: 'Catatan diperbarui tanpa ganti URL',
    expectedVersion: upCreate.data.version,
  });
  assert.equal(upUpdateNoUrl.status, 200, `upstream.update (no url) gagal: ${JSON.stringify(upUpdateNoUrl)}`);
  // Update WITH URL & key change -> urlChanged: true (Ya), keyReplaced: true (Ya)
  const upUpdateWithUrl = await apiCall(page, `/admin/api/upstreams/${upCreate.data.id}`, {
    name: 'Upstream Audit Lengkap',
    baseUrls: {
      CHAT: 'https://chat2.audit.example/v1',
      ANTHROPIC: 'https://anthropic.audit.example',
      RESPONSES: 'https://responses.audit.example/v1',
    },
    apiKey: 'sk-audit-upstream-replaced-2',
    termsNote: 'URL dan key diganti',
    expectedVersion: upUpdateNoUrl.data.version,
  });
  assert.equal(upUpdateWithUrl.status, 200, `upstream.update (with url) gagal: ${JSON.stringify(upUpdateWithUrl)}`);
  // Status change: PENDING -> ELIGIBLE (from, to, reason)
  const upStatus = await apiCall(page, `/admin/api/upstreams/${upCreate.data.id}/status`, {
    status: 'ELIGIBLE',
    reason: 'Layak untuk uji audit',
    expectedVersion: upUpdateWithUrl.data.version,
  });
  assert.equal(upStatus.status, 200, `upstream.status gagal: ${JSON.stringify(upStatus)}`);

  // 10. Route: buat (modelId, upstream, protocol, upstreamModel, priority) & ubah (before, after)
  const routeCreate = await apiCall(page, '/admin/api/routes', {
    modelId,
    upstreamId: upCreate.data.id,
    protocol: 'CHAT',
    upstreamModel: 'upstream-chat-v1',
    priority: 2,
    enabled: true,
  });
  assert.equal(routeCreate.status, 201, `route.create gagal: ${JSON.stringify(routeCreate)}`);
  const routeUpdate = await apiCall(page, `/admin/api/routes/${routeCreate.data.id}`, {
    upstreamModel: 'upstream-chat-v2',
    priority: 5,
    enabled: false,
    expectedVersion: routeCreate.data.version,
  });
  assert.equal(routeUpdate.status, 200, `route.update gagal: ${JSON.stringify(routeUpdate)}`);

  // Archive & restore upstream (upstream.archive / upstream.restore -> name)
  const upArch = await apiCall(page, `/admin/api/upstreams/${upCreate.data.id}/archive`, {
    archived: true,
    expectedVersion: upStatus.data.version,
  });
  assert.equal(upArch.status, 200, `upstream.archive gagal: ${JSON.stringify(upArch)}`);
  const upRest = await apiCall(page, `/admin/api/upstreams/${upCreate.data.id}/archive`, {
    archived: false,
    expectedVersion: upArch.data.version,
  });
  assert.equal(upRest.status, 200, `upstream.restore gagal: ${JSON.stringify(upRest)}`);

  // 11. Undangan & aktivasi via API (invite.create -> email, invite.accept -> username)
  const invRes = await apiCall(page, '/admin/api/invites', { email: 'audit-close@example.test' });
  assert.equal(invRes.status, 201, `invite.create gagal: ${JSON.stringify(invRes)}`);
  const closeInviteToken = mail.invites.at(-1).token;

  // 12. Aksi pelanggan: API key (buat, ubah, cabut), voucher redeem, dan aktivasi + tutup akun (api_key.revoke account_closed + account.close)
  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custPage = await custCtx.newPage();
  custPage.on('pageerror', err => pageErrors.push(`cust:${err.message}`));
  await custPage.goto(`${webBase}/masuk`);
  await custPage.getByLabel(m.identifier).fill(custUsername);
  await custPage.getByLabel(m.password, { exact: true }).fill(custPassword);
  await custPage.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.home, exact: true }), 'Login pelanggan audit gagal');

  const keyCreate = await apiCall(custPage, '/api/keys', {
    name: 'Key Uji Audit',
    allowedModels: null,
    spendLimitMicro: '10000000',
    expiresAt: null,
    idempotencyKey: 'audit-cust-key-create-1',
  });
  assert.equal(keyCreate.status, 201, `api_key.create gagal: ${JSON.stringify(keyCreate)}`);
  const keyUpdate = await apiCall(custPage, `/api/keys/${keyCreate.data.key.id}/limits`, {
    name: 'Key Uji Audit Diubah',
    allowedModels: null,
    spendLimitMicro: '20000000',
    expiresAt: null,
    expectedVersion: keyCreate.data.key.version,
  });
  assert.equal(keyUpdate.status, 200, `api_key.update gagal: ${JSON.stringify(keyUpdate)}`);
  const keyRevoke = await apiCall(custPage, `/api/keys/${keyCreate.data.key.id}/revoke`, {
    expectedVersion: keyUpdate.data.key.version,
  });
  assert.equal(keyRevoke.status, 200, `api_key.revoke gagal: ${JSON.stringify(keyRevoke)}`);

  const redeemRes = await apiCall(custPage, '/api/redeem', { code: voucherRedeemable.data.code });
  assert.equal(redeemRes.status, 200, `voucher.redeem gagal: ${JSON.stringify(redeemRes)}`);
  await custCtx.close();

  // Pelanggan kedua: aktivasi via /api/auth/activate -> login -> buat key -> tutup akun (/api/account/close)
  const closeCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const closePage = await closeCtx.newPage();
  closePage.on('pageerror', err => pageErrors.push(`closeCust:${err.message}`));
  await closePage.goto(`${webBase}/masuk`);
  const actRes = await apiCall(closePage, '/api/auth/activate', {
    token: closeInviteToken,
    username: custCloseUsername,
    password: custPassword,
  });
  assert.equal(actRes.status, 201, `invite.accept gagal: ${JSON.stringify(actRes)}`);
  await closePage.getByLabel(m.identifier).fill(custCloseUsername);
  await closePage.getByLabel(m.password, { exact: true }).fill(custPassword);
  await closePage.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(closePage.getByRole('heading', { name: m.home, exact: true }), 'Login pelanggan tutup akun gagal');
  const closeKey = await apiCall(closePage, '/api/keys', {
    name: 'Key Sebelum Tutup Akun',
    allowedModels: null,
    spendLimitMicro: null,
    expiresAt: null,
    idempotencyKey: 'audit-close-key-1',
  });
  assert.equal(closeKey.status, 201, `api_key.create (close cust) gagal: ${JSON.stringify(closeKey)}`);
  const closeMe = await apiCall(closePage, '/api/me', undefined, 'GET');
  assert.equal(closeMe.status, 200);
  const closeRes = await apiCall(closePage, '/api/account/close', {
    currentPassword: custPassword,
    confirmUsername: custCloseUsername,
    expectedVersion: closeMe.data.version,
  });
  assert.equal(closeRes.status, 200, `account.close gagal: ${JSON.stringify(closeRes)}`);
  await closeCtx.close();

  // ---- Fetch raw server audit events for ground-truth verification ----
  const rawEventsById = new Map();
  {
    let before = null;
    for (let guard = 0; guard < 20; guard++) {
      const path = `/admin/api/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`;
      const res = await apiCall(page, path, undefined, 'GET');
      assert.equal(res.status, 200, `GET ${path} gagal`);
      for (const ev of res.data.events) rawEventsById.set(ev.id, ev);
      if (!res.data.nextBefore) break;
      before = res.data.nextBefore;
    }
  }

  // ---- Walk ALL pages of /admin/audit in browser, open EVERY "Rincian", verify labels/booleans/micros/statuses ----
  await page.locator('aside.desktop-nav nav').getByRole('link', { name: m.audit, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: m.audit, exact: true }), 'Halaman /admin/audit tidak terbuka');
  await page.waitForFunction(() => document.querySelectorAll('article.data-row').length > 0, null, { timeout: 10_000 });

  const observedSummaryActions = new Set();
  const observedSummaryKeys = new Set();
  let checkedRows = 0;
  let checkedEmptySummaryRows = 0;
  let checkedBooleanYes = 0;
  let checkedBooleanNo = 0;
  let checkedMicroFields = 0;

  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const rowCount = await page.locator('article.data-row').count();
    assert.ok(rowCount > 0, `Halaman audit ke-${pageIndex + 1} tidak boleh kosong`);

    for (let i = 0; i < rowCount; i++) {
      const row = page.locator('article.data-row').nth(i);
      const auditId = (await row.locator('dd.mono').last().innerText()).trim();
      const raw = rawEventsById.get(auditId);
      assert.ok(raw, `Event audit ID ${auditId} tidak ditemukan di jawaban /admin/api/audit`);
      checkedRows++;

      const summaryObj = raw.summary && typeof raw.summary === 'object' && !Array.isArray(raw.summary) ? raw.summary : {};
      const summaryKeys = Object.keys(summaryObj);
      const details = row.locator('details.audit-details');

      if (summaryKeys.length === 0) {
        assert.equal(await details.count(), 0, `Event tanpa ringkasan '${raw.action}' (${auditId}) tidak boleh punya ${m.details}`);
        checkedEmptySummaryRows++;
        continue;
      }

      observedSummaryActions.add(raw.action);
      await expectVisible(details.locator('summary', { hasText: m.details }), `Ringkasan '${m.details}' tidak tampil pada '${raw.action}' (${auditId})`);
      await details.locator('summary').click();
      await expectVisible(details.locator('dl'), `Daftar rincian tidak terbuka pada '${raw.action}' (${auditId})`);

      const renderedEntries = await details.evaluate(el => [...el.querySelectorAll('dl > div')].map(div => ({
        dt: div.querySelector('dt')?.textContent?.trim() ?? '',
        dd: div.querySelector('dd')?.textContent?.trim() ?? '',
      })));

      assert.equal(renderedEntries.length, summaryKeys.length, `Jumlah entri rincian tidak cocok pada '${raw.action}' (${auditId})`);

      for (let kIdx = 0; kIdx < summaryKeys.length; kIdx++) {
        const rawKey = summaryKeys[kIdx];
        const rawVal = summaryObj[rawKey];
        const { dt, dd } = renderedEntries[kIdx];
        observedSummaryKeys.add(rawKey);

        assert.notEqual(dt, rawKey, `Label rincian '${dt}' pada '${raw.action}' tidak boleh sama dengan nama kunci mentah '${rawKey}'`);
        assert.equal(dt, expectedSummaryLabels[rawKey], `Label kunci '${rawKey}' pada '${raw.action}' tidak cocok dengan messages.ts (got '${dt}', expected '${expectedSummaryLabels[rawKey]}')`);

        if (typeof rawVal === 'boolean') {
          const expectedBool = rawVal ? m.auditYes : m.auditNo;
          assert.equal(dd, expectedBool, `Boolean '${rawKey}' pada '${raw.action}' harus tampil '${expectedBool}' (got '${dd}')`);
          if (rawVal) checkedBooleanYes++;
          else checkedBooleanNo++;
        } else if (rawKey.endsWith('Micro') && typeof rawVal === 'string' && /^-?(0|[1-9][0-9]*)$/.test(rawVal)) {
          const expectedCredits = `${formatCredits(rawVal)} ${m.credits}`;
          assert.equal(dd, expectedCredits, `Nilai mikro '${rawKey}' pada '${raw.action}' harus tampil '${expectedCredits}' (got '${dd}')`);
          checkedMicroFields++;
        } else if (typeof rawVal === 'string' && auditStatusKeys.has(rawKey)) {
          const expectedStatus = Object.hasOwn(m.stateText, rawVal) ? m.stateText[rawVal] : statusText[rawVal] ?? rawVal;
          assert.equal(dd, expectedStatus, `Status '${rawKey}=${rawVal}' pada '${raw.action}' harus diterjemahkan ke '${expectedStatus}' (got '${dd}')`);
        }
      }
    }

    const nextBtn = page.locator('nav.pagination').getByRole('button', { name: m.next, exact: true });
    if (await nextBtn.count() === 0) break;
    const prevFirstId = (await page.locator('article.data-row dd.mono').first().innerText()).trim();
    await nextBtn.click();
    await page.waitForFunction(
      oldId => {
        const cur = document.querySelector('article.data-row dd.mono')?.textContent?.trim();
        return Boolean(cur && cur !== oldId);
      },
      prevFirstId,
      { timeout: 10_000 },
    );
  }

  // Verify ALL 38 summary keys & ALL 30 summary-writing action names were exercised and verified in real DOM
  const allExpectedKeys = Object.keys(expectedSummaryLabels).sort();
  const missingKeys = allExpectedKeys.filter(k => !observedSummaryKeys.has(k));
  assert.deepEqual(missingKeys, [], `Masih ada kunci summary server yang belum terverifikasi di DOM: ${missingKeys.join(', ')}`);

  const expectedActionsWithSummary = [
    'account.close',
    'admin.second_factor',
    'api_key.create',
    'api_key.revoke',
    'api_key.update',
    'invite.accept',
    'invite.create',
    'ledger.adjustment',
    'ledger.admin_topup',
    'pack.create',
    'pack.update',
    'price.draft_save',
    'price.publish',
    'price.retire',
    'request.resolve',
    'route.create',
    'route.update',
    'setting.gateway_pause',
    'setting.gateway_resume',
    'setting.overdraft',
    'tenant.restore',
    'tenant.suspend',
    'upstream.archive',
    'upstream.create',
    'upstream.restore',
    'upstream.status',
    'upstream.update',
    'voucher.issue',
    'voucher.redeem',
    'voucher.revoke',
  ];
  const missingActions = expectedActionsWithSummary.filter(a => !observedSummaryActions.has(a));
  assert.deepEqual(missingActions, [], `Masih ada aksi audit bersummary yang belum terverifikasi: ${missingActions.join(', ')}`);

  assert.ok(checkedEmptySummaryRows >= 2, `Minimal 2 event tanpa ringkasan harus diverifikasi (got ${checkedEmptySummaryRows})`);
  assert.ok(checkedBooleanYes >= 3 && checkedBooleanNo >= 3, `Boolean Ya/Tidak harus terverifikasi keduanya (Ya=${checkedBooleanYes}, Tidak=${checkedBooleanNo})`);
  assert.ok(checkedMicroFields >= 5, `Field *Micro harus terverifikasi (got ${checkedMicroFields})`);

  // Secret hygiene check on page URL & storage
  const hygiene = await page.evaluate(() => ({
    href: location.href,
    localLen: localStorage.length,
    sessionLen: sessionStorage.length,
  }));
  assert.equal(hygiene.localLen, 0, 'localStorage harus kosong');
  assert.equal(hygiene.sessionLen, 0, 'sessionStorage harus kosong');
  assert.equal(hygiene.href.includes(seedApiKeySecret), false, 'API key bocor di URL');
  assert.equal(hygiene.href.includes(adm.totpSecretBase32), false, 'TOTP secret bocor di URL');

  await ctx.close();

  assert.deepEqual(pageErrors, [], `Ada pageerror browser: ${pageErrors.join('; ')}`);
  assert.deepEqual(serverErrors, [], `Ada respons >=500: ${serverErrors.join('; ')}`);
  assert.deepEqual(await ledger.invariantViolations(pool), [], 'Ada pelanggaran invariant ledger');

  process.stdout.write(
    `admin-audit-local-verify: PASS (checkedRows=${checkedRows}, actionsWithSummary=${observedSummaryActions.size}/30, summaryKeys=${observedSummaryKeys.size}/38, emptySummaryRows=${checkedEmptySummaryRows}, boolYa=${checkedBooleanYes}, boolTidak=${checkedBooleanNo}, microFields=${checkedMicroFields}, invariantViolations=[])\n`,
  );
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
