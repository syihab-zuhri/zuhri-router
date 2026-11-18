import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createPool } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import * as ledger from '../../server/src/ledger.ts';
import * as pricing from '../../server/src/pricing.ts';
import { totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_admin_cust_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);

const capturedTokens = [];
const consoleLogs = [];
const mailer = {
  invite: async (_to, token) => {
    capturedTokens.push(token);
    throw new Error('manual_delivery_channel');
  },
  passwordReset: async (_to, token) => {
    capturedTokens.push(token);
  },
};

const adminUsername = 'admin_cust_verify';
const adminPassword = 'local-admin-pass-verify-14';
const invitedEmail = 'pelanggan.baru@example.test';
const customerUsername = 'pelanggan_baru';
const customerPassword = 'local-customer-pass-10';
const modelId = 'local/admission-check';
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
  return locator.waitFor({ state: 'visible', timeout: 10_000 }).catch(err => {
    throw new Error(`${message}: ${err instanceof Error ? err.message : String(err)}`);
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
  // Navigation state (selected customer, tab, list cursors) may live in the query string; nothing else may.
  const allowedQuery = new Set(['customer', 'tab', 'keyAfter', 'prefix', 'after', 'before']);
  for (const key of new URLSearchParams(state.search).keys()) assert.ok(allowedQuery.has(key), `${label}: parameter URL tak terduga (${key})`);
  assert.equal(state.hash, '', `${label}: fragment URL tidak kosong (${state.hash})`);
  const storageDump = JSON.stringify([state.localStorageEntries, state.sessionStorageEntries]);
  for (const secret of secrets) {
    assert.ok(secret && secret.length >= 6, 'Secret pembanding harus terisi');
    assert.equal(state.href.includes(secret), false, `${label}: secret bocor di URL`);
    assert.equal(storageDump.includes(secret), false, `${label}: secret bocor di storage`);
    for (const entry of consoleLogs) {
      assert.equal(entry.includes(secret), false, `${label}: secret bocor di log konsol`);
    }
  }
}

function attachListeners(page, tag) {
  page.on('console', msg => {
    const line = `${tag}:${msg.type()}:${msg.text()}`;
    consoleLogs.push(line);
    process.stderr.write(`${line}\n`);
  });
  page.on('response', res => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith('/api/') || path.startsWith('/admin/api/')) {
      process.stderr.write(`${tag}:api:${res.status()}:${path}\n`);
    }
  });
}

async function expireAdminStepUp(db, adminUserId) {
  await db.query(
    "update session set auth_at = clock_timestamp() - interval '10 minutes' where user_id = $1 and kind = 'ADMIN'",
    [adminUserId],
  );
  await db.query('update admin_credential set last_totp_step = 0 where user_id = $1', [adminUserId]);
}

async function completeStepUpDialog(adminPage, totpSeed, usedSecrets, contextLabel) {
  const stepUpDialog = adminPage.getByRole('dialog', { name: 'Verifikasi ulang admin' });
  await expectVisible(stepUpDialog, `Dialog step-up tidak tampil untuk ${contextLabel}`);
  const step = await safeTotpStep();
  const code = totpAt(totpSeed, step);
  usedSecrets.push(code);
  await stepUpDialog.getByLabel('Kode autentikator').fill(code);
  await stepUpDialog.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
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
    email: 'admin-cust-verify@example.test',
    password: adminPassword,
  });
  const totpSeed = base32Decode(adminBoot.totpSecretBase32);
  const usedSecrets = [...adminBoot.recoveryCodes];

  // Siapkan satu model dengan harga terbit (tanpa upstream nyata) untuk menguji tahap admission /v1/chat/completions
  const createdModel = await pricing.createModel(db, {
    id: pricing.modelId(modelId),
    displayName: 'Local Admission Test Model',
    actorUser: adminBoot.userId,
  });
  const draftModel = await pricing.saveDraft(db, {
    id: pricing.modelId(modelId),
    expectedVersion: pricing.versionOf(createdModel.version),
    price: pricing.priceInput({
      inputRate: '1',
      outputRate: '1',
      cacheReadRate: '0',
      cacheWriteRate: '0',
      multiplier: '1',
    }),
    actorUser: adminBoot.userId,
  });
  await pricing.publish(db, {
    id: pricing.modelId(modelId),
    expectedVersion: pricing.versionOf(draftModel.version),
    reason: 'Model lokal untuk verifikasi admission tanpa upstream',
    actorUser: adminBoot.userId,
  });

  app = await buildApp({
    db,
    key,
    mailer,
    secureCookies: false,
    publicBaseUrl: webBase,
  });
  await app.listen({ host: '127.0.0.1', port: apiPort });

  vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        ROUTER_API_TARGET: apiBase,
        WEB_PORT: String(webPort),
      },
      stdio: 'ignore',
    },
  );
  await waitFor(`${webBase}/`);

  browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    headless: true,
    args: ['--no-proxy-server'],
  });

  // Pemanasan bundel Vite agar navigasi pertama tidak terputus oleh optimizeDeps
  {
    const warmCtx = await browser.newContext();
    const warmPage = await warmCtx.newPage();
    await warmPage.goto(`${webBase}/masuk`, { waitUntil: 'networkidle' });
    await warmCtx.close();
  }

  // ---- 1. Admin mengundang email baru, tautan aktivasi tampil, pelanggan aktivasi & masuk ----
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminCtx.newPage();
  attachListeners(adminPage, 'admin');

  const loginStep = await safeTotpStep();
  const loginTotp = totpAt(totpSeed, loginStep);
  usedSecrets.push(loginTotp);

  await adminPage.goto(`${webBase}/admin/masuk`, { waitUntil: 'networkidle' });
  await expectVisible(adminPage.getByRole('heading', { name: 'Masuk admin', exact: true }), 'Halaman login admin tidak tampil');
  await adminPage.getByLabel('Username atau email').fill(adminUsername);
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword);
  await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(adminPage.getByLabel('Kode autentikator', { exact: true }), 'Input 2FA login admin tidak tampil');
  await adminPage.getByLabel('Kode autentikator', { exact: true }).fill(loginTotp);
  await adminPage.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Pelanggan', exact: true }), 'Halaman /admin/pelanggan tidak tampil setelah login');
  await assertCleanSecretHygiene(adminPage, usedSecrets, 'admin-after-login');

  const inviteForm = adminPage.locator('form').filter({ hasText: 'Undang pelanggan' });
  await inviteForm.getByLabel('Email').fill(invitedEmail);
  await inviteForm.getByRole('button', { name: 'Undang pelanggan', exact: true }).click();

  await expectVisible(adminPage.getByRole('heading', { name: 'Undangan dibuat', exact: true }), 'Bukti undangan dibuat tidak tampil');
  await expectVisible(
    adminPage.getByText('Email tidak dikirim otomatis. Kirim tautan aktivasi ini kepada pelanggan lewat kanal Anda sendiri.'),
    'Pesan pengiriman manual tautan aktivasi tidak tampil',
  );
  const activationLinkLocator = adminPage.getByLabel('Tautan aktivasi');
  await expectVisible(activationLinkLocator, 'Tautan aktivasi tidak tampil di layar');
  const activationLink = (await activationLinkLocator.textContent())?.trim() ?? '';
  assert.equal(capturedTokens.length, 1, 'Token undangan harus tercatat tepat sekali');
  const inviteToken = capturedTokens[0];
  usedSecrets.push(inviteToken);
  assert.equal(activationLink, `${webBase}/aktivasi#token=${inviteToken}`, 'Format tautan aktivasi tidak sesuai');
  await assertCleanSecretHygiene(adminPage, usedSecrets, 'admin-after-invite');

  // Pelanggan membuka tautan aktivasi, memilih username dan password, lalu masuk
  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custPage = await custCtx.newPage();
  attachListeners(custPage, 'cust');

  await custPage.goto(activationLink, { waitUntil: 'networkidle' });
  await expectVisible(custPage.getByRole('heading', { name: 'Aktivasi undangan', exact: true }), 'Halaman aktivasi undangan tidak tampil');
  // Begitu halaman aktivasi termuat, bootstrap.ts harus sudah menghapus #token=... dari URL
  await assertCleanSecretHygiene(custPage, usedSecrets, 'customer-on-activate-page');

  await custPage.getByLabel('Username').fill(customerUsername);
  await custPage.getByLabel('Password baru').fill(customerPassword);
  await custPage.getByRole('button', { name: 'Aktifkan akun', exact: true }).click();
  await expectVisible(custPage.getByText('Akun sudah aktif. Silakan masuk.'), 'Pesan sukses aktivasi tidak tampil');
  await assertCleanSecretHygiene(custPage, usedSecrets, 'customer-after-activate');

  await custPage.getByRole('link', { name: 'Kembali ke masuk' }).click();
  await expectVisible(custPage.getByRole('heading', { name: 'Masuk', exact: true }), 'Halaman /masuk pelanggan tidak tampil');
  await custPage.getByLabel('Username atau email').fill(customerUsername);
  await custPage.getByLabel('Password', { exact: true }).fill(customerPassword);
  await custPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: 'Beranda', exact: true }), 'Pelanggan baru gagal masuk ke /beranda');

  // Buat API key pelanggan melalui UI /api-key untuk pengujian penangguhan dan pemulihan
  await custPage.getByRole('link', { name: 'API key', exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: 'API key', exact: true }), 'Halaman /api-key tidak tampil');
  await custPage.getByLabel('Nama key').fill('Key Uji Penangguhan');
  await custPage.getByRole('button', { name: 'Buat API key', exact: true }).click();
  const secretDialog = custPage.getByRole('dialog', { name: 'Salin secret sekarang' });
  await expectVisible(secretDialog, 'Dialog secret API key tidak tampil');
  const customerApiKey = (await secretDialog.locator('pre.secret').textContent())?.trim() ?? '';
  assert.match(customerApiKey, /^rtr_[A-Za-z0-9_-]{43}$/, 'Format secret API key pelanggan tidak valid');
  usedSecrets.push(customerApiKey);
  await secretDialog.getByRole('button', { name: 'Saya sudah menyalin', exact: true }).click();
  await assertCleanSecretHygiene(custPage, usedSecrets, 'customer-after-key-create');

  // Memakai tautan aktivasi yang sama kedua kali harus ditolak
  const secondActivatePage = await custCtx.newPage();
  attachListeners(secondActivatePage, 'cust-replay-invite');
  await secondActivatePage.goto(activationLink, { waitUntil: 'networkidle' });
  await expectVisible(secondActivatePage.getByRole('heading', { name: 'Aktivasi undangan', exact: true }), 'Halaman aktivasi kedua tidak tampil');
  await assertCleanSecretHygiene(secondActivatePage, usedSecrets, 'customer-second-activate-load');
  await secondActivatePage.getByLabel('Username').fill('pelanggan_kedua');
  await secondActivatePage.getByLabel('Password baru').fill(customerPassword);
  await secondActivatePage.getByRole('button', { name: 'Aktifkan akun', exact: true }).click();
  await expectVisible(
    secondActivatePage.getByText('Undangan tidak valid, kedaluwarsa, atau sudah dipakai. Hubungi admin.'),
    'Pemakaian tautan aktivasi kedua kali tidak ditolak sebagaimana mestinya',
  );
  await assertCleanSecretHygiene(secondActivatePage, usedSecrets, 'customer-second-activate-rejected');
  await secondActivatePage.close();

  // Mengundang email yang sama lagi harus menampilkan pesan konflik
  await inviteForm.getByLabel('Email').fill(invitedEmail);
  await inviteForm.getByRole('button', { name: 'Undang pelanggan', exact: true }).click();
  await expectVisible(
    adminPage.getByRole('alert').filter({ hasText: 'Email tersebut sudah memiliki akun. Gunakan email lain.' }),
    'Pesan konflik saat mengundang ulang email yang sudah aktif tidak tampil',
  );

  // Muat ulang daftar pelanggan di layar admin dan buka detail pelanggan_baru
  const listSection = adminPage.locator('section[aria-label="Daftar pelanggan"]');
  await listSection.getByRole('button', { name: 'Muat ulang', exact: true }).click();
  const customerRow = adminPage.locator('.customer-list-row').filter({ hasText: customerUsername });
  await expectVisible(customerRow, 'Baris pelanggan baru tidak muncul di daftar pelanggan');
  await customerRow.getByRole('button', { name: 'Buka rincian pelanggan', exact: true }).click();
  const detailSection = adminPage.locator('section[aria-label="Rincian"]');
  await expectVisible(detailSection.getByRole('heading', { name: customerUsername, exact: true }), 'Panel rincian pelanggan tidak tampil');
  assert.equal(
    await detailSection.getByRole('tab', { name: 'Ringkasan', exact: true }).getAttribute('aria-selected'),
    'true',
    'Tab awal detail pelanggan harus Ringkasan',
  );

  // ---- 2. Admin menangguhkan pelanggan (dengan step-up) -> API key ditolak; dipulihkan (dengan step-up) -> API key diterima kembali ----
  await expireAdminStepUp(db, adminBoot.userId);
  await detailSection.getByRole('button', { name: 'Tangguhkan pelanggan', exact: true }).click();
  const suspendDialog = adminPage.getByRole('dialog', { name: 'Tangguhkan pelanggan' });
  await expectVisible(suspendDialog, 'Dialog konfirmasi tangguhkan pelanggan tidak tampil');
  await suspendDialog.getByLabel('Alasan').fill('Uji penangguhan akses API pelanggan');
  await suspendDialog.getByRole('button', { name: 'Tangguhkan pelanggan', exact: true }).click();

  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'suspend-customer');
  await expectVisible(
    detailSection.getByText('Akun ditangguhkan. Saldo dan riwayat tetap dapat dilihat; hubungi admin untuk akses API.'),
    'Status penangguhan pelanggan tidak tampil setelah step-up',
  );
  await assertCleanSecretHygiene(adminPage, usedSecrets, 'admin-after-suspend');

  // Request API memakai API key pelanggan yang ditangguhkan harus ditolak (403 tenant_suspended)
  const suspendedModelsRes = await fetch(`${apiBase}/v1/models`, {
    headers: { authorization: `Bearer ${customerApiKey}` },
  });
  assert.equal(suspendedModelsRes.status, 403, 'GET /v1/models untuk pelanggan ditangguhkan harus 403');
  const suspendedModelsBody = await suspendedModelsRes.json();
  assert.equal(suspendedModelsBody?.error?.code, 'tenant_suspended', 'Kode error GET /v1/models harus tenant_suspended');

  const suspendedChatRes = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${customerApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'halo' }],
      max_tokens: 8,
    }),
  });
  assert.equal(suspendedChatRes.status, 403, 'POST /v1/chat/completions untuk pelanggan ditangguhkan harus 403');
  const suspendedChatBody = await suspendedChatRes.json();
  assert.equal(suspendedChatBody?.error?.code, 'tenant_suspended', 'Kode error admission chat saat ditangguhkan harus tenant_suspended');

  // Pulihkan pelanggan (dengan step-up)
  await expireAdminStepUp(db, adminBoot.userId);
  await detailSection.getByRole('button', { name: 'Pulihkan pelanggan', exact: true }).click();
  const restoreDialog = adminPage.getByRole('dialog', { name: 'Pulihkan pelanggan' });
  await expectVisible(restoreDialog, 'Dialog konfirmasi pulihkan pelanggan tidak tampil');
  await restoreDialog.getByLabel('Alasan').fill('Uji pemulihan akses API pelanggan');
  await restoreDialog.getByRole('button', { name: 'Pulihkan pelanggan', exact: true }).click();

  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'restore-customer');
  await expectVisible(
    detailSection.getByRole('button', { name: 'Tangguhkan pelanggan', exact: true }),
    'Tombol Tangguhkan pelanggan tidak kembali tampil setelah pelanggan dipulihkan',
  );
  await assertCleanSecretHygiene(adminPage, usedSecrets, 'admin-after-restore');

  // Setelah dipulihkan, request API diterima kembali pada pemeriksaan status key/tenant
  const restoredModelsRes = await fetch(`${apiBase}/v1/models`, {
    headers: { authorization: `Bearer ${customerApiKey}` },
  });
  assert.equal(restoredModelsRes.status, 200, 'GET /v1/models setelah pelanggan dipulihkan harus 200');
  const restoredModelsBody = await restoredModelsRes.json();
  assert.equal(restoredModelsBody?.object, 'list', 'Respons GET /v1/models harus berupa list');

  // ---- 3. Koreksi saldo +2,5 dan -1 kredit (+2_500_000 dan -1_000_000 mikro-kredit) serta uji ulang idempotensi ----
  const tenantRow = (
    await db.query(
      'select m.tenant_id from app_user u join membership m on m.user_id = u.id where u.username = $1',
      [customerUsername],
    )
  ).rows[0];
  assert.ok(tenantRow?.tenant_id, 'Tenant pelanggan baru harus ada di database');
  const tenantId = tenantRow.tenant_id;

  const interceptedAdjustmentBodies = [];
  adminPage.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/admin/api/adjustments') {
      try {
        interceptedAdjustmentBodies.push(JSON.parse(req.postData() ?? '{}'));
      } catch {
        // abaikan bila bukan JSON
      }
    }
  });

  // Pindah ke tab Saldo lewat tombol tab sebelum koreksi +2,5
  await detailSection.getByRole('tab', { name: 'Saldo', exact: true }).click();
  const adjustmentForm = detailSection.locator('form').filter({ hasText: 'Nominal koreksi (kredit token)' });
  await expectVisible(adjustmentForm, 'Form koreksi saldo pada tab Saldo tidak tampil');

  // 3a. Koreksi +2,5 kredit (+2_500_000 mikro-kredit) dengan step-up
  await expireAdminStepUp(db, adminBoot.userId);
  await adjustmentForm.getByLabel('Nominal koreksi (kredit token)').fill('2,5');
  await adjustmentForm.getByLabel('Alasan').fill('Koreksi tambah dua koma lima kredit');
  await adjustmentForm.getByRole('button', { name: 'Koreksi saldo', exact: true }).click();

  const adjustConfirmPlus = adminPage.getByRole('dialog', { name: 'Konfirmasi koreksi saldo' });
  await expectVisible(adjustConfirmPlus, 'Dialog konfirmasi koreksi +2,5 tidak tampil');
  await expectVisible(adjustConfirmPlus.getByText('2,5 kredit token', { exact: true }), 'Nominal 2,5 kredit token di dialog konfirmasi tidak tampil');
  await adjustConfirmPlus.getByRole('button', { name: 'Terapkan koreksi', exact: true }).click();

  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'adjustment-plus-2.5');
  const plusReceipt = detailSection.locator('.receipt').filter({ hasText: 'Saldo berhasil ditambah' });
  await expectVisible(plusReceipt, 'Struk koreksi +2,5 pada tab Saldo tidak tampil');
  assert.equal(await plusReceipt.getByText('2,5 kredit token', { exact: true }).count(), 2, 'Struk +2,5 harus menampilkan nominal dan saldo sesudahnya 2,5 kredit token');

  // Pindah ke tab Ringkasan lewat tombol tab untuk memeriksa angka saldo
  await detailSection.getByRole('tab', { name: 'Ringkasan', exact: true }).click();
  await expectVisible(
    detailSection.locator('.metric').filter({ hasText: 'Saldo tersedia' }).getByText('2,5 kredit token', { exact: true }),
    'Saldo tersedia di layar tidak berubah menjadi 2,5 kredit token',
  );
  await expectVisible(
    detailSection.locator('.metric').filter({ hasText: 'Saldo tercatat' }).getByText('2,5 kredit token', { exact: true }),
    'Saldo tercatat di layar tidak berubah menjadi 2,5 kredit token',
  );

  // Pindah ke tab Transaksi lewat tombol tab untuk memeriksa entri ledger
  await detailSection.getByRole('tab', { name: 'Transaksi', exact: true }).click();
  const ledgerSection = detailSection.locator('section.panel').filter({ hasText: 'Transaksi' });
  await expectVisible(
    ledgerSection.locator('.data-row').filter({ hasText: 'Koreksi kredit' }).getByText('2,5 kredit token', { exact: true }),
    'Entri buku besar Koreksi kredit 2,5 kredit token tidak tampil di layar',
  );

  const balanceAfterPlus = await ledger.getBalance(db, tenantId);
  assert.equal(balanceAfterPlus.posted, 2_500_000n, 'Saldo posted di DB harus tepat 2_500_000 mikro-kredit');
  assert.equal(balanceAfterPlus.available, 2_500_000n, 'Saldo available di DB harus tepat 2_500_000 mikro-kredit');
  const entriesAfterPlus = await ledger.listEntries(db, tenantId);
  assert.equal(entriesAfterPlus.length, 1, 'Jumlah entri ledger setelah koreksi pertama harus 1');
  assert.equal(entriesAfterPlus[0].kind, 'ADJUSTMENT_CREDIT', 'Jenis entri pertama harus ADJUSTMENT_CREDIT');
  assert.equal(entriesAfterPlus[0].amount, '2500000', 'Nilai entri pertama harus 2500000 mikro-kredit');

  // Pengiriman ulang koreksi +2,5 dengan kunci idempotensi yang sama tidak boleh menggandakan entri
  const plusPayload = interceptedAdjustmentBodies.at(-1);
  assert.ok(plusPayload?.idempotencyKey, 'Kunci idempotensi koreksi +2,5 harus tertangkap');
  assert.equal(plusPayload.amountMicro, '2500000', 'Payload amountMicro koreksi +2,5 harus 2500000');
  const replayPlusResult = await adminPage.evaluate(async payload => {
    const res = await fetch('/admin/api/adjustments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-router-csrf': '1' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }, plusPayload);
  assert.equal(replayPlusResult.status, 200, 'Replay koreksi +2,5 dengan idempotencyKey sama harus mengembalikan HTTP 200');
  assert.equal(replayPlusResult.body.replayed, true, 'Replay koreksi +2,5 harus menandai replayed: true');
  assert.equal(replayPlusResult.body.entryId, entriesAfterPlus[0].id, 'Replay koreksi +2,5 harus mengembalikan entryId yang sama');
  assert.equal((await ledger.listEntries(db, tenantId)).length, 1, 'Replay tidak boleh menambah entri ledger baru');
  assert.equal((await ledger.getBalance(db, tenantId)).posted, 2_500_000n, 'Replay tidak boleh mengubah saldo posted');

  // Pindah ke tab Saldo lewat tombol tab sebelum koreksi -1
  await detailSection.getByRole('tab', { name: 'Saldo', exact: true }).click();
  await expectVisible(adjustmentForm, 'Form koreksi saldo pada tab Saldo tidak tampil untuk koreksi -1');

  // 3b. Koreksi -1 kredit (-1_000_000 mikro-kredit) dengan step-up
  await expireAdminStepUp(db, adminBoot.userId);
  await adjustmentForm.getByLabel('Nominal koreksi (kredit token)').fill('-1');
  await adjustmentForm.getByLabel('Alasan').fill('Koreksi kurang satu kredit');
  await adjustmentForm.getByRole('button', { name: 'Koreksi saldo', exact: true }).click();

  const adjustConfirmMinus = adminPage.getByRole('dialog', { name: 'Konfirmasi koreksi saldo' });
  await expectVisible(adjustConfirmMinus, 'Dialog konfirmasi koreksi -1 tidak tampil');
  await expectVisible(adjustConfirmMinus.getByText('-1 kredit token', { exact: true }), 'Nominal -1 kredit token di dialog konfirmasi tidak tampil');
  await adjustConfirmMinus.getByRole('button', { name: 'Terapkan koreksi', exact: true }).click();

  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'adjustment-minus-1');
  await expectVisible(
    detailSection.locator('.receipt').filter({ hasText: 'Saldo berhasil dikurangi' }).getByText('-1 kredit token', { exact: true }),
    'Struk koreksi -1 pada tab Saldo tidak tampil',
  );

  // Pindah ke tab Ringkasan lewat tombol tab untuk memeriksa saldo 1,5 kredit token
  await detailSection.getByRole('tab', { name: 'Ringkasan', exact: true }).click();
  await expectVisible(
    detailSection.locator('.metric').filter({ hasText: 'Saldo tersedia' }).getByText('1,5 kredit token', { exact: true }),
    'Saldo tersedia di layar tidak berubah menjadi 1,5 kredit token setelah koreksi -1',
  );
  await expectVisible(
    detailSection.locator('.metric').filter({ hasText: 'Saldo tercatat' }).getByText('1,5 kredit token', { exact: true }),
    'Saldo tercatat di layar tidak berubah menjadi 1,5 kredit token setelah koreksi -1',
  );

  // Pindah ke tab Transaksi lewat tombol tab untuk memeriksa entri Koreksi debit -1
  await detailSection.getByRole('tab', { name: 'Transaksi', exact: true }).click();
  await expectVisible(
    ledgerSection.locator('.data-row').filter({ hasText: 'Koreksi debit' }).getByText('-1 kredit token', { exact: true }),
    'Entri buku besar Koreksi debit -1 kredit token tidak tampil di layar',
  );

  // Pindah ke tab API key lewat tombol tab untuk memastikan key tampil tersamar
  await detailSection.getByRole('tab', { name: 'API key', exact: true }).click();
  await expectVisible(detailSection.getByText('Key Uji Penangguhan', { exact: true }), 'Key pelanggan pada tab API key tidak tampil');

  const balanceAfterMinus = await ledger.getBalance(db, tenantId);
  assert.equal(balanceAfterMinus.posted, 1_500_000n, 'Saldo posted di DB harus tepat 1_500_000 mikro-kredit');
  assert.equal(balanceAfterMinus.available, 1_500_000n, 'Saldo available di DB harus tepat 1_500_000 mikro-kredit');
  const entriesAfterMinus = await ledger.listEntries(db, tenantId);
  assert.equal(entriesAfterMinus.length, 2, 'Jumlah entri ledger setelah koreksi kedua harus 2');
  assert.equal(entriesAfterMinus[0].kind, 'ADJUSTMENT_DEBIT', 'Jenis entri terbaru harus ADJUSTMENT_DEBIT');
  assert.equal(entriesAfterMinus[0].amount, '-1000000', 'Nilai entri terbaru harus -1000000 mikro-kredit');

  // Pengiriman ulang koreksi -1 dengan kunci idempotensi yang sama tidak boleh menggandakan entri
  const minusPayload = interceptedAdjustmentBodies.at(-1);
  assert.ok(minusPayload?.idempotencyKey, 'Kunci idempotensi koreksi -1 harus tertangkap');
  assert.equal(minusPayload.amountMicro, '-1000000', 'Payload amountMicro koreksi -1 harus -1000000');
  const replayMinusResult = await adminPage.evaluate(async payload => {
    const res = await fetch('/admin/api/adjustments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-router-csrf': '1' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }, minusPayload);
  assert.equal(replayMinusResult.status, 200, 'Replay koreksi -1 dengan idempotencyKey sama harus mengembalikan HTTP 200');
  assert.equal(replayMinusResult.body.replayed, true, 'Replay koreksi -1 harus menandai replayed: true');
  assert.equal(replayMinusResult.body.entryId, entriesAfterMinus[0].id, 'Replay koreksi -1 harus mengembalikan entryId yang sama');
  assert.equal((await ledger.listEntries(db, tenantId)).length, 2, 'Replay koreksi -1 tidak boleh menambah entri ledger baru');
  assert.equal((await ledger.getBalance(db, tenantId)).posted, 1_500_000n, 'Replay koreksi -1 tidak boleh mengubah saldo posted');

  // Dengan saldo > 0 dan pelanggan berstatus ACTIVE, buktikan POST /v1/chat/completions lolos tahap admission
  // (tanpa memanggil upstream nyata karena tidak ada route upstream yang dikonfigurasi -> outcome no_route, debit 0)
  const admittedChatRes = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${customerApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'uji admission setelah pulih' }],
      max_tokens: 8,
    }),
  });
  assert.equal(admittedChatRes.status, 503, 'Tanpa route upstream, setelah lolos admission gateway mengembalikan 503 no_route');
  const admittedReqRow = (
    await db.query('select id, outcome, debit, hold from request where tenant_id = $1 order by created_at desc limit 1', [tenantId])
  ).rows[0];
  assert.ok(admittedReqRow?.id, 'Request pelanggan aktif harus tercatat melewati tahap admission di tabel request');
  assert.equal(admittedReqRow.outcome, 'no_route', 'Request yang lolos admission tanpa upstream harus berhenti di no_route');
  assert.equal(BigInt(admittedReqRow.debit), 0n, 'Request no_route harus melepas hold dengan debit 0');

  // Pastikan invariant buku besar bersih
  const violations = await ledger.invariantViolations(db);
  assert.deepEqual(violations, [], 'Tidak boleh ada pelanggaran invariant ledger');

  // ---- 4. Verifikasi akhir kebersihan URL, storage, dan log konsol ----
  await assertCleanSecretHygiene(adminPage, usedSecrets, 'admin-final');
  await assertCleanSecretHygiene(custPage, usedSecrets, 'customer-final');

  await custCtx.close();
  await adminCtx.close();
  process.stdout.write(
    'admin-customers-local-verify: PASS (invite + activate + replay reject + conflict + suspend/restore admission + adjustments +2.5/-1 + idempotency + secret hygiene)\n',
  );
} finally {
  await browser?.close().catch(() => {});
  if (vite) {
    vite.kill('SIGTERM');
    await Promise.race([new Promise(resolve => vite.once('exit', resolve)), delay(3_000)]);
  }
  await app?.close().catch(() => {});
  await db?.end().catch(() => {});
  await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
  await root.end().catch(() => {});
}
