import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client } from './helpers.ts';
import * as ledger from '../src/ledger.ts';
import { withTx, type Db } from '../src/db/pool.ts';

let db: Db; let app: FastifyInstance; let admin: Client;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); admin = await adminClient(app, await makeAdmin(db)); });

test('overview is admin-only and reads as zeros on an empty system', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  assert.equal((await new Client(app).get('/admin/api/overview')).status, 401);
  assert.equal((await client.get('/admin/api/overview')).status, 401, 'a customer session is not an admin session');
  const o = (await admin.get('/admin/api/overview')).json;
  assert.deepEqual(o.customers, { ACTIVE: 1, SUSPENDED: 0, CLOSED: 0 });
  assert.deepEqual(o.balances, { postedMicro: '0', heldMicro: '0', positiveMicro: '0', negativeAccounts: 0, negativeMicro: '0' });
  assert.deepEqual(o.activeVouchers, { count: 0, amountMicro: '0' });
  assert.deepEqual(o.requests24h, { total: 0, failed: 0, estimated: 0, debitMicro: '0' });
  assert.deepEqual(o.unresolved, { count: 0, heldMicro: '0' });
  assert.deepEqual(o.upstreams, { PENDING: 0, ELIGIBLE: 0, BLOCKED: 0 });
  assert.deepEqual(o.gateway, { paused: false, reason: null, changedAt: null }, 'the gateway runs until an admin pauses it');
  assert.ok(!Number.isNaN(Date.parse(o.generatedAt)));
});

test('overview sums balances exactly, separates negative accounts and counts suspended customers', async () => {
  await makeCustomer(app, admin, 'budi'); await makeCustomer(app, admin, 'ani');
  assert.equal((await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '10', saleRef: 'sale one', idempotencyKey: 'overview-topup-1' })).status, 201);
  const ani = (await db.query("select m.tenant_id from membership m join app_user u on u.id=m.user_id where u.username='ani'")).rows[0].tenant_id;
  await admin.post('/admin/api/topups', { username: 'ani', amountTokens: '1', saleRef: 'sale two', idempotencyKey: 'overview-topup-2' });
  assert.equal((await admin.post('/admin/api/adjustments', { username: 'ani', amountMicro: '-1250000', reason: 'usage correction', idempotencyKey: 'overview-adjust-1' })).status, 201);
  await withTx(db, tx => ledger.placeHold(tx, { tenantId: ani, requestId: 'overview-hold', amount: 1n })).catch(() => undefined);
  assert.equal((await admin.post('/admin/api/customers/budi/suspend', { expectedVersion: '1', reason: 'operator review' })).status, 200);
  const o = (await admin.get('/admin/api/overview')).json;
  assert.deepEqual(o.customers, { ACTIVE: 1, SUSPENDED: 1, CLOSED: 0 });
  assert.deepEqual(o.balances, { postedMicro: '9750000', heldMicro: '0', positiveMicro: '10000000', negativeAccounts: 1, negativeMicro: '-250000' });
  assert.equal(o.balances.heldMicro, '0', 'admission needs a positive available balance, so no hold was placed');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});
