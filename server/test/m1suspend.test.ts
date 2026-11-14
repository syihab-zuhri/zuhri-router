import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, ADMIN } from './helpers.ts';
import * as ledger from '../src/ledger.ts';
import { withTx, type Db } from '../src/db/pool.ts';

let db: Db; let app: FastifyInstance; let admin: Client;
let adm: Awaited<ReturnType<typeof makeAdmin>>;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm); });

async function target(username = 'budi') {
  return (await db.query('select m.tenant_id, u.id as user_id from membership m join app_user u on u.id=m.user_id where u.username=$1', [username])).rows[0];
}
const change = (action: string, expectedVersion = '1') => admin.post(`/admin/api/customers/budi/${action}`, { expectedVersion, reason: 'operator review' });

// FR-014 forbids new inference, not reading the retained balance/history.
test('suspend blocks admission but preserves portal access and lets admitted requests settle once', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '10', saleRef: 'test sale', idempotencyKey: 'suspend-topup-01' });
  const t = await target();
  await withTx(db, tx => ledger.placeHold(tx, { tenantId: t.tenant_id, requestId: 'before-suspend', amount: 1_000_000n }));
  const suspended = await change('suspend');
  assert.equal(suspended.status, 200);
  assert.equal(suspended.json.tenantStatus, 'SUSPENDED');
  assert.equal(suspended.json.version, '2');
  assert.equal((await client.get('/api/me')).json.tenantStatus, 'SUSPENDED');
  assert.equal((await client.get('/api/balance')).json.heldMicro, '1000000');
  assert.equal((await client.get('/api/ledger')).status, 200);
  const signedIn = new Client(app);
  assert.equal((await signedIn.post('/api/auth/login', { identifier: 'budi', password: 'customer-password-1' })).status, 200);
  await assert.rejects(withTx(db, tx => ledger.placeHold(tx, { tenantId: t.tenant_id, requestId: 'after-suspend', amount: 1n })), { code: 'tenant_suspended' });
  const settle = () => withTx(db, tx => ledger.settleHold(tx, { tenantId: t.tenant_id, requestId: 'before-suspend', debit: 500_000n }));
  assert.equal((await settle()).settled, true);
  assert.equal((await settle()).settled, false);
  assert.equal((await client.get('/api/balance')).json.postedMicro, '9500000');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('committed suspension is checked after a queued admission acquires its lock', async () => {
  await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '1', saleRef: 'test sale', idempotencyKey: 'queued-topup-01' });
  const t = await target();
  let release: () => void = () => { throw new Error('gate not initialized'); };
  let ready: () => void = () => { throw new Error('gate not initialized'); };
  const gate = new Promise<void>(resolve => { release = resolve; });
  const acquired = new Promise<void>(resolve => { ready = resolve; });
  const suspension = withTx(db, async tx => {
    await tx.query("update tenant set status='SUSPENDED', version=version+1 where id=$1", [t.tenant_id]);
    ready();
    await gate;
  });
  await acquired;
  const pending = withTx(db, tx => ledger.placeHold(tx, { tenantId: t.tenant_id, requestId: 'queued-admission', amount: 1n }));
  const denied = assert.rejects(pending, { code: 'tenant_suspended' });
  release();
  await suspension;
  await denied;
  assert.equal((await db.query('select count(*) n from hold')).rows[0].n, '0');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('restore uses a version check, admits again, and never changes another tenant', async () => {
  await makeCustomer(app, admin, 'budi');
  const { client: other } = await makeCustomer(app, admin, 'ani');
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '1', saleRef: 'test sale', idempotencyKey: 'restore-topup-01' });
  assert.equal((await change('suspend')).status, 200);
  assert.equal((await change('restore')).status, 409, 'stale version cannot restore');
  const restored = await change('restore', '2');
  assert.equal(restored.status, 200);
  assert.equal(restored.json.tenantStatus, 'ACTIVE');
  assert.equal(restored.json.version, '3');
  const t = await target();
  await withTx(db, tx => ledger.placeHold(tx, { tenantId: t.tenant_id, requestId: 'after-restore', amount: 1n }));
  assert.equal((await other.get('/api/me')).json.tenantStatus, 'ACTIVE');
  assert.equal((await other.get('/api/balance')).json.postedMicro, '0');
});

test('parallel status changes write exactly one audit event; stale and no-op versions conflict', async () => {
  await makeCustomer(app, admin, 'budi');
  const responses = await Promise.all(Array.from({ length: 8 }, () => change('suspend')));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(responses.filter(r => r.status === 409).length, 7);
  assert.equal((await change('suspend', '2')).status, 409, 'already suspended');
  assert.equal((await db.query("select count(*) n from audit_event where action='tenant.suspend'")).rows[0].n, '1');
  assert.equal((await change('restore', '2')).status, 200);
  assert.equal((await db.query("select count(*) n from audit_event where action='tenant.restore'")).rows[0].n, '1');
});

test('suspend and restore deny anonymous, customer, password-only admin, stale step-up and missing CSRF', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const partial = new Client(app);
  await partial.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  const payload = { expectedVersion: '1', reason: 'operator review' };
  for (const action of ['suspend', 'restore']) {
    const url = `/admin/api/customers/budi/${action}`;
    assert.equal((await new Client(app).post(url, payload)).status, 401);
    assert.equal((await client.post(url, payload)).status, 401);
    assert.equal((await partial.post(url, payload)).json.error.code, 'second_factor_required');
    assert.equal((await admin.post(url, payload, { csrf: false })).status, 403);
  }
  await db.query("update session set auth_at=now()-interval '6 minutes' where kind='ADMIN'");
  for (const action of ['suspend', 'restore']) assert.equal((await change(action)).json.error.code, 'step_up_required');
  assert.equal((await db.query("select count(*) n from audit_event where action in ('tenant.suspend','tenant.restore')")).rows[0].n, '0');
});

test('status validation rejects invalid versions, unknown customer and empty reason without mutation', async () => {
  await makeCustomer(app, admin, 'budi');
  for (const expectedVersion of [undefined, 1, '0', '-1', '1.5', '9223372036854775808']) {
    const r = await admin.post('/admin/api/customers/budi/suspend', { expectedVersion, reason: 'operator review' });
    assert.equal(r.status, 400);
  }
  assert.equal((await admin.post('/admin/api/customers/budi/suspend', { expectedVersion: '1', reason: ' ' })).status, 400);
  assert.equal((await admin.post('/admin/api/customers/nobody/suspend', { expectedVersion: '1', reason: 'operator review' })).status, 404);
  assert.equal((await change('restore')).status, 409);
  assert.equal((await admin.get('/admin/api/customers/budi')).json.tenantStatus, 'ACTIVE');
});
