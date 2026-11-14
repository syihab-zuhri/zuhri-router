// TEST-007 (admin authentication) and the top-up part of TEST-014.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, ADMIN } from './helpers.ts';
import * as ledger from '../src/ledger.ts';
import type { Db } from '../src/db/pool.ts';

let db: Db; let app: any; let adm: Awaited<ReturnType<typeof makeAdmin>>;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); });
const entries = async () => (await db.query('select count(*) n from ledger_entry')).rows[0].n;

test('password alone opens nothing: admin operations need the second factor', async () => {
  const c = new Client(app);
  assert.equal((await c.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password })).status, 200);
  for (const [m, url, body] of [['POST', '/admin/api/invites', { email: 'x@example.test' }], ['GET', '/admin/api/audit', undefined], ['POST', '/admin/api/topups', { username: 'x', amountTokens: '1', saleRef: 'a', idempotencyKey: 'k-12345678' }]] as const) {
    const r = await c.req(m, url, body); assert.equal(r.status, 401); assert.equal(r.json.error.code, 'second_factor_required');
  }
  assert.equal((await new Client(app).get('/admin/api/audit')).status, 401);
});

test('an admin cannot sign in through the customer route and the public flow cannot create one', async () => {
  assert.equal((await new Client(app).post('/api/auth/login', { identifier: ADMIN.username, password: ADMIN.password })).status, 401);
  const admin = await adminClient(app, adm); await makeCustomer(app, admin, 'budi');
  assert.equal((await db.query("select count(*) n from app_user where role='ADMIN'")).rows[0].n, '1');
  assert.equal((await new Client(app).post('/admin/api/login', { identifier: 'budi', password: 'customer-password-1' })).status, 401, 'a customer is not an admin');
});

test('a TOTP code is accepted once; wrong codes are rate limited', async () => {
  const c = new Client(app); await c.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  const code = adm.code(0);
  assert.equal((await c.post('/admin/api/second-factor', { code })).status, 200);
  assert.equal((await c.post('/admin/api/second-factor', { code })).json.error.code, 'invalid_code', 'replay of the same step');
  for (let i = 0; i < 4; i++) assert.equal((await c.post('/admin/api/second-factor', { code: '000000' })).status, 401);
  const limited = await c.post('/admin/api/second-factor', { code: adm.code(1) });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers['retry-after']) > 0);
});

test('recovery codes work once', async () => {
  const c = new Client(app); await c.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  assert.equal((await c.post('/admin/api/second-factor', { code: adm.recoveryCodes[0] })).status, 200);
  assert.equal((await c.get('/admin/api/audit')).status, 200);
  const d = new Client(app, '10.8.8.8'); await d.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  assert.equal((await d.post('/admin/api/second-factor', { code: adm.recoveryCodes[0] })).status, 401);
});

test('top-up needs a recent second factor; without it nothing is written', async () => {
  const admin = await adminClient(app, adm); await makeCustomer(app, admin, 'budi');
  await db.query("update session set auth_at = now() - interval '6 minutes' where kind='ADMIN'");
  const body = { username: 'budi', amountTokens: '50000', saleRef: 'INV-100', idempotencyKey: 'topup-budi-0001' };
  const blocked = await admin.post('/admin/api/topups', body);
  assert.equal(blocked.status, 401); assert.equal(blocked.json.error.code, 'step_up_required'); assert.equal(await entries(), '0');
  assert.equal((await admin.get('/admin/api/audit')).status, 200, 'reads do not need step-up');
  assert.equal((await admin.post('/admin/api/second-factor', { code: adm.code(0) })).status, 200);
  const ok = await admin.post('/admin/api/topups', body);
  assert.equal(ok.status, 201); assert.equal(ok.json.amountMicro, '50000000000'); assert.equal(ok.json.username, 'budi');
  assert.ok(!Number.isNaN(Date.parse(ok.json.createdAt)), 'the receipt carries the server time');
  assert.equal((await admin.post('/admin/api/topups', body)).json.createdAt, ok.json.createdAt, 'a replay keeps the original time');
});

test('top-up by username: replay credits once, unknown username and bad amounts write nothing, views agree', async () => {
  const admin = await adminClient(app, adm); const { client } = await makeCustomer(app, admin, 'budi');
  const body = { username: 'Budi', amountTokens: '50000', saleRef: 'INV-100', idempotencyKey: 'topup-budi-0001' };
  assert.equal((await admin.post('/admin/api/topups', body)).status, 201);
  const replay = await admin.post('/admin/api/topups', body); assert.equal(replay.status, 200); assert.equal(replay.json.replayed, true);
  assert.equal((await admin.post('/admin/api/topups', { ...body, amountTokens: '60000' })).status, 409);
  assert.equal((await admin.post('/admin/api/topups', { ...body, username: 'nobody', idempotencyKey: 'topup-none-0001' })).json.error.code, 'username_not_found');
  for (const amountTokens of ['-5', '1.5', '0', 50000, '', '1e6']) assert.ok([400].includes((await admin.post('/admin/api/topups', { ...body, amountTokens, idempotencyKey: 'topup-bad-' + String(amountTokens).padEnd(8, 'x') })).status), String(amountTokens));
  assert.equal(await entries(), '1');
  const mine = (await client.get('/api/balance')).json; const theirs = (await admin.get('/admin/api/customers/budi')).json;
  assert.equal(mine.postedMicro, '50000000000'); assert.equal(theirs.postedMicro, mine.postedMicro);
  assert.equal((await client.get('/api/ledger')).json.entries[0].kind, 'GRANT_ADMIN_TOPUP');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('every admin action leaves exactly one audit event', async () => {
  const admin = await adminClient(app, adm); await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '1000', saleRef: 'INV-1', idempotencyKey: 'topup-budi-0002' });
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '1000', saleRef: 'INV-1', idempotencyKey: 'topup-budi-0002' });
  const ev = (await admin.get('/admin/api/audit')).json.events.map((e: any) => e.action);
  const count = (a: string) => ev.filter((x: string) => x === a).length;
  assert.equal(count('ledger.admin_topup'), 1, 'a replay is not a second action'); assert.equal(count('invite.create'), 1); assert.equal(count('invite.accept'), 1); assert.equal(count('admin.bootstrap'), 1);
});

test('customer list: paged by username, prefix filter, admin only, no closed accounts', async () => {
  const admin = await adminClient(app, adm);
  const made: Record<string, Client> = {};
  for (const u of ['andi', 'budi', 'bunga', 'citra']) made[u] = (await makeCustomer(app, admin, u)).client;
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '700', saleRef: 'INV-L1', idempotencyKey: 'topup-list-0001' });
  const all = (await admin.get('/admin/api/customers')).json;
  assert.deepEqual(all.customers.map((c: any) => c.username), ['andi', 'budi', 'bunga', 'citra']); assert.equal(all.nextAfter, null);
  assert.equal(all.customers[1].postedMicro, '700000000'); assert.equal(all.customers[1].tenantStatus, 'ACTIVE');
  const p1 = (await admin.get('/admin/api/customers?limit=2')).json; assert.equal(p1.nextAfter, 'budi');
  assert.deepEqual((await admin.get('/admin/api/customers?limit=2&after=' + p1.nextAfter)).json.customers.map((c: any) => c.username), ['bunga', 'citra']);
  assert.deepEqual((await admin.get('/admin/api/customers?prefix=BU')).json.customers.map((c: any) => c.username), ['budi', 'bunga']);
  assert.ok(!JSON.stringify(all).includes('@'), 'no email addresses in the list');
  assert.equal((await made.andi.get('/admin/api/customers')).status, 401); assert.equal((await new Client(app).get('/admin/api/customers')).status, 401);
});
