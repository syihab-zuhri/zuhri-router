import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, ADMIN } from './helpers.ts';
import { type Db } from '../src/db/pool.ts';
import * as ledger from '../src/ledger.ts';

let db: Db; let app: FastifyInstance; let admin: Client;
let adm: Awaited<ReturnType<typeof makeAdmin>>;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm); });
const payload = { username: 'budi', amountMicro: '-500000', reason: 'correction of wrong amount', idempotencyKey: 'adjustment-test-01' };

test('adjustment is an audited correction, preserves the grant, supports replay and conflicts on changed payload', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '10', saleRef: 'test sale', idempotencyKey: 'adjustment-topup-01' });
  const original = (await db.query('select * from ledger_entry')).rows[0];
  const response = await admin.post('/admin/api/adjustments', payload);
  assert.equal(response.status, 201);
  assert.equal(response.json.amountMicro, '-500000');
  assert.equal(response.json.postedAfterMicro, '9500000');
  const replay = await admin.post('/admin/api/adjustments', payload);
  assert.equal(replay.status, 200); assert.equal(replay.json.replayed, true);
  assert.equal(replay.json.entryId, response.json.entryId);
  assert.equal((await admin.post('/admin/api/adjustments', { ...payload, reason: 'changed reason' })).status, 409);
  assert.equal((await admin.post('/admin/api/adjustments', { ...payload, amountMicro: '-1' })).status, 409);
  assert.deepEqual((await db.query('select * from ledger_entry where id=$1', [original.id])).rows[0], original);
  assert.equal((await client.get('/api/balance')).json.postedMicro, '9500000');
  assert.equal((await client.get('/api/ledger')).json.entries[0].kind, 'ADJUSTMENT_DEBIT');
  const event = (await db.query("select actor_user, summary from audit_event where action='ledger.adjustment'")).rows;
  assert.equal(event.length, 1); assert.ok(event[0].actor_user);
  assert.equal(event[0].summary.reason, payload.reason);
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('parallel identical adjustments post once and distinct corrections serialize without lost balance updates', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const credit = { ...payload, amountMicro: '1000000' };
  const results = await Promise.all(Array.from({ length: 10 }, () => admin.post('/admin/api/adjustments', credit)));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 200).length, 9);
  const changes = await Promise.all(Array.from({ length: 8 }, (_, i) => admin.post('/admin/api/adjustments', { ...payload, amountMicro: '-1', idempotencyKey: `adjustment-distinct-${i}` })));
  assert.ok(changes.every(r => r.status === 201));
  assert.equal((await client.get('/api/balance')).json.postedMicro, '999992');
  assert.equal((await db.query("select count(*) n from audit_event where action='ledger.adjustment'")).rows[0].n, '9');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('adjustment denies anonymous, customer, partial admin, stale step-up and missing CSRF without posting', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  const partial = new Client(app);
  await partial.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  assert.equal((await new Client(app).post('/admin/api/adjustments', payload)).status, 401);
  assert.equal((await client.post('/admin/api/adjustments', payload)).status, 401);
  assert.equal((await partial.post('/admin/api/adjustments', payload)).json.error.code, 'second_factor_required');
  assert.equal((await admin.post('/admin/api/adjustments', payload, { csrf: false })).status, 403);
  await db.query("update session set auth_at=now()-interval '6 minutes' where kind='ADMIN'");
  assert.equal((await admin.post('/admin/api/adjustments', payload)).json.error.code, 'step_up_required');
  assert.equal((await db.query('select count(*) n from ledger_entry')).rows[0].n, '0');
});

test('invalid or overflowing integer amounts, reason, key and unknown customer leave no financial records', async () => {
  await makeCustomer(app, admin, 'budi');
  for (const amountMicro of [0, 100, '0', '-0', '+1', '01', '1.5', '1e6', ' 1', '9223372036854775808', '-9223372036854775808', '', null]) {
    assert.equal((await admin.post('/admin/api/adjustments', { ...payload, amountMicro })).status, 400, String(amountMicro));
  }
  for (const change of [{ reason: '' }, { reason: '  ' }, { reason: 'x'.repeat(501) }, { idempotencyKey: '' }]) {
    assert.equal((await admin.post('/admin/api/adjustments', { ...payload, ...change })).status, 400);
  }
  const absent = await admin.post('/admin/api/adjustments', { ...payload, username: 'nobody' });
  assert.equal(absent.status, 404); assert.equal(absent.json.error.code, 'username_not_found');
  assert.equal((await db.query('select count(*) n from ledger_entry')).rows[0].n, '0');
  assert.equal((await db.query('select count(*) n from idempotency_record')).rows[0].n, '0');
});
