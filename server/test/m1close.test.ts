import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, mail } from './helpers.ts';
import { withTx, type Db } from '../src/db/pool.ts';
import * as ledger from '../src/ledger.ts';
import * as identity from '../src/identity.ts';

let db: Db; let app: FastifyInstance; let admin: Client;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); admin = await adminClient(app, await makeAdmin(db)); });
const closure = { currentPassword: 'customer-password-1', confirmUsername: 'budi', expectedVersion: '1' };
async function target() {
  return (await db.query("select u.id, m.tenant_id from app_user u join membership m on m.user_id=u.id where u.username='budi'")).rows[0];
}

test('owner closure pseudonymizes current identity, revokes sessions/reset tokens and preserves ledger and audit', async () => {
  const { client, email } = await makeCustomer(app, admin, 'budi');
  const t = await target();
  const another = new Client(app);
  await another.post('/api/auth/login', { identifier: 'budi', password: closure.currentPassword });
  await client.post('/api/auth/reset/request', { email });
  const reset = mail.resets[0].token;
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '10', saleRef: 'test sale', idempotencyKey: 'closure-topup-01' });
  await withTx(db, tx => ledger.placeHold(tx, { tenantId: t.tenant_id, requestId: 'closure-running', amount: 1_000_000n }));
  const entries = (await db.query('select * from ledger_entry order by id')).rows;
  const audit = (await db.query('select * from audit_event order by id')).rows;
  const closed = await client.post('/api/account/close', { ...closure, tenantId: 'ignored', userId: 'ignored' });
  assert.equal(closed.status, 200); assert.equal(closed.json.ok, true);
  assert.ok(!client.cookies.sid, 'browser cookie cleared');
  assert.equal((await another.get('/api/balance')).status, 401);
  assert.equal((await another.post('/api/account/close', closure)).status, 401);
  assert.equal((await new Client(app).post('/api/auth/login', { identifier: 'budi', password: closure.currentPassword })).status, 401);
  assert.equal((await client.post('/api/auth/reset/complete', { token: reset, password: 'another-password-1' })).status, 400);
  const user = (await db.query('select * from app_user where id=$1', [t.id])).rows[0];
  assert.equal(user.status, 'CLOSED'); assert.ok(user.anonymized_at);
  assert.notEqual(user.username, 'budi'); assert.notEqual(user.email, email);
  assert.equal(user.password_hash, 'CLOSED');
  assert.equal((await db.query('select status from tenant where id=$1', [t.tenant_id])).rows[0].status, 'CLOSED');
  assert.equal((await db.query('select count(*) n from session where user_id=$1 and revoked_at is null', [t.id])).rows[0].n, '0');
  assert.equal((await db.query('select count(*) n from invite where email=$1', [email])).rows[0].n, '0');
  assert.deepEqual((await db.query('select * from ledger_entry order by id')).rows, entries);
  assert.deepEqual((await db.query('select * from audit_event order by id limit $1', [audit.length])).rows, audit);
  assert.equal((await db.query("select count(*) n from audit_event where action='account.close' and actor_kind='CUSTOMER' and actor_user=$1", [t.id])).rows[0].n, '1');
  await assert.rejects(withTx(db, tx => ledger.placeHold(tx, { tenantId: t.tenant_id, requestId: 'closed-new', amount: 1n })), { code: 'auth_invalid' });
  const settled = await withTx(db, tx => ledger.settleHold(tx, { tenantId: t.tenant_id, requestId: 'closure-running', debit: 500_000n }));
  assert.equal(settled.settled, true);
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('closure rejects anonymous/admin sessions, missing CSRF, wrong confirmation and stale version', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  assert.equal((await new Client(app).post('/api/account/close', closure)).status, 401);
  assert.equal((await admin.post('/api/account/close', closure)).status, 401);
  assert.equal((await client.post('/api/account/close', closure, { csrf: false })).status, 403);
  assert.equal((await client.post('/api/account/close', { ...closure, confirmUsername: 'ani' })).status, 400);
  assert.equal((await client.post('/api/account/close', { ...closure, expectedVersion: '2' })).status, 409);
  assert.equal((await client.get('/api/me')).json.version, '1');
  assert.equal((await db.query("select count(*) n from audit_event where action='account.close'")).rows[0].n, '0');
});

test('wrong closure password is rate limited without closing the owner or another account', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const { client: other } = await makeCustomer(app, admin, 'ani');
  for (let i = 0; i < 5; i++) {
    const denied = await client.post('/api/account/close', { ...closure, currentPassword: 'wrong-password' });
    assert.equal(denied.status, 401); assert.equal(denied.json.error.code, 'invalid_credentials');
  }
  const limited = await client.post('/api/account/close', closure);
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal((await client.get('/api/me')).json.tenantStatus, 'ACTIVE');
  assert.equal((await other.get('/api/me')).json.tenantStatus, 'ACTIVE');
});

test('parallel wrong closure passwords cannot exceed the per-account failure cap', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const replies = await Promise.all(Array.from({ length: 12 }, () => client.post('/api/account/close', { ...closure, currentPassword: 'wrong-password' })));
  assert.equal(replies.filter(r => r.status === 401).length, 5);
  assert.equal(replies.filter(r => r.status === 429).length, 7);
  assert.equal((await client.get('/api/me')).json.tenantStatus, 'ACTIVE');
});

test('parallel closure writes exactly one audit event, cannot target a different tenant, and cannot be restored', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const { client: other } = await makeCustomer(app, admin, 'ani');
  const t = await target();
  const results = await Promise.all(Array.from({ length: 6 }, () => client.post('/api/account/close', { ...closure, username: 'ani' })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.ok(results.every(r => [200, 401, 409].includes(r.status)));
  assert.equal((await other.get('/api/me')).json.username, 'ani');
  assert.equal((await db.query("select count(*) n from audit_event where action='account.close'")).rows[0].n, '1');
  const tombstone = (await db.query('select username from app_user where id=$1', [t.id])).rows[0].username;
  assert.equal((await admin.post(`/admin/api/customers/${tombstone}/restore`, { expectedVersion: '2', reason: 'try reopening' })).status, 409);
});

test('suspended owner can close and database guards prevent reopening or changing retired usernames', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const t = await target();
  const rawSession = client.cookies.sid;
  assert.ok(rawSession);
  assert.equal((await admin.post('/admin/api/customers/budi/suspend', { expectedVersion: '1', reason: 'operator review' })).status, 200);
  assert.equal((await client.post('/api/account/close', { ...closure, expectedVersion: '1' })).status, 409);
  assert.equal((await client.post('/api/account/close', { ...closure, expectedVersion: '2' })).status, 200);
  await assert.rejects(db.query("update tenant set status='ACTIVE' where id=$1", [t.tenant_id]), /cannot be reopened/);
  await assert.rejects(db.query("update app_user set status='ACTIVE', username='budi' where id=$1", [t.id]), /closed identity is immutable/);
  await assert.rejects(db.query('delete from retired_username'), /append-only/);
  const evidence = JSON.stringify((await db.query("select summary from audit_event where action='account.close'")).rows);
  assert.ok(!evidence.includes(closure.currentPassword));
  assert.ok(!evidence.includes(rawSession));
});

test('audit failure rolls back closure identity, tenant, sessions and username reservation together', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const t = await target();
  await db.query(`create function reject_closure_audit() returns trigger language plpgsql as $$
    begin if new.action='account.close' then raise exception 'fixture audit failure'; end if; return new; end $$;
    create trigger fixture_reject_closure before insert on audit_event for each row execute function reject_closure_audit()`);
  try {
    assert.equal((await client.post('/api/account/close', closure)).status, 500);
    assert.equal((await client.get('/api/me')).json.username, 'budi');
    assert.equal((await db.query('select status from tenant where id=$1', [t.tenant_id])).rows[0].status, 'ACTIVE');
    assert.equal((await db.query('select count(*) n from retired_username')).rows[0].n, '0');
  } finally {
    await db.query('drop trigger fixture_reject_closure on audit_event; drop function reject_closure_audit()');
  }
  assert.equal((await client.post('/api/account/close', closure)).status, 200);
});

test('activation and closure serialize email before username and invitation locks', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/invites', { email: 'later@example.test' });
  const token = mail.invites.findLast(i => i.to === 'later@example.test')!.token;
  const locks: string[] = [];
  const observedDb = new Proxy(db, {
    get(pool, property) {
      if (property === 'connect') return async () => {
        const connection = await pool.connect();
        return new Proxy(connection, {
          get(tx, key) {
            if (key === 'query') return async (sql: string, values?: unknown[]) => {
              if (sql.includes('pg_advisory_xact_lock')) locks.push(sql.includes('identity-email:') ? 'email' : 'username');
              if (sql.includes('from invite') && sql.includes('for update')) locks.push('invite');
              return tx.query(sql, values);
            };
            const value: unknown = Reflect.get(tx, key, tx);
            return typeof value === 'function' ? value.bind(tx) : value;
          },
        });
      };
      const value: unknown = Reflect.get(pool, property, pool);
      return typeof value === 'function' ? value.bind(pool) : value;
    },
  });
  await identity.activateInvite(observedDb, { token, username: 'later', password: 'later-password-1' });
  assert.deepEqual(locks, ['email', 'username', 'invite'], 'activation must follow closure lock order');
  assert.equal((await client.post('/api/account/close', closure)).status, 200);
});

test('closed usernames cannot be reused by a later invitation, while a new username can activate', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  assert.equal((await client.post('/api/account/close', closure)).status, 200);
  await admin.post('/admin/api/invites', { email: 'new-owner@example.test' });
  const token = mail.invites.findLast(i => i.to === 'new-owner@example.test')!.token;
  const activate = (username: string) => new Client(app).post('/api/auth/activate', { token, username, password: 'new-customer-password-1' });
  const reused = await activate('budi');
  assert.equal(reused.status, 409); assert.equal(reused.json.error.code, 'username_taken');
  assert.equal((await activate('budi_new')).status, 201);
});

for (const operation of ['login', 'reset-request', 'reset-complete', 'password-change'] as const) {
  test(`closure wins against ${operation} that read identity before it was closed`, async () => {
    const { client, email } = await makeCustomer(app, admin, 'budi');
    await client.post('/api/auth/reset/request', { email });
    const reset = mail.resets[0].token;
    const principal = await identity.authenticate(db, client.cookies.sid, 'CUSTOMER', identity.LIMITS.customerIdleHours);
    assert.ok(principal);
    let resume: () => void = () => { throw new Error('gate not initialized'); };
    let reached: () => void = () => { throw new Error('gate not initialized'); };
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const observed = new Promise<void>(resolve => { reached = resolve; });
    let used = false;
    const raceDb = new Proxy(db, {
      get(pool, property) {
        if (property === 'query') return async (sql: string, values?: unknown[]) => {
          const result = await pool.query(sql, values);
          const relevant = operation === 'login' ? sql.includes('select id, password_hash from app_user')
            : operation === 'reset-request' ? sql.includes('select id from app_user where email')
            : operation === 'reset-complete' ? sql.includes('select user_id from password_reset')
            : sql.includes('select password_hash from app_user');
          if (!used && relevant) { used = true; reached(); await gate; }
          return result;
        };
        const value: unknown = Reflect.get(pool, property, pool);
        return typeof value === 'function' ? value.bind(pool) : value;
      },
    });
    const run = operation === 'login' ? () => identity.login(raceDb, { identifier: 'budi', password: closure.currentPassword, ip: '10.4.4.4' })
      : operation === 'reset-request' ? () => identity.requestPasswordReset(raceDb, { email, ip: '10.4.4.4' }, { invite: async () => {}, passwordReset: async () => {} })
      : operation === 'reset-complete' ? () => identity.completePasswordReset(raceDb, { token: reset, password: 'replacement-password-1' })
      : () => identity.changePassword(raceDb, principal, { current: closure.currentPassword, next: 'replacement-password-1' });
    const pending = run().then(() => ({ code: 'succeeded' }), (error: unknown) => ({ code: error instanceof Error && 'code' in error ? String(error.code) : 'unexpected_error' }));
    try {
      await observed;
      assert.equal((await client.post('/api/account/close', closure)).status, 200);
    } finally { resume(); }
    const result = await pending;
    assert.notEqual(result.code, 'unexpected_error');
    assert.notEqual(result.code, 'P0001', 'closed-identity trigger must not become a server error');
    if (operation === 'login' || operation === 'password-change') assert.equal(result.code, 'invalid_credentials');
    assert.equal((await db.query("select count(*) n from session s join app_user u on u.id=s.user_id where u.status='CLOSED' and s.revoked_at is null")).rows[0].n, '0');
    assert.equal((await db.query("select count(*) n from password_reset p join app_user u on u.id=p.user_id where u.status='CLOSED' and p.used_at is null")).rows[0].n, '0');
  });
}
