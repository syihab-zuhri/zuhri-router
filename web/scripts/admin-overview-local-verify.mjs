import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createPool, withTx } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { activateInvite, authenticate, changeTenantStatus, createInvite, LIMITS, login } from '../../server/src/identity.ts';
import * as keys from '../../server/src/keys.ts';
import * as ledger from '../../server/src/ledger.ts';
import * as pricing from '../../server/src/pricing.ts';
import * as upstreams from '../../server/src/upstreams.ts';
import * as vouchers from '../../server/src/vouchers.ts';
import { seal, totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';
import { m, ov } from '../src/messages.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_overview_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);

const mail = { invites: [], resets: [] };
const mailer = {
  invite: async (to, token) => { mail.invites.push({ to, token }); },
  passwordReset: async (to, token) => { mail.resets.push({ to, token }); },
};

const offlinePublicResolver = async () => ['93.184.216.34'];
const adminUsername = 'admin_ov_verify';
const adminPassword = 'local-admin-overview-14';
const custOneUsername = 'ov_pelanggan_satu';
const custTwoUsername = 'ov_pelanggan_dua';
const custPassword = 'local-cust-overview-10';
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

const databaseUrl = new URL(DB_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname));
assert.ok(databaseUrl.pathname === '/router_test_antigravity' || databaseUrl.pathname === '/router_test');

const root = createPool(databaseUrl.href);
let db;
let app;
let mockServer;
let vite;
let browser;

try {
  await root.query(`create schema "${schema}"`);
  databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
  db = createPool(databaseUrl.href);
  await migrate(db);

  const adminBoot = await bootstrapAdmin(db, key, {
    username: adminUsername,
    email: 'admin-ov@example.test',
    password: adminPassword,
  });
  const totpSeed = base32Decode(adminBoot.totpSecretBase32);

  // Dua pelanggan: satu ditangguhkan (saldo positif + request), satu bersaldo minus lewat koreksi
  await createInvite(db, { email: 'ov-satu@example.test', adminUser: adminBoot.userId }, mailer);
  const custOne = await activateInvite(db, { token: mail.invites[0].token, username: custOneUsername, password: custPassword });

  await createInvite(db, { email: 'ov-dua@example.test', adminUser: adminBoot.userId }, mailer);
  const custTwo = await activateInvite(db, { token: mail.invites[1].token, username: custTwoUsername, password: custPassword });

  // Topup custOne 10 kredit (10_000_000 mikro), custTwo 1 kredit lalu koreksi -1,25 kredit (-250_000 mikro)
  await withTx(db, async tx => {
    await ledger.grantAdminTopup(tx, {
      tenantId: custOne.tenantId,
      amount: 10_000_000n,
      saleRef: 'OV-TOPUP-1',
      actorUser: adminBoot.userId,
      idemKey: 'ov-topup-1',
    });
    await ledger.grantAdminTopup(tx, {
      tenantId: custTwo.tenantId,
      amount: 1_000_000n,
      saleRef: 'OV-TOPUP-2',
      actorUser: adminBoot.userId,
      idemKey: 'ov-topup-2',
    });
    await ledger.adjust(tx, {
      tenantId: custTwo.tenantId,
      amount: -1_250_000n,
      reason: 'Koreksi saldo minus untuk verifikasi ringkasan',
      actorUser: adminBoot.userId,
      idemKey: 'ov-adjust-minus',
    });
  });

  // Model + 1 request SETTLED (debit 500_000), 1 request FAILED, 1 request UNRESOLVED (hold 750_000)
  const model = await pricing.createModel(db, { id: 'ov/test-model', displayName: 'Overview Test Model', actorUser: adminBoot.userId });
  const draft = await pricing.saveDraft(db, {
    id: model.id,
    expectedVersion: model.version,
    price: pricing.priceInput({ multiplier: '1' }),
    actorUser: adminBoot.userId,
  });
  await pricing.publish(db, {
    id: model.id,
    expectedVersion: draft.version,
    reason: 'Harga untuk seed ringkasan lokal',
    actorUser: adminBoot.userId,
  });

  const custLogin = await login(db, { identifier: custOneUsername, password: custPassword, ip: '127.0.0.1' });
  const custPrincipal = await authenticate(db, custLogin.token, 'CUSTOMER', LIMITS.customerIdleHours);
  assert.ok(custPrincipal, 'Principal pelanggan untuk seed gagal dibuat');
  const apiKey = await keys.create(
    db,
    custPrincipal,
    keys.policy({ name: 'Key Overview Seed', allowedModels: null, spendLimitMicro: null, expiresAt: null }),
    'ov-key-seed-1',
  );

  await withTx(db, async tx => {
    const snap = await pricing.snapshotForAdmission(tx, model.id);
    assert.ok(snap, 'Snapshot harga harus tersedia');
    const snapJson = JSON.stringify({
      seq: snap.price.version,
      inputRate: String(snap.price.inputRate),
      outputRate: String(snap.price.outputRate),
      cacheReadRate: String(snap.price.cacheReadRate),
      cacheWriteRate: String(snap.price.cacheWriteRate),
      multiplierE4: String(snap.price.multiplierE4),
    });

    const reqSettled = `req_${randomUUID()}`;
    const h1 = await ledger.placeKeyHold(tx, { secret: apiKey.secret, requestId: reqSettled, amount: 1_000_000n, model: model.id });
    await tx.query(
      `insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, debit, estimated, usage_norm, outcome, created_at, settled_at)
       values($1,$2,$3,$4,'CHAT',false,'SETTLED',$5,$6,1024,2048,'1000000','500000',false,$7::jsonb,'completed',now(),now())`,
      [reqSettled, h1.tenantId, h1.keyId, model.id, snap.priceVersionId, snapJson, JSON.stringify({ input: 300, output: 200, cacheRead: 0, cacheWrite: 0 })],
    );
    await ledger.settleHold(tx, { tenantId: h1.tenantId, requestId: reqSettled, debit: 500_000n, ref: { requestId: reqSettled } });

    const reqFailed = `req_${randomUUID()}`;
    const h2 = await ledger.placeKeyHold(tx, { secret: apiKey.secret, requestId: reqFailed, amount: 500_000n, model: model.id });
    await tx.query(
      `insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, debit, estimated, outcome, created_at, settled_at)
       values($1,$2,$3,$4,'CHAT',false,'FAILED',$5,$6,1024,2048,'500000','0',true,'all_routes_failed',now(),now())`,
      [reqFailed, h2.tenantId, h2.keyId, model.id, snap.priceVersionId, snapJson],
    );
    await ledger.settleHold(tx, { tenantId: h2.tenantId, requestId: reqFailed, debit: 0n, ref: { requestId: reqFailed } });

    const reqUnresolved = `req_${randomUUID()}`;
    const h3 = await ledger.placeKeyHold(tx, { secret: apiKey.secret, requestId: reqUnresolved, amount: 750_000n, model: model.id });
    await tx.query(
      `insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, estimated, outcome, created_at)
       values($1,$2,$3,$4,'RESPONSES',true,'UNRESOLVED',$5,$6,1024,2048,'750000',false,'process_lost_mid_stream',now())`,
      [reqUnresolved, h3.tenantId, h3.keyId, model.id, snap.priceVersionId, snapJson],
    );
  });

  // Tangguhkan custOne setelah seed request selesai
  await changeTenantStatus(db, {
    username: custOneUsername,
    to: 'SUSPENDED',
    expectedVersion: '1',
    reason: 'Uji pelanggan ditangguhkan pada ringkasan',
    actorUser: adminBoot.userId,
  });

  // Satu kode aktif belum ditukar (50 kredit)
  await vouchers.issue(db, {
    kind: 'SALE',
    tokens: '50',
    saleRef: 'OV-VOUCHER-ACTIVE-1',
    idempotencyKey: 'ov-voucher-active-1',
  }, adminBoot.userId);

  // Satu upstream PENDING (memakai resolver offline)
  await upstreams.create(db, key, offlinePublicResolver, {
    name: 'Upstream Overview Uji',
    baseUrls: { CHAT: 'https://api.example.com/v1' },
    apiKey: 'sk-ov-synthetic-key-1',
    termsNote: 'Seed upstream untuk ringkasan',
  }, adminBoot.userId);

  assert.deepEqual(await ledger.invariantViolations(db), []);

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

  vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ROUTER_API_TARGET: apiBase, WEB_PORT: String(webPort) },
      stdio: 'ignore',
    },
  );
  await waitFor(`${webBase}/`);

  browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    headless: true,
    args: ['--no-proxy-server'],
  });

  // Hangatkan cache Vite sekali agar konteks pengujian tidak terkena reload saat pre-bundling
  {
    const warmCtx = await browser.newContext();
    const warmPage = await warmCtx.newPage();
    await warmPage.goto(`${webBase}/masuk`);
    await expectVisible(warmPage.getByRole('heading', { name: m.login, exact: true }), 'Warmup Vite gagal');
    await warmCtx.close();
  }

  const adminCtx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await adminCtx.newPage();
  const pageErrors = [];
  const serverErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', res => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
  });

  const loginCode = await nextTotpCode(totpSeed);
  await page.goto(`${webBase}/admin/masuk`);
  await expectVisible(page.getByLabel(m.identifier), 'Form login admin tidak tampil');
  await page.getByLabel(m.identifier).fill(adminUsername);
  await page.getByLabel(m.password, { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(page.getByLabel(m.code, { exact: true }), 'Input 2FA tidak tampil');
  await page.getByLabel(m.code, { exact: true }).fill(loginCode);
  await page.getByRole('button', { name: m.verify, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Login admin tidak mendarat di Ringkasan Operasi');

  // Uji buka /admin/pelanggan lalu kembali ke /admin/ringkasan lewat Menu di 360px
  await page.getByRole('button', { name: m.menu, exact: true }).click();
  await page.getByRole('dialog', { name: m.menu }).getByRole('link', { name: m.customers, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: m.customers, exact: true, level: 1 }), 'Navigasi ke /admin/pelanggan lewat menu mobile gagal');
  await page.getByRole('button', { name: m.menu, exact: true }).click();
  await page.getByRole('dialog', { name: m.menu }).getByRole('link', { name: ov.overview, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Halaman Ringkasan Operasi tidak terbuka');

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Terdapat gulir horizontal di 360px');

  // Cocokkan seluruh angka dengan jawaban nyata GET /admin/api/overview
  const overviewJson = await page.evaluate(async () => {
    const res = await fetch('/admin/api/overview');
    return { status: res.status, data: await res.json() };
  });
  assert.equal(overviewJson.status, 200);
  assert.deepEqual(overviewJson.data.customers, { ACTIVE: 1, SUSPENDED: 1, CLOSED: 0 });
  assert.deepEqual(overviewJson.data.balances, {
    postedMicro: '9250000',
    heldMicro: '750000',
    positiveMicro: '9500000',
    negativeAccounts: 1,
    negativeMicro: '-250000',
  });
  assert.deepEqual(overviewJson.data.activeVouchers, { count: 1, amountMicro: '50000000' });
  assert.deepEqual(overviewJson.data.requests24h, { total: 3, failed: 1, estimated: 1, debitMicro: '500000' });
  assert.deepEqual(overviewJson.data.unresolved, { count: 1, heldMicro: '750000' });
  assert.deepEqual(overviewJson.data.upstreams, { PENDING: 1, ELIGIBLE: 0, BLOCKED: 0 });

  const metricText = async (heading) => (await page.locator('section.metric', { hasText: heading }).innerText()).replace(/\s+/g, ' ').trim();

  const custText = await metricText(ov.customersCard);
  assert.ok(custText.includes(`${ov.activeCustomers} 1`) && custText.includes(`${ov.suspendedCustomers} 1`) && custText.includes(`${ov.closedCustomers} 0`), `Kartu pelanggan tidak cocok: ${custText}`);

  const totalText = await metricText(ov.totalBalanceCard);
  assert.ok(totalText.includes('9,25') && totalText.includes(`${ov.positiveBalanceLabel} 9,5`), `Kartu total saldo tidak cocok: ${totalText}`);

  const heldText = await metricText(ov.heldBalanceCard);
  assert.ok(heldText.includes('0,75'), `Kartu saldo ditahan tidak cocok: ${heldText}`);

  const negCard = page.locator('section.metric', { hasText: ov.negativeAccountsCard });
  const negClass = (await negCard.getAttribute('class')) ?? '';
  assert.ok(negClass.includes('metric-warning'), 'Kartu akun bersaldo minus harus memiliki kelas peringatan');
  const negText = (await negCard.innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(negText.includes(ov.negativeAccountsAttention) && negText.includes('1') && negText.includes('-0,25'), `Kartu akun minus tidak cocok: ${negText}`);

  const voucherText = await metricText(ov.activeVouchersCard);
  assert.ok(voucherText.includes('1') && voucherText.includes(`50 ${m.credits}`), `Kartu kode aktif tidak cocok: ${voucherText}`);

  const reqText = await metricText(ov.requests24hCard);
  assert.ok(reqText.includes('0,5') && reqText.includes(`${ov.requestsTotal} 3`) && reqText.includes(`${ov.requestsFailed} 1`) && reqText.includes(`${ov.requestsEstimated} 1`), `Kartu request 24 jam tidak cocok: ${reqText}`);

  const unresText = await metricText(ov.unresolvedCard);
  assert.ok(unresText.includes('1') && unresText.includes('0,75'), `Kartu unresolved tidak cocok: ${unresText}`);

  const upText = await metricText(ov.upstreamsCard);
  assert.ok(upText.includes(`${m.stateText.PENDING} 1`) && upText.includes(`${m.stateText.ELIGIBLE} 0`) && upText.includes(`${m.stateText.BLOCKED} 0`), `Kartu upstream tidak cocok: ${upText}`);

  await expectVisible(page.getByText(ov.costUnavailableNote), 'Catatan biaya belum tersedia tidak tampil');
  await expectVisible(page.getByText(`${ov.generatedAt}:`, { exact: false }), 'Waktu generatedAt tidak tampil');

  // ---- Uji Kill Switch pada server nyata (Jeda -> 503 service_paused -> Lanjutkan -> 200) ----
  const gatewayCard = page.getByRole('region', { name: ov.gatewaySection });
  await expectVisible(gatewayCard.getByText(ov.gatewayRunning, { exact: true }), 'Status awal gateway harus Berjalan');
  await expectVisible(gatewayCard.getByText(ov.gatewayNeverChanged, { exact: true }), 'Status waktu perubahan awal harus belum pernah diubah');
  await expectVisible(gatewayCard.getByText(ov.gatewayNoActor, { exact: true }), 'Status pelaku awal harus belum ada');

  mockServer = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    void raw;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url?.includes('/messages')) {
      res.end(JSON.stringify({
        type: 'message',
        content: [{ type: 'text', text: 'Halo dari mock overview' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }));
      return;
    }
    if (req.url?.endsWith('/responses')) {
      res.end(JSON.stringify({
        id: 'resp_ov_1',
        object: 'response',
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Halo dari mock overview' }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }));
      return;
    }
    res.end(JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: 'Halo dari mock overview' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const mockAddr = mockServer.address();
  const mockPort = typeof mockAddr === 'object' && mockAddr ? mockAddr.port : 0;

  await createInvite(db, { email: 'ov-live@example.test', adminUser: adminBoot.userId }, mailer);
  const custLive = await activateInvite(db, {
    token: mail.invites.at(-1).token,
    username: 'ov_pelanggan_live',
    password: custPassword,
  });
  await withTx(db, tx => ledger.grantAdminTopup(tx, {
    tenantId: custLive.tenantId,
    amount: 50_000_000n,
    saleRef: 'OV-LIVE-SEED',
    actorUser: adminBoot.userId,
    idemKey: 'ov-live-topup-1',
  }));
  const liveLogin = await login(db, { identifier: 'ov_pelanggan_live', password: custPassword, ip: '127.0.0.1' });
  const livePrincipal = await authenticate(db, liveLogin.token, 'CUSTOMER', LIMITS.customerIdleHours);
  assert.ok(livePrincipal, 'Principal pelanggan live gagal dibuat');
  const liveKey = (await keys.create(
    db,
    livePrincipal,
    keys.policy({ name: 'Key Live Kill Switch', allowedModels: null, spendLimitMicro: null, expiresAt: null }),
    'ov-live-key-1',
  )).secret;

  const upLive = (await db.query(
    'insert into upstream(name, status, base_url_chat, base_url_anthropic, base_url_responses, key_enc, key_set_at) values($1,$2,$3,$4,$3,$5,now()) returning id',
    ['Upstream Overview Live', 'ELIGIBLE', `http://127.0.0.1:${mockPort}/v1`, `http://127.0.0.1:${mockPort}/anthropic`, seal(key, Buffer.from('sk-ov-live-mock-1'))],
  )).rows[0];
  for (const proto of ['CHAT', 'ANTHROPIC', 'RESPONSES']) {
    await db.query(
      'insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,1)',
      [model.id, upLive.id, proto, 'ok'],
    );
  }

  const callGateway = (path, token = liveKey) => fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.id, stream: false, max_tokens: 16, messages: [{ role: 'user', content: 'halo' }], input: 'halo' }),
  });

  assert.equal((await callGateway('/v1/chat/completions')).status, 200, 'Gateway sebelum dijeda harus mengembalikan 200');

  // Buka dua tab portal pelanggan SEBELUM admin menjeda (keduanya sudah berada di Beranda dengan status Berjalan & tanpa banner)
  let allowOneCustMe500 = false;
  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custPage = await custCtx.newPage();
  custPage.on('pageerror', err => pageErrors.push(`cust:${err.message}`));
  custPage.on('response', res => {
    if (res.status() >= 500) {
      if (allowOneCustMe500 && new URL(res.url()).pathname === '/api/me') {
        allowOneCustMe500 = false;
        return;
      }
      serverErrors.push(`cust:${res.status()} ${res.url()}`);
    }
  });
  await custPage.goto(`${webBase}/masuk`);
  await custPage.getByLabel(m.identifier).fill('ov_pelanggan_live');
  await custPage.getByLabel(m.password, { exact: true }).fill(custPassword);
  await custPage.getByRole('button', { name: m.login, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.home, exact: true }), 'Login pelanggan live tidak mendarat di Beranda');

  const custBanner = custPage.getByRole('status').filter({ hasText: m.servicePausedMessage });
  const serviceStatusRegion = custPage.getByRole('region', { name: m.serviceStatus });
  await expectVisible(serviceStatusRegion.getByText(m.serviceRunning, { exact: true }), 'Status awal di Beranda pelanggan harus Berjalan');
  assert.equal(await custBanner.count(), 0, 'Banner jeda tidak boleh tampil sebelum layanan dijeda');

  // Tab kedua pelanggan (berbagi sesi cookie di custCtx) untuk uji visibilitychange tanpa berpindah halaman
  const custVisPage = await custCtx.newPage();
  custVisPage.on('pageerror', err => pageErrors.push(`custVis:${err.message}`));
  custVisPage.on('response', res => {
    if (res.status() >= 500) serverErrors.push(`custVis:${res.status()} ${res.url()}`);
  });
  await custVisPage.goto(`${webBase}/beranda`);
  await expectVisible(custVisPage.getByRole('region', { name: m.serviceStatus }).getByText(m.serviceRunning, { exact: true }), 'Tab kedua pelanggan harus mulai dengan status Berjalan');
  const custVisBanner = custVisPage.getByRole('status').filter({ hasText: m.servicePausedMessage });
  assert.equal(await custVisBanner.count(), 0, 'Tab kedua pelanggan tidak boleh menampilkan banner jeda sebelum jeda');

  // Jeda layanan lewat UI dengan step-up wajib dan alasan wajib
  await db.query("update session set auth_at = now() - interval '10 minutes' where kind = 'ADMIN'");
  await gatewayCard.getByRole('button', { name: ov.pauseGateway, exact: true }).click();
  const pauseDialog = page.getByRole('dialog', { name: ov.pauseDialogTitle });
  await expectVisible(pauseDialog.getByText(ov.pauseImpact), 'Peringatan dampak jeda gateway tidak tampil');
  await pauseDialog.getByLabel(m.reason).fill('Uji jeda darurat ringkasan');
  await pauseDialog.getByRole('button', { name: ov.pauseGateway, exact: true }).click();

  const pauseStepUp = page.getByRole('dialog', { name: m.stepUp });
  await expectVisible(pauseStepUp, 'Dialog step-up untuk jeda gateway tidak muncul');
  await expectVisible(gatewayCard.getByText(ov.gatewayRunning, { exact: true }), 'Status tidak boleh berubah optimistis sebelum step-up');
  await pauseStepUp.getByLabel(m.code).fill(await nextTotpCode(totpSeed));
  await pauseStepUp.getByRole('button', { name: m.verify, exact: true }).click();

  await expectVisible(gatewayCard.getByText(ov.gatewayPaused, { exact: true }), 'Status gateway tidak berubah menjadi Dijeda');
  await expectVisible(gatewayCard.getByText(ov.gatewayPausedConfirmed), 'Konfirmasi jeda dari server tidak tampil');
  await expectVisible(gatewayCard.getByText(ov.gatewayPausedBanner), 'Banner layanan-dijeda tidak tampil');
  await expectVisible(gatewayCard.getByText('Uji jeda darurat ringkasan', { exact: true }), 'Alasan jeda tidak tampil');
  await expectVisible(gatewayCard.getByText(adminUsername, { exact: true }), 'Pelaku penjedaan tidak tampil');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Terdapat gulir horizontal 360px saat layanan-dijeda');

  await page.reload();
  await expectVisible(gatewayCard.getByText(ov.gatewayPaused, { exact: true }), 'Status Dijeda tidak bertahan setelah muat ulang');

  // Saat dijeda: /v1/chat/completions, /v1/messages, /v1/responses -> 503 service_paused + Retry-After: 60; /v1/models -> 200; key salah -> 401
  const chatPaused = await callGateway('/v1/chat/completions');
  assert.equal(chatPaused.status, 503);
  assert.equal(chatPaused.headers.get('retry-after'), '60');
  assert.equal((await chatPaused.json())?.error?.code, 'service_paused');

  const msgPaused = await callGateway('/v1/messages');
  assert.equal(msgPaused.status, 503);
  assert.equal(msgPaused.headers.get('retry-after'), '60');
  const msgPausedJson = await msgPaused.json();
  assert.equal(msgPausedJson?.type, 'error');
  assert.equal(msgPausedJson?.error?.type, 'service_paused');

  const respPaused = await callGateway('/v1/responses');
  assert.equal(respPaused.status, 503);
  assert.equal(respPaused.headers.get('retry-after'), '60');
  assert.equal((await respPaused.json())?.error?.code, 'service_paused');

  const wrongKeyPaused = await callGateway('/v1/chat/completions', `rtr_${'0'.repeat(43)}`);
  assert.equal(wrongKeyPaused.status, 401, 'Key salah tetap harus ditolak 401 saat gateway dijeda');

  const modelsPaused = await fetch(`${apiBase}/v1/models`, { headers: { authorization: `Bearer ${liveKey}` } });
  assert.equal(modelsPaused.status, 200, 'GET /v1/models harus tetap 200 saat gateway dijeda');
  assert.ok((await modelsPaused.json()).data.some(item => item.id === model.id));

  // 1) Tab kedua pelanggan: tanpa reload & tanpa berpindah halaman, visibilitychange memicu refetch /api/me -> banner muncul & Beranda menunjukkan Dijeda
  await custVisPage.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectVisible(custVisBanner, 'Banner jeda tidak muncul sesudah visibilitychange tanpa berpindah halaman');
  assert.equal(await custVisBanner.count(), 1, 'Banner jeda di tab visibilitychange harus tampil tepat satu kali');
  await expectVisible(custVisPage.getByRole('region', { name: m.serviceStatus }).getByText(m.servicePaused, { exact: true }), 'Status Beranda di tab visibilitychange tidak berubah menjadi Dijeda');
  assert.equal(new URL(custVisPage.url()).pathname, '/beranda', 'Tab visibilitychange harus tetap di /beranda tanpa navigasi');

  // 2) Tab utama pelanggan: tanpa reload, sesudah berpindah halaman (/beranda -> /isi-saldo) banner jeda muncul
  const mePaused = await custPage.evaluate(async () => {
    const res = await fetch('/api/me');
    return { status: res.status, data: await res.json() };
  });
  assert.equal(mePaused.status, 200, 'GET /api/me saat layanan dijeda harus 200');
  assert.equal(mePaused.data.servicePaused, true, 'GET /api/me harus mengembalikan servicePaused: true saat dijeda');
  assert.equal(JSON.stringify(mePaused.data).includes('Uji jeda darurat ringkasan'), false, 'Alasan jeda admin tidak boleh bocor ke /api/me pelanggan');

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.redeem, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.redeem, exact: true }), 'Halaman Isi saldo tidak terbuka saat layanan dijeda');
  await expectVisible(custBanner, 'Banner layanan dijeda tidak muncul tanpa muat ulang saat pelanggan berpindah halaman');
  assert.equal(await custBanner.count(), 1, 'Banner layanan dijeda harus tampil tepat satu kali di Isi saldo');

  // Simpan referensi elemen DOM banner, lalu berpindah ke /api-key -> elemen DOM banner harus tetap node yang sama
  const originalBannerHandle = await custBanner.elementHandle();
  assert.ok(originalBannerHandle, 'ElementHandle banner jeda tidak ditemukan');

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.keys, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.keys, exact: true }), 'Halaman API key tidak terbuka saat layanan dijeda');
  await expectVisible(custBanner, 'Banner layanan dijeda tidak tampil di halaman API key');
  assert.equal(await custBanner.count(), 1, 'Banner layanan dijeda tidak boleh ganda di halaman API key');
  const sameNodeAfterNav = await custBanner.evaluate((node, orig) => node === orig && orig.isConnected, originalBannerHandle);
  assert.equal(sameNodeAfterNav, true, 'Elemen DOM banner jeda harus tetap elemen yang sama sesudah berpindah halaman');

  // 3) Kegagalan /api/me satu kali saat pembacaan ulang: halaman tidak berganti layar galat & banner terakhir tetap tampil
  let failedOnceCount = 0;
  allowOneCustMe500 = true;
  await custPage.route('**/api/me', async route => {
    if (failedOnceCount === 0) {
      failedOnceCount++;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal_error', message: 'Transient refetch failure' } }),
      });
      return;
    }
    await route.continue();
  });
  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.home, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.home, exact: true }), 'Beranda tidak tampil saat /api/me gagal sekali');
  await custPage.waitForFunction(() => document.querySelectorAll('main.standalone').length === 0, null, { timeout: 5_000 });
  assert.equal(failedOnceCount, 1, 'Intersepsi kegagalan /api/me satu kali harus terpicu');
  assert.equal(await custPage.getByRole('heading', { name: m.failed, exact: true }).count(), 0, 'Halaman tidak boleh berganti ke layar galat saat pembacaan ulang /api/me gagal');
  await expectVisible(custBanner, 'Banner jeda terakhir harus tetap tampil saat pembacaan ulang /api/me gagal sekali');
  await expectVisible(serviceStatusRegion.getByText(m.servicePaused, { exact: true }), 'Status Dijeda di Beranda harus tetap bertahan saat pembacaan ulang /api/me gagal');
  const sameNodeAfterFailedRefetch = await custBanner.evaluate((node, orig) => node === orig && orig.isConnected, originalBannerHandle);
  assert.equal(sameNodeAfterFailedRefetch, true, 'Elemen banner harus tetap utuh sesudah kegagalan refetch /api/me');
  await custPage.unroute('**/api/me');

  // Lanjutkan layanan lewat UI dengan konfirmasi + step-up -> panggilan gateway kembali berhasil 200
  await db.query("update session set auth_at = now() - interval '10 minutes' where kind = 'ADMIN'");
  await gatewayCard.getByRole('button', { name: ov.resumeGateway, exact: true }).click();
  const resumeDialog = page.getByRole('dialog', { name: ov.resumeDialogTitle });
  await expectVisible(resumeDialog.getByText(ov.resumeImpact), 'Peringatan konfirmasi lanjutkan gateway tidak tampil');
  await resumeDialog.getByRole('button', { name: ov.resumeGateway, exact: true }).click();

  const resumeStepUp = page.getByRole('dialog', { name: m.stepUp });
  await expectVisible(resumeStepUp, 'Dialog step-up untuk melanjutkan gateway tidak muncul');
  await resumeStepUp.getByLabel(m.code).fill(await nextTotpCode(totpSeed));
  await resumeStepUp.getByRole('button', { name: m.verify, exact: true }).click();

  await expectVisible(gatewayCard.getByText(ov.gatewayRunning, { exact: true }), 'Status gateway tidak kembali menjadi Berjalan');
  await expectVisible(gatewayCard.getByText(ov.gatewayResumedConfirmed), 'Konfirmasi lanjutkan layanan dari server tidak tampil');
  assert.equal((await callGateway('/v1/chat/completions')).status, 200, 'Gateway setelah dilanjutkan harus kembali mengembalikan 200');
  assert.deepEqual(await ledger.invariantViolations(db), []);

  // 4) Tanpa muat ulang halaman: pelanggan berpindah halaman lagi -> banner hilang, lalu kembali ke Beranda -> status Berjalan
  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.redeem, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.redeem, exact: true }), 'Navigasi ke Isi saldo sesudah resume gagal');
  await custBanner.waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await custBanner.count(), 0, 'Banner layanan dijeda harus hilang tanpa reload sesudah pelanggan berpindah halaman');

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: m.home, exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: m.home, exact: true }), 'Kembali ke Beranda sesudah resume gagal');
  await expectVisible(serviceStatusRegion.getByText(m.serviceRunning, { exact: true }), 'Beranda pelanggan harus kembali menunjukkan status Berjalan tanpa reload');
  assert.equal(await custBanner.count(), 0, 'Banner jeda tetap tidak tampil di Beranda sesudah layanan dilanjutkan');

  const meResumed = await custPage.evaluate(async () => {
    const res = await fetch('/api/me');
    return { status: res.status, data: await res.json() };
  });
  assert.equal(meResumed.status, 200, 'GET /api/me sesudah layanan dilanjutkan harus 200');
  assert.equal(meResumed.data.servicePaused, false, 'GET /api/me harus mengembalikan servicePaused: false sesudah dilanjutkan');
  await originalBannerHandle.dispose();
  await custCtx.close();

  const auditRows = (await db.query("select action from audit_event where action in ('setting.gateway_pause', 'setting.gateway_resume') order by id")).rows.map(r => r.action);
  assert.deepEqual(auditRows, ['setting.gateway_pause', 'setting.gateway_resume'], 'Audit pause dan resume harus tercatat');

  // Uji tautan ke /admin/rekonsiliasi dan /admin/upstream
  await page.getByRole('link', { name: ov.openUnresolved, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: m.unresolved, exact: true }), 'Tautan ke /admin/rekonsiliasi gagal');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('aside.desktop-nav nav').getByRole('link', { name: ov.overview, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: ov.overviewTitle, exact: true }), 'Kembali ke /admin/ringkasan gagal');
  await page.getByRole('link', { name: ov.openUpstreams, exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: m.upstreams, exact: true }), 'Tautan ke /admin/upstream gagal');

  assert.deepEqual(pageErrors, [], `Terdapat pageerror: ${pageErrors.join('; ')}`);
  assert.deepEqual(serverErrors, [], `Terdapat server error 5xx: ${serverErrors.join('; ')}`);

  await adminCtx.close();
  process.stdout.write('admin-overview-local-verify: PASS (real server overview metrics, kill switch pause/503/resume/200, live customer banner via nav+visibilitychange+same-node+500-retention, negative warning, 360px, links)\n');
} finally {
  await browser?.close().catch(() => {});
  if (mockServer) {
    mockServer.closeAllConnections?.();
    mockServer.close();
  }
  if (vite) {
    vite.kill('SIGTERM');
    await Promise.race([new Promise(resolve => vite.once('exit', resolve)), delay(3_000)]);
  }
  await app?.close().catch(() => {});
  await db?.end().catch(() => {});
  if (root) {
    if (/^web_overview_[a-f0-9]{32}$/.test(schema)) await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
    await root.end().catch(() => {});
  }
}
