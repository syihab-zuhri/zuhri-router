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
import { totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_verify_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const mail = { invites: [], resets: [] };
const mailer = {
  invite: async (to, token) => { mail.invites.push({ to, token }); },
  passwordReset: async (to, token) => { mail.resets.push({ to, token }); },
};

const customerUsername = 'acct_verify_user';
const customerPass1 = 'local-customer-pass-1';
const customerPass2 = 'local-customer-pass-2';
const adminUsername = 'acct_verify_admin';
const adminPass1 = 'local-admin-pass-one-14';
const adminPass2 = 'local-admin-pass-two-14';
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
  return locator.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => { throw new Error(message); });
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

async function assertReflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Halaman memiliki scroll horizontal');
}

async function assertCleanStorageAndUrl(page) {
  const clean = await page.evaluate(() => ({
    storage: localStorage.length + sessionStorage.length,
    search: location.search,
    hash: location.hash,
  }));
  assert.equal(clean.storage, 0, 'Browser storage tidak kosong');
  assert.equal(clean.search, '', 'Query string tidak kosong');
  assert.equal(clean.hash, '', 'URL fragment tidak kosong');
}

function attachListeners(page, tag) {
  page.on('console', msg => process.stderr.write(`${tag}:${msg.type()}:${msg.text()}\n`));
  page.on('response', res => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith('/api/') || path.startsWith('/admin/api/')) {
      process.stderr.write(`${tag}:api:${res.status()}:${path}\n`);
    }
  });
}

async function customerLogin(page, username, password) {
  await page.goto(`${webBase}/masuk`);
  await page.getByLabel('Username atau email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
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

  const admin = await bootstrapAdmin(db, key, { username: adminUsername, email: 'acct-admin@example.test', password: adminPass1 });
  const seed1 = base32Decode(admin.totpSecretBase32);

  await createInvite(db, { email: 'acct-customer@example.test', adminUser: admin.userId }, mailer);
  await activateInvite(db, { token: mail.invites[0].token, username: customerUsername, password: customerPass1 });

  app = await buildApp({ db, key, mailer, secureCookies: false });
  await app.listen({ host: '127.0.0.1', port: apiPort });

  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ROUTER_API_TARGET: `http://127.0.0.1:${apiPort}` },
    stdio: 'ignore',
  });
  await waitFor(`${webBase}/`);

  browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    headless: true,
    args: ['--no-proxy-server'],
  });

  // ---- Alur akun pelanggan (/akun) ----
  const custCtx1 = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const custPage1 = await custCtx1.newPage();
  attachListeners(custPage1, 'cust1');

  const custCtx2 = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const custPage2 = await custCtx2.newPage();
  attachListeners(custPage2, 'cust2');

  await customerLogin(custPage1, customerUsername, customerPass1);
  await expectVisible(custPage1.getByRole('heading', { name: 'Beranda', exact: true }), 'Login pelanggan 1 gagal');

  await customerLogin(custPage2, customerUsername, customerPass1);
  await expectVisible(custPage2.getByRole('heading', { name: 'Beranda', exact: true }), 'Login pelanggan 2 gagal');
  await custPage2.goto(`${webBase}/akun`);
  await expectVisible(custPage2.getByRole('heading', { name: 'Akun dan Keamanan', exact: true }), 'Halaman akun pelanggan 2 tidak terbuka');

  // Buka /akun via menu di viewport 360px
  await custPage1.getByRole('button', { name: 'Menu', exact: true }).click();
  await custPage1.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Akun', exact: true }).click();
  await expectVisible(custPage1.getByRole('heading', { name: 'Akun dan Keamanan', exact: true }), 'Halaman akun pelanggan 1 tidak terbuka');
  await expectVisible(custPage1.getByText('Sesi saat ini', { exact: true }), 'Sesi saat ini tidak ditandai');
  await expectVisible(custPage1.getByText('Sesi lain', { exact: true }), 'Sesi lain tidak tampil');
  await assertReflow(custPage1);
  await assertCleanStorageAndUrl(custPage1);

  // Cabut sesi lain dan buktikan sesi tersebut ditolak server (401 -> /masuk)
  const otherCard = custPage1.locator('.data-row').filter({ hasText: 'Sesi lain' });
  await otherCard.getByRole('button', { name: 'Cabut sesi', exact: true }).click();
  const revokeDialog = custPage1.getByRole('dialog', { name: 'Cabut sesi ini?' });
  await expectVisible(revokeDialog, 'Dialog konfirmasi cabut sesi tidak tampil');
  await revokeDialog.getByRole('button', { name: 'Cabut sesi', exact: true }).click();
  await expectVisible(custPage1.getByText('Sesi berhasil dicabut.'), 'Status pencabutan sesi tidak tampil');
  assert.equal(await custPage1.getByText('Sesi lain', { exact: true }).count(), 0, 'Sesi lain masih tampil setelah dicabut');

  await custPage2.getByRole('button', { name: 'Muat ulang', exact: true }).click();
  await expectVisible(custPage2.getByRole('heading', { name: 'Masuk', exact: true }), 'Sesi 2 tidak diarahkan ke /masuk setelah dicabut');
  await custCtx2.close();

  // Ubah password pelanggan, buktikan password lama ditolak dan password baru berhasil masuk
  const custPwForm = custPage1.locator('form').filter({ hasText: 'Ubah password' });
  await custPwForm.getByLabel('Password saat ini').fill(customerPass1);
  await custPwForm.getByLabel('Password baru').fill(customerPass2);
  await custPwForm.getByRole('button', { name: 'Ubah password', exact: true }).click();
  await expectVisible(custPage1.getByText('Password berhasil diperbarui. Semua sesi lain telah dicabut.'), 'Status ubah password pelanggan tidak tampil');

  await custPage1.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expectVisible(custPage1.getByRole('heading', { name: 'Masuk', exact: true }), 'Logout pelanggan tidak kembali ke /masuk');

  await customerLogin(custPage1, customerUsername, customerPass1);
  await expectVisible(custPage1.getByText('Username atau password tidak cocok.'), 'Password lama masih diterima setelah diganti');

  await customerLogin(custPage1, customerUsername, customerPass2);
  await expectVisible(custPage1.getByRole('heading', { name: 'Beranda', exact: true }), 'Login dengan password baru gagal');

  // Tutup akun permanen dan buktikan tidak dapat login lagi
  await custPage1.goto(`${webBase}/akun`);
  await expectVisible(custPage1.getByRole('heading', { name: 'Akun dan Keamanan', exact: true }), 'Halaman akun tidak terbuka sebelum tutup akun');
  await custPage1.getByRole('button', { name: 'Tutup akun', exact: true }).click();
  const closeDialog = custPage1.getByRole('dialog', { name: 'Tutup akun permanen?' });
  await expectVisible(closeDialog, 'Dialog konfirmasi tutup akun tidak tampil');
  await expectVisible(closeDialog.getByText('Sisa saldo token hangus dan tidak dapat dikembalikan atau diuangkan. Riwayat transaksi tetap tersimpan.'), 'Teks CR-035 konsekuensi saldo tutup akun tidak tampil');
  await closeDialog.getByLabel('Konfirmasi username').fill(customerUsername);
  await closeDialog.getByLabel('Password saat ini').fill(customerPass2);
  await closeDialog.getByRole('button', { name: 'Tutup akun permanen', exact: true }).click();
  await expectVisible(custPage1.getByRole('heading', { name: 'Masuk', exact: true }), 'Tutup akun tidak mengarahkan ke /masuk');

  await customerLogin(custPage1, customerUsername, customerPass2);
  await expectVisible(custPage1.getByText('Username atau password tidak cocok.'), 'Akun yang sudah ditutup masih bisa login');
  await assertCleanStorageAndUrl(custPage1);
  await custCtx1.close();

  // ---- Alur akun admin (/admin/akun) ----
  const adminCtx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const adminPage = await adminCtx.newPage();
  attachListeners(adminPage, 'admin');

  const initialStep = await safeTotpStep();
  await adminPage.goto(`${webBase}/admin/masuk`);
  await adminPage.getByLabel('Username atau email').fill(adminUsername);
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPass1);
  await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(adminPage.getByLabel('Kode autentikator', { exact: true }), 'Langkah 2FA admin tidak tampil');
  await adminPage.getByLabel('Kode autentikator', { exact: true }).fill(totpAt(seed1, initialStep - 1n));
  await adminPage.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Pelanggan', exact: true }), 'Login admin tidak selesai');

  // Buka /admin/akun via menu di 360px
  await adminPage.getByRole('button', { name: 'Menu', exact: true }).click();
  await adminPage.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Akun', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Akun Admin', exact: true }), 'Halaman akun admin tidak terbuka');
  await assertReflow(adminPage);

  // Ubah password admin dengan step-up asli dari Postgres
  await db.query("update session set auth_at=clock_timestamp()-interval '10 minutes' where user_id=$1 and kind='ADMIN'", [admin.userId]);
  const adminPwForm = adminPage.locator('form').filter({ hasText: 'Ubah password' });
  await adminPwForm.getByLabel('Password saat ini').fill(adminPass1);
  await adminPwForm.getByLabel('Password baru').fill(adminPass2);
  await adminPwForm.getByRole('button', { name: 'Ubah password', exact: true }).click();
  const pwStepUp = adminPage.getByRole('dialog', { name: 'Verifikasi ulang admin' });
  await expectVisible(pwStepUp, 'Dialog step-up ubah password admin tidak tampil');
  await pwStepUp.getByLabel('Kode autentikator').fill(admin.recoveryCodes[0]);
  await pwStepUp.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(adminPage.getByText('Password admin berhasil diperbarui. Semua sesi admin lain telah dicabut.'), 'Status ubah password admin tidak tampil');

  // Logout dan verifikasi password lama ditolak, password baru diterima
  await adminPage.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Masuk admin', exact: true }), 'Logout admin tidak kembali ke /admin/masuk');

  await adminPage.getByLabel('Username atau email').fill(adminUsername);
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPass1);
  await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(adminPage.getByText('Username atau password tidak cocok.'), 'Password lama admin masih diterima');

  const reloginStep = await safeTotpStep();
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPass2);
  await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(adminPage.getByLabel('Kode autentikator', { exact: true }), 'Langkah 2FA admin ulang tidak tampil');
  await adminPage.getByLabel('Kode autentikator', { exact: true }).fill(totpAt(seed1, reloginStep));
  await adminPage.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Pelanggan', exact: true }), 'Login admin dengan password baru gagal');

  // Ganti autentikator 2 langkah dengan step-up asli dari Postgres
  await adminPage.goto(`${webBase}/admin/akun`);
  await expectVisible(adminPage.getByRole('heading', { name: 'Akun Admin', exact: true }), 'Halaman akun admin tidak terbuka untuk rotasi');
  await db.query("update session set auth_at=clock_timestamp()-interval '10 minutes' where user_id=$1 and kind='ADMIN'", [admin.userId]);
  await adminPage.getByRole('button', { name: 'Mulai ganti autentikator', exact: true }).click();
  const rotStepUp = adminPage.getByRole('dialog', { name: 'Verifikasi ulang admin' });
  await expectVisible(rotStepUp, 'Dialog step-up mulai ganti autentikator tidak tampil');
  await rotStepUp.getByLabel('Kode autentikator').fill(admin.recoveryCodes[1]);
  await rotStepUp.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();

  await expectVisible(adminPage.getByRole('button', { name: 'Salin kunci', exact: true }), 'Kunci manual autentikator baru tidak tampil');
  const qrPathData = await adminPage.locator('.qr-box svg.qr-svg path').getAttribute('d');
  assert.ok(qrPathData && qrPathData.length > 100, 'QR SVG lokal tidak terbentuk');
  assert.equal(await adminPage.locator('a[href^="otpauth:"]').count(), 0, 'otpauth URI tidak boleh dirender sebagai tautan');

  const groupedKey = (await adminPage.locator('.secret').innerText()).trim();
  assert.match(groupedKey, /^[A-Z2-7]{4}(?: [A-Z2-7]{4})+$/, 'Kunci manual tidak dikelompokkan per 4 karakter');
  const seed2 = base32Decode(groupedKey.replace(/\s+/g, ''));
  await assertReflow(adminPage);
  await assertCleanStorageAndUrl(adminPage);

  const confirmStep = await safeTotpStep();
  await adminPage.getByLabel('Kode autentikator baru').fill(totpAt(seed2, confirmStep - 1n));
  await adminPage.getByRole('button', { name: 'Konfirmasi autentikator baru', exact: true }).click();

  const recDialog = adminPage.getByRole('dialog', { name: 'Simpan kode pemulihan baru' });
  await expectVisible(recDialog, 'Modal kode pemulihan baru tidak tampil');
  const recoveryText = (await recDialog.locator('.secret').innerText()).trim();
  const recoveryList = recoveryText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  assert.equal(recoveryList.length, 8, 'Jumlah kode pemulihan tidak sama dengan 8');
  for (const rc of recoveryList) assert.match(rc, /^[0-9a-f]{20}$/, 'Format kode pemulihan tidak sesuai');
  await assertCleanStorageAndUrl(adminPage);

  await recDialog.getByRole('button', { name: 'Saya sudah menyalin', exact: true }).click();
  assert.equal(await adminPage.locator('.secret').count(), 0, 'Rahasia tetap dirender setelah modal ditutup');
  await expectVisible(adminPage.getByText('Autentikator baru telah aktif.'), 'Peringatan autentikator lama berhenti berlaku tidak tampil');
  await assertReflow(adminPage);

  // Logout dan verifikasi TOTP LAMA ditolak sedangkan TOTP BARU diterima
  await adminPage.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Masuk admin', exact: true }), 'Logout setelah rotasi gagal');

  await adminPage.getByLabel('Username atau email').fill(adminUsername);
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPass2);
  await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(adminPage.getByLabel('Kode autentikator', { exact: true }), 'Langkah 2FA sesudah rotasi tidak tampil');

  await adminPage.getByLabel('Kode autentikator', { exact: true }).fill(totpAt(seed1, totpStep(Date.now())));
  await adminPage.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(adminPage.getByText('Kode autentikator tidak valid atau sudah dipakai.'), 'TOTP lama masih diterima setelah rotasi');

  const finalStep = await safeTotpStep();
  await adminPage.getByLabel('Kode autentikator', { exact: true }).fill(totpAt(seed2, finalStep));
  await adminPage.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expectVisible(adminPage.getByRole('heading', { name: 'Pelanggan', exact: true }), 'TOTP baru gagal untuk masuk admin');
  await assertCleanStorageAndUrl(adminPage);
  await adminCtx.close();

  process.stdout.write('account-local-verify: PASS\n');
} finally {
  await browser?.close().catch(() => {});
  vite?.kill();
  await app?.close().catch(() => {});
  await db?.end().catch(() => {});
  if (root) {
    if (/^web_verify_[a-f0-9]{32}$/.test(schema)) await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
    await root.end().catch(() => {});
  }
}
