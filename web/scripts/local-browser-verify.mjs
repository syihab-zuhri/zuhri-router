import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createPool } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { createInvite } from '../../server/src/identity.ts';
import { totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55481);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5175);
const schema = `web_verify_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const mail = { invites: [], resets: [] };
const mailer = {
  invite: async (to, token) => { mail.invites.push({ to, token }); },
  passwordReset: async (to, token) => { mail.resets.push({ to, token }); },
};
const username = 'web_verify_user';
const password = 'local-customer-password-only';
const adminPassword = 'local-admin-password-only';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of value) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
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
  for (let attempt = 0; attempt < 50; attempt++) {
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
async function assertReflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Halaman memiliki scroll horizontal');
}

const databaseUrl = new URL(DB_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname));
assert.equal(databaseUrl.pathname, '/router_test');
const root = createPool(databaseUrl.href);
let db;
let app;
let vite;
let browser;
let adminUserId;
let recoveryCode;

try {
  await root.query(`create schema "${schema}"`);
  databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
  db = createPool(databaseUrl.href);
  await migrate(db);
  const admin = await bootstrapAdmin(db, key, { username: 'web_verify_admin', email: 'admin@example.test', password: adminPassword });
  adminUserId = admin.userId;
  recoveryCode = admin.recoveryCodes[0];
  const seed = base32Decode(admin.totpSecretBase32);
  const code = () => totpAt(seed, totpStep(Date.now()));
  await createInvite(db, { email: 'customer@example.test', adminUser: admin.userId }, mailer);
  app = await buildApp({ db, key, mailer, secureCookies: false });
  await app.listen({ host: '127.0.0.1', port: apiPort });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, ROUTER_API_TARGET: `http://127.0.0.1:${apiPort}` }, stdio: 'ignore',
  });
  await waitFor(`http://127.0.0.1:${webPort}/`);
  browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  page.on('console', message => process.stderr.write(`browser:${message.type()}:${message.text()}\n`));
  page.on('response', async response => {
    const url = new URL(response.url());
    const path = url.pathname;
    if (path.startsWith('/api/') || path.startsWith('/admin/api/')) {
      let details = '';
      if (path === '/admin/api/models' && response.status() < 400) {
        const payload = await response.json().catch(() => null);
        details = `:${JSON.stringify(payload).slice(0, 500)}`;
      }
      process.stderr.write(`api:${response.status()}:${path}${details}\\n`);
    }
  });

  const inviteToken = mail.invites[0].token;
  await page.goto(`http://127.0.0.1:${webPort}/aktivasi#token=${encodeURIComponent(inviteToken)}`);
  assert.equal(new URL(page.url()).hash, '', 'Token undangan masih berada pada URL');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password baru', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Aktifkan akun' }).click();
  await expectVisible(page.getByText('Akun sudah aktif. Silakan masuk.'), 'Aktivasi tidak selesai');
  await assertReflow(page);

  await page.getByRole('link', { name: 'Kembali ke masuk' }).click();
  await page.getByLabel('Username atau email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Beranda', exact: true }), 'Login pelanggan tidak membuka beranda');
  await assertReflow(page);

  await page.goto(`http://127.0.0.1:${webPort}/api-key`);
  await page.getByLabel('Nama key').fill('Key verifikasi lokal');
  await page.getByRole('button', { name: 'Buat API key', exact: true }).click();
  await expectVisible(page.getByRole('dialog'), 'Secret key tidak ditampilkan');
  const secret = await page.locator('.secret').innerText();
  assert.match(secret, /^rtr_/);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, 'Secret tersimpan di browser storage');
  await page.getByRole('button', { name: 'Saya sudah menyalin' }).click();
  assert.equal(await page.locator('.secret').count(), 0, 'Secret tetap dirender setelah ditutup');

  await page.getByRole('button', { name: 'Cabut', exact: true }).click();
  await page.getByRole('button', { name: 'Cabut API key', exact: true }).click();
  await expectVisible(page.getByText('Key sudah dicabut.'), 'API key tidak dicabut');
  await page.getByRole('button', { name: 'Keluar' }).click();

  await page.goto(`http://127.0.0.1:${webPort}/admin/masuk`);
  await page.getByLabel('Username atau email').fill('web_verify_admin');
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.getByLabel('Kode autentikator', { exact: true }).fill(code());
  await page.getByRole('button', { name: 'Verifikasi kode' }).click();
  await expectVisible(page.getByRole('heading', { name: 'Pelanggan', exact: true }), 'Login admin tidak selesai');

  await page.getByLabel('Awalan username', { exact: true }).fill(username);
  await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: username, exact: true }).first(), 'Pelanggan tidak ditemukan');
  await page.getByRole('button', { name: 'Buka detail pelanggan', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: username, exact: true }).last(), 'Detail pelanggan tidak terbuka');
  await page.getByRole('tab', { name: 'Saldo', exact: true }).click();
  await expectVisible(page.getByLabel('Jumlah kredit token'), 'Form top-up tidak tampil di tab Saldo');
  await db.query("update session set auth_at=clock_timestamp()-interval '10 minutes' where user_id=$1 and kind='ADMIN'", [adminUserId]);
  await page.getByLabel('Jumlah kredit token').fill('100');
  await page.getByLabel('Referensi penjualan').fill('web-local-topup');
  await page.getByRole('button', { name: 'Tambah saldo', exact: true }).click();
  await expectVisible(page.getByRole('dialog', { name: 'Konfirmasi tambah saldo' }), 'Konfirmasi top-up tidak tampil');
  await page.getByRole('dialog', { name: 'Konfirmasi tambah saldo' }).getByRole('button', { name: 'Tambah saldo', exact: true }).click();
  const topupStepUp = page.getByRole('dialog', { name: 'Verifikasi ulang admin' });
  await expectVisible(topupStepUp, 'Step-up top-up tidak tampil');
  await topupStepUp.getByLabel('Kode autentikator').fill(recoveryCode);
  await topupStepUp.getByRole('button', { name: 'Verifikasi kode' }).click();
  await expectVisible(page.getByRole('heading', { name: 'Saldo berhasil ditambah' }), 'Top-up tidak menghasilkan receipt');
  recoveryCode = admin.recoveryCodes[1];
  await db.query("update session set auth_at=clock_timestamp()-interval '10 minutes' where user_id=$1 and kind='ADMIN'", [adminUserId]);

  await page.goto(`http://127.0.0.1:${webPort}/admin/paket`);
  await page.getByRole('button', { name: 'Buat paket' }).click();
  await page.getByLabel('Nama paket').fill('Paket lokal');
  await page.getByLabel('Jumlah kredit token').fill('100000000');
  await page.getByLabel('Harga tampilan (Rp)').fill('10000');
  await page.getByRole('button', { name: 'Buat paket', exact: true }).last().click();
  await expectVisible(page.getByText('Paket lokal', { exact: true }), 'Paket tidak dibuat');

  await page.goto(`http://127.0.0.1:${webPort}/admin/harga`);
  await page.getByRole('button', { name: 'Buat model' }).click();
  await page.getByLabel('ID model').fill('web-local-model');
  await page.getByLabel('Nama tampilan').fill('Model lokal');
  await page.getByRole('button', { name: 'Buat model', exact: true }).last().click();
  await page.getByRole('region', { name: 'Harga model' }).getByRole('heading', { name: 'Model lokal', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await expectVisible(page.locator('.panel').filter({ hasText: 'web-local-model' }), 'Detail model tidak dimuat');
  await page.getByLabel('Bobot input', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Simpan draf', exact: true }).click();
  await expectVisible(page.getByText('Perubahan sudah dikonfirmasi server.'), 'Draf harga tidak tersimpan');
  await page.getByRole('button', { name: 'Terbitkan harga', exact: true }).click();
  const publishDialog = page.getByRole('dialog', { name: 'Terbitkan harga' });
  await expectVisible(publishDialog, 'Konfirmasi publish harga tidak tampil');
  await publishDialog.getByLabel('Alasan').fill('Harga model lokal');
  await publishDialog.getByRole('button', { name: 'Terbitkan harga', exact: true }).click();
  const priceStepUp = page.getByRole('dialog', { name: 'Verifikasi ulang admin' });
  await expectVisible(priceStepUp, 'Step-up publish harga tidak tampil');
  await priceStepUp.getByLabel('Kode autentikator').fill(recoveryCode);
  await priceStepUp.getByRole('button', { name: 'Verifikasi kode' }).click();
  await expectVisible(page.getByText('Perubahan sudah dikonfirmasi server.'), 'Harga model tidak diterbitkan');
  recoveryCode = admin.recoveryCodes[2];

  await page.goto(`http://127.0.0.1:${webPort}/admin/kode`);
  await page.getByLabel('Paket').selectOption({ label: 'Paket lokal (100.000.000 kredit token)' });
  await page.getByLabel('Referensi penjualan').fill('web-local-sale');
  await page.getByRole('button', { name: 'Terbitkan kode', exact: true }).click();
  const issueConfirmation = page.getByRole('dialog', { name: 'Terbitkan kode' });
  await expectVisible(issueConfirmation, 'Konfirmasi terbit kode tidak tampil');
  await db.query("update session set auth_at=clock_timestamp()-interval '10 minutes' where user_id=$1 and kind='ADMIN'", [adminUserId]);
  await issueConfirmation.getByRole('button', { name: 'Terbitkan kode', exact: true }).click();
  const voucherStepUp = page.getByRole('dialog', { name: 'Verifikasi ulang admin' });
  await expectVisible(voucherStepUp, 'Step-up penerbitan kode tidak tampil');
  await voucherStepUp.getByLabel('Kode autentikator').fill(recoveryCode);
  await voucherStepUp.getByRole('button', { name: 'Verifikasi kode' }).click();
  await expectVisible(page.locator('.secret'), 'Kode redeem sekali tampil tidak ada');
  const voucherCode = await page.locator('.secret').innerText();
  assert.match(voucherCode, /^ZR-/);
  await page.getByRole('button', { name: 'Saya sudah menyalin' }).click();
  await page.getByRole('button', { name: 'Keluar' }).click();

  await page.goto(`http://127.0.0.1:${webPort}/masuk`);
  await page.getByLabel('Username atau email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expectVisible(page.getByRole('heading', { name: 'Beranda', exact: true }), 'Login pelanggan setelah admin logout tidak selesai');
  await page.goto(`http://127.0.0.1:${webPort}/isi-saldo`);
  await page.getByLabel('Kode redeem', { exact: true }).fill(voucherCode);
  await page.getByRole('button', { name: 'Tukar kode' }).click();
  await expectVisible(page.getByText('Saldo berhasil ditambah'), 'Redeem tidak menghasilkan receipt');
  await page.getByLabel('Kode redeem', { exact: true }).fill(voucherCode);
  await page.getByRole('button', { name: 'Tukar kode' }).click();
  await expectVisible(page.getByText('Tidak ada penambahan kedua'), 'Replay redeem tidak dijelaskan');
  await expectVisible(page.getByText('Saldo tercatat saat jawaban ini diterima'), 'Saldo replay tidak diberi label saldo terkini');
  await page.goto(`http://127.0.0.1:${webPort}/transaksi`);
  await expectVisible(page.getByText('Penukaran kode', { exact: true }), 'Ledger tidak memuat penukaran');
  await assertReflow(page);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, 'Browser storage tidak kosong');
  process.stdout.write('local-browser-verify: PASS\n');
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
