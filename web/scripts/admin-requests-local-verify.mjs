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

// Child mode: start a short-lived gateway process on the shared test schema, open one streaming
// request, wait until the first SSE byte is delivered (so state='STREAMING' with an active hold),
// signal readiness to the parent, and stay alive until the parent kills us with SIGKILL.
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
    body: JSON.stringify({ model: modelId, stream: true, max_tokens: 32, messages: [{ role: 'user', content: 'stuck stream probe' }] }),
  });
  assert.equal(res.status, 200, `Child stuck stream unexpected HTTP ${res.status}`);
  const reqId = res.headers.get('x-request-id');
  assert.ok(reqId, 'Child stuck stream missing x-request-id');
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false, 'Child stuck stream closed before first chunk');
  process.stdout.write(`STUCK_READY:${reqId}\n`);
  // Stay open until parent sends SIGKILL to simulate a mid-stream process crash.
  await new Promise(() => {});
}

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_admin_req_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const C = 1_000_000n;

const adminUsername = 'admin_req_verify';
const adminPassword = 'local-admin-req-14';
const custAUsername = 'req_pelanggan_a';
const custBUsername = 'req_pelanggan_b';
const custPassword = 'local-req-cust-10';
const modelAlpha = 'req/alpha';
const modelBeta = 'req/beta';
const upstreamApiKey = 'sk-req-mock-upstream-888';
const promptMarker = 'REQ_VERIFY_SECRET_PROMPT_MARKER';
const consoleLogs = [];

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

async function safeTotpStep() {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 4_500) await delay(remaining + 300);
  return totpStep(Date.now());
}

function attachListeners(page, tag, pageErrors, serverErrors) {
  page.on('pageerror', err => pageErrors.push(`${tag}:${err.message}`));
  page.on('console', msg => {
    const line = `${tag}:${msg.type()}:${msg.text()}`;
    consoleLogs.push(line);
    process.stderr.write(`${line}\n`);
  });
  page.on('response', res => {
    const path = new URL(res.url()).pathname;
    if (res.status() >= 500) serverErrors.push(`${tag}:${res.status()}:${path}`);
    if (path.startsWith('/api/') || path.startsWith('/admin/api/')) {
      process.stderr.write(`${tag}:api:${res.status()}:${path}\n`);
    }
  });
}

async function assertCleanSecretHygiene(page, secrets, label) {
  const state = await page.evaluate(() => ({
    href: location.href,
    hash: location.hash,
    localStorageEntries: Object.entries(localStorage),
    sessionStorageEntries: Object.entries(sessionStorage),
  }));
  assert.equal(state.localStorageEntries.length, 0, `${label}: localStorage tidak kosong`);
  assert.equal(state.sessionStorageEntries.length, 0, `${label}: sessionStorage tidak kosong`);
  assert.equal(state.hash, '', `${label}: fragment URL tidak kosong`);
  const storageDump = JSON.stringify([state.localStorageEntries, state.sessionStorageEntries]);
  for (const secret of secrets) {
    assert.ok(secret && secret.length >= 8, 'Secret pembanding harus terisi');
    assert.equal(state.href.includes(secret), false, `${label}: secret bocor di URL`);
    assert.equal(storageDump.includes(secret), false, `${label}: secret bocor di storage`);
    for (const entry of consoleLogs) {
      assert.equal(entry.includes(secret), false, `${label}: secret bocor di konsol`);
    }
  }
}

function startMockUpstream() {
  const openHangResponses = new Set();
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      assert.equal(req.headers.authorization, `Bearer ${upstreamApiKey}`, 'Auth header upstream tidak cocok');
      if (body.model === 'upstream-beta-hang' && body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'potongan awal menggantung' } }] })}\n\n`);
        openHangResponses.add(res);
        res.on('close', () => openHangResponses.delete(res));
        return;
      }
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'potongan pertama untuk uji batal' } }] })}\n\n`);
        // Hold briefly so client can abort mid-stream before usage arrives
        await delay(1_500);
        if (!res.destroyed) {
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
        return;
      }
      const payload = JSON.stringify({
        id: 'chatcmpl_req_verify',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      res.end(payload);
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

async function waitForSettled(pool, requestId) {
  for (let i = 0; i < 120; i++) {
    const row = (await pool.query('select state, outcome, debit, estimated from request where id=$1', [requestId])).rows[0];
    if (row && row.debit !== null) return row;
    await delay(50);
  }
  throw new Error(`Request ${requestId} belum selesai (debit null)`);
}

async function spawnAndKillStuckStream({ schemaName, keyHex, apiKey, modelId }) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child-stuck-stream'], {
    env: {
      ...process.env,
      STUCK_SCHEMA: schemaName,
      STUCK_KEY_HEX: keyHex,
      STUCK_API_KEY: apiKey,
      STUCK_MODEL_ID: modelId,
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

async function maybeSubmitStepUp(page, totpSeed, stepOffsetRef) {
  const dialog = page.getByRole('dialog', { name: m.stepUp });
  try {
    await dialog.waitFor({ state: 'visible', timeout: 800 });
  } catch {
    return false;
  }
  const step = await safeTotpStep();
  const code = totpAt(totpSeed, step + BigInt(stepOffsetRef.offset++));
  await dialog.getByLabel(m.code, { exact: true }).fill(code);
  await dialog.getByRole('button', { name: m.verify, exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: 10_000 });
  return true;
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
  pool = createPool(schemaUrl.href, 20);
  await migrate(pool);

  const mail = { invites: [] };
  const mailer = {
    invite: async (to, token) => { mail.invites.push({ to, token }); },
    passwordReset: async () => {},
  };

  const adm = await bootstrapAdmin(pool, key, {
    username: adminUsername,
    email: 'admin-req@example.test',
    password: adminPassword,
  });
  const totpSeed = base32Decode(adm.totpSecretBase32);

  await createInvite(pool, { email: 'req-a@example.test', adminUser: adm.userId }, mailer);
  const custA = await activateInvite(pool, { token: mail.invites.at(-1).token, username: custAUsername, password: custPassword });
  await createInvite(pool, { email: 'req-b@example.test', adminUser: adm.userId }, mailer);
  const custB = await activateInvite(pool, { token: mail.invites.at(-1).token, username: custBUsername, password: custPassword });

  // Seed balances and >50 legitimate audit events (via grantAdminTopup) so /admin/audit paginates via nextBefore
  await withTx(pool, tx => ledger.grantAdminTopup(tx, {
    tenantId: custA.tenantId,
    amount: 500_000n * C,
    saleRef: 'REQ-VERIFY-A-SEED',
    actorUser: adm.userId,
    idemKey: 'req-verify-a-seed-0001',
  }));
  for (let i = 1; i <= 52; i++) {
    await withTx(pool, tx => ledger.grantAdminTopup(tx, {
      tenantId: custB.tenantId,
      amount: 10_000n * C,
      saleRef: `REQ-VERIFY-B-SEED-${String(i).padStart(3, '0')}`,
      actorUser: adm.userId,
      idemKey: `req-verify-b-seed-${String(i).padStart(4, '0')}`,
    }));
  }

  // Create API keys for custA and custB
  const keyASecret = 'rtr_' + newToken();
  const keyBSecret = 'rtr_' + newToken();
  await pool.query(
    'insert into api_key(tenant_id, name, prefix, token_hash, creation_key_hash) values($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
    [
      custA.tenantId, 'kunci-pelanggan-a', keyASecret.slice(0, 12), tokenHash(keyASecret), tokenHash('req-key-a-0001'),
      custB.tenantId, 'kunci-pelanggan-b', keyBSecret.slice(0, 12), tokenHash(keyBSecret), tokenHash('req-key-b-0001'),
    ],
  );

  mock = await startMockUpstream();
  resetRouteHealth();

  app = await buildApp({
    db: pool,
    key,
    mailer,
    secureCookies: false,
    resolveHost: async () => ['93.184.216.34'],
    gateway: {
      unsafeAllowAnyUpstreamUrl: true,
      firstByteTimeoutMs: 5_000,
      idleTimeoutMs: 10_000,
      requestsPerMinutePerKey: 10_000,
      concurrentPerTenant: 100,
    },
  });
  await app.listen({ host: '127.0.0.1', port: apiPort });

  // Provision two models (req/alpha, req/beta) + third model (req/beta-hang) on mock upstream via admin API
  const up = (await pool.query(
    'insert into upstream(name, status, base_url_chat, key_enc, key_set_at) values($1,$2,$3,$4,now()) returning id',
    ['req-verify-upstream', 'ELIGIBLE', `http://127.0.0.1:${mock.port}/v1`, seal(key, Buffer.from(upstreamApiKey))],
  )).rows[0];

  const modelsToCreate = [
    { id: modelAlpha, displayName: 'Model Alpha', upstreamModel: 'upstream-alpha' },
    { id: modelBeta, displayName: 'Model Beta', upstreamModel: 'upstream-beta' },
    { id: 'req/beta-hang', displayName: 'Model Beta Hang', upstreamModel: 'upstream-beta-hang' },
  ];
  for (const item of modelsToCreate) {
    const created = await pricing.createModel(pool, { id: item.id, displayName: item.displayName, actorUser: adm.userId });
    const drafted = await pricing.saveDraft(pool, {
      id: item.id,
      expectedVersion: created.version,
      price: pricing.priceInput({ multiplier: '1' }),
      actorUser: adm.userId,
    });
    await pricing.publish(pool, {
      id: item.id,
      expectedVersion: drafted.version,
      reason: 'Verifikasi daftar request admin',
      actorUser: adm.userId,
    });
    await pool.query(
      'insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,1)',
      [item.id, up.id, 'CHAT', item.upstreamModel],
    );
  }

  // ---- 1. Generate real gateway requests for both customers ----
  // 1a. custA: 52 normal settled requests on req/alpha (so custA has > 50 rows for requestBefore pagination)
  async function callNormal(apiKey, modelId) {
    const res = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId, stream: false, max_tokens: 32, messages: [{ role: 'user', content: promptMarker }] }),
    });
    assert.equal(res.status, 200, `Gateway normal request gagal: HTTP ${res.status}`);
    await res.text();
    return res.headers.get('x-request-id');
  }

  const custANormalIds = [];
  for (let batch = 0; batch < 52; batch += 10) {
    const size = Math.min(10, 52 - batch);
    const ids = await Promise.all(Array.from({ length: size }, () => callNormal(keyASecret, modelAlpha)));
    custANormalIds.push(...ids);
  }
  for (const id of custANormalIds) {
    const row = await waitForSettled(pool, id);
    assert.equal(row.state, 'SETTLED', `Request normal ${id} harus SETTLED`);
    assert.equal(row.outcome, 'completed', `Outcome normal ${id} harus completed`);
  }

  // 1b. custA: 1 estimated request via client abort mid-stream (SETTLED_ESTIMATED, cancelled_mid_stream)
  const abortCtrl = new AbortController();
  let custAEstimatedId = '';
  {
    const res = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keyASecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelAlpha, stream: true, max_tokens: 32, messages: [{ role: 'user', content: promptMarker }] }),
      signal: abortCtrl.signal,
    });
    assert.equal(res.status, 200, `Stream request gagal: HTTP ${res.status}`);
    custAEstimatedId = res.headers.get('x-request-id');
    assert.ok(custAEstimatedId, 'Stream request tanpa x-request-id');
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false, 'Chunk pertama stream tidak diterima');
    abortCtrl.abort();
    await reader.cancel().catch(() => {});
  }
  const estRow = await waitForSettled(pool, custAEstimatedId);
  assert.equal(estRow.state, 'SETTLED_ESTIMATED', `Request batal tengah stream harus SETTLED_ESTIMATED (got ${estRow.state})`);
  assert.equal(estRow.estimated, true, 'Request batal tengah stream harus estimated=true');
  assert.equal(estRow.outcome, 'cancelled_mid_stream', `Outcome batal tengah stream harus cancelled_mid_stream (got ${estRow.outcome})`);

  // 1c. custB: 2 normal settled requests on req/beta
  const custBNormalIds = [
    await callNormal(keyBSecret, modelBeta),
    await callNormal(keyBSecret, modelBeta),
  ];
  for (const id of custBNormalIds) {
    const row = await waitForSettled(pool, id);
    assert.equal(row.state, 'SETTLED', `Request normal custB ${id} harus SETTLED`);
  }

  // 1d. custB: 1 UNRESOLVED request via genuine mid-stream process crash + server recoverStuck()
  const custBUnresolvedId = await spawnAndKillStuckStream({
    schemaName: schema,
    keyHex: key.toString('hex'),
    apiKey: keyBSecret,
    modelId: 'req/beta-hang',
  });
  mock.closeHangs();
  await delay(60);
  const rec = await recoverStuck(pool, 0);
  assert.equal(rec.unresolved, 1, `recoverStuck harus menandai 1 request UNRESOLVED (got ${JSON.stringify(rec)})`);
  const unresRow = (await pool.query('select state, outcome, debit from request where id=$1', [custBUnresolvedId])).rows[0];
  assert.equal(unresRow.state, 'UNRESOLVED', 'State sesudah recoverStuck harus UNRESOLVED');
  assert.equal(unresRow.outcome, 'process_lost_mid_stream', 'Outcome sesudah recoverStuck harus process_lost_mid_stream');
  assert.equal(unresRow.debit, null, 'Debit UNRESOLVED harus null sampai diputuskan');

  // Cluster 10 earliest custA requests across the UI page-50 boundary:
  // 6 rows share the exact same microsecond timestamp and 4 rows differ by < 1ms within the same millisecond.
  const clusterIds = custANormalIds.slice(0, 10);
  const exactSameTs = '2026-11-19T10:00:00.500250Z';
  const subMsTs = [
    '2026-11-19T10:00:00.500900Z',
    '2026-11-19T10:00:00.500700Z',
    '2026-11-19T10:00:00.500400Z',
    '2026-11-19T10:00:00.500100Z',
  ];
  await pool.query('update request set created_at = $1::timestamptz where id = any($2::text[])', [exactSameTs, clusterIds.slice(0, 6)]);
  for (let i = 0; i < subMsTs.length; i++) {
    await pool.query('update request set created_at = $1::timestamptz where id = $2', [subMsTs[i], clusterIds[6 + i]]);
  }

  const allExpectedIds = [...custANormalIds, custAEstimatedId, ...custBNormalIds, custBUnresolvedId];
  const custAExpectedIds = [...custANormalIds, custAEstimatedId];
  const assertExactIdSet = (actualIds, expectedIds, label) => {
    const unique = new Set(actualIds);
    assert.equal(actualIds.length, expectedIds.length, `${label}: jumlah baris tidak cocok (got ${actualIds.length}, expected ${expectedIds.length})`);
    assert.equal(unique.size, expectedIds.length, `${label}: terdapat ID request duplikat (unique=${unique.size}, total=${actualIds.length})`);
    assert.deepEqual([...unique].sort(), [...expectedIds].sort(), `${label}: himpunan ID request tidak persis sama`);
  };
  const extractSectionRequestIds = (targetPage, sectionAriaLabel) => targetPage.evaluate(
    sel => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      if (!section) return [];
      return [...section.querySelectorAll('article.data-row')].map(row => {
        const match = (row.textContent ?? '').match(/req_[0-9a-f-]{36}/);
        return match ? match[0] : '';
      }).filter(Boolean);
    },
    sectionAriaLabel,
  );

  // Start Vite + Chromium
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

  // Warmup Vite pre-bundling once
  {
    const warmCtx = await browser.newContext();
    const warmPage = await warmCtx.newPage();
    await warmPage.goto(`${webBase}/admin/masuk`);
    await expectVisible(warmPage.getByRole('heading', { name: m.adminLogin, exact: true }), 'Warmup Vite /admin/masuk gagal', 25_000);
    await warmCtx.close();
  }

  const pageErrors = [];
  const serverErrors = [];
  const secrets = [keyASecret, keyBSecret, upstreamApiKey, promptMarker, adm.totpSecretBase32];
  const stepOffsetRef = { offset: 0 };

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  attachListeners(page, 'admin', pageErrors, serverErrors);

  // Admin login + 2FA
  await page.goto(`${webBase}/admin/masuk`);
  await page.getByLabel(m.identifier).fill(adminUsername);
  await page.getByLabel(m.password, { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(page.getByLabel(m.code, { exact: true }), 'Form 2FA admin tidak muncul');
  const loginStep = await safeTotpStep();
  await page.getByLabel(m.code, { exact: true }).fill(totpAt(totpSeed, loginStep - 1n));
  await page.getByRole('button', { name: m.verify, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Login admin tidak masuk ke Ringkasan Operasi');

  // ---- 2. /admin/rekonsiliasi: rows, badges, outcomes, filters (username, state, model), username link ----
  await page.locator('aside.desktop-nav nav').getByRole('link', { name: m.unresolved, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: m.unresolved, exact: true }), 'Heading /admin/rekonsiliasi tidak tampil');
  const allReqSection = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: m.allCustomerRequests, exact: true }) });
  await expectVisible(allReqSection, 'Bagian semua request pelanggan tidak tampil');

  // Top unresolved section should contain custBUnresolvedId
  const topUnresolvedCard = page.locator('article.data-row').filter({ hasText: custBUnresolvedId }).first();
  await expectVisible(topUnresolvedCard, 'Request UNRESOLVED tidak tampil di halaman rekonsiliasi');

  // All requests list has custB UNRESOLVED + custA SETTLED_ESTIMATED + normal SETTLED rows
  const unresListRow = allReqSection.locator('article.data-row').filter({ hasText: custBUnresolvedId });
  await expectVisible(unresListRow, 'Baris UNRESOLVED tidak tampil di daftar semua request');
  await expectVisible(unresListRow.locator('.badge').filter({ hasText: m.requestStateText.UNRESOLVED }), 'Badge UNRESOLVED tidak tampil');
  await expectVisible(unresListRow.getByText(m.requestOutcomeText.process_lost_mid_stream, { exact: true }), 'Keterangan process_lost_mid_stream tidak tampil');

  const estListRow = allReqSection.locator('article.data-row').filter({ hasText: custAEstimatedId });
  await expectVisible(estListRow, 'Baris SETTLED_ESTIMATED tidak tampil di daftar semua request');
  await expectVisible(estListRow.locator('.badge').filter({ hasText: m.requestStateText.SETTLED_ESTIMATED }), 'Badge SETTLED_ESTIMATED tidak tampil');
  await expectVisible(estListRow.locator('.badge').filter({ hasText: m.adminRequestEstimate }), 'Badge estimasi tidak tampil');
  await expectVisible(estListRow.getByText(m.requestOutcomeText.cancelled_mid_stream, { exact: true }), 'Keterangan cancelled_mid_stream tidak tampil');

  // Filter by username = custBUsername
  await allReqSection.getByLabel(m.adminRequestUsername).fill(custBUsername);
  await allReqSection.getByRole('button', { name: m.search, exact: true }).click();
  await page.waitForFunction(
    ([sel, expectedCount, forbiddenUser]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      if (!section) return false;
      const rows = [...section.querySelectorAll('article.data-row')];
      return rows.length === expectedCount && rows.every(r => !r.textContent?.includes(forbiddenUser));
    },
    [m.allCustomerRequests, 3, custAUsername],
    { timeout: 10_000 },
  );

  async function clearAndWait(panel) {
    const btn = panel.getByRole('button', { name: m.clearFilters, exact: true });
    await btn.click();
    await btn.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      label => {
        const buttons = [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === label);
        return buttons.some(b => b.disabled);
      },
      m.clearFilters,
      { timeout: 10_000 },
    );
  }

  // Filter by state = UNRESOLVED (with username cleared)
  await clearAndWait(allReqSection);
  await allReqSection.getByLabel(m.adminRequestState).selectOption('UNRESOLVED');
  await allReqSection.getByRole('button', { name: m.search, exact: true }).click();
  await page.waitForFunction(
    ([sel, targetId]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      if (!section) return false;
      const rows = [...section.querySelectorAll('article.data-row')];
      return rows.length === 1 && rows[0].textContent?.includes(targetId);
    },
    [m.allCustomerRequests, custBUnresolvedId],
    { timeout: 10_000 },
  );

  // Filter by model = modelBeta -> returns exactly 2 settled rows of custB (model req/beta)
  await clearAndWait(allReqSection);
  await allReqSection.getByLabel(m.adminRequestModel).fill(modelBeta);
  await allReqSection.getByRole('button', { name: m.search, exact: true }).click();
  await page.waitForFunction(
    ([sel, expectedCount, expectedModel, forbiddenModel]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      if (!section) return false;
      const rows = [...section.querySelectorAll('article.data-row')];
      return rows.length === expectedCount
        && rows.every(r => r.textContent?.includes(expectedModel) && !r.textContent?.includes(forbiddenModel));
    },
    [m.allCustomerRequests, 2, modelBeta, modelAlpha],
    { timeout: 10_000 },
  );

  // Clear filters, walk Rekonsiliasi pagination across the identical-timestamp + sub-ms cluster (API limit=3 & UI limit=50)
  await clearAndWait(allReqSection);
  await page.waitForFunction(
    ([sel, expectedCount]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      return Boolean(section && section.querySelectorAll('article.data-row').length === expectedCount);
    },
    [m.allCustomerRequests, 50],
    { timeout: 10_000 },
  );

  // API walk with small limit (limit=3 across all customers, limit=4 scoped to custA)
  const adminWalkAllIds = await page.evaluate(async () => {
    const ids = [];
    let before = null;
    for (let guard = 0; guard < 100; guard++) {
      const q = new URLSearchParams({ limit: '3' });
      if (before) q.set('before', before);
      const res = await fetch(`/admin/api/requests?${q.toString()}`);
      if (res.status !== 200) throw new Error(`GET /admin/api/requests HTTP ${res.status}`);
      const body = await res.json();
      for (const r of body.requests) ids.push(r.id);
      if (!body.nextBefore) break;
      before = body.nextBefore;
    }
    return ids;
  });
  assertExactIdSet(adminWalkAllIds, allExpectedIds, 'API /admin/api/requests limit=3');

  const adminWalkCustAIds = await page.evaluate(async username => {
    const ids = [];
    let before = null;
    for (let guard = 0; guard < 100; guard++) {
      const q = new URLSearchParams({ limit: '4', username });
      if (before) q.set('before', before);
      const res = await fetch(`/admin/api/requests?${q.toString()}`);
      if (res.status !== 200) throw new Error(`GET /admin/api/requests?username HTTP ${res.status}`);
      const body = await res.json();
      for (const r of body.requests) ids.push(r.id);
      if (!body.nextBefore) break;
      before = body.nextBefore;
    }
    return ids;
  }, custAUsername);
  assertExactIdSet(adminWalkCustAIds, custAExpectedIds, 'API /admin/api/requests?username=custA limit=4');

  // UI walk on /admin/rekonsiliasi (page 1 = 50, page 2 = 6 across the 6 identical-timestamp + sub-ms rows)
  const rekPage1Ids = await extractSectionRequestIds(page, m.allCustomerRequests);
  assert.equal(rekPage1Ids.length, 50, `Halaman 1 Rekonsiliasi harus berisi 50 baris (got ${rekPage1Ids.length})`);
  const rekNextBtn = allReqSection.getByRole('button', { name: m.next, exact: true });
  await expectVisible(rekNextBtn, 'Tombol Berikutnya pada Rekonsiliasi tidak tampil untuk >50 baris');
  await rekNextBtn.click();
  await page.waitForFunction(
    ([sel, expectedCount]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      return Boolean(section && new URLSearchParams(location.search).has('before') && section.querySelectorAll('article.data-row').length === expectedCount);
    },
    [m.allCustomerRequests, 6],
    { timeout: 10_000 },
  );
  const rekPage2Ids = await extractSectionRequestIds(page, m.allCustomerRequests);
  assertExactIdSet([...rekPage1Ids, ...rekPage2Ids], allExpectedIds, 'UI /admin/rekonsiliasi (50 + 6)');

  await allReqSection.getByRole('button', { name: m.first, exact: true }).click();
  await page.waitForFunction(
    ([sel, expectedCount]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      return Boolean(section && !new URLSearchParams(location.search).has('before') && section.querySelectorAll('article.data-row').length === expectedCount);
    },
    [m.allCustomerRequests, 50],
    { timeout: 10_000 },
  );

  const custALink = allReqSection.getByRole('link', { name: custAUsername, exact: true }).first();
  await expectVisible(custALink, 'Tautan username pelanggan A di daftar request tidak tampil');
  await custALink.click();
  await expectVisible(page.locator('.customer-detail-heading h2', { hasText: custAUsername }), 'Tautan username tidak membuka detail pelanggan A');

  // ---- 3. Detail pelanggan -> tab Request: tenant isolation + requestBefore pagination (>50 rows across cluster) ----
  const reqTab = page.getByRole('tab', { name: m.customerRequestTab, exact: true });
  await expectVisible(reqTab, 'Tab Request di detail pelanggan tidak tampil');
  await reqTab.click();
  const custReqSection = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: m.customerRequests, exact: true }) });
  await expectVisible(custReqSection, 'Panel Request pelanggan tidak tampil');
  await page.waitForFunction(
    ([sel, expectedCount, forbiddenUser]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      if (!section) return false;
      const rows = [...section.querySelectorAll('article.data-row')];
      return rows.length === expectedCount && rows.every(r => !r.textContent?.includes(forbiddenUser));
    },
    [m.customerRequests, 50, custBUsername],
    { timeout: 10_000 },
  );
  const tabPage1Ids = await extractSectionRequestIds(page, m.customerRequests);

  // Page 2 via requestBefore -> remaining 3 rows of custA, still zero custB
  const nextReqBtn = custReqSection.getByRole('button', { name: m.next, exact: true });
  await expectVisible(nextReqBtn, 'Tombol Berikutnya pada tab Request tidak tampil untuk >50 baris');
  await nextReqBtn.click();
  await page.waitForFunction(
    () => new URLSearchParams(location.search).has('requestBefore'),
    null,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    ([sel, expectedCount, forbiddenUser]) => {
      const section = [...document.querySelectorAll('section.panel')].find(el => el.getAttribute('aria-label') === sel);
      if (!section) return false;
      const rows = [...section.querySelectorAll('article.data-row')];
      return rows.length === expectedCount && rows.every(r => !r.textContent?.includes(forbiddenUser));
    },
    [m.customerRequests, 3, custBUsername],
    { timeout: 10_000 },
  );
  const tabPage2Ids = await extractSectionRequestIds(page, m.customerRequests);
  assertExactIdSet([...tabPage1Ids, ...tabPage2Ids], custAExpectedIds, 'UI tab Request pelanggan (50 + 3)');

  // Back to page 1 via Halaman awal
  const firstReqBtn = custReqSection.getByRole('button', { name: m.first, exact: true });
  await expectVisible(firstReqBtn, 'Tombol Halaman awal pada tab Request tidak tampil');
  await firstReqBtn.click();
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('requestBefore'), null, { timeout: 10_000 });

  // ---- 4. Suspend & restore custA via UI, then pause & resume kill switch via UI, then verify /admin/audit ----
  await page.getByRole('tab', { name: m.summary, exact: true }).click();
  await expectVisible(page.getByRole('button', { name: m.suspendCustomer, exact: true }), 'Tombol tangguhkan pelanggan tidak tampil');

  // Suspend custA
  await page.getByRole('button', { name: m.suspendCustomer, exact: true }).click();
  const suspendDialog = page.getByRole('dialog', { name: m.suspendCustomer });
  await expectVisible(suspendDialog, 'Dialog konfirmasi tangguhkan tidak muncul');
  await suspendDialog.getByLabel(m.reason).fill('Uji audit penangguhan pelanggan');
  await suspendDialog.getByRole('button', { name: m.suspendCustomer, exact: true }).click();
  await maybeSubmitStepUp(page, totpSeed, stepOffsetRef);
  await expectVisible(page.getByText(m.adminSuspended, { exact: true }), 'Status ditangguhkan tidak tampil sesudah suspend');
  await expectVisible(page.locator('.customer-detail-heading .badge', { hasText: statusText.SUSPENDED }), 'Badge SUSPENDED tidak tampil');

  // Restore custA
  await page.getByRole('button', { name: m.restoreCustomer, exact: true }).click();
  const restoreDialog = page.getByRole('dialog', { name: m.restoreCustomer });
  await expectVisible(restoreDialog, 'Dialog konfirmasi pulihkan tidak muncul');
  await restoreDialog.getByLabel(m.reason).fill('Uji audit pemulihan pelanggan');
  await restoreDialog.getByRole('button', { name: m.restoreCustomer, exact: true }).click();
  await maybeSubmitStepUp(page, totpSeed, stepOffsetRef);
  await expectVisible(page.getByRole('button', { name: m.suspendCustomer, exact: true }), 'Pelanggan tidak kembali aktif sesudah restore');

  // Pause & resume kill switch via /admin/ringkasan UI
  await page.locator('aside.desktop-nav nav').getByRole('link', { name: ov.overview, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Ringkasan Operasi tidak terbuka');

  await page.getByRole('button', { name: ov.pauseGateway, exact: true }).click();
  const pauseDialog = page.getByRole('dialog', { name: ov.pauseDialogTitle });
  await expectVisible(pauseDialog, 'Dialog jeda gateway tidak muncul');
  await pauseDialog.getByLabel(m.reason).fill('Uji audit jeda layanan gateway');
  await pauseDialog.getByRole('button', { name: ov.pauseGateway, exact: true }).click();
  await maybeSubmitStepUp(page, totpSeed, stepOffsetRef);
  await expectVisible(page.getByText(ov.gatewayPausedBanner, { exact: true }), 'Banner layanan dijeda tidak tampil');

  await page.getByRole('button', { name: ov.resumeGateway, exact: true }).click();
  const resumeDialog = page.getByRole('dialog', { name: ov.resumeDialogTitle });
  await expectVisible(resumeDialog, 'Dialog lanjutkan gateway tidak muncul');
  await resumeDialog.getByRole('button', { name: ov.resumeGateway, exact: true }).click();
  await maybeSubmitStepUp(page, totpSeed, stepOffsetRef);
  await expectVisible(page.getByRole('button', { name: ov.pauseGateway, exact: true }), 'Gateway tidak kembali berjalan sesudah resume');

  // Navigate to /admin/audit
  await page.locator('aside.desktop-nav nav').getByRole('link', { name: m.audit, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: m.audit, exact: true }), 'Halaman Audit tidak terbuka');
  const auditFilterPanel = page.locator('section.panel').filter({ has: page.getByLabel(m.auditActionFilter) });
  await expectVisible(auditFilterPanel, 'Panel filter audit tidak tampil');

  // Pagination (> 50 events -> nextBefore)
  await page.waitForFunction(
    () => document.querySelectorAll('article.data-row').length === 50,
    null,
    { timeout: 10_000 },
  );
  const firstPageAuditIds = await page.locator('article.data-row').evaluateAll(els => els.map(e => e.textContent ?? ''));
  const auditNextBtn = page.locator('nav.pagination').getByRole('button', { name: m.next, exact: true });
  await expectVisible(auditNextBtn, 'Tombol Berikutnya pada Audit tidak tampil untuk >50 event');
  await auditNextBtn.click();
  await page.waitForFunction(() => new URLSearchParams(location.search).has('before'), null, { timeout: 10_000 });
  await page.waitForFunction(
    firstTop => {
      const firstRow = document.querySelector('article.data-row');
      return Boolean(firstRow && firstRow.textContent !== firstTop);
    },
    firstPageAuditIds[0],
    { timeout: 10_000 },
  );
  await page.locator('nav.pagination').getByRole('button', { name: m.first, exact: true }).click();
  await page.waitForFunction(
    firstTop => {
      const firstRow = document.querySelector('article.data-row');
      return !new URLSearchParams(location.search).has('before') && Boolean(firstRow && firstRow.textContent === firstTop);
    },
    firstPageAuditIds[0],
    { timeout: 10_000 },
  );

  // Group "Status pelanggan" (tenant.) -> Pelanggan ditangguhkan & Pelanggan dipulihkan with adminUsername (NOT UUID)
  await auditFilterPanel.getByLabel(m.auditActionFilter).selectOption('tenant.');
  await auditFilterPanel.getByRole('button', { name: m.search, exact: true }).click();
  await page.waitForFunction(
    ([expectedSuspend, expectedRestore]) => {
      const rows = [...document.querySelectorAll('article.data-row')];
      const text = rows.map(r => r.textContent ?? '').join('\n');
      return rows.length === 2 && text.includes(expectedSuspend) && text.includes(expectedRestore);
    },
    [m.auditActionText['tenant.suspend'], m.auditActionText['tenant.restore']],
    { timeout: 10_000 },
  );
  const tenantRowsText = await page.locator('article.data-row').allTextContents();
  assert.equal(tenantRowsText.length, 2, `Kelompok Status pelanggan harus berisi 2 event (got ${tenantRowsText.length})`);
  for (const rowText of tenantRowsText) {
    assert.ok(rowText.includes(adminUsername), `Pelaku harus menampilkan username admin '${adminUsername}', bukan UUID`);
    assert.equal(rowText.includes(adm.userId), false, 'UUID admin tidak boleh bocor sebagai pelaku audit');
  }

  // Filter by actor username + targetId (custA.tenantId) -> includes ledger.admin_topup, tenant.suspend, tenant.restore
  await clearAndWait(auditFilterPanel);
  await auditFilterPanel.getByLabel(m.auditActorUsername).fill(adminUsername);
  await auditFilterPanel.getByLabel(m.auditTargetId).fill(custA.tenantId);
  await auditFilterPanel.getByRole('button', { name: m.search, exact: true }).click();
  await page.waitForFunction(
    ([targetId, expectedActor, expectedSuspend, expectedRestore, expectedTopup]) => {
      const rows = [...document.querySelectorAll('article.data-row')];
      const text = rows.map(r => r.textContent ?? '').join('\n');
      return rows.length === 3
        && rows.every(r => r.textContent?.includes(targetId) && r.textContent?.includes(expectedActor))
        && text.includes(expectedSuspend) && text.includes(expectedRestore) && text.includes(expectedTopup);
    },
    [
      custA.tenantId,
      adminUsername,
      m.auditActionText['tenant.suspend'],
      m.auditActionText['tenant.restore'],
      m.auditActionText['ledger.admin_topup'],
    ],
    { timeout: 10_000 },
  );

  // Group "Pengaturan" (setting.) -> Layanan dijeda & Layanan dilanjutkan
  await clearAndWait(auditFilterPanel);
  await auditFilterPanel.getByLabel(m.auditActionFilter).selectOption('setting.');
  await auditFilterPanel.getByRole('button', { name: m.search, exact: true }).click();
  await page.waitForFunction(
    ([expectedPause, expectedResume]) => {
      const rows = [...document.querySelectorAll('article.data-row')];
      const text = rows.map(r => r.textContent ?? '').join('\n');
      return rows.length === 2 && text.includes(expectedPause) && text.includes(expectedResume);
    },
    [m.auditActionText['setting.gateway_pause'], m.auditActionText['setting.gateway_resume']],
    { timeout: 10_000 },
  );
  const settingRowsText = await page.locator('article.data-row').allTextContents();
  assert.equal(settingRowsText.length, 2, `Kelompok Pengaturan harus memuat 2 event (got ${settingRowsText.length})`);
  for (const rowText of settingRowsText) {
    assert.ok(rowText.includes(adminUsername), `Pelaku pengaturan harus menampilkan username '${adminUsername}'`);
    assert.equal(rowText.includes(adm.userId), false, 'UUID admin tidak boleh tampil pada event Pengaturan');
  }

  // Custom action prefix filter for SYSTEM recovery event (request.mark_unresolved)
  await clearAndWait(auditFilterPanel);
  await auditFilterPanel.getByLabel(m.auditActionFilter).selectOption('__custom');
  await auditFilterPanel.getByLabel(m.auditCustomAction).fill('request.mark_unresolved');
  await auditFilterPanel.getByRole('button', { name: m.search, exact: true }).click();
  await page.waitForFunction(
    ([expectedLabel, targetId, systemLabel]) => {
      const rows = [...document.querySelectorAll('article.data-row')];
      return rows.length === 1
        && rows[0].textContent?.includes(expectedLabel)
        && rows[0].textContent?.includes(targetId)
        && rows[0].textContent?.includes(systemLabel);
    },
    [m.auditActionText['request.mark_unresolved'], custBUnresolvedId, m.system],
    { timeout: 10_000 },
  );

  await assertCleanSecretHygiene(page, secrets, 'admin-requests-audit');
  await ctx.close();

  // ---- 5. Customer portal /pemakaian + GET /api/requests?limit=3 pagination across identical-timestamp & sub-ms cluster ----
  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custPage = await custCtx.newPage();
  attachListeners(custPage, 'custA', pageErrors, serverErrors);
  await custPage.goto(`${webBase}/masuk`);
  await custPage.getByLabel(m.identifier).fill(custAUsername);
  await custPage.getByLabel(m.password, { exact: true }).fill(custPassword);
  await custPage.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.home, exact: true }), 'Login pelanggan A gagal');

  const custWalkIds = await custPage.evaluate(async () => {
    const ids = [];
    let before = null;
    for (let guard = 0; guard < 100; guard++) {
      const q = new URLSearchParams({ limit: '3' });
      if (before) q.set('before', before);
      const res = await fetch(`/api/requests?${q.toString()}`);
      if (res.status !== 200) throw new Error(`GET /api/requests HTTP ${res.status}`);
      const body = await res.json();
      for (const r of body.requests) ids.push(r.id);
      if (!body.nextBefore) break;
      before = body.nextBefore;
    }
    return ids;
  });
  assertExactIdSet(custWalkIds, custAExpectedIds, 'API /api/requests limit=3');

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.requests, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.requests, exact: true }), 'Halaman /pemakaian pelanggan tidak terbuka');
  await custPage.waitForFunction(() => document.querySelectorAll('article.request-row').length === 50, null, { timeout: 10_000 });
  const extractUsageIds = () => custPage.evaluate(() => [...document.querySelectorAll('article.request-row')].map(row => {
    const match = (row.textContent ?? '').match(/req_[0-9a-f-]{36}/);
    return match ? match[0] : '';
  }).filter(Boolean));
  const usagePage1Ids = await extractUsageIds();
  await custPage.locator('nav.pagination').getByRole('button', { name: m.next, exact: true }).click();
  await custPage.waitForFunction(
    () => new URLSearchParams(location.search).has('before') && document.querySelectorAll('article.request-row').length === 3,
    null,
    { timeout: 10_000 },
  );
  const usagePage2Ids = await extractUsageIds();
  assertExactIdSet([...usagePage1Ids, ...usagePage2Ids], custAExpectedIds, 'UI /pemakaian pelanggan (50 + 3)');
  await assertCleanSecretHygiene(custPage, secrets, 'customer-usage-cursor');
  await custCtx.close();

  assert.deepEqual(pageErrors, [], `Ada pageerror browser: ${pageErrors.join('; ')}`);
  assert.deepEqual(serverErrors, [], `Ada respons >=500: ${serverErrors.join('; ')}`);
  assert.deepEqual(await ledger.invariantViolations(pool), [], 'Ada pelanggaran invariant ledger');

  process.stdout.write('admin-requests-local-verify: PASS (rekonsiliasi filters/badges/links, sub-ms+same-ts cursor API+UI across rekonsiliasi/Request-tab/pemakaian, audit groups/actor/targetId/nextBefore, invariantViolations=[])\n');
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
