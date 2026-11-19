import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createPool } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { activateInvite } from '../../server/src/identity.ts';
import * as ledger from '../../server/src/ledger.ts';
import { debitMicro } from '../../server/src/money.ts';
import { seal, totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';
import { kindText, m, ov, statusText } from '../src/messages.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_golden_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);

const mail = { invites: [], resets: [] };
const mailer = {
  invite: async (to, token) => { mail.invites.push({ to, token }); },
  passwordReset: async (to, token) => { mail.resets.push({ to, token }); },
};

const offlinePublicResolver = async () => ['93.184.216.34'];
const adminUsername = 'admin_golden_verify';
const adminPassword = 'local-admin-golden-14';
const custUsername = 'golden_pelanggan';
const custEmail = 'golden-pelanggan@example.test';
const custPassword = 'local-golden-pass-10';
const upstreamApiKey = 'sk-golden-mock-upstream-999';
const promptMarker = 'GOLDEN_SECRET_PROMPT_MARKER';
const consoleLogs = [];

const CHAT_NONSTREAM_RAW_USAGE = {
  prompt_tokens: 120,
  completion_tokens: 40,
  total_tokens: 160,
  prompt_cache_hit_tokens: 20,
  prompt_cache_miss_tokens: 100,
};
const CHAT_STREAM_RAW_USAGE = {
  prompt_tokens: 160,
  completion_tokens: 60,
  total_tokens: 220,
  prompt_cache_hit_tokens: 40,
  prompt_cache_miss_tokens: 120,
};
const ANTHROPIC_RAW_USAGE = {
  input_tokens: 90,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 8,
  output_tokens: 30,
};

const PUBLISHED_PRICE = {
  version: 1,
  inputRate: 1_000_000_000n,
  outputRate: 2_000_000_000n,
  cacheReadRate: 250_000_000n,
  cacheWriteRate: 500_000_000n,
  multiplierE4: 15_000n, // 1.5x
};

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

function expectVisible(locator, message) {
  return locator.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
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

class CookieClient {
  #cookies = new Map();
  async request(method, path, body) {
    const cookieHeader = [...this.#cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(method !== 'GET' ? { 'x-router-csrf': '1', 'content-type': 'application/json' } : {}),
      },
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const pair = raw.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (value) this.#cookies.set(name, value);
        else this.#cookies.delete(name);
      }
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: res.status, json, text };
  }
  get = (path) => this.request('GET', path);
  post = (path, body) => this.request('POST', path, body);
}

function startLoopbackMockUpstream() {
  const stats = { requests: [], aborts: 0 };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    stats.requests.push({ url: req.url, headers: { ...req.headers }, body });

    let finished = false;
    let closed = false;
    res.on('close', () => {
      closed = true;
      if (!finished) stats.aborts += 1;
    });

    const isAnthropic = req.url?.includes('/messages');
    const promptText = String(body?.messages?.[0]?.content ?? '');
    const isAbortMode = promptText.includes('GOLDEN_ABORT_AFTER_FIRST');

    if (isAbortMode && body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Potongan pertama' } }] })}\n\n`);
      for (let i = 0; i < 100 && !closed && !res.destroyed; i += 1) {
        await delay(50);
      }
      if (!closed) {
        finished = true;
        if (!res.writableEnded) res.end();
      }
      return;
    }

    if (isAnthropic) {
      assert.equal(body.stream, false);
      finished = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_golden_1',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: 'Jawaban Anthropic tiruan' }],
        stop_reason: 'end_turn',
        usage: ANTHROPIC_RAW_USAGE,
      }));
      return;
    }

    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const word of ['Halo', ' dari', ' upstream', ' golden']) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: word } }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: CHAT_STREAM_RAW_USAGE,
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      finished = true;
      res.end();
      return;
    }

    finished = true;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_golden_1',
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Jawaban Chat tiruan' }, finish_reason: 'stop' }],
      usage: CHAT_NONSTREAM_RAW_USAGE,
    }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, stats });
    });
  });
}

async function waitSettled(db, reqId) {
  for (let i = 0; i < 120; i += 1) {
    const row = (await db.query('select * from request where id=$1', [reqId])).rows[0];
    if (row && row.settled_at !== null) return row;
    await delay(50);
  }
  throw new Error(`Request belum settle: ${reqId}`);
}

const databaseUrl = new URL(DB_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname));
assert.ok(databaseUrl.pathname === '/router_test_antigravity' || databaseUrl.pathname === '/router_test');

const root = createPool(databaseUrl.href);
let db;
let app;
let mock;
let vite;
let browser;

try {
  await root.query(`create schema "${schema}"`);
  databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
  db = createPool(databaseUrl.href);
  await migrate(db);

  mock = await startLoopbackMockUpstream();
  const mockChatBase = `http://127.0.0.1:${mock.port}/v1`;
  const mockAnthropicBase = `http://127.0.0.1:${mock.port}/anthropic`;

  const adminBoot = await bootstrapAdmin(db, key, {
    username: adminUsername,
    email: 'admin-golden@example.test',
    password: adminPassword,
  });
  const totpSeed = base32Decode(adminBoot.totpSecretBase32);

  app = await buildApp({
    db,
    key,
    mailer,
    secureCookies: false,
    resolveHost: offlinePublicResolver,
    publicBaseUrl: webBase,
    gateway: { unsafeAllowAnyUpstreamUrl: true },
  });
  await app.listen({ host: '127.0.0.1', port: apiPort });

  // ---- 1. Persiapan admin lewat API HTTP: upstream tiruan, model pengali 1.5x, route, paket & voucher, undangan pelanggan ----
  const adminApi = new CookieClient();
  assert.equal((await adminApi.post('/admin/api/login', { identifier: adminUsername, password: adminPassword })).status, 200);
  assert.equal((await adminApi.post('/admin/api/second-factor', { code: adminBoot.recoveryCodes[0] })).status, 200);

  // Sisipkan upstream tiruan loopback langsung di DB (API admin /upstreams sengaja mewajibkan HTTPS publik; gateway.test.ts memakai pola yang sama)
  const upRow = (await db.query(
    `insert into upstream(name, status, base_url_chat, base_url_anthropic, key_enc, key_set_at, terms_note)
     values($1, 'PENDING', $2, $3, $4, now(), $5) returning id, version`,
    ['Upstream Golden Tiruan', mockChatBase, mockAnthropicBase, seal(key, Buffer.from(upstreamApiKey)), 'Loopback mock upstream untuk golden path.'],
  )).rows[0];

  const upEligibleRes = await adminApi.post(`/admin/api/upstreams/${upRow.id}/status`, {
    status: 'ELIGIBLE',
    expectedVersion: String(upRow.version),
    reason: 'Siap uji golden path loopback',
  });
  assert.equal(upEligibleRes.status, 200);

  const publicModelId = 'gp/model-15x';
  const modelRes = await adminApi.post('/admin/api/models', { id: publicModelId, displayName: 'Golden Model 1.5x' });
  assert.equal(modelRes.status, 201);

  const draftRes = await adminApi.post('/admin/api/models/price/draft', {
    id: publicModelId,
    expectedVersion: modelRes.json.version,
    inputRateMicro: String(PUBLISHED_PRICE.inputRate),
    outputRateMicro: String(PUBLISHED_PRICE.outputRate),
    cacheReadRateMicro: String(PUBLISHED_PRICE.cacheReadRate),
    cacheWriteRateMicro: String(PUBLISHED_PRICE.cacheWriteRate),
    multiplier: '1.5',
  });
  assert.equal(draftRes.status, 200);

  const publishRes = await adminApi.post('/admin/api/models/price/publish', {
    id: publicModelId,
    expectedVersion: draftRes.json.version,
    reason: 'Terbit harga pengali 1.5x untuk golden path',
  });
  assert.equal(publishRes.status, 200);

  const chatRouteRes = await adminApi.post('/admin/api/routes', {
    modelId: publicModelId,
    upstreamId: upRow.id,
    protocol: 'CHAT',
    upstreamModel: 'mock-chat-model',
    priority: 10,
    enabled: true,
  });
  assert.equal(chatRouteRes.status, 201);

  const anthropicRouteRes = await adminApi.post('/admin/api/routes', {
    modelId: publicModelId,
    upstreamId: upRow.id,
    protocol: 'ANTHROPIC',
    upstreamModel: 'mock-anthropic-model',
    priority: 10,
    enabled: true,
  });
  assert.equal(anthropicRouteRes.status, 201);

  const packRes = await adminApi.post('/admin/api/packs', {
    name: 'Paket Golden 100',
    tokens: '100',
    displayPriceIdr: '200000',
    isPromo: false,
    active: true,
  });
  assert.equal(packRes.status, 201);

  const voucherRes = await adminApi.post('/admin/api/vouchers', {
    kind: 'SALE',
    packId: packRes.json.id,
    saleRef: 'GOLDEN-SALE-100',
    idempotencyKey: 'golden-voucher-issue-1',
  });
  assert.equal(voucherRes.status, 201);
  const voucherCode = voucherRes.json.code;
  assert.ok(voucherCode);

  const inviteRes = await adminApi.post('/admin/api/invites', { email: custEmail });
  assert.equal(inviteRes.status, 201);
  const inviteToken = mail.invites[0]?.token;
  assert.ok(inviteToken);
  const cust = await activateInvite(db, { token: inviteToken, username: custUsername, password: custPassword });

  // Jalankan Vite + Chromium
  vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    {
      cwd: new URL('..', import.meta.url),
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

  const pageErrors = [];
  const serverErrors = [];
  const secrets = [voucherCode, upstreamApiKey, promptMarker];

  // ---- 2. Pelanggan lewat UI: login, tukar voucher, buat API key & ambil secret sekali-tampil ----
  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custPage = await custCtx.newPage();
  attachListeners(custPage, 'cust', pageErrors, serverErrors);

  await custPage.goto(`${webBase}/masuk`);
  await expectVisible(custPage.getByRole('heading', { name: m.login, exact: true }), 'Halaman /masuk gagal terbuka');
  await custPage.getByLabel(m.identifier).fill(custUsername);
  await custPage.getByLabel(m.password, { exact: true }).fill(custPassword);
  await custPage.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.home, exact: true }), 'Login pelanggan gagal');

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.redeem, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.redeem, exact: true }), 'Halaman Isi saldo gagal');
  await custPage.getByLabel(m.redeemCode).fill(voucherCode);
  await custPage.getByRole('button', { name: m.redeemAction, exact: true }).click();
  await expectVisible(custPage.locator('section.receipt').getByRole('heading', { name: m.redeemed, exact: true }), 'Struk redeem tidak tampil');
  assert.equal((await ledger.getBalance(db, cust.tenantId)).posted, 100_000_000n);

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.keys, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.keys, exact: true }), 'Halaman API key gagal');
  await custPage.getByLabel(m.keyName).fill('Key Golden Path');
  await custPage.getByRole('button', { name: m.createKey, exact: true }).click();

  const secretDialog = custPage.getByRole('dialog', { name: m.secretTitle });
  await expectVisible(secretDialog, 'Dialog secret API key tidak tampil');
  const apiKeySecret = (await secretDialog.locator('pre.secret').textContent())?.trim() ?? '';
  assert.match(apiKeySecret, /^rtr_[A-Za-z0-9_-]{43}$/);
  secrets.push(apiKeySecret);

  await secretDialog.getByRole('button', { name: m.copiedDone, exact: true }).click();
  await secretDialog.waitFor({ state: 'hidden', timeout: 5_000 });
  assert.equal((await custPage.content()).includes(apiKeySecret), false, 'Secret tidak boleh bertahan di DOM');
  await assertCleanSecretHygiene(custPage, secrets, 'after-create-key');

  // ---- 3. Panggil /v1/chat/completions (non-stream & stream) serta /v1/messages dengan key tersebut ----
  const paddingText = ' kata'.repeat(120); // body > 600 byte agar jauh di atas token input mock (capInput tidak memotong)

  // Request 1: CHAT non-stream
  const r1 = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKeySecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: publicModelId,
      stream: false,
      max_tokens: 200,
      messages: [{ role: 'user', content: `${promptMarker} non-stream ${paddingText}` }],
    }),
  });
  assert.equal(r1.status, 200);
  const r1Id = r1.headers.get('x-request-id');
  const r1Body = await r1.json();
  assert.deepEqual(r1Body.usage, CHAT_NONSTREAM_RAW_USAGE, 'Usage respons /v1/chat/completions non-stream harus sama persis dengan upstream (tidak dikali multiplier)');
  const row1 = await waitSettled(db, r1Id);

  // Request 2: CHAT stream
  const r2 = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKeySecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: publicModelId,
      stream: true,
      max_tokens: 200,
      messages: [{ role: 'user', content: `${promptMarker} stream ${paddingText}` }],
    }),
  });
  assert.equal(r2.status, 200);
  const r2Id = r2.headers.get('x-request-id');
  const r2SseText = await r2.text();
  let streamUsage = null;
  for (const block of r2SseText.replace(/\r\n/g, '\n').split('\n\n')) {
    const dataLine = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!dataLine || dataLine === '[DONE]') continue;
    const parsed = JSON.parse(dataLine);
    if (parsed.usage) streamUsage = parsed.usage;
  }
  assert.deepEqual(streamUsage, CHAT_STREAM_RAW_USAGE, 'Usage pada SSE /v1/chat/completions stream harus sama persis dengan upstream');
  const row2 = await waitSettled(db, r2Id);

  // Request 3: ANTHROPIC /v1/messages
  const r3 = await fetch(`${apiBase}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': apiKeySecret, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: publicModelId,
      stream: false,
      max_tokens: 200,
      messages: [{ role: 'user', content: `${promptMarker} anthropic ${paddingText}` }],
    }),
  });
  assert.equal(r3.status, 200);
  const r3Id = r3.headers.get('x-request-id');
  const r3Body = await r3.json();
  assert.deepEqual(r3Body.usage, ANTHROPIC_RAW_USAGE, 'Usage respons /v1/messages harus sama persis dengan upstream');
  const row3 = await waitSettled(db, r3Id);

  // Upstream tidak pernah menerima secret key pelanggan
  assert.equal(mock.stats.requests.length, 3);
  for (const upReq of mock.stats.requests) {
    assert.equal(JSON.stringify(upReq.headers).includes(apiKeySecret), false, 'API key pelanggan tidak boleh dikirim ke upstream');
  }

  // Hitungan mikro-kredit integer eksak: debit = debitMicro(usage, publishedPrice)
  const expDebit1 = debitMicro({ input: 100, output: 40, cacheRead: 20, cacheWrite: 0 }, PUBLISHED_PRICE);
  const expDebit2 = debitMicro({ input: 120, output: 60, cacheRead: 40, cacheWrite: 0 }, PUBLISHED_PRICE);
  const expDebit3 = debitMicro({ input: 90, output: 30, cacheRead: 10, cacheWrite: 8 }, PUBLISHED_PRICE);
  assert.equal(expDebit1, 277_500n);
  assert.equal(expDebit2, 375_000n);
  assert.equal(expDebit3, 234_750n);

  assert.equal(BigInt(row1.debit), expDebit1);
  assert.equal(BigInt(row2.debit), expDebit2);
  assert.equal(BigInt(row3.debit), expDebit3);

  const totalDebit3 = expDebit1 + expDebit2 + expDebit3;
  assert.equal(totalDebit3, 887_250n);

  const balAfter3 = await ledger.getBalance(db, cust.tenantId);
  assert.equal(balAfter3.posted, 100_000_000n - totalDebit3, 'Saldo harus turun tepat sebesar jumlah ketiga debit');
  assert.equal(balAfter3.held, 0n);

  // ---- 4. UI pelanggan (Pemakaian & Transaksi) dan UI admin (Ringkasan) sebelum request ke-4 ----
  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.requests, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.requests, exact: true }), 'Halaman Pemakaian gagal');
  await expectVisible(custPage.locator('.request-row').first(), 'Baris request Pemakaian tidak tampil');
  assert.equal(await custPage.locator('.request-row').count(), 3, 'Pemakaian harus menampilkan tepat 3 request');
  const usageText = (await custPage.locator('main').innerText()).replace(/\s+/g, ' ');
  for (const debitLabel of [`0,2775 ${m.credits}`, `0,375 ${m.credits}`, `0,23475 ${m.credits}`]) {
    assert.ok(usageText.includes(debitLabel), `Debit ${debitLabel} tidak tampil di /pemakaian: ${usageText}`);
  }

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.ledger, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.ledger, exact: true }), 'Halaman Transaksi gagal');
  await expectVisible(custPage.locator('.data-row').first(), 'Baris Transaksi tidak tampil');
  assert.equal(await custPage.locator('.data-row').count(), 4, 'Transaksi harus menampilkan 1 redeem + 3 debit');
  const ledgerText = (await custPage.locator('main').innerText()).replace(/\s+/g, ' ');
  assert.ok(ledgerText.includes(kindText.DEBIT_USAGE), `Jenis entri ${kindText.DEBIT_USAGE} tidak tampil di /transaksi`);
  for (const debitLabel of [`-0,2775 ${m.credits}`, `-0,375 ${m.credits}`, `-0,23475 ${m.credits}`]) {
    assert.ok(ledgerText.includes(debitLabel), `Entri ${debitLabel} tidak tampil di /transaksi: ${ledgerText}`);
  }

  // UI Admin: /admin/ringkasan
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminCtx.newPage();
  attachListeners(adminPage, 'admin', pageErrors, serverErrors);

  const step = await safeTotpStep();
  await adminPage.goto(`${webBase}/admin/masuk`);
  await adminPage.getByLabel(m.identifier).fill(adminUsername);
  await adminPage.getByLabel(m.password, { exact: true }).fill(adminPassword);
  await adminPage.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(adminPage.getByLabel(m.code, { exact: true }), 'Input 2FA admin tidak tampil');
  await adminPage.getByLabel(m.code, { exact: true }).fill(totpAt(totpSeed, step));
  await adminPage.getByRole('button', { name: m.verify, exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: m.customers, exact: true }), 'Login admin UI gagal');

  await adminPage.locator('aside.desktop-nav nav').getByRole('link', { name: ov.overview, exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Halaman Ringkasan Operasi gagal');
  await expectVisible(adminPage.locator('section.metric', { hasText: ov.requests24hCard }), 'Kartu Request 24 jam tidak tampil');

  const req24CardText = (await adminPage.locator('section.metric', { hasText: ov.requests24hCard }).innerText()).replace(/\s+/g, ' ');
  assert.ok(req24CardText.includes(`${ov.requestsTotal} 3`) && req24CardText.includes('0,88725'), `Kartu Request 24 jam tidak cocok: ${req24CardText}`);
  const overviewData = await adminPage.evaluate(async () => (await fetch('/admin/api/overview')).json());
  assert.equal(overviewData.requests24h.total, 3);
  assert.equal(overviewData.requests24h.debitMicro, '887250');
  await adminCtx.close();

  // ---- 5. Stream diputus klien sesudah potongan pertama -> cek state akhir & 0 hold ACTIVE tersisa ----
  const abortController = new AbortController();
  const r4 = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKeySecret}`, 'content-type': 'application/json' },
    signal: abortController.signal,
    body: JSON.stringify({
      model: publicModelId,
      stream: true,
      max_tokens: 200,
      messages: [{ role: 'user', content: `${promptMarker} GOLDEN_ABORT_AFTER_FIRST ${paddingText}` }],
    }),
  });
  assert.equal(r4.status, 200);
  const r4Id = r4.headers.get('x-request-id');
  const reader = r4.body.getReader();
  const firstRead = await reader.read();
  assert.equal(firstRead.done, false, 'Potongan pertama SSE harus diterima sebelum memutus koneksi');
  const firstChunkText = new TextDecoder().decode(firstRead.value);
  assert.ok(firstChunkText.includes('Potongan pertama'), `Potongan pertama tidak sesuai: ${firstChunkText}`);

  abortController.abort();
  await reader.cancel().catch(() => {});

  const row4 = await waitSettled(db, r4Id);
  await delay(150);
  const activeHoldsAfterAbort = Number((await db.query("select count(*) c from hold where status='ACTIVE'")).rows[0].c);
  const holdRow4 = (await db.query('select status, amount, settled_debit from hold where request_id=$1', [r4Id])).rows[0];
  const balAfterAbort = await ledger.getBalance(db, cust.tenantId);

  assert.equal(activeHoldsAfterAbort, 0, 'Tidak boleh ada hold ACTIVE tertinggal sesudah stream terputus');
  assert.equal(balAfterAbort.held, 0n);
  assert.ok(mock.stats.aborts >= 1, 'Upstream tiruan harus menerima pembatalan koneksi saat klien memutus stream');
  process.stderr.write(
    `golden-path: cancelled-stream requestId=${r4Id} state=${row4.state} estimated=${row4.estimated} outcome=${row4.outcome} debitMicro=${row4.debit} holdStatus=${holdRow4.status} activeHolds=${activeHoldsAfterAbort}\n`,
  );

  // ---- 6. Cabut API key lewat UI -> panggilan berikutnya ditolak 401 -> invariantViolations kosong ----
  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.keys, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.keys, exact: true }), 'Halaman API key gagal dibuka kembali');
  const keyCard = custPage.locator('.data-row').filter({ hasText: 'Key Golden Path' });
  await keyCard.getByRole('button', { name: m.revoke, exact: true }).click();
  await expectVisible(keyCard.getByText(m.revokeQuestion), 'Konfirmasi cabut key tidak tampil');
  await keyCard.getByRole('button', { name: m.revokeKey, exact: true }).click();
  await expectVisible(custPage.getByText(m.revoked, { exact: true }), 'Pesan pencabutan API key tidak tampil');
  await expectVisible(keyCard.getByText(statusText.REVOKED, { exact: true }), 'Badge status Dicabut tidak tampil');

  const afterRevokeChat = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKeySecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: publicModelId, messages: [{ role: 'user', content: 'after revoke' }] }),
  });
  assert.equal(afterRevokeChat.status, 401, 'Key yang dicabut harus ditolak 401 di /v1/chat/completions');
  assert.equal((await afterRevokeChat.json())?.error?.code, 'key_revoked');

  const afterRevokeAnthropic = await fetch(`${apiBase}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': apiKeySecret, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: publicModelId, max_tokens: 10, messages: [{ role: 'user', content: 'after revoke' }] }),
  });
  assert.equal(afterRevokeAnthropic.status, 401, 'Key yang dicabut harus ditolak 401 di /v1/messages');
  assert.equal((await afterRevokeAnthropic.json())?.error?.type, 'key_revoked');

  await assertCleanSecretHygiene(custPage, secrets, 'final');
  await custCtx.close();

  // Pastikan prompt & secret tidak pernah masuk ke tabel audit maupun metadata request
  const dbTextDump = JSON.stringify({
    audits: (await db.query('select action, target_type, target_id, summary from audit_event')).rows,
    requests: (await db.query('select id, state, outcome, usage_raw, usage_norm from request')).rows,
  });
  assert.equal(dbTextDump.includes(promptMarker), false, 'Isi prompt tidak boleh tersimpan di DB/audit');
  assert.equal(dbTextDump.includes(apiKeySecret), false, 'Secret API key tidak boleh tersimpan di DB/audit');
  assert.equal(dbTextDump.includes(upstreamApiKey), false, 'API key upstream tidak boleh tersimpan di audit');

  assert.deepEqual(await ledger.invariantViolations(db), []);
  assert.deepEqual(pageErrors, [], `Terdapat pageerror: ${pageErrors.join(' | ')}`);
  assert.deepEqual(serverErrors, [], `Terdapat respons >=500: ${serverErrors.join(' | ')}`);

  console.log(`golden-path-local-verify: PASS (cancelled_state=${row4.state}, cancelled_outcome=${row4.outcome}, cancelled_debit=${row4.debit}, active_holds=0)`);
} finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
  if (app) await app.close();
  if (mock?.server) {
    mock.server.closeAllConnections();
    mock.server.close();
  }
  if (db) await db.end();
  await root.query(`drop schema if exists "${schema}" cascade`);
  await root.end();
}
