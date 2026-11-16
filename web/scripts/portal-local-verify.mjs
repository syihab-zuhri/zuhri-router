import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createPool, withTx } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { activateInvite, createInvite } from '../../server/src/identity.ts';
import * as ledger from '../../server/src/ledger.ts';
import * as pricing from '../../server/src/pricing.ts';
import * as upstreams from '../../server/src/upstreams.ts';
import * as vouchers from '../../server/src/vouchers.ts';
import { DB_URL } from '../../server/test/helpers.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_portal_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);

const mail = { invites: [], resets: [] };
const mailer = {
  invite: async (to, token) => { mail.invites.push({ to, token }); },
  passwordReset: async (to, token) => { mail.resets.push({ to, token }); },
};

const offlinePublicResolver = async () => ['93.184.216.34'];
const adminUsername = 'admin_portal_verify';
const adminPassword = 'local-admin-portal-14';
const custOneUsername = 'portal_pelanggan_1';
const custTwoUsername = 'portal_pelanggan_2';
const custPassword = 'local-portal-pass-10';
const consoleLogs = [];

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
    search: location.search,
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

async function customerLogin(page, username, password) {
  await page.goto(`${webBase}/masuk`);
  await expectVisible(page.getByRole('heading', { name: 'Masuk', exact: true }), 'Halaman /masuk tidak terbuka');
  await page.getByLabel('Username atau email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Beranda', exact: true }), `Login ${username} gagal`);
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

  const admin = await bootstrapAdmin(db, key, {
    username: adminUsername,
    email: 'admin-portal@example.test',
    password: adminPassword,
  });

  await createInvite(db, { email: 'portal-cust1@example.test', adminUser: admin.userId }, mailer);
  const cust1 = await activateInvite(db, { token: mail.invites[0].token, username: custOneUsername, password: custPassword });

  await createInvite(db, { email: 'portal-cust2@example.test', adminUser: admin.userId }, mailer);
  const cust2 = await activateInvite(db, { token: mail.invites[1].token, username: custTwoUsername, password: custPassword });

  // Paket SALE & kode SALE
  const packSale = await vouchers.createPack(db, {
    name: 'Paket Portal 100',
    tokens: '100',
    displayPriceIdr: '200000',
    isPromo: false,
    active: true,
  }, admin.userId);
  const saleVoucher = await vouchers.issue(db, {
    kind: 'SALE',
    packId: packSale.id,
    saleRef: 'PORTAL-SALE-100',
    idempotencyKey: 'portal-sale-issue-1',
  }, admin.userId);
  assert.ok(saleVoucher.code, 'Kode SALE harus terbit');

  // Seed katalog model & upstream lokal offline (tanpa pernah menghubungi jaringan luar)
  const upstream = await upstreams.create(db, key, offlinePublicResolver, {
    name: 'Upstream Katalog Lokal',
    baseUrls: { CHAT: 'https://api.example.com/v1', ANTHROPIC: 'https://api.example.com', RESPONSES: 'https://api.example.com/v1' },
    apiKey: 'sk-portal-catalogue-offline-1',
    termsNote: 'Seed offline tanpa panggilan keluar.',
  }, admin.userId);
  await upstreams.setStatus(db, upstream.id, {
    status: 'ELIGIBLE',
    expectedVersion: upstream.version,
    reason: 'Siap uji katalog lokal offline tanpa panggilan keluar',
  }, admin.userId);

  const mUniform = await pricing.createModel(db, { id: 'portal/uniform-2x', displayName: 'Portal Uniform 2x', actorUser: admin.userId });
  const mUniformDraft = await pricing.saveDraft(db, {
    id: mUniform.id,
    expectedVersion: mUniform.version,
    price: pricing.priceInput({ multiplier: '2' }),
    actorUser: admin.userId,
  });
  await pricing.publish(db, {
    id: mUniform.id,
    expectedVersion: mUniformDraft.version,
    reason: 'Terbit harga uniform 2x',
    actorUser: admin.userId,
  });
  await upstreams.createRoute(db, {
    modelId: mUniform.id,
    upstreamId: upstream.id,
    protocol: 'CHAT',
    upstreamModel: 'uniform-2x-up',
    priority: 10,
    enabled: true,
  }, admin.userId);

  const mVaried = await pricing.createModel(db, { id: 'portal/varied-rates', displayName: 'Portal Varied Rates', actorUser: admin.userId });
  const mVariedDraft = await pricing.saveDraft(db, {
    id: mVaried.id,
    expectedVersion: mVaried.version,
    price: pricing.priceInput({
      multiplier: '1.5',
      inputRateMicro: '2000000',
      outputRateMicro: '4000000',
      cacheReadRateMicro: '500000',
      cacheWriteRateMicro: '1000000',
    }),
    actorUser: admin.userId,
  });
  await pricing.publish(db, {
    id: mVaried.id,
    expectedVersion: mVariedDraft.version,
    reason: 'Terbit harga varied 1.5x',
    actorUser: admin.userId,
  });
  await upstreams.createRoute(db, {
    modelId: mVaried.id,
    upstreamId: upstream.id,
    protocol: 'ANTHROPIC',
    upstreamModel: 'varied-anth',
    priority: 10,
    enabled: true,
  }, admin.userId);
  await upstreams.createRoute(db, {
    modelId: mVaried.id,
    upstreamId: upstream.id,
    protocol: 'RESPONSES',
    upstreamModel: 'varied-resp',
    priority: 20,
    enabled: true,
  }, admin.userId);

  const mArchived = await pricing.createModel(db, { id: 'portal/archived-model', displayName: 'Portal Archived Model', actorUser: admin.userId });
  await pricing.setModelArchived(db, {
    id: mArchived.id,
    archived: true,
    expectedVersion: mArchived.version,
    actorUser: admin.userId,
  });

  const mDraftOnly = await pricing.createModel(db, { id: 'portal/draft-only', displayName: 'Portal Draft Only', actorUser: admin.userId });
  await pricing.saveDraft(db, {
    id: mDraftOnly.id,
    expectedVersion: mDraftOnly.version,
    price: pricing.priceInput({ multiplier: '3' }),
    actorUser: admin.userId,
  });

  app = await buildApp({ db, key, mailer, secureCookies: false, resolveHost: offlinePublicResolver, publicBaseUrl: webBase });
  await app.listen({ host: '127.0.0.1', port: apiPort });

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

  // Hangatkan cache pre-bundling Vite sekali sebelum skenario berjalan
  {
    const warmCtx = await browser.newContext();
    const warmPage = await warmCtx.newPage();
    await warmPage.goto(`${webBase}/masuk`);
    await expectVisible(warmPage.getByRole('heading', { name: 'Masuk', exact: true }), 'Warmup Vite /masuk gagal');
    await warmCtx.close();
  }

  const pageErrors = [];
  const serverErrors = [];
  const secrets = [saleVoucher.code];

  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page1 = await ctx1.newPage();
  attachListeners(page1, 'cust1', pageErrors, serverErrors);

  // ---- 1. Tukar kode SALE ----
  await customerLogin(page1, custOneUsername, custPassword);
  await expectVisible(page1.getByText('Saldo tersedia: 0 kredit token', { exact: false }), 'Saldo awal harus 0');
  await expectVisible(page1.getByText('Paket Portal 100', { exact: true }), 'Paket aktif tidak tampil di beranda');

  await page1.locator('aside.desktop-nav nav').getByRole('link', { name: 'Isi saldo', exact: true }).click();
  await expectVisible(page1.getByRole('heading', { name: 'Isi saldo', exact: true }), 'Halaman Isi saldo gagal terbuka');

  // Kode salah ditolak dengan pesan benar
  await page1.getByLabel('Kode redeem').fill('ZR-SALAH-0000000-0000000-0000000');
  await page1.getByRole('button', { name: 'Tukar kode', exact: true }).click();
  await expectVisible(page1.getByText('Kode ini tidak dapat dipakai. Periksa penulisannya atau hubungi penjual.'), 'Pesan penolakan kode salah tidak tampil');
  assert.equal((await ledger.getBalance(db, cust1.tenantId)).posted, 0n, 'Kode salah tidak boleh menambah saldo');

  // Kode SALE sah -> saldo naik persis 100 kredit token
  await page1.getByLabel('Kode redeem').fill(saleVoucher.code);
  await page1.getByRole('button', { name: 'Tukar kode', exact: true }).click();
  const receipt = page1.locator('section.receipt');
  await expectVisible(receipt.getByRole('heading', { name: 'Saldo berhasil ditambah', exact: true }), 'Struk redeem tidak tampil');
  const receiptText = await receipt.innerText();
  assert.ok(receiptText.includes('100 kredit token'), `Nominal struk tidak cocok: ${receiptText}`);
  await expectVisible(page1.getByText('Saldo tersedia: 100 kredit token', { exact: false }), 'Saldo topbar tidak naik menjadi 100');

  const balAfterRedeem = await ledger.getBalance(db, cust1.tenantId);
  assert.equal(balAfterRedeem.posted, 100_000_000n, 'Saldo DB setelah redeem SALE harus tepat 100_000_000 mikro');
  const entriesAfterRedeem = await ledger.listEntries(db, cust1.tenantId);
  assert.equal(entriesAfterRedeem.length, 1, 'Harus terdapat tepat 1 entri GRANT_REDEEM');
  assert.ok(receiptText.includes(entriesAfterRedeem[0].id), 'Struk harus menampilkan ID transaksi ledger yang sama');

  // Menukar kode yang sama lagi oleh pemilik: replay idempotent, saldo tidak bertambah kedua kali
  await page1.getByLabel('Kode redeem').fill(saleVoucher.code);
  await page1.getByRole('button', { name: 'Tukar kode', exact: true }).click();
  await expectVisible(page1.getByText('Penukaran ini sudah tercatat. Tidak ada penambahan kedua.'), 'Pesan replay pemilik kode tidak tampil');
  assert.equal((await ledger.getBalance(db, cust1.tenantId)).posted, 100_000_000n, 'Replay tidak boleh menggandakan saldo');
  assert.equal((await ledger.listEntries(db, cust1.tenantId)).length, 1, 'Replay tidak boleh menggandakan entri');

  // Menukar kode yang sama oleh pelanggan lain ditolak sebagai code_unusable
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  attachListeners(page2, 'cust2', pageErrors, serverErrors);
  await customerLogin(page2, custTwoUsername, custPassword);
  await page2.locator('aside.desktop-nav nav').getByRole('link', { name: 'Isi saldo', exact: true }).click();
  await page2.getByLabel('Kode redeem').fill(saleVoucher.code);
  await page2.getByRole('button', { name: 'Tukar kode', exact: true }).click();
  await expectVisible(page2.getByText('Kode ini tidak dapat dipakai. Periksa penulisannya atau hubungi penjual.'), 'Pelanggan lain harus ditolak saat menukar kode yang sudah dipakai');
  assert.equal((await ledger.getBalance(db, cust2.tenantId)).posted, 0n, 'Pelanggan kedua tidak boleh mendapat saldo');
  await ctx2.close();

  await assertCleanSecretHygiene(page1, secrets, 'after-redeem');

  // ---- 2. Buat API key, tampil sekali, tidak ada di URL/storage/konsol, tidak tampil lagi setelah ditutup, cabut -> 401 ----
  await page1.locator('aside.desktop-nav nav').getByRole('link', { name: 'API key', exact: true }).click();
  await expectVisible(page1.getByRole('heading', { name: 'API key', exact: true }), 'Halaman API key tidak terbuka');

  await page1.getByLabel('Nama key').fill('Key Portal Dicabut');
  await page1.getByRole('button', { name: 'Buat API key', exact: true }).click();
  const secretDialog = page1.getByRole('dialog', { name: 'Salin secret sekarang' });
  await expectVisible(secretDialog, 'Dialog secret API key tidak tampil');
  const firstKeySecret = (await secretDialog.locator('pre.secret').textContent())?.trim() ?? '';
  assert.match(firstKeySecret, /^rtr_[A-Za-z0-9_-]{43}$/, 'Format secret API key tidak sesuai');
  secrets.push(firstKeySecret);

  await assertCleanSecretHygiene(page1, secrets, 'after-key-reveal');
  await secretDialog.getByRole('button', { name: 'Saya sudah menyalin', exact: true }).click();
  await secretDialog.waitFor({ state: 'hidden', timeout: 5_000 });

  assert.equal((await page1.content()).includes(firstKeySecret), false, 'Secret masih ada di DOM setelah dialog ditutup');
  await page1.reload();
  await expectVisible(page1.getByText('Key Portal Dicabut', { exact: true }), 'Key yang dibuat tidak tampil setelah muat ulang');
  assert.equal((await page1.content()).includes(firstKeySecret), false, 'Secret masih terlihat setelah muat ulang');
  await expectVisible(page1.getByText(`${firstKeySecret.slice(0, 12)}...`, { exact: true }), 'Prefix tersamar API key tidak tampil');

  // Uji key aktif diterima pada GET /v1/models
  const activeModelsRes = await fetch(`${apiBase}/v1/models`, {
    headers: { authorization: `Bearer ${firstKeySecret}` },
  });
  assert.equal(activeModelsRes.status, 200, 'Key aktif harus diterima GET /v1/models');
  const activeModelsBody = await activeModelsRes.json();
  const v1Ids = activeModelsBody.data.map(item => item.id);
  assert.ok(v1Ids.includes('portal/uniform-2x') && v1Ids.includes('portal/varied-rates'), 'Model terbit harus muncul di GET /v1/models');

  // Cabut key di UI -> ditolak di admission (GET /v1/models 401)
  const keyCard = page1.locator('.data-row').filter({ hasText: 'Key Portal Dicabut' });
  await keyCard.getByRole('button', { name: 'Cabut', exact: true }).click();
  await expectVisible(keyCard.getByText('Cabut key ini? Tool yang memakainya akan langsung ditolak.'), 'Konfirmasi cabut key tidak tampil');
  await keyCard.getByRole('button', { name: 'Cabut API key', exact: true }).click();
  await expectVisible(page1.getByText('Key sudah dicabut.', { exact: true }), 'Pesan key dicabut tidak tampil');
  await expectVisible(keyCard.getByText('Dicabut', { exact: true }), 'Badge status Dicabut tidak tampil');

  const revokedModelsRes = await fetch(`${apiBase}/v1/models`, {
    headers: { authorization: `Bearer ${firstKeySecret}` },
  });
  assert.equal(revokedModelsRes.status, 401, 'Key yang sudah dicabut harus ditolak 401 pada GET /v1/models');
  const revokedModelsBody = await revokedModelsRes.json();
  assert.equal(revokedModelsBody?.error?.code, 'key_revoked', 'Kode error key dicabut harus key_revoked');

  // Buat key kedua untuk men-seed 55 request selesai tanpa upstream
  await page1.getByLabel('Nama key').fill('Key Pemakaian Seed');
  await page1.getByRole('button', { name: 'Buat API key', exact: true }).click();
  const secretDialog2 = page1.getByRole('dialog', { name: 'Salin secret sekarang' });
  await expectVisible(secretDialog2, 'Dialog secret key kedua tidak tampil');
  const secondKeySecret = (await secretDialog2.locator('pre.secret').textContent())?.trim() ?? '';
  secrets.push(secondKeySecret);
  await secretDialog2.getByRole('button', { name: 'Saya sudah menyalin', exact: true }).click();
  await secretDialog2.waitFor({ state: 'hidden', timeout: 5_000 });

  // ---- 3. Seed 55 request selesai lewat fungsi server (tanpa upstream) & buktikan /pemakaian, /transaksi, dan pagination ----
  await withTx(db, async tx => {
    const snap = await pricing.snapshotForAdmission(tx, mUniform.id);
    assert.ok(snap, 'Snapshot harga harus tersedia');
    const snapJson = JSON.stringify({
      seq: snap.price.version,
      inputRate: String(snap.price.inputRate),
      outputRate: String(snap.price.outputRate),
      cacheReadRate: String(snap.price.cacheReadRate),
      cacheWriteRate: String(snap.price.cacheWriteRate),
      multiplierE4: String(snap.price.multiplierE4),
    });

    // Urutan i = 55 (paling lama) sampai i = 1 (paling baru) dengan debit khusus 1_250_000 pada i = 1
    for (let i = 55; i >= 1; i--) {
      const reqId = `req_${randomUUID()}`;
      const debit = i === 1 ? 1_250_000n : 100_000n;
      const holdAmt = i === 1 ? 2_000_000n : 200_000n;
      const held = await ledger.placeKeyHold(tx, { secret: secondKeySecret, requestId: reqId, amount: holdAmt, model: mUniform.id });
      const usage = i === 1 ? { input: 500, output: 125, cacheRead: 0, cacheWrite: 0 } : { input: 40, output: 10, cacheRead: 0, cacheWrite: 0 };
      await tx.query(
        `insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, debit, estimated, usage_norm, outcome, created_at, settled_at)
         values($1,$2,$3,$4,'CHAT',false,'SETTLED',$5,$6,2048,4096,$7,$8,false,$9::jsonb,'completed', now() - make_interval(mins => $10), now() - make_interval(mins => $10))`,
        [reqId, held.tenantId, held.keyId, mUniform.id, snap.priceVersionId, snapJson, String(holdAmt), String(debit), JSON.stringify(usage), i],
      );
      await ledger.settleHold(tx, { tenantId: held.tenantId, requestId: reqId, debit, ref: { requestId: reqId } });
    }
  });
  assert.deepEqual(await ledger.invariantViolations(db), []);

  // Total debit = 1_250_000 + 54 * 100_000 = 6_650_000; saldo akhir = 100_000_000 - 6_650_000 = 93_350_000 (93,35)
  const expectedFinalBalance = await ledger.getBalance(db, cust1.tenantId);
  assert.equal(expectedFinalBalance.posted, 93_350_000n, 'Saldo akhir harus 93_350_000 mikro');

  // Cek /pemakaian dan pagination (50 per halaman -> halaman 1 = 50, halaman 2 = 5)
  await page1.locator('aside.desktop-nav nav').getByRole('link', { name: 'Pemakaian', exact: true }).click();
  await expectVisible(page1.getByRole('heading', { name: 'Pemakaian', exact: true }), 'Halaman Pemakaian tidak terbuka');
  await expectVisible(page1.locator('.request-row').first(), 'Daftar request tidak tampil');
  assert.equal(await page1.locator('.request-row').count(), 50, 'Halaman pertama /pemakaian harus memuat 50 request');
  await expectVisible(page1.locator('.request-row').first().getByText('1,25 kredit token', { exact: true }), 'Debit request terbaru (1,25 kredit token) tidak cocok');

  await page1.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expectVisible(page1.getByRole('button', { name: 'Halaman awal', exact: true }), 'Tombol Halaman awal di /pemakaian tidak tampil');
  await page1.waitForFunction(() => document.querySelectorAll('.request-row').length === 5, { timeout: 10_000 });
  assert.equal(await page1.locator('.request-row').count(), 5, 'Halaman kedua /pemakaian harus memuat 5 request sisa');

  await page1.getByRole('button', { name: 'Halaman awal', exact: true }).click();
  await page1.waitForFunction(() => document.querySelectorAll('.request-row').length === 50, { timeout: 10_000 });

  // Cek /transaksi mencantumkan entri ledger yang sama dan pagination bekerja (56 entri -> halaman 1 = 50, halaman 2 = 6)
  await page1.locator('aside.desktop-nav nav').getByRole('link', { name: 'Transaksi', exact: true }).click();
  await expectVisible(page1.getByRole('heading', { name: 'Transaksi', exact: true }), 'Halaman Transaksi tidak terbuka');
  await expectVisible(page1.locator('.data-row').first(), 'Daftar transaksi tidak tampil');
  assert.equal(await page1.locator('.data-row').count(), 50, 'Halaman pertama /transaksi harus memuat 50 entri');

  const allLedgerEntries = await ledger.listEntries(db, cust1.tenantId, { limit: 100 });
  assert.equal(allLedgerEntries.length, 56, 'Total entri ledger harus 56 (1 redeem + 55 debit)');
  const newestEntryText = await page1.locator('.data-row').first().innerText();
  assert.ok(newestEntryText.includes('Pemakaian API'), `Entri terbaru harus Pemakaian API: ${newestEntryText}`);
  assert.ok(newestEntryText.includes('-1,25 kredit token'), `Nominal entri terbaru tidak cocok dengan ledger: ${newestEntryText}`);
  assert.ok(newestEntryText.includes(allLedgerEntries[0].id), `ID entri terbaru tidak cocok dengan ledger: ${newestEntryText}`);

  await page1.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await page1.waitForFunction(() => document.querySelectorAll('.data-row').length === 6, { timeout: 10_000 });
  assert.equal(await page1.locator('.data-row').count(), 6, 'Halaman kedua /transaksi harus memuat 6 entri sisa');
  await expectVisible(page1.locator('.data-row').last().getByText('100 kredit token', { exact: true }), 'Entri redeem awal tidak ditemukan di halaman kedua /transaksi');
  await page1.getByRole('button', { name: 'Halaman awal', exact: true }).click();
  await page1.waitForFunction(() => document.querySelectorAll('.data-row').length === 50, { timeout: 10_000 });

  // ---- 4. Halaman Model dan Harga (/model-harga) ----
  await page1.locator('aside.desktop-nav nav').getByRole('link', { name: 'Model dan Harga', exact: true }).click();
  await expectVisible(page1.getByRole('heading', { name: 'Model dan Harga', exact: true }), 'Halaman Model dan Harga tidak terbuka');

  const serverCatalogue = await page1.evaluate(async () => {
    const res = await fetch('/api/models');
    return { status: res.status, data: await res.json() };
  });
  assert.equal(serverCatalogue.status, 200);
  const catalogueIds = serverCatalogue.data.models.map(item => item.id);
  assert.deepEqual(catalogueIds, ['portal/uniform-2x', 'portal/varied-rates'], 'Katalog server hanya boleh berisi model terbit non-arsip dengan route layak');

  const uniformServer = serverCatalogue.data.models.find(item => item.id === 'portal/uniform-2x');
  assert.equal(uniformServer.multiplier, '2');
  const variedServer = serverCatalogue.data.models.find(item => item.id === 'portal/varied-rates');
  assert.equal(variedServer.multiplier, '1.5');
  assert.deepEqual(variedServer.creditsPerToken, {
    input: '0.000003',
    output: '0.000006',
    cacheRead: '0.00000075',
    cacheWrite: '0.0000015',
  });

  const uniformCard = page1.locator('.data-row').filter({ hasText: 'portal/uniform-2x' });
  await expectVisible(uniformCard, 'Model uniform tidak tampil di /model-harga');
  await expectVisible(uniformCard.getByText('x2', { exact: true }), 'Pengali x2 tidak tampil');
  await expectVisible(uniformCard.getByText('CHAT', { exact: true }), 'Protokol CHAT tidak tampil');

  const variedCard = page1.locator('.data-row').filter({ hasText: 'portal/varied-rates' });
  await expectVisible(variedCard, 'Model varied tidak tampil di /model-harga');
  const variedText = await variedCard.innerText();
  assert.ok(
    variedText.includes(`${variedServer.creditsPerToken.input.replace('.', ',')} kredit token`) &&
      variedText.includes(`${variedServer.creditsPerToken.output.replace('.', ',')} kredit token`) &&
      variedText.includes(`${variedServer.creditsPerToken.cacheRead.replace('.', ',')} kredit token`) &&
      variedText.includes(`${variedServer.creditsPerToken.cacheWrite.replace('.', ',')} kredit token`),
    `Tarif per kategori model varied tidak cocok dengan server: ${variedText}`,
  );
  assert.equal(await page1.getByText('portal/archived-model').count(), 0, 'Model diarsipkan tidak boleh tampil di /model-harga');
  assert.equal(await page1.getByText('portal/draft-only').count(), 0, 'Model tanpa harga terbit tidak boleh tampil di /model-harga');

  // Cek 360px reflow & kebersihan akhir
  await page1.setViewportSize({ width: 360, height: 640 });
  assert.equal(await page1.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Terdapat gulir horizontal di 360px');

  await page1.goto(`${webBase}/beranda`);
  await expectVisible(page1.getByRole('heading', { name: 'Beranda', exact: true }), 'Halaman Beranda tidak terbuka di akhir verifikasi');
  await expectVisible(page1.getByText('Saldo tersedia: 93,35 kredit token', { exact: false }), 'Saldo akhir di shell harus 93,35 kredit token');
  await assertCleanSecretHygiene(page1, secrets, 'portal-final');

  assert.deepEqual(pageErrors, [], `Terdapat pageerror: ${pageErrors.join('; ')}`);
  assert.deepEqual(serverErrors, [], `Terdapat error 5xx: ${serverErrors.join('; ')}`);

  await ctx1.close();
  process.stdout.write(
    'portal-local-verify: PASS (redeem SALE + replay/wrong reject + API key secret-once & revoke 401 + usage/ledger pagination + catalogue non-archived)\n',
  );
} finally {
  await browser?.close().catch(() => {});
  if (vite) {
    vite.kill('SIGTERM');
    await Promise.race([new Promise(resolve => vite.once('exit', resolve)), delay(3_000)]);
  }
  await app?.close().catch(() => {});
  await db?.end().catch(() => {});
  if (root) {
    if (/^web_portal_[a-f0-9]{32}$/.test(schema)) await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
    await root.end().catch(() => {});
  }
}
