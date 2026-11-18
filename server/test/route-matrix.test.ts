// Task 6 Part A: Exhaustive route authorization matrix, CSRF, step-up freshness, API key error surfaces, and tenant isolation.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  ADMIN,
  Client,
  DB_URL,
  KEY,
  fakeResolver,
  mailer,
  makeAdmin,
  makeCustomer,
  adminClient,
  wipe,
} from './helpers.ts';
import { createPool, withTx, type Db } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import * as ledger from '../src/ledger.ts';
import { resetRouteHealth } from '../src/gateway.ts';
import { totpAt, totpStep } from '../src/crypto.ts';

type RouteCategory = 'public' | 'customer' | 'admin' | 'admin-stepup' | 'apikey' | 'static';
type DiscoveredRoute = { method: string; path: string };

const ROUTE_MATRIX: Record<string, RouteCategory> = {
  // public
  'GET /healthz': 'public',
  'GET /readyz': 'public',
  'POST /api/auth/activate': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/logout': 'public',
  'POST /api/auth/reset/request': 'public',
  'POST /api/auth/reset/complete': 'public',
  'POST /admin/api/login': 'public',
  'POST /admin/api/logout': 'public',

  // customer (OWNER session)
  'POST /api/account/password': 'customer',
  'POST /api/account/close': 'customer',
  'GET /api/account/sessions': 'customer',
  'POST /api/account/sessions/:id/revoke': 'customer',
  'POST /api/keys': 'customer',
  'GET /api/keys': 'customer',
  'GET /api/keys/:id': 'customer',
  'POST /api/keys/:id/limits': 'customer',
  'POST /api/keys/:id/revoke': 'customer',
  'GET /api/packs': 'customer',
  'POST /api/redeem': 'customer',
  'GET /api/me': 'customer',
  'GET /api/balance': 'customer',
  'GET /api/models': 'customer',
  'GET /api/requests': 'customer',
  'GET /api/ledger': 'customer',

  // admin (MFA-verified admin session, or pre-MFA second-factor submission)
  'POST /admin/api/second-factor': 'admin',
  'POST /admin/api/invites': 'admin',
  'GET /admin/api/customers': 'admin',
  'GET /admin/api/customers/:username/usage': 'admin',
  'GET /admin/api/customers/:username/keys': 'admin',
  'GET /admin/api/customers/:username': 'admin',
  'GET /admin/api/models': 'admin',
  'POST /admin/api/models': 'admin',
  'POST /admin/api/models/price/draft': 'admin',
  'POST /admin/api/models/price/preview': 'admin',
  'GET /admin/api/packs': 'admin',
  'POST /admin/api/packs': 'admin',
  'POST /admin/api/packs/:id': 'admin',
  'GET /admin/api/vouchers': 'admin',
  'GET /admin/api/upstreams': 'admin',
  'GET /admin/api/upstreams/:id/models': 'admin',
  'GET /admin/api/routes': 'admin',
  'GET /admin/api/overview': 'admin',
  'GET /admin/api/requests': 'admin',
  'GET /admin/api/requests/unresolved': 'admin',
  'GET /admin/api/settings/overdraft': 'admin',
  'GET /admin/api/settings/gateway': 'admin',
  'GET /admin/api/audit': 'admin',

  // admin-stepup (financial, credential rotation, upstream/route, customer suspend/restore/key-revoke, price publish/retire/archive)
  'POST /admin/api/account/password': 'admin-stepup',
  'POST /admin/api/account/authenticator/start': 'admin-stepup',
  'POST /admin/api/account/authenticator/confirm': 'admin-stepup',
  'POST /admin/api/topups': 'admin-stepup',
  'POST /admin/api/adjustments': 'admin-stepup',
  'POST /admin/api/customers/:username/suspend': 'admin-stepup',
  'POST /admin/api/customers/:username/restore': 'admin-stepup',
  'POST /admin/api/customers/:username/keys/:id/revoke': 'admin-stepup',
  'POST /admin/api/models/price/publish': 'admin-stepup',
  'POST /admin/api/models/price/retire': 'admin-stepup',
  'POST /admin/api/models/archive': 'admin-stepup',
  'POST /admin/api/vouchers': 'admin-stepup',
  'POST /admin/api/vouchers/:id/revoke': 'admin-stepup',
  'POST /admin/api/upstreams/:id/archive': 'admin-stepup',
  'POST /admin/api/upstreams': 'admin-stepup',
  'POST /admin/api/upstreams/:id': 'admin-stepup',
  'POST /admin/api/upstreams/:id/status': 'admin-stepup',
  'POST /admin/api/routes': 'admin-stepup',
  'POST /admin/api/routes/:id': 'admin-stepup',
  'POST /admin/api/requests/:id/resolve': 'admin-stepup',
  'POST /admin/api/settings/overdraft': 'admin-stepup',
  'POST /admin/api/settings/gateway': 'admin-stepup',

  // apikey (data plane /v1/*)
  'POST /v1/chat/completions': 'apikey',
  'POST /v1/messages': 'apikey',
  'POST /v1/responses': 'apikey',
  'GET /v1/models': 'apikey',
};

const DUMMY_UUID = '00000000-0000-4000-8000-000000000099';
const MISSING_REQUEST_ID = 'req_00000000-0000-4000-8000-000000000099';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function unbase32(s: string): Buffer {
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const ch of s) {
    v = (v << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Parse `app.printRoutes({ commonPrefix: false })` ASCII tree into canonical `METHOD /path` entries. */
function parsePrintedRoutes(tree: string): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  const stack: string[] = [];

  for (const line of tree.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([ │]*)(?:├── |└── )(.+?)(?: \(([^)]+)\))?$/.exec(line);
    if (!match) {
      throw new Error(`Baris printRoutes tidak dapat diurai: ${line}`);
    }
    const depth = Math.floor(match[1].length / 4);
    const segment = match[2];
    stack[depth] = segment;
    stack.length = depth + 1;

    if (!match[3]) continue;
    const rawPath = stack.join('').replace(/\/{2,}/g, '/');
    const fullPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const methods = match[3].split(',').map((m) => m.trim());
    for (const method of methods) {
      if (method === 'HEAD' && methods.includes('GET')) continue;
      routes.push({ method, path: fullPath });
    }
  }

  return routes;
}

function materializePath(template: string): string {
  if (template === '/admin/api/requests/:id/resolve') {
    return `/admin/api/requests/${MISSING_REQUEST_ID}/resolve`;
  }
  return template
    .replace(/:id\b/g, DUMMY_UUID)
    .replace(/:username\b/g, 'nonexistent_user');
}

function minimalPayloadFor(routePath: string): unknown {
  if (routePath === '/admin/api/account/password') return { current: 'x', next: 'short' };
  if (routePath === '/admin/api/models/price/preview') return { id: 'no/model', which: 'draft', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
  if (routePath === '/admin/api/routes' || routePath.startsWith('/admin/api/routes/')) return { upstreamModel: 'm1', expectedVersion: '1' };
  return {};
}

let db: Db;
let app: FastifyInstance;
let tempDir: string;
let webDistDir: string;
let adm: Awaited<ReturnType<typeof makeAdmin>>;

before(async () => {
  db = createPool(DB_URL, 10);
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db);
  await db.query("update system_setting set value=0 where name='overdraft_micro'");

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-route-matrix-'));
  webDistDir = path.join(tempDir, 'dist');
  fs.mkdirSync(path.join(webDistDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><title>ZRouter</title><div id="root"></div>');
  fs.writeFileSync(path.join(webDistDir, 'assets', 'app-abc123.js'), 'console.log("ok");');

  app = await buildApp({
    db,
    key: KEY,
    mailer,
    secureCookies: false,
    resolveHost: fakeResolver,
    webDist: webDistDir,
    gateway: { unsafeAllowAnyUpstreamUrl: true, authFailuresPerMinutePerIp: 100 },
  });
});

after(async () => {
  if (app) await app.close();
  if (db) {
    assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections');
    await db.end();
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetRouteHealth();
  await wipe(db);
  await db.query("update system_setting set value=0 where name='overdraft_micro'");
  adm = await makeAdmin(db);
});

test('setiap rute yang terdaftar di Fastify terklasifikasi penuh dua arah di ROUTE_MATRIX dan static dilayani via fallback aman', async () => {
  const discovered = parsePrintedRoutes(app.printRoutes({ commonPrefix: false }));
  const discoveredKeys = new Set(discovered.map((r) => `${r.method} ${r.path}`));
  const matrixKeys = new Set(Object.keys(ROUTE_MATRIX));

  for (const key of discoveredKeys) {
    assert.ok(
      matrixKeys.has(key),
      `Rute baru belum diklasifikasikan di ROUTE_MATRIX (server/test/route-matrix.test.ts): ${key}. Wajib klasifikasikan sebagai salah satu: public, customer, admin, admin-stepup, apikey, static.`,
    );
  }
  for (const key of matrixKeys) {
    assert.ok(
      discoveredKeys.has(key),
      `Entri di ROUTE_MATRIX tidak lagi ada pada rute aplikasi: ${key}. Hapus atau perbarui entri ini.`,
    );
  }

  // Static fallback via setNotFoundHandler (registerStatic)
  for (const staticUrl of ['/', '/masuk', '/admin/pelanggan', '/assets/app-abc123.js']) {
    const res = await app.inject({ method: 'GET', url: staticUrl, remoteAddress: '10.10.0.1' });
    assert.equal(res.statusCode, 200, `static GET ${staticUrl} harus 200`);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.ok(String(res.headers['content-security-policy'] ?? '').includes("frame-ancestors 'none'"));
  }
  for (const missingApi of ['/api/tidak-ada', '/admin/api/tidak-ada', '/v1/tidak-ada']) {
    const res = await app.inject({ method: 'GET', url: missingApi, remoteAddress: '10.10.0.2' });
    assert.equal(res.statusCode, 404, `${missingApi} tidak boleh jatuh ke HTML static`);
    assert.equal(res.json().error.code, 'not_found');
  }
  assert.equal(
    (await app.inject({ method: 'POST', url: '/masuk', remoteAddress: '10.10.0.3' })).statusCode,
    403,
    'POST static route tanpa x-router-csrf harus ditolak dengan 403 csrf',
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/masuk', headers: { 'x-router-csrf': '1' }, remoteAddress: '10.10.0.4' })).statusCode,
    404,
  );
});

test('tanpa cookie, salah peran cookie, sesi admin belum TOTP, dan ketiadaan x-router-csrf ditolak secara bawaan di seluruh rute', async () => {
  const admin = await adminClient(app, adm);
  const cust = await makeCustomer(app, admin, 'cust_matrix');

  // Password-only admin session (before /admin/api/second-factor)
  const preMfaAdmin = new Client(app, '10.20.0.1');
  const loginRes = await preMfaAdmin.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  assert.equal(loginRes.status, 200);

  const custTokenInAdminCookie = { asid: cust.client.cookies.sid };
  const adminTokenInCustCookie = { sid: admin.cookies.asid };

  for (const [key, category] of Object.entries(ROUTE_MATRIX)) {
    const [method, rawPath] = key.split(' ') as ['GET' | 'POST', string];
    const url = materializePath(rawPath);
    const payload = method === 'POST' ? minimalPayloadFor(rawPath) : undefined;

    if (category === 'public') {
      if (method === 'GET') {
        const res = await app.inject({ method: 'GET', url, remoteAddress: '10.20.0.2' });
        assert.equal(res.statusCode, 200, `public GET ${url}`);
      } else {
        const noCsrf = await app.inject({
          method: 'POST',
          url,
          remoteAddress: '10.20.0.3',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(payload ?? {}),
        });
        assert.equal(noCsrf.statusCode, 403, `public ${key} tanpa x-router-csrf harus 403`);
        assert.equal(noCsrf.json().error.code, 'csrf', `public ${key} harus berkode csrf`);
      }
      continue;
    }

    if (category === 'customer') {
      // 1. Tanpa cookie -> 401
      const noCookie = await app.inject({
        method,
        url,
        remoteAddress: '10.20.0.4',
        headers: { 'x-router-csrf': '1', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        payload: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
      });
      assert.equal(noCookie.statusCode, 401, `${key} tanpa cookie harus 401`);

      // 2. Cookie admin (normal & dipindah ke sid) -> 401
      const wrongRole = await admin.req(method, url, payload);
      assert.equal(wrongRole.status, 401, `${key} dengan cookie admin harus 401`);

      const forgedRole = await app.inject({
        method,
        url,
        remoteAddress: '10.20.0.5',
        cookies: adminTokenInCustCookie,
        headers: { 'x-router-csrf': '1', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        payload: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
      });
      assert.equal(forgedRole.statusCode, 401, `${key} dengan token admin di cookie sid harus 401`);

      // 3. Mutasi dengan sesi pelanggan sah tetapi tanpa x-router-csrf -> 403 csrf
      if (method === 'POST') {
        const noCsrf = await cust.client.post(url, payload, { csrf: false });
        assert.equal(noCsrf.status, 403, `${key} tanpa x-router-csrf harus 403`);
        assert.equal(noCsrf.json?.error?.code, 'csrf', `${key} harus berkode csrf`);
      }
      continue;
    }

    if (category === 'admin' || category === 'admin-stepup') {
      // 1. Tanpa cookie -> 401
      const noCookie = await app.inject({
        method,
        url,
        remoteAddress: '10.20.0.6',
        headers: { 'x-router-csrf': '1', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        payload: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
      });
      assert.equal(noCookie.statusCode, 401, `${key} tanpa cookie harus 401`);

      // 2. Cookie pelanggan (normal & dipindah ke asid) -> 401
      const wrongRole = await cust.client.req(method, url, payload);
      assert.equal(wrongRole.status, 401, `${key} dengan cookie pelanggan harus 401`);

      const forgedRole = await app.inject({
        method,
        url,
        remoteAddress: '10.20.0.7',
        cookies: custTokenInAdminCookie,
        headers: { 'x-router-csrf': '1', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        payload: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
      });
      assert.equal(forgedRole.statusCode, 401, `${key} dengan token pelanggan di cookie asid harus 401`);

      // 3. Sesi admin sebelum TOTP (kecuali /admin/api/second-factor) -> 401 second_factor_required
      if (rawPath !== '/admin/api/second-factor') {
        const preMfa = await preMfaAdmin.req(method, url, payload);
        assert.equal(preMfa.status, 401, `${key} sebelum TOTP harus 401`);
        assert.equal(preMfa.json?.error?.code, 'second_factor_required', `${key} sebelum TOTP harus second_factor_required`);
      }

      // 4. Mutasi dengan sesi admin sah tetapi tanpa x-router-csrf -> 403 csrf
      if (method === 'POST') {
        const noCsrf = await admin.post(url, payload, { csrf: false });
        assert.equal(noCsrf.status, 403, `${key} tanpa x-router-csrf harus 403`);
        assert.equal(noCsrf.json?.error?.code, 'csrf', `${key} harus berkode csrf`);
      }
    }
  }
});

test('semua rute admin-stepup menolak sesi dengan auth_at kedaluwarsa menggunakan step_up_required dan nol mutasi database', async () => {
  const admin = await adminClient(app, adm);

  // Seed entitas nyata agar jika cek step-up hilang, mutasi benar-benar akan menembus ke DB.
  const activeCust = await makeCustomer(app, admin, 'step_active');
  const suspendedCust = await makeCustomer(app, admin, 'step_suspended');

  const keyRes = await activeCust.client.post('/api/keys', {
    name: 'step-key',
    allowedModels: null,
    spendLimitMicro: null,
    expiresAt: null,
    idempotencyKey: 'step-key-0001',
  });
  assert.equal(keyRes.status, 201);
  const targetKeyId = keyRes.json.key.id as string;
  const targetKeySecret = keyRes.json.secret as string;

  assert.equal(
    (await admin.post('/admin/api/customers/step_suspended/suspend', {
      expectedVersion: '1',
      reason: 'seed suspended for stepup restore test',
    })).status,
    200,
  );

  // Token pack + active voucher
  const packRes = await admin.post('/admin/api/packs', {
    name: 'Paket Uji StepUp',
    tokens: '50',
    displayPriceIdr: '100000',
    active: true,
  });
  assert.equal(packRes.status, 201);
  const packId = packRes.json.id as string;

  const voucherRes = await admin.post('/admin/api/vouchers', {
    packId,
    kind: 'SALE',
    saleRef: 'SALE-STEPUP-001',
    idempotencyKey: 'voucher-stepup-001',
  });
  assert.equal(voucherRes.status, 201);
  const voucherId = voucherRes.json.voucher.id as string;
  const voucherCode = voucherRes.json.code as string;

  // Redeem minimal topup agar activeCust punya saldo untuk hold UNRESOLVED
  assert.equal((await activeCust.client.post('/api/redeem', { code: voucherCode })).status, 200);
  const voucher2Res = await admin.post('/admin/api/vouchers', {
    packId,
    kind: 'SALE',
    saleRef: 'SALE-STEPUP-002',
    idempotencyKey: 'voucher-stepup-002',
  });
  assert.equal(voucher2Res.status, 201);
  const liveVoucherId = voucher2Res.json.voucher.id as string;

  // Upstream + 3 model (publishable draft, published retirable, retired archivable) + route
  const upRes = await admin.post('/admin/api/upstreams', {
    name: 'up-stepup',
    baseUrls: { CHAT: 'https://stepup.example.test/v1' },
    apiKey: 'sk-stepup-upstream-1234',
    termsNote: 'stepup seed',
  });
  assert.equal(upRes.status, 201);
  const upstreamId = upRes.json.id as string;

  const pubModel = 'stepup/publish-ready';
  assert.equal((await admin.post('/admin/api/models', { id: pubModel, displayName: 'Publish Ready' })).status, 201);
  const pubDraft = await admin.post('/admin/api/models/price/draft', {
    id: pubModel,
    expectedVersion: '1',
    inputRateMicro: '1000',
    outputRateMicro: '2000',
    cacheReadRateMicro: '100',
    cacheWriteRateMicro: '500',
    multiplier: '1',
  });
  assert.equal(pubDraft.status, 200);

  const retModel = 'stepup/retire-ready';
  assert.equal((await admin.post('/admin/api/models', { id: retModel, displayName: 'Retire Ready' })).status, 201);
  assert.equal((await admin.post('/admin/api/models/price/draft', {
    id: retModel,
    expectedVersion: '1',
    inputRateMicro: '1000',
    outputRateMicro: '2000',
    cacheReadRateMicro: '100',
    cacheWriteRateMicro: '500',
    multiplier: '1',
  })).status, 200);
  const retPublished = await admin.post('/admin/api/models/price/publish', {
    id: retModel,
    expectedVersion: '2',
    reason: 'publish before stale stepup retire test',
  });
  assert.equal(retPublished.status, 200);

  const archModel = 'stepup/archive-ready';
  assert.equal((await admin.post('/admin/api/models', { id: archModel, displayName: 'Archive Ready' })).status, 201);

  const routeRes = await admin.post('/admin/api/routes', {
    modelId: retModel,
    upstreamId,
    protocol: 'CHAT',
    upstreamModel: 'up-model-1',
    priority: 10,
    enabled: true,
  });
  assert.equal(routeRes.status, 201);
  const routeId = routeRes.json.id as string;

  // Seed UNRESOLVED request via placeKeyHold agar POST /admin/api/requests/:id/resolve memiliki target nyata
  const unresolvedReqId = 'req_' + crypto.randomUUID();
  await withTx(db, async (tx) => {
    const placed = await ledger.placeKeyHold(tx, {
      secret: targetKeySecret,
      requestId: unresolvedReqId,
      amount: 1_000_000n,
      model: retModel,
    });
    const pv = (await tx.query("select id from price_version where model_id=$1 and status='PUBLISHED'", [retModel])).rows[0];
    await tx.query(
      "insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, outcome) values($1,$2,$3,$4,'CHAT',false,'UNRESOLVED',$5,'{}',10,10,1000000,'seed_unresolved')",
      [unresolvedReqId, placed.tenantId, placed.keyId, retModel, pv.id],
    );
  });

  // Start TOTP rotation sebelum auth_at dilewatkan sehingga /authenticator/confirm juga menguji payload nyata
  const totpRot = await admin.post('/admin/api/account/authenticator/start', {});
  assert.equal(totpRot.status, 200);
  const pendingCode = totpAt(unbase32(totpRot.json.secretBase32 as string), totpStep(Date.now()));

  // Lewatkan umur autentikasi admin dari ambang 300 detik
  await db.query("update session set auth_at = now() - interval '6 minutes' where kind='ADMIN'");

  const snapshot = async () => ({
    users: (await db.query('select id, password_hash, status from app_user order by id')).rows,
    adminCreds: (await db.query('select user_id, totp_secret_enc, pending_totp_enc, last_totp_step from admin_credential order by user_id')).rows,
    recoveryCount: (await db.query('select count(*) c from admin_recovery_code')).rows[0].c,
    tenants: (await db.query('select id, status, version from tenant order by id')).rows,
    keys: (await db.query('select id, status, version, spent, held from api_key order by id')).rows,
    accounts: (await db.query('select id, posted, held from ledger_account order by id')).rows,
    entriesCount: (await db.query('select count(*) c from ledger_entry')).rows[0].c,
    holds: (await db.query('select id, status, amount, settled_debit from hold order by id')).rows,
    requests: (await db.query('select id, state, debit, outcome from request order by id')).rows,
    models: (await db.query('select id, archived, version from public_model order by id')).rows,
    prices: (await db.query('select id, status from price_version order by id')).rows,
    vouchers: (await db.query('select id, status from voucher order by id')).rows,
    upstreams: (await db.query('select id, status, archived, version from upstream order by id')).rows,
    routes: (await db.query('select id, enabled, priority, version from route order by id')).rows,
    overdraft: (await db.query("select value from system_setting where name='overdraft_micro'")).rows[0].value,
    gateway: (await db.query("select value, note, updated_by from system_setting where name='gateway_paused'")).rows[0],
    auditCount: (await db.query('select count(*) c from audit_event')).rows[0].c,
  });

  const beforeSnap = await snapshot();

  const stepupCases: Record<string, { url: string; payload: unknown }> = {
    'POST /admin/api/account/password': {
      url: '/admin/api/account/password',
      payload: { current: ADMIN.password, next: 'a-brand-new-admin-password-9' },
    },
    'POST /admin/api/account/authenticator/start': {
      url: '/admin/api/account/authenticator/start',
      payload: {},
    },
    'POST /admin/api/account/authenticator/confirm': {
      url: '/admin/api/account/authenticator/confirm',
      payload: { code: pendingCode },
    },
    'POST /admin/api/topups': {
      url: '/admin/api/topups',
      payload: { username: 'step_active', amountTokens: '10', saleRef: 'INV-STALE-1', idempotencyKey: 'stale-topup-1' },
    },
    'POST /admin/api/adjustments': {
      url: '/admin/api/adjustments',
      payload: { username: 'step_active', amountMicro: '1000000', reason: 'stale stepup adjustment', idempotencyKey: 'stale-adj-1' },
    },
    'POST /admin/api/customers/:username/suspend': {
      url: '/admin/api/customers/step_active/suspend',
      payload: { expectedVersion: '1', reason: 'stale stepup suspend' },
    },
    'POST /admin/api/customers/:username/restore': {
      url: '/admin/api/customers/step_suspended/restore',
      payload: { expectedVersion: '2', reason: 'stale stepup restore' },
    },
    'POST /admin/api/customers/:username/keys/:id/revoke': {
      url: `/admin/api/customers/step_active/keys/${targetKeyId}/revoke`,
      payload: { expectedVersion: '1' },
    },
    'POST /admin/api/models/price/publish': {
      url: '/admin/api/models/price/publish',
      payload: { id: pubModel, expectedVersion: '2', reason: 'stale stepup publish' },
    },
    'POST /admin/api/models/price/retire': {
      url: '/admin/api/models/price/retire',
      payload: { id: retModel, expectedVersion: '3', reason: 'stale stepup retire' },
    },
    'POST /admin/api/models/archive': {
      url: '/admin/api/models/archive',
      payload: { id: archModel, archived: true, expectedVersion: '1' },
    },
    'POST /admin/api/vouchers': {
      url: '/admin/api/vouchers',
      payload: { packId, kind: 'SALE', saleRef: 'SALE-STALE-999', idempotencyKey: 'voucher-stale-999' },
    },
    'POST /admin/api/vouchers/:id/revoke': {
      url: `/admin/api/vouchers/${liveVoucherId}/revoke`,
      payload: { reason: 'stale stepup revoke voucher' },
    },
    'POST /admin/api/upstreams/:id/archive': {
      url: `/admin/api/upstreams/${upstreamId}/archive`,
      payload: { archived: true, expectedVersion: '1' },
    },
    'POST /admin/api/upstreams': {
      url: '/admin/api/upstreams',
      payload: { name: 'up-stale-new', baseUrls: { CHAT: 'https://stale.example.test/v1' }, apiKey: 'sk-stale-new-1234', termsNote: 'x' },
    },
    'POST /admin/api/upstreams/:id': {
      url: `/admin/api/upstreams/${upstreamId}`,
      payload: { name: 'up-stepup-renamed', baseUrls: { CHAT: 'https://stepup.example.test/v1' }, expectedVersion: '1', termsNote: 'changed' },
    },
    'POST /admin/api/upstreams/:id/status': {
      url: `/admin/api/upstreams/${upstreamId}/status`,
      payload: { status: 'ELIGIBLE', expectedVersion: '1', reason: 'stale stepup eligible' },
    },
    'POST /admin/api/routes': {
      url: '/admin/api/routes',
      payload: { modelId: pubModel, upstreamId, protocol: 'CHAT', upstreamModel: 'up-m2', priority: 20, enabled: true },
    },
    'POST /admin/api/routes/:id': {
      url: `/admin/api/routes/${routeId}`,
      payload: { expectedVersion: '1', upstreamModel: 'up-model-changed', priority: 5, enabled: false },
    },
    'POST /admin/api/requests/:id/resolve': {
      url: `/admin/api/requests/${unresolvedReqId}/resolve`,
      payload: { debitTokens: '1', reason: 'stale stepup resolve' },
    },
    'POST /admin/api/settings/overdraft': {
      url: '/admin/api/settings/overdraft',
      payload: { tokens: '25' },
    },
    'POST /admin/api/settings/gateway': {
      url: '/admin/api/settings/gateway',
      payload: { paused: true, reason: 'stale stepup pause' },
    },
  };

  // Pastikan cakupan stepupCases sama persis dengan entri admin-stepup pada ROUTE_MATRIX
  const expectedStepupKeys = Object.entries(ROUTE_MATRIX)
    .filter(([, cat]) => cat === 'admin-stepup')
    .map(([k]) => k)
    .sort();
  assert.deepEqual(Object.keys(stepupCases).sort(), expectedStepupKeys);
  assert.ok(voucherId);

  for (const [routeKey, c] of Object.entries(stepupCases)) {
    const res = await admin.post(c.url, c.payload);
    assert.equal(res.status, 401, `${routeKey} dengan step-up kedaluwarsa harus 401`);
    assert.equal(res.json?.error?.code, 'step_up_required', `${routeKey} harus berkode step_up_required`);
  }

  // Admin read biasa tanpa step-up tetap bekerja
  assert.equal((await admin.get('/admin/api/audit')).status, 200);

  const afterSnap = await snapshot();
  assert.deepEqual(afterSnap, beforeSnap, 'rute admin-stepup yang ditolak tidak boleh mengubah baris tabel apa pun');
});

test('rute apikey (/v1/*) menolak tanpa key, key salah, dan key dicabut dengan 401 dalam format error masing-masing permukaan', async () => {
  const admin = await adminClient(app, adm);
  const cust = await makeCustomer(app, admin, 'v1_cust');

  const keyRes = await cust.client.post('/api/keys', {
    name: 'revoked-for-v1',
    allowedModels: null,
    spendLimitMicro: null,
    expiresAt: null,
    idempotencyKey: 'v1-revoked-0001',
  });
  assert.equal(keyRes.status, 201);
  const revokedSecret = keyRes.json.secret as string;
  assert.equal(
    (await cust.client.post(`/api/keys/${keyRes.json.key.id}/revoke`, { expectedVersion: '1' })).status,
    200,
  );

  let ipOctet = 10;
  const nextIp = () => `10.55.0.${ipOctet++}`;

  const v1Routes: { key: string; method: 'GET' | 'POST'; url: string; surface: 'OPENAI' | 'ANTHROPIC'; payload?: unknown }[] = [
    { key: 'POST /v1/chat/completions', method: 'POST', url: '/v1/chat/completions', surface: 'OPENAI', payload: { model: 'x', messages: [{ role: 'user', content: 'hi' }] } },
    { key: 'POST /v1/messages', method: 'POST', url: '/v1/messages', surface: 'ANTHROPIC', payload: { model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] } },
    { key: 'POST /v1/responses', method: 'POST', url: '/v1/responses', surface: 'OPENAI', payload: { model: 'x', input: 'hi' } },
    { key: 'GET /v1/models', method: 'GET', url: '/v1/models', surface: 'OPENAI' },
  ];

  assert.deepEqual(
    v1Routes.map((r) => r.key).sort(),
    Object.entries(ROUTE_MATRIX).filter(([, c]) => c === 'apikey').map(([k]) => k).sort(),
  );

  for (const r of v1Routes) {
    const authModes: { label: string; headers: Record<string, string>; expectedCode: string }[] = [
      { label: 'missing', headers: {}, expectedCode: 'auth_invalid' },
      { label: 'wrong-bearer', headers: { authorization: 'Bearer rtr_0000000000000000000000000000000000000000000' }, expectedCode: 'auth_invalid' },
      { label: 'revoked-bearer', headers: { authorization: `Bearer ${revokedSecret}` }, expectedCode: 'key_revoked' },
    ];
    if (r.surface === 'ANTHROPIC') {
      authModes.push(
        { label: 'wrong-x-api-key', headers: { 'x-api-key': 'bad-key' }, expectedCode: 'auth_invalid' },
        { label: 'revoked-x-api-key', headers: { 'x-api-key': revokedSecret }, expectedCode: 'key_revoked' },
      );
    }

    for (const mode of authModes) {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        remoteAddress: nextIp(),
        headers: {
          ...mode.headers,
          ...(r.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        payload: r.method === 'POST' ? JSON.stringify(r.payload) : undefined,
      });
      assert.equal(res.statusCode, 401, `${r.key} (${mode.label}) harus 401`);
      const json = res.json();
      if (r.surface === 'ANTHROPIC') {
        assert.equal(json.type, 'error', `${r.key} (${mode.label}) format Anthropic`);
        assert.equal(json.error?.type, mode.expectedCode);
        assert.equal(typeof json.error?.message, 'string');
        assert.equal(json.error?.code, undefined);
      } else {
        assert.equal(json.error?.code, mode.expectedCode, `${r.key} (${mode.label}) format OpenAI`);
        assert.equal(json.error?.type, mode.expectedCode);
        assert.equal(typeof json.error?.message, 'string');
      }
    }
  }
});

test('isolasi tenant: seluruh rute pelanggan dengan ID mengembalikan respons identik untuk ID milik tenant lain dan ID yang tidak ada', async () => {
  const admin = await adminClient(app, adm);
  const custA = await makeCustomer(app, admin, 'tenant_a');
  const custB = await makeCustomer(app, admin, 'tenant_b');

  // Seed data milik tenant A: second session, API key, redeem voucher, hold request
  const custASecondSession = new Client(app, '10.60.0.2');
  assert.equal((await custASecondSession.post('/api/auth/login', { identifier: 'tenant_a', password: custA.password })).status, 200);
  const aSessions = await custA.client.get('/api/account/sessions');
  const otherSessionAId = (aSessions.json.sessions as { id: string }[]).find((s) => s.id !== aSessions.json.current)!.id;

  const keyARes = await custA.client.post('/api/keys', {
    name: 'tenant-a-key',
    allowedModels: null,
    spendLimitMicro: null,
    expiresAt: null,
    idempotencyKey: 'tenant-a-key-0001',
  });
  assert.equal(keyARes.status, 201);
  const keyAId = keyARes.json.key.id as string;

  const packRes = await admin.post('/admin/api/packs', {
    name: 'Paket Isolasi',
    tokens: '25',
    displayPriceIdr: '50000',
    active: true,
  });
  assert.equal(packRes.status, 201);
  const vRes = await admin.post('/admin/api/vouchers', {
    packId: packRes.json.id,
    kind: 'SALE',
    saleRef: 'ISO-001',
    idempotencyKey: 'iso-voucher-001',
  });
  assert.equal(vRes.status, 201);
  assert.equal((await custA.client.post('/api/redeem', { code: vRes.json.code })).status, 200);

  const reqAId = 'req_' + crypto.randomUUID();
  const modelA = 'iso/model-1';
  assert.equal((await admin.post('/admin/api/models', { id: modelA, displayName: 'Iso Model' })).status, 201);
  assert.equal((await admin.post('/admin/api/models/price/draft', {
    id: modelA,
    expectedVersion: '1',
    inputRateMicro: '100',
    outputRateMicro: '100',
    cacheReadRateMicro: '10',
    cacheWriteRateMicro: '50',
    multiplier: '1',
  })).status, 200);
  assert.equal((await admin.post('/admin/api/models/price/publish', {
    id: modelA,
    expectedVersion: '2',
    reason: 'iso seed',
  })).status, 200);

  await withTx(db, async (tx) => {
    const h = await ledger.placeKeyHold(tx, {
      secret: keyARes.json.secret as string,
      requestId: reqAId,
      amount: 500_000n,
      model: modelA,
    });
    const pv = (await tx.query("select id from price_version where model_id=$1 and status='PUBLISHED'", [modelA])).rows[0];
    await tx.query(
      "insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, debit, outcome, settled_at) values($1,$2,$3,$4,'CHAT',false,'SETTLED',$5,'{}',10,10,500000,1000,'completed',now())",
      [reqAId, h.tenantId, h.keyId, modelA, pv.id],
    );
    await ledger.settleHold(tx, { tenantId: h.tenantId, requestId: reqAId, debit: 1000n });
  });

  // Pelanggan B mengakses semua rute customer berparameter ID milik tenant A vs UUID tidak ada
  const crossIdProbes: { method: 'GET' | 'POST'; pathOf: (id: string) => string; payload?: unknown }[] = [
    { method: 'GET', pathOf: (id) => `/api/keys/${id}` },
    {
      method: 'POST',
      pathOf: (id) => `/api/keys/${id}/limits`,
      payload: { name: 'hijacked', allowedModels: null, spendLimitMicro: null, expiresAt: null, expectedVersion: '1' },
    },
    { method: 'POST', pathOf: (id) => `/api/keys/${id}/revoke`, payload: { expectedVersion: '1' } },
  ];

  for (const p of crossIdProbes) {
    const withForeignId = await custB.client.req(p.method, p.pathOf(keyAId), p.payload);
    const withMissingId = await custB.client.req(p.method, p.pathOf(DUMMY_UUID), p.payload);
    assert.equal(withForeignId.status, 404, `${p.method} ${p.pathOf(':id')} lintas tenant harus 404`);
    assert.equal(withMissingId.status, 404);
    assert.deepEqual(withForeignId.json, withMissingId.json, `respons lintas tenant dan ID tidak ada harus identik (${p.pathOf(':id')})`);
  }

  const revokeForeignSession = await custB.client.post(`/api/account/sessions/${otherSessionAId}/revoke`, {});
  const revokeMissingSession = await custB.client.post(`/api/account/sessions/${DUMMY_UUID}/revoke`, {});
  assert.equal(revokeForeignSession.status, 404);
  assert.deepEqual(revokeForeignSession.json, revokeMissingSession.json);

  // Resource milik tenant A tidak tersentuh
  const keyAAfter = await custA.client.get(`/api/keys/${keyAId}`);
  assert.equal(keyAAfter.status, 200);
  assert.equal(keyAAfter.json.key.status, 'ACTIVE');
  assert.equal(keyAAfter.json.key.version, '1');
  assert.equal(keyAAfter.json.key.name, 'tenant-a-key');
  assert.equal((await custASecondSession.get('/api/me')).status, 200, 'sesi kedua tenant A tidak boleh tercabut');

  // Daftar, kursor paginasi, & ringkasan pelanggan B tidak memuat data tenant A
  assert.deepEqual((await custB.client.get('/api/keys')).json.keys, []);
  assert.deepEqual((await custB.client.get(`/api/keys?after=${keyAId}`)).json.keys, []);
  assert.deepEqual((await custB.client.get('/api/requests')).json.requests, []);
  assert.deepEqual((await custB.client.get('/api/requests?before=2099-01-01T00:00:00.000Z')).json.requests, []);
  assert.deepEqual((await custB.client.get('/api/ledger')).json.entries, []);
  assert.deepEqual((await custB.client.get('/api/ledger?before=999999999999')).json.entries, []);
  assert.equal((await custB.client.get('/api/balance')).json.postedMicro, '0');
  const bSessionIds = ((await custB.client.get('/api/account/sessions')).json.sessions as { id: string }[]).map((s) => s.id);
  assert.ok(!bSessionIds.includes(otherSessionAId));

  assert.deepEqual(await ledger.invariantViolations(db), []);
});
