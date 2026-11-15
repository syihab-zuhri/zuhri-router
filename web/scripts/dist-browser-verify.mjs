import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPool } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { createInvite } from '../../server/src/identity.ts';
import { DB_URL } from '../../server/test/helpers.ts';

const port = Number(process.env.VERIFY_DIST_PORT ?? 55482);
const schema = `web_dist_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const dist = fileURLToPath(new URL('../dist', import.meta.url));
const username = 'dist_verify_user';
const password = 'dist-verify-password-only';
const mail = { invites: [] };
const mailer = {
  invite: async (_to, token) => { mail.invites.push(token); },
  passwordReset: async () => {},
};

async function assertReflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Halaman memiliki scroll horizontal');
}

const databaseUrl = new URL(DB_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname));
assert.equal(databaseUrl.pathname, '/router_test');
const root = createPool(databaseUrl.href);
let db;
let app;
let browser;

try {
  await root.query(`create schema "${schema}"`);
  databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
  db = createPool(databaseUrl.href);
  await migrate(db);
  const admin = await bootstrapAdmin(db, key, { username: 'web_dist_admin', email: 'dist-admin@example.test', password: 'dist-admin-password-only' });
  await createInvite(db, { email: 'dist-customer@example.test', adminUser: admin.userId }, mailer);
  app = await buildApp({ db, key, mailer, secureCookies: false, webDist: dist });
  await app.listen({ host: '127.0.0.1', port });
  browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  const origin = `http://127.0.0.1:${port}`;

  const activation = await page.goto(`${origin}/aktivasi#token=${encodeURIComponent(mail.invites[0])}`);
  assert.equal(activation?.status(), 200);
  assert.match(activation?.headers()['content-security-policy'] ?? '', /default-src 'self'/);
  assert.equal(new URL(page.url()).hash, '', 'Token aktivasi masih di URL');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password baru', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Aktifkan akun' }).click();
  await page.getByText('Akun sudah aktif. Silakan masuk.').waitFor({ state: 'visible', timeout: 10_000 });

  await page.getByRole('link', { name: 'Kembali ke masuk' }).click();
  await page.getByLabel('Username atau email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.getByRole('heading', { name: 'Beranda', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await assertReflow(page);

  const portal = await page.goto(`${origin}/panduan`);
  assert.equal(portal?.status(), 200);
  assert.match(portal?.headers()['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  await page.getByRole('heading', { name: 'Panduan Integrasi', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await assertReflow(page);

  const probes = await page.evaluate(async () => Promise.all(['/api/not-found', '/admin/api/not-found', '/v1/not-found', '/healthz', '/readyz', '/missing.js'].map(async path => {
    const response = await fetch(path);
    return { path, status: response.status, type: response.headers.get('content-type') ?? '', body: await response.text() };
  })));
  for (const probe of probes.filter(probe => ['/api/not-found', '/admin/api/not-found', '/v1/not-found', '/healthz', '/readyz'].includes(probe.path))) {
    assert.ok(!probe.type.includes('text/html'), `${probe.path} must not receive SPA HTML`);
  }
  const missingAsset = probes.find(probe => probe.path === '/missing.js');
  assert.equal(missingAsset?.status, 404);
  assert.ok(!missingAsset?.type.includes('text/html'));

  process.stdout.write('same-origin-dist-verify: PASS\n');
} finally {
  await browser?.close().catch(() => {});
  await app?.close().catch(() => {});
  await db?.end().catch(() => {});
  if (root) {
    if (/^web_dist_[a-f0-9]{32}$/.test(schema)) await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
    await root.end().catch(() => {});
  }
}
