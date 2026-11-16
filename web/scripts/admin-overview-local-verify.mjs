import assert from 'node:assert/strict';
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
import { totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';

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

async function safeTotpStep() {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 4_500) await delay(remaining + 300);
  return totpStep(Date.now());
}

const databaseUrl = new URL(DB_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname));
assert.ok(databaseUrl.pathname === '/router_test_antigravity' || databaseUrl.pathname === '/router_test');

const root = createPool(databaseUrl.href);
let db;
let app;
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

  app = await buildApp({ db, key, mailer, secureCookies: false, resolveHost: offlinePublicResolver, publicBaseUrl: webBase });
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

  const adminCtx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await adminCtx.newPage();
  const pageErrors = [];
  const serverErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('response', res => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
  });

  const step = await safeTotpStep();
  await page.goto(`${webBase}/admin/masuk`, { waitUntil: 'networkidle' });
  await page.getByLabel('Username atau email').fill(adminUsername);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(page.getByLabel('Kode autentikator', { exact: true }), 'Input 2FA tidak tampil');
  await page.getByLabel('Kode autentikator', { exact: true }).fill(totpAt(totpSeed, step));
  await page.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Pelanggan', exact: true }), 'Login admin gagal');

  // Buka /admin/ringkasan lewat Menu di 360px
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Ringkasan', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Ringkasan Operasi', exact: true }), 'Halaman Ringkasan Operasi tidak terbuka');

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

  const custText = await metricText('Pelanggan');
  assert.ok(custText.includes('Aktif 1') && custText.includes('Ditangguhkan 1') && custText.includes('Ditutup 0'), `Kartu pelanggan tidak cocok: ${custText}`);

  const totalText = await metricText('Total saldo tercatat');
  assert.ok(totalText.includes('9,25') && totalText.includes('Saldo positif 9,5'), `Kartu total saldo tidak cocok: ${totalText}`);

  const heldText = await metricText('Saldo ditahan');
  assert.ok(heldText.includes('0,75'), `Kartu saldo ditahan tidak cocok: ${heldText}`);

  const negCard = page.locator('section.metric', { hasText: 'Akun bersaldo minus' });
  const negClass = (await negCard.getAttribute('class')) ?? '';
  assert.ok(negClass.includes('metric-warning'), 'Kartu akun bersaldo minus harus memiliki kelas peringatan');
  const negText = (await negCard.innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(negText.includes('Perlu perhatian') && negText.includes('1') && negText.includes('-0,25'), `Kartu akun minus tidak cocok: ${negText}`);

  const voucherText = await metricText('Kode aktif belum ditukar');
  assert.ok(voucherText.includes('1') && voucherText.includes('50 kredit token'), `Kartu kode aktif tidak cocok: ${voucherText}`);

  const reqText = await metricText('Request 24 jam');
  assert.ok(reqText.includes('0,5') && reqText.includes('Total request 3') && reqText.includes('Gagal 1') && reqText.includes('Estimasi 1'), `Kartu request 24 jam tidak cocok: ${reqText}`);

  const unresText = await metricText('Request menunggu keputusan');
  assert.ok(unresText.includes('1') && unresText.includes('0,75'), `Kartu unresolved tidak cocok: ${unresText}`);

  const upText = await metricText('Upstream aktif (non-arsip)');
  assert.ok(upText.includes('Menunggu tinjauan 1') && upText.includes('Layak 0') && upText.includes('Diblokir 0'), `Kartu upstream tidak cocok: ${upText}`);

  await expectVisible(page.getByText('Angka biaya upstream, margin, dan kill switch belum tersedia dari server.'), 'Catatan biaya belum tersedia tidak tampil');
  await expectVisible(page.getByText('Diperbarui pada:', { exact: false }), 'Waktu generatedAt tidak tampil');

  // Uji tautan ke /admin/rekonsiliasi dan /admin/upstream
  await page.getByRole('link', { name: 'Buka Request dan Rekonsiliasi', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Request belum diputuskan', exact: true }), 'Tautan ke /admin/rekonsiliasi gagal');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('aside.desktop-nav nav').getByRole('link', { name: 'Ringkasan', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Ringkasan Operasi', exact: true }), 'Kembali ke /admin/ringkasan gagal');
  await page.getByRole('link', { name: 'Buka Upstream dan Route', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Upstream dan Route', exact: true }), 'Tautan ke /admin/upstream gagal');

  assert.deepEqual(pageErrors, [], `Terdapat pageerror: ${pageErrors.join('; ')}`);
  assert.deepEqual(serverErrors, [], `Terdapat server error 5xx: ${serverErrors.join('; ')}`);

  await adminCtx.close();
  process.stdout.write('admin-overview-local-verify: PASS (real server overview metrics, negative warning, 360px, links)\n');
} finally {
  await browser?.close().catch(() => {});
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
