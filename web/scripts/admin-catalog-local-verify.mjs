import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createPool } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { activateInvite, createInvite } from '../../server/src/identity.ts';
import * as ledger from '../../server/src/ledger.ts';
import * as upstreams from '../../server/src/upstreams.ts';
import { totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const apiBase = `http://127.0.0.1:${apiPort}`;
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_catalog_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);

const mail = { invites: [], resets: [] };
const mailer = {
  invite: async (to, token) => { mail.invites.push({ to, token }); },
  passwordReset: async (to, token) => { mail.resets.push({ to, token }); },
};

// Resolver offline: *.example.test -> publik kecuali internal* -> privat (tanpa DNS atau koneksi luar)
const offlineResolver = async host => {
  if (host.startsWith('internal')) return ['10.0.0.5'];
  return ['93.184.216.34'];
};

const adminUsername = 'admin_cat_verify';
const adminPassword = 'local-admin-catalog-14';
const custUsername = 'cat_pelanggan';
const custPassword = 'local-cat-cust-pass-10';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const consoleLogs = [];

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
    assert.ok(secret && secret.length >= 6, 'Secret pembanding harus terisi');
    assert.equal(state.href.includes(secret), false, `${label}: secret bocor di URL`);
    assert.equal(storageDump.includes(secret), false, `${label}: secret bocor di storage`);
    for (const entry of consoleLogs) {
      assert.equal(entry.includes(secret), false, `${label}: secret bocor di konsol`);
    }
  }
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
    email: 'admin-catalog@example.test',
    password: adminPassword,
  });
  const totpSeed = base32Decode(adminBoot.totpSecretBase32);
  const usedSecrets = [...adminBoot.recoveryCodes];

  await createInvite(db, { email: 'cat-cust@example.test', adminUser: adminBoot.userId }, mailer);
  const cust = await activateInvite(db, { token: mail.invites[0].token, username: custUsername, password: custPassword });

  // Siapkan 1 upstream ELIGIBLE offline agar perubahan harga model terlihat di katalog pelanggan /model-harga
  const eligibleUpstream = await upstreams.create(db, key, offlineResolver, {
    name: 'Upstream Katalog Publik',
    baseUrls: { CHAT: 'https://public.example.test/v1' },
    apiKey: 'sk-cat-offline-key-1',
    termsNote: 'Seed offline tanpa request luar.',
  }, adminBoot.userId);
  await upstreams.setStatus(db, eligibleUpstream.id, {
    status: 'ELIGIBLE',
    expectedVersion: eligibleUpstream.version,
    reason: 'Untuk verifikasi katalog model tanpa request luar',
  }, adminBoot.userId);

  app = await buildApp({ db, key, mailer, secureCookies: false, resolveHost: offlineResolver, publicBaseUrl: webBase });
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

  // Warmup Vite
  {
    const warmCtx = await browser.newContext();
    const warmPage = await warmCtx.newPage();
    await warmPage.goto(`${webBase}/masuk`);
    await expectVisible(warmPage.getByRole('heading', { name: 'Masuk', exact: true }), 'Warmup Vite gagal');
    await warmCtx.close();
  }

  const pageErrors = [];
  const serverErrors = [];

  // Login admin dan login pelanggan di konteks terpisah
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminCtx.newPage();
  attachListeners(adminPage, 'admin', pageErrors, serverErrors);

  const loginStep = await safeTotpStep();
  const loginTotp = totpAt(totpSeed, loginStep);
  usedSecrets.push(loginTotp);
  await adminPage.goto(`${webBase}/admin/masuk`);
  await expectVisible(adminPage.getByRole('heading', { name: 'Masuk admin', exact: true }), 'Halaman /admin/masuk tidak terbuka');
  await adminPage.getByLabel('Username atau email').fill(adminUsername);
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword);
  await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(adminPage.getByLabel('Kode autentikator', { exact: true }), 'Input 2FA admin tidak tampil');
  await adminPage.getByLabel('Kode autentikator', { exact: true }).fill(loginTotp);
  await adminPage.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Pelanggan', exact: true }), 'Login admin gagal');

  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custPage = await custCtx.newPage();
  attachListeners(custPage, 'cust', pageErrors, serverErrors);
  await custPage.goto(`${webBase}/masuk`);
  await expectVisible(custPage.getByRole('heading', { name: 'Masuk', exact: true }), 'Halaman /masuk pelanggan tidak terbuka');
  await custPage.getByLabel('Username atau email').fill(custUsername);
  await custPage.getByLabel('Password', { exact: true }).fill(custPassword);
  await custPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: 'Beranda', exact: true }), 'Login pelanggan gagal');

  // ---- 1. Paket token: buat, ubah, nonaktifkan; harga tampilan di beranda pelanggan ikut berubah ----
  await adminPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Paket token', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Paket token', exact: true }), 'Halaman Paket token gagal terbuka');

  // Buat Paket A
  await adminPage.getByRole('button', { name: 'Buat paket', exact: true }).click();
  const createPackDialog = adminPage.getByRole('dialog', { name: 'Buat paket' });
  await createPackDialog.getByLabel('Nama paket').fill('Paket Katalog Awal');
  await createPackDialog.getByLabel('Jumlah kredit token').fill('50');
  await createPackDialog.getByLabel('Harga tampilan (Rp)').fill('100000');
  await createPackDialog.getByRole('button', { name: 'Buat paket', exact: true }).click();
  await expectVisible(adminPage.getByText('Perubahan sudah dikonfirmasi server.', { exact: true }), 'Konfirmasi buat paket tidak tampil');
  await expectVisible(adminPage.locator('.data-row').filter({ hasText: 'Paket Katalog Awal' }), 'Paket Katalog Awal tidak tampil di daftar admin');

  // Pelanggan melihat Paket Katalog Awal di Beranda
  await custPage.reload();
  await expectVisible(custPage.locator('.data-row').filter({ hasText: 'Paket Katalog Awal' }).getByText('Rp100.000', { exact: true }), 'Paket Katalog Awal tidak tampil di Beranda pelanggan');

  // Ubah Paket A
  await adminPage.locator('.data-row').filter({ hasText: 'Paket Katalog Awal' }).getByRole('button', { name: 'Ubah', exact: true }).click();
  const editPackDialog = adminPage.getByRole('dialog', { name: 'Ubah' });
  await editPackDialog.getByLabel('Nama paket').fill('Paket Katalog Baru');
  await editPackDialog.getByLabel('Jumlah kredit token').fill('75');
  await editPackDialog.getByLabel('Harga tampilan (Rp)').fill('140000');
  await editPackDialog.getByLabel('Promo', { exact: true }).check();
  await editPackDialog.getByRole('button', { name: 'Simpan paket', exact: true }).click();
  const updatedPackRow = adminPage.locator('.data-row').filter({ hasText: 'Paket Katalog Baru' });
  await expectVisible(updatedPackRow.getByText('140.000', { exact: true }), 'Harga tampilan baru paket tidak tampil di admin');

  await custPage.reload();
  const custPackRow = custPage.locator('.data-row').filter({ hasText: 'Paket Katalog Baru' });
  await expectVisible(custPackRow.getByText('Rp140.000', { exact: true }), 'Perubahan harga paket tidak tampil di Beranda pelanggan');
  await expectVisible(custPackRow.getByText('Promo', { exact: true }), 'Badge Promo paket tidak tampil di Beranda pelanggan');

  // Buat Paket B lalu nonaktifkan -> hilang dari Beranda pelanggan
  await adminPage.getByRole('button', { name: 'Buat paket', exact: true }).click();
  const createPackBDialog = adminPage.getByRole('dialog', { name: 'Buat paket' });
  await createPackBDialog.getByLabel('Nama paket').fill('Paket Nonaktif Uji');
  await createPackBDialog.getByLabel('Jumlah kredit token').fill('20');
  await createPackBDialog.getByLabel('Harga tampilan (Rp)').fill('45000');
  await createPackBDialog.getByRole('button', { name: 'Buat paket', exact: true }).click();
  await expectVisible(adminPage.locator('.data-row').filter({ hasText: 'Paket Nonaktif Uji' }), 'Paket B tidak tampil');

  await custPage.reload();
  await expectVisible(custPage.locator('.data-row').filter({ hasText: 'Paket Nonaktif Uji' }), 'Paket B sebelum dinonaktifkan tidak tampil di Beranda');

  await adminPage.locator('.data-row').filter({ hasText: 'Paket Nonaktif Uji' }).getByRole('button', { name: 'Ubah', exact: true }).click();
  const deactivateDialog = adminPage.getByRole('dialog', { name: 'Ubah' });
  await deactivateDialog.getByLabel('Aktif', { exact: true }).uncheck();
  await deactivateDialog.getByRole('button', { name: 'Simpan paket', exact: true }).click();
  await expectVisible(adminPage.locator('.data-row').filter({ hasText: 'Paket Nonaktif Uji' }).getByText('Ditarik', { exact: true }), 'Status Ditarik paket tidak tampil');

  await custPage.reload();
  await expectVisible(custPage.locator('.data-row').filter({ hasText: 'Paket Katalog Baru' }), 'Paket aktif tidak tampil di Beranda');
  assert.equal(await custPage.locator('.data-row').filter({ hasText: 'Paket Nonaktif Uji' }).count(), 0, 'Paket yang dinonaktifkan masih tampil di Beranda pelanggan');

  // ---- 2. Kode redeem: terbitkan dari paket, kode tampil sekali, cabut lalu tidak bisa ditukar ----
  await adminPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Kode redeem', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Kode redeem', exact: true }), 'Halaman Kode redeem gagal terbuka');

  const activePackRow = (await db.query("select id from token_pack where name = 'Paket Katalog Baru'")).rows[0];
  assert.ok(activePackRow?.id, 'ID Paket Katalog Baru harus ada');

  await expireAdminStepUp(db, adminBoot.userId);
  await adminPage.locator('#voucher-pack').selectOption(activePackRow.id);
  await adminPage.getByLabel('Referensi penjualan').fill('CAT-SALE-VOUCHER-1');
  await adminPage.locator('form').getByRole('button', { name: 'Terbitkan kode', exact: true }).click();

  const issueConfirmDialog = adminPage.getByRole('dialog', { name: 'Terbitkan kode' });
  await expectVisible(issueConfirmDialog, 'Dialog konfirmasi terbit kode tidak tampil');
  await expectVisible(issueConfirmDialog.getByText('75 kredit token', { exact: true }), 'Nominal paket pada dialog terbit kode tidak cocok');
  await issueConfirmDialog.getByRole('button', { name: 'Terbitkan kode', exact: true }).click();

  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'issue-voucher');

  const voucherSecretModal = adminPage.getByRole('dialog', { name: 'Salin secret sekarang' });
  await expectVisible(voucherSecretModal, 'Modal kode redeem sekali tampil tidak terbuka');
  const rawVoucherCode = (await voucherSecretModal.locator('pre.secret').textContent())?.trim() ?? '';
  assert.match(rawVoucherCode, /^ZR-[A-Z0-9]{5}-[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}$/, 'Format kode redeem tidak valid');
  usedSecrets.push(rawVoucherCode);
  await assertCleanSecretHygiene(adminPage, usedSecrets, 'after-voucher-reveal');

  await voucherSecretModal.getByRole('button', { name: 'Saya sudah menyalin', exact: true }).click();
  await voucherSecretModal.waitFor({ state: 'hidden', timeout: 5_000 });
  assert.equal((await adminPage.content()).includes(rawVoucherCode), false, 'Kode mentah masih terlihat di DOM setelah dialog ditutup');

  // Cabut kode lalu buktikan tidak bisa ditukar oleh pelanggan
  const voucherCard = adminPage.locator('.data-row').filter({ hasText: 'CAT-SALE-VOUCHER-1' });
  await expectVisible(voucherCard, 'Voucher baru tidak muncul di daftar');
  await expireAdminStepUp(db, adminBoot.userId);
  await voucherCard.getByRole('button', { name: 'Cabut kode', exact: true }).click();
  const revokeDialog = adminPage.getByRole('dialog', { name: 'Cabut kode' });
  await expectVisible(revokeDialog, 'Dialog konfirmasi cabut kode tidak tampil');
  await revokeDialog.getByLabel('Alasan').fill('Uji pencabutan kode katalog');
  await revokeDialog.getByRole('button', { name: 'Cabut kode', exact: true }).click();
  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'revoke-voucher');
  await expectVisible(voucherCard.getByText('Dicabut', { exact: true }), 'Status Dicabut pada voucher tidak tampil');

  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Isi saldo', exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: 'Isi saldo', exact: true }), 'Halaman Isi saldo gagal terbuka');
  await custPage.getByLabel('Kode redeem').fill(rawVoucherCode);
  await custPage.getByRole('button', { name: 'Tukar kode', exact: true }).click();
  await expectVisible(custPage.getByText('Kode ini tidak dapat dipakai. Periksa penulisannya atau hubungi penjual.'), 'Kode yang sudah dicabut masih bisa ditukar');
  assert.equal((await ledger.getBalance(db, cust.tenantId)).posted, 0n, 'Kode dicabut tidak boleh menambah saldo');

  // ---- 3. Harga model: draf, pratinjau, terbit, tarik; pelanggan melihat perubahan ----
  await adminPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Harga model', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Harga model', exact: true }), 'Halaman Harga model gagal terbuka');

  await adminPage.getByRole('button', { name: 'Buat model', exact: true }).click();
  const createModelDialog = adminPage.getByRole('dialog', { name: 'Buat model' });
  await createModelDialog.getByLabel('ID model').fill('cat/model-uji');
  await createModelDialog.getByLabel('Nama tampilan').fill('Model Katalog Uji');
  await createModelDialog.getByRole('button', { name: 'Buat model', exact: true }).click();

  const modelDetail = adminPage.locator('section[aria-label="Rincian"]');
  await expectVisible(modelDetail.getByRole('heading', { name: 'Model Katalog Uji', exact: true }), 'Detail model baru tidak terbuka');

  // Tambahkan route dari UI /admin/upstream agar model tampil di /model-harga setelah diterbitkan
  await adminPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Upstream dan Route', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Upstream dan Route', exact: true }), 'Halaman Upstream dan Route gagal terbuka');

  // Uji penolakan Base URL internal/IP oleh server pada /admin/upstream
  await expireAdminStepUp(db, adminBoot.userId);
  await adminPage.getByRole('button', { name: 'Tambah upstream', exact: true }).click();
  const upDialog = adminPage.getByRole('dialog', { name: 'Tambah upstream' });
  await upDialog.getByLabel('Nama upstream').fill('Upstream Alamat Internal');
  await upDialog.getByLabel('Base URL CHAT').fill('https://internal.example.test/v1');
  await upDialog.getByLabel('API key upstream').fill('sk-rejected-internal-url-1');
  await upDialog.getByLabel('Alasan').fill('Uji penolakan alamat internal');
  await upDialog.getByRole('button', { name: 'Simpan', exact: true }).click();
  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'upstream-rejected-url');
  await expectVisible(
    upDialog.getByText('Base URL ditolak. Gunakan HTTPS pada alamat publik yang tidak mengarah ke jaringan internal.'),
    'Pesan penolakan Base URL internal tidak tampil',
  );
  await upDialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await upDialog.waitFor({ state: 'hidden', timeout: 5_000 });
  assert.equal((await db.query("select count(*)::int as n from upstream where name = 'Upstream Alamat Internal'")).rows[0].n, 0, 'Upstream dengan URL ditolak tidak boleh tersimpan');

  // Buat route ke Upstream Katalog Publik untuk cat/model-uji lewat UI
  await expireAdminStepUp(db, adminBoot.userId);
  await adminPage.getByRole('button', { name: 'Tambah route', exact: true }).click();
  const routeDialog = adminPage.getByRole('dialog', { name: 'Tambah route' });
  await routeDialog.locator('#route-model').selectOption('cat/model-uji');
  await routeDialog.locator('#route-upstream').selectOption(eligibleUpstream.id);
  await routeDialog.getByLabel('ID model di upstream').fill('cat-model-v1');
  await routeDialog.getByRole('button', { name: 'Tambah route', exact: true }).click();
  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'create-route');
  await expectVisible(adminPage.getByText('Route tersimpan.', { exact: true }), 'Route gagal disimpan melalui UI');

  // Kembali ke /admin/harga -> pilih cat/model-uji -> Draf, Pratinjau, Terbit, Ubah Terbit, Tarik
  await adminPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Harga model', exact: true }).click();
  await adminPage.locator('.data-row').filter({ hasText: 'cat/model-uji' }).getByRole('button', { name: 'Rincian', exact: true }).click();
  await expectVisible(modelDetail.getByRole('heading', { name: 'Model Katalog Uji', exact: true }), 'Detail model gagal dibuka kembali');

  // Simpan Draf 1 (varied, x1,5)
  await modelDetail.getByLabel('Bobot input').fill('2');
  await modelDetail.getByLabel('Bobot output').fill('4');
  await modelDetail.getByLabel('Bobot cache read').fill('0,5');
  await modelDetail.getByLabel('Bobot cache write').fill('1');
  await modelDetail.getByLabel('Pengali').fill('1,5');
  await modelDetail.getByRole('button', { name: 'Simpan draf', exact: true }).click();
  await expectVisible(modelDetail.getByText('Perubahan sudah dikonfirmasi server.', { exact: true }), 'Simpan draf 1 gagal');

  // Pelanggan belum melihat model selama masih draf
  await custPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Model dan Harga', exact: true }).click();
  await expectVisible(custPage.getByRole('heading', { name: 'Model dan Harga', exact: true }), 'Halaman Model dan Harga pelanggan gagal terbuka');
  assert.equal(await custPage.getByText('cat/model-uji').count(), 0, 'Model yang baru berstatus Draf tidak boleh tampil di katalog pelanggan');

  // Hitung Preview draf: 1000*3 + 500*6 + 200*0.75 + 100*1.5 = 6.300 kredit token
  await modelDetail.getByLabel('Token input').fill('1000');
  await modelDetail.getByLabel('Token output').fill('500');
  await modelDetail.getByLabel('Token cache read').fill('200');
  await modelDetail.getByLabel('Token cache write').fill('100');
  await modelDetail.getByRole('button', { name: 'Hitung preview', exact: true }).click();
  await expectVisible(modelDetail.locator('section.receipt').getByText('6.300 kredit token', { exact: true }), 'Hasil preview debit 6.300 kredit token tidak cocok');

  // Terbitkan Draf 1 (step-up)
  await expireAdminStepUp(db, adminBoot.userId);
  await modelDetail.getByRole('button', { name: 'Terbitkan harga', exact: true }).click();
  const pubDialog1 = adminPage.getByRole('dialog', { name: 'Terbitkan harga' });
  await pubDialog1.getByLabel('Alasan').fill('Terbit harga awal model katalog');
  await pubDialog1.getByRole('button', { name: 'Terbitkan harga', exact: true }).click();
  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'publish-price-1');
  await expectVisible(modelDetail.getByText('Terbit', { exact: true }).first(), 'Harga model gagal terbit');

  // Pelanggan melihat harga terbit 1 di /model-harga
  await custPage.reload();
  const custModelCard = custPage.locator('.data-row').filter({ hasText: 'cat/model-uji' });
  await expectVisible(custModelCard, 'Model terbit tidak tampil di katalog pelanggan');
  const custCardText1 = await custModelCard.innerText();
  assert.ok(
    custCardText1.includes('3 kredit token') &&
      custCardText1.includes('6 kredit token') &&
      custCardText1.includes('0,75 kredit token') &&
      custCardText1.includes('1,5 kredit token'),
    `Harga terbit 1 di katalog pelanggan tidak cocok: ${custCardText1}`,
  );

  // Simpan Draf 2 (uniform x2,5) -> pelanggan tetap melihat harga lama sampai diterbitkan
  await modelDetail.getByLabel('Bobot input').fill('1');
  await modelDetail.getByLabel('Bobot output').fill('1');
  await modelDetail.getByLabel('Bobot cache read').fill('1');
  await modelDetail.getByLabel('Bobot cache write').fill('1');
  await modelDetail.getByLabel('Pengali').fill('2,5');
  await modelDetail.getByRole('button', { name: 'Simpan draf', exact: true }).click();
  await expectVisible(modelDetail.getByText('Draf', { exact: true }).first(), 'Draf 2 gagal tersimpan');

  await custPage.reload();
  await expectVisible(custModelCard.getByText('3 kredit token', { exact: true }), 'Draf baru tidak boleh menimpa harga terbit sebelum dipublikasikan');

  // Terbitkan Draf 2 -> pelanggan melihat x2.5
  await expireAdminStepUp(db, adminBoot.userId);
  await modelDetail.getByRole('button', { name: 'Terbitkan harga', exact: true }).click();
  const pubDialog2 = adminPage.getByRole('dialog', { name: 'Terbitkan harga' });
  await pubDialog2.getByLabel('Alasan').fill('Perbarui harga katalog ke pengali 2,5');
  await pubDialog2.getByRole('button', { name: 'Terbitkan harga', exact: true }).click();
  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'publish-price-2');

  await custPage.reload();
  await expectVisible(custPage.locator('.data-row').filter({ hasText: 'cat/model-uji' }).getByText('x2.5', { exact: true }), 'Perubahan pengali x2.5 tidak tampil di katalog pelanggan');

  // Tarik harga -> pelanggan tidak melihat model lagi
  await expireAdminStepUp(db, adminBoot.userId);
  await modelDetail.getByRole('button', { name: 'Tarik harga', exact: true }).click();
  const retireDialog = adminPage.getByRole('dialog', { name: 'Tarik harga' });
  await retireDialog.getByLabel('Alasan').fill('Tarik harga model katalog uji');
  await retireDialog.getByRole('button', { name: 'Tarik harga', exact: true }).click();
  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'retire-price');
  await expectVisible(adminPage.locator('.data-row').filter({ hasText: 'cat/model-uji' }).getByText('Belum ada harga', { exact: true }), 'Status Belum ada harga setelah tarik tidak tampil');

  await custPage.reload();
  await expectVisible(custPage.getByRole('heading', { name: 'Belum ada model dijual.', exact: true }), 'Setelah harga ditarik, katalog pelanggan harus kosong');

  // ---- 4. Batas lebih-pakai (/admin/batas-lebih-pakai): ubah dengan step-up, nilai baru tampil ----
  await adminPage.locator('aside.desktop-nav nav').getByRole('link', { name: 'Batas lebih-pakai', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Batas lebih-pakai', exact: true }), 'Halaman Batas lebih-pakai gagal terbuka');

  await adminPage.getByLabel('Batas lebih-pakai dalam token').fill('125');
  await adminPage.locator('main form').getByRole('button', { name: 'Simpan', exact: true }).click();
  const overdraftDialog = adminPage.getByRole('dialog', { name: 'Konfirmasi batas lebih-pakai' });
  await expectVisible(overdraftDialog, 'Dialog konfirmasi batas lebih-pakai tidak tampil');
  await expectVisible(overdraftDialog.getByText('125 kredit token', { exact: true }), 'Nilai konfirmasi 125 kredit token tidak tampil');

  await expireAdminStepUp(db, adminBoot.userId);
  await overdraftDialog.getByRole('button', { name: 'Simpan', exact: true }).click();
  await completeStepUpDialog(adminPage, totpSeed, usedSecrets, 'update-overdraft');
  await expectVisible(adminPage.locator('section.panel').getByText('125 kredit token', { exact: true }), 'Nilai baru batas lebih-pakai tidak tampil di layar');

  await adminPage.reload();
  await expectVisible(adminPage.locator('section.panel').getByText('125 kredit token', { exact: true }), 'Nilai baru batas lebih-pakai tidak bertahan setelah muat ulang');
  assert.equal(await ledger.overdraftMicro(db), 125_000_000n, 'Nilai DB overdraft_micro harus 125_000_000');

  await assertCleanSecretHygiene(adminPage, usedSecrets, 'admin-catalog-final');
  await assertCleanSecretHygiene(custPage, usedSecrets, 'cust-catalog-final');

  assert.deepEqual(pageErrors, [], `Terdapat pageerror: ${pageErrors.join('; ')}`);
  assert.deepEqual(serverErrors, [], `Terdapat error 5xx: ${serverErrors.join('; ')}`);

  await custCtx.close();
  await adminCtx.close();
  process.stdout.write(
    'admin-catalog-local-verify: PASS (packs create/edit/deactivate + voucher issue/once/revoke + model draft/preview/publish/retire + upstream base_url_rejected/route + overdraft step-up)\n',
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
    if (/^web_catalog_[a-f0-9]{32}$/.test(schema)) await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
    await root.end().catch(() => {});
  }
}
