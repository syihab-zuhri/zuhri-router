// TEST-006 (accounts and sessions) and TEST-008 (tenant boundary) for the operations that exist in M1.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, mail } from './helpers.ts';
import type { Db } from '../src/db/pool.ts';

let db: Db; let app: any; let adm: Awaited<ReturnType<typeof makeAdmin>>; let admin: Client;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm); });

test('activation happens exactly once and creates user, tenant, owner and ledger account together', async () => {
  const { client, inviteToken } = await makeCustomer(app, admin, 'budi');
  assert.equal((await client.get('/api/me')).json.username, 'budi');
  assert.equal((await client.get('/api/balance')).json.availableMicro, '0');
  const again = await new Client(app).post('/api/auth/activate', { token: inviteToken, username: 'budi2', password: 'customer-password-1' });
  assert.equal(again.status, 400); assert.equal(again.json.error.code, 'invite_invalid');
  const n = (await db.query("select (select count(*) from app_user where role='CUSTOMER') u, (select count(*) from tenant) t, (select count(*) from membership) m, (select count(*) from ledger_account) a")).rows[0];
  assert.deepEqual([n.u, n.t, n.m, n.a], ['1', '1', '1', '1']);
});

test('activation rejects expired invites, taken usernames, bad usernames and weak passwords without partial records', async () => {
  await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/invites', { email: 'siti@example.test' }); const token = mail.invites.at(-1)!.token;
  const anon = new Client(app);
  assert.equal((await anon.post('/api/auth/activate', { token, username: 'budi', password: 'customer-password-1' })).json.error.code, 'username_taken');
  assert.equal((await anon.post('/api/auth/activate', { token, username: 'Bad Name!', password: 'customer-password-1' })).json.error.code, 'invalid_username');
  assert.equal((await anon.post('/api/auth/activate', { token, username: 'siti', password: 'short' })).json.error.code, 'weak_password');
  await db.query("update invite set expires_at = now() - interval '1 minute' where email='siti@example.test'");
  assert.equal((await anon.post('/api/auth/activate', { token, username: 'siti', password: 'customer-password-1' })).json.error.code, 'invite_invalid');
  assert.equal((await db.query("select count(*) n from tenant")).rows[0].n, '1');
});

test('login works with username or email; unknown account and wrong password are indistinguishable', async () => {
  const { email, password } = await makeCustomer(app, admin, 'budi');
  assert.equal((await new Client(app).post('/api/auth/login', { identifier: 'BUDI', password })).status, 200);
  assert.equal((await new Client(app).post('/api/auth/login', { identifier: email, password })).status, 200);
  const wrong = await new Client(app, '10.0.2.1').post('/api/auth/login', { identifier: 'budi', password: 'not-the-password' });
  const unknown = await new Client(app, '10.0.2.2').post('/api/auth/login', { identifier: 'nobody', password: 'not-the-password' });
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.json, unknown.json);
});

test('repeated failures are limited with Retry-After, without locking out the owner or other accounts', async () => {
  const a = await makeCustomer(app, admin, 'budi'); const b = await makeCustomer(app, admin, 'siti');
  const attacker = new Client(app, '10.0.3.1');
  for (let i = 0; i < 5; i++) assert.equal((await attacker.post('/api/auth/login', { identifier: 'budi', password: 'guess-number-' + i })).status, 401);
  const limited = await attacker.post('/api/auth/login', { identifier: 'budi', password: a.password });
  assert.equal(limited.status, 429, 'even the right password is refused from the limited network'); assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal((await new Client(app, '10.0.3.2').post('/api/auth/login', { identifier: 'budi', password: a.password })).status, 200, 'the owner can still sign in from another network');
  assert.equal((await new Client(app, '10.0.3.1').post('/api/auth/login', { identifier: 'siti', password: b.password })).status, 200, 'other accounts stay usable');
  assert.equal((await a.client.get('/api/me')).status, 200, 'existing sessions keep working');
});

test('guessing one account from many networks is capped across all of them', async () => {
  const a = await makeCustomer(app, admin, 'budi');
  for (let i = 0; i < 50; i++) await new Client(app, `10.1.${i}.1`).post('/api/auth/login', { identifier: 'budi', password: 'guess-' + i });
  assert.equal((await new Client(app, '10.2.0.1').post('/api/auth/login', { identifier: 'budi', password: a.password })).status, 429);
});

test('password reset: same response for any address, single-use token, old sessions revoked', async () => {
  const { client, email, password } = await makeCustomer(app, admin, 'budi');
  const anon = new Client(app, '10.0.4.1');
  const known = await anon.post('/api/auth/reset/request', { email }); const unknown = await anon.post('/api/auth/reset/request', { email: 'nobody@example.test' });
  assert.deepEqual([known.status, known.json], [unknown.status, unknown.json]); assert.equal(mail.resets.length, 1);
  const token = mail.resets[0].token;
  assert.equal((await anon.post('/api/auth/reset/complete', { token, password: 'a-brand-new-password' })).status, 200);
  assert.equal((await anon.post('/api/auth/reset/complete', { token, password: 'another-new-password' })).json.error.code, 'reset_invalid');
  assert.equal((await client.get('/api/me')).status, 401, 'sessions opened before the reset are revoked');
  assert.equal((await new Client(app).post('/api/auth/login', { identifier: 'budi', password })).status, 401);
  assert.equal((await new Client(app).post('/api/auth/login', { identifier: 'budi', password: 'a-brand-new-password' })).status, 200);
});

test('reset requests for one address are capped quietly', async () => {
  const { email } = await makeCustomer(app, admin, 'budi'); const anon = new Client(app, '10.0.4.2');
  for (let i = 0; i < 6; i++) assert.equal((await anon.post('/api/auth/reset/request', { email })).status, 200);
  assert.equal(mail.resets.length, 3);
});

test('logout and session revocation take effect immediately; idle and expired sessions are refused', async () => {
  const { client, password } = await makeCustomer(app, admin, 'budi');
  const second = new Client(app); await second.post('/api/auth/login', { identifier: 'budi', password });
  const list = (await client.get('/api/account/sessions')).json; assert.equal(list.sessions.length, 2);
  const other = list.sessions.find((s: any) => s.id !== list.current).id;
  assert.equal((await client.post(`/api/account/sessions/${other}/revoke`)).status, 200);
  assert.equal((await second.get('/api/me')).status, 401);
  await db.query("update session set last_seen_at = now() - interval '25 hours' where id=$1", [list.current]);
  assert.equal((await client.get('/api/me')).status, 401, 'idle timeout');
  const third = new Client(app); await third.post('/api/auth/login', { identifier: 'budi', password });
  await third.post('/api/auth/logout'); assert.equal((await third.get('/api/me')).status, 401);
});

test('state-changing requests without the CSRF header are refused', async () => {
  const { password } = await makeCustomer(app, admin, 'budi');
  const r = await new Client(app).post('/api/auth/login', { identifier: 'budi', password }, { csrf: false });
  assert.equal(r.status, 403); assert.equal(r.json.error.code, 'csrf');
});

test('tenant boundary: a customer only ever sees their own data; foreign ids behave as not found', async () => {
  const a = await makeCustomer(app, admin, 'budi'); const b = await makeCustomer(app, admin, 'siti');
  const stepped = await admin.post('/admin/api/second-factor', { code: adm.code(0) }); assert.equal(stepped.status, 200);
  await admin.post('/admin/api/topups', { username: 'siti', amountTokens: '75000', saleRef: 'INV-S1', idempotencyKey: 'topup-siti-0001' });
  assert.equal((await a.client.get('/api/balance')).json.postedMicro, '0');
  assert.deepEqual((await a.client.get('/api/ledger')).json.entries, []);
  assert.equal((await b.client.get('/api/ledger')).json.entries.length, 1);
  const bSession = (await b.client.get('/api/account/sessions')).json.current;
  const cross = await a.client.post(`/api/account/sessions/${bSession}/revoke`);
  const missing = await a.client.post('/api/account/sessions/00000000-0000-4000-8000-000000000000/revoke');
  assert.equal(cross.status, 404); assert.deepEqual(cross.json, missing.json);
  assert.equal((await b.client.get('/api/me')).status, 200, "the other tenant's session is untouched");
  assert.equal((await a.client.get('/admin/api/audit')).status, 401, 'a customer session is not an admin session');
});

test('one-time tokens and passwords are never stored or audited in plaintext', async () => {
  const { email, password, inviteToken } = await makeCustomer(app, admin, 'budi');
  await new Client(app, '10.0.5.1').post('/api/auth/reset/request', { email });
  const dump = JSON.stringify((await db.query("select (select json_agg(t) from invite t) a, (select json_agg(t) from password_reset t) b, (select json_agg(t) from session t) c, (select json_agg(t) from audit_event t) d, (select json_agg(t) from app_user t) e, (select json_agg(t) from admin_credential t) f")).rows[0]);
  for (const secret of [inviteToken, mail.resets[0].token, password, adm.totpSecretBase32, ...adm.recoveryCodes]) assert.ok(!dump.includes(secret), 'secret found in database dump');
});
