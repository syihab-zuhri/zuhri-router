import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client } from './helpers.ts';
import { withTx, type Db } from '../src/db/pool.ts';
import * as keys from '../src/keys.ts';
import * as ledger from '../src/ledger.ts';

let db: Db; let app: FastifyInstance; let admin: Client; let owner: Client;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => {
  await wipe(db); admin = await adminClient(app, await makeAdmin(db));
  owner = (await makeCustomer(app, admin, 'budi')).client;
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '100', saleRef: 'fixture', idempotencyKey: 'key-admission-funds' });
});
async function create(extra: Record<string, unknown> = {}) {
  const result = await owner.post('/api/keys', { name: 'test admission', allowedModels: ['model-a'], spendLimitMicro: '1000', idempotencyKey: 'admission-create-01', ...extra });
  assert.equal(result.status, 201);
  return { id: result.json.key.id as string, secret: result.json.secret as string };
}
const admit = (secret: string, requestId: string, amount: bigint, model = 'model-a') => withTx(db, tx => ledger.placeKeyHold(tx, { secret, requestId, amount, model }));

test('authentication rejects prefixes, malformed, wrong, expired and revoked keys; scope and tenant status gate admission', async () => {
  const key = await create();
  const authenticated = await keys.authenticate(db, key.secret);
  assert.equal(authenticated.keyId, key.id);
  for (const raw of ['', key.secret.slice(0, 12), key.secret + 'x', key.secret.replace('rtr_', 'bad_'), 'rtr_' + 'x'.repeat(43)]) {
    await assert.rejects(keys.authenticate(db, raw), { code: 'auth_invalid' });
  }
  await assert.rejects(admit(key.secret, 'wrong-model', 1n, 'model-b'), { code: 'model_not_available' });
  await db.query("update api_key set expires_at=now()-interval '1 second' where id=$1", [key.id]);
  await assert.rejects(keys.authenticate(db, key.secret), { code: 'auth_invalid' });
  await db.query('update api_key set expires_at=null where id=$1', [key.id]);
  await admin.post('/admin/api/customers/budi/suspend', { expectedVersion: '1', reason: 'review fixture' });
  await assert.rejects(admit(key.secret, 'suspended', 1n), { code: 'tenant_suspended' });
  await admin.post('/admin/api/customers/budi/restore', { expectedVersion: '2', reason: 'review fixture' });
  assert.equal((await owner.post(`/api/keys/${key.id}/revoke`, { expectedVersion: '1' })).status, 200);
  await assert.rejects(keys.authenticate(db, key.secret), { code: 'key_revoked' });
  assert.equal((await db.query('select count(*) n from hold')).rows[0].n, '0');
});

test('parallel admissions never reserve beyond lifetime key cap; settlement releases remainder and is exactly once after revoke', async () => {
  const key = await create();
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => admit(key.secret, `key-request-${i}`, 100n)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.status === 'rejected' && r.reason.code === 'limit_exceeded'));
  const state = (await db.query('select spent,held,last_used_at from api_key where id=$1', [key.id])).rows[0];
  assert.equal(state.held, '1000'); assert.equal(state.spent, '0'); assert.ok(state.last_used_at);
  const request = (await db.query('select request_id,tenant_id from hold order by request_id limit 1')).rows[0];
  assert.equal((await owner.post(`/api/keys/${key.id}/limits`, { name: 'too low', spendLimitMicro: '999', expectedVersion: '1' })).status, 409);
  assert.equal((await owner.post(`/api/keys/${key.id}/revoke`, { expectedVersion: '1' })).status, 200);
  const settled = await Promise.all(Array.from({ length: 6 }, () => withTx(db, tx => ledger.settleHold(tx, { tenantId: request.tenant_id, requestId: request.request_id, debit: 40n }))));
  assert.equal(settled.filter(r => r.settled).length, 1);
  const after = (await db.query('select spent,held from api_key where id=$1', [key.id])).rows[0];
  assert.equal(after.spent, '40'); assert.equal(after.held, '900');
  await assert.rejects(admit(key.secret, 'after-revoke', 1n), { code: 'key_revoked' });
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('key accounting handles zero debit, over-bound debit, independent keys and insufficient tenant balance atomically', async () => {
  const key = await create();
  const t = await admit(key.secret, 'zero', 100n);
  await withTx(db, tx => ledger.settleHold(tx, { tenantId: t.tenantId, requestId: 'zero', debit: 0n }));
  assert.equal((await db.query('select held from api_key where id=$1', [key.id])).rows[0].held, '0');
  await admit(key.secret, 'over-bound', 100n);
  assert.equal((await withTx(db, tx => ledger.settleHold(tx, { tenantId: t.tenantId, requestId: 'over-bound', debit: 1100n }))).boundExceeded, true);
  await assert.rejects(admit(key.secret, 'cap-spent', 1n), { code: 'limit_exceeded' });
  const another = await create({ idempotencyKey: 'admission-create-02', allowedModels: null, spendLimitMicro: null });
  await assert.rejects(admit(another.secret, 'no-funds', 200_000_000n), { code: 'insufficient_balance' });
  assert.equal((await db.query('select held from api_key where id=$1', [another.id])).rows[0].held, '0');
  await admit(another.secret, 'other-key', 1n, 'model-b');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('empty scope and zero lifetime cap deny dispatch, while coarse last-used does not change every request', async () => {
  const denied = await create({ allowedModels: [], spendLimitMicro: '0' });
  await assert.rejects(admit(denied.secret, 'empty-scope', 1n), { code: 'model_not_available' });
  const blocked = await create({ idempotencyKey: 'admission-zero-cap', spendLimitMicro: '0' });
  await assert.rejects(admit(blocked.secret, 'zero-cap', 1n), { code: 'limit_exceeded' });
  const usable = await create({ idempotencyKey: 'admission-usable-01' });
  const t = await admit(usable.secret, 'coarse-usage-1', 1n);
  const before = (await db.query('select last_used_at from api_key where id=$1', [usable.id])).rows[0].last_used_at;
  await admit(usable.secret, 'coarse-usage-2', 1n);
  assert.deepEqual((await db.query('select last_used_at from api_key where id=$1', [usable.id])).rows[0].last_used_at, before);
  await assert.rejects(admit(usable.secret, 'coarse-usage-2', 1n), { code: '23505' });
  assert.equal((await db.query('select held from api_key where id=$1', [usable.id])).rows[0].held, '2');
  await withTx(db, tx => ledger.settleHold(tx, { tenantId: t.tenantId, requestId: 'coarse-usage-1', debit: 1n }));
  await db.query('update api_key set spent=spent+1 where id=$1', [usable.id]);
  assert.ok((await ledger.invariantViolations(db)).some(r => r.problem === `key:${usable.id}:spent_differs_from_settlements`));
});

test('key hold counter corruption is detected by the ledger invariant check', async () => {
  const key = await create();
  await admit(key.secret, 'check-counter', 100n);
  await db.query('update api_key set held=held+1 where id=$1', [key.id]);
  assert.ok((await ledger.invariantViolations(db)).some(r => r.problem === `key:${key.id}:held_differs_from_active_holds`));
});

test('cross-tenant account and key links cannot be inserted into a hold', async () => {
  const key = await create();
  const other = (await makeCustomer(app, admin, 'ani')).client;
  assert.equal((await other.get('/api/balance')).status, 200);
  const account = (await db.query('select id from ledger_account where tenant_id<>(select tenant_id from api_key where id=$1)', [key.id])).rows[0].id;
  const tenantId = (await db.query('select tenant_id from api_key where id=$1', [key.id])).rows[0].tenant_id;
  await assert.rejects(db.query('insert into hold(account_id,request_id,amount,tenant_id,api_key_id) values($1,$2,1,$3,$4)', [account, 'foreign-account', tenantId, key.id]), { code: '23503' });
});

for (const transition of ['revoke', 'expire', 'close'] as const) {
  test(`admission rechecks ${transition} committed after key preflight and before locks`, async () => {
    const key = await create();
    let resume: () => void = () => { throw new Error('gate not initialized'); };
    let ready: () => void = () => { throw new Error('gate not initialized'); };
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const observed = new Promise<void>(resolve => { ready = resolve; });
    const raceDb = new Proxy(db, {
      get(pool, property) {
        if (property === 'connect') return async () => {
          const tx = await pool.connect();
          let held = false;
          return new Proxy(tx, {
            get(connection, key) {
              if (key === 'query') return async (sql: string, values?: unknown[]) => {
                const result = await connection.query(sql, values);
                if (!held && sql.includes('where k.token_hash=$1') && !sql.includes('for update')) {
                  held = true; ready(); await gate;
                }
                return result;
              };
              const value: unknown = Reflect.get(connection, key, connection);
              return typeof value === 'function' ? value.bind(connection) : value;
            },
          });
        };
        const value: unknown = Reflect.get(pool, property, pool);
        return typeof value === 'function' ? value.bind(pool) : value;
      },
    });
    const pending = withTx(raceDb, tx => ledger.placeKeyHold(tx, { secret: key.secret, requestId: 'racing-key', amount: 1n, model: 'model-a' }));
    const rejected = assert.rejects(pending, { code: transition === 'revoke' ? 'key_revoked' : 'auth_invalid' });
    try {
      await observed;
      if (transition === 'revoke') assert.equal((await owner.post(`/api/keys/${key.id}/revoke`, { expectedVersion: '1' })).status, 200);
      else if (transition === 'expire') await db.query("update api_key set expires_at=clock_timestamp()-interval '1 second' where id=$1", [key.id]);
      else assert.equal((await owner.post('/api/account/close', { currentPassword: 'customer-password-1', confirmUsername: 'budi', expectedVersion: '1' })).status, 200);
    } finally { resume(); }
    await rejected;
    assert.equal((await db.query('select count(*) n from hold')).rows[0].n, '0');
    assert.equal((await db.query('select held from api_key where id=$1', [key.id])).rows[0].held, '0');
  });
}

test('account closure revokes all keys yet admitted work still settles; stale principals cannot create keys', async () => {
  const key = await create();
  const t = await admit(key.secret, 'close-running', 100n);
  const identity = await import('../src/identity.ts');
  const principal = await identity.authenticate(db, owner.cookies.sid, 'CUSTOMER', identity.LIMITS.customerIdleHours);
  assert.ok(principal);
  assert.equal((await owner.post('/api/account/close', { currentPassword: 'customer-password-1', confirmUsername: 'budi', expectedVersion: '1' })).status, 200);
  assert.equal((await db.query('select status from api_key where id=$1', [key.id])).rows[0].status, 'REVOKED');
  await assert.rejects(admit(key.secret, 'closed-new', 1n));
  await assert.rejects(keys.create(db, principal, keys.policy({ name: 'stale principal' }), 'stale-create-01'), { code: 'unauthorized' });
  assert.equal((await withTx(db, tx => ledger.settleHold(tx, { tenantId: t.tenantId, requestId: 'close-running', debit: 80n }))).settled, true);
  assert.equal((await db.query('select spent,held from api_key where id=$1', [key.id])).rows[0].spent, '80');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});
