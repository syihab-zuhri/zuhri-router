// CR-013: token-credit balances, per-model multiplier as the only price input, and the overrun allowance.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client } from './helpers.ts';
import { withTx, type Db } from '../src/db/pool.ts';
import * as ledger from '../src/ledger.ts';
import * as pricing from '../src/pricing.ts';
import { debitMicro, holdMicro } from '../src/money.ts';

let db: Db; let app: any; let adm: Awaited<ReturnType<typeof makeAdmin>>; let admin: Client;
const C = 1_000_000n; // micro per token credit
before(async () => { ({ db, app } = await setup()); });
after(async () => { await db.query("update system_setting set value=0 where name='overdraft_micro'"); await app.close(); assert.equal(db.totalCount - db.idleCount, 0); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm); await db.query("update system_setting set value=$1 where name='overdraft_micro'", [String(ledger.DEFAULT_OVERDRAFT_MICRO)]); });
const tenantOf = async (u: string) => (await db.query('select m.tenant_id from membership m join app_user a on a.id=m.user_id where a.username=$1', [u])).rows[0].tenant_id as string;
const topup = (username: string, tokens: string, key: string) => admin.post('/admin/api/topups', { username, amountTokens: tokens, saleRef: 'paket', idempotencyKey: key });

test('the migration default allowance is 500,000 token credits and balances are labelled TOKEN', async () => {
  assert.equal(ledger.DEFAULT_OVERDRAFT_MICRO, 500_000n * C);
  const { client } = await makeCustomer(app, admin, 'budi');
  assert.equal((await topup('budi', '100000000', 'topup-pack-0001')).status, 201);
  const b = (await client.get('/api/balance')).json;
  assert.deepEqual([b.currency, b.postedMicro], ['TOKEN', String(100_000_000n * C)]);
});

test('a model priced with only a multiplier charges tokens x multiplier, decimals included', async () => {
  await admin.post('/admin/api/models', { id: 'gpt/sol', displayName: 'GPT Sol' }); await admin.post('/admin/api/models', { id: 'gpt/luna', displayName: 'GPT Luna' });
  const price = async (id: string, multiplier: string) => { const d = (await admin.post('/admin/api/models/price/draft', { id, expectedVersion: '1', multiplier })).json; return admin.post('/admin/api/models/price/publish', { id, expectedVersion: d.version, reason: 'harga awal' }); };
  assert.equal((await price('gpt/sol', '1')).status, 200); assert.equal((await price('gpt/luna', '2')).status, 200);
  const usage = { input: 700, output: 300, cacheRead: 0, cacheWrite: 0 }; // 1,000 tokens read by the system
  assert.equal(debitMicro(usage, (await pricing.snapshotForAdmission(db, 'gpt/sol'))!.price), 1_000n * C);
  assert.equal(debitMicro(usage, (await pricing.snapshotForAdmission(db, 'gpt/luna'))!.price), 2_000n * C);
  const d = (await admin.post('/admin/api/models/price/draft', { id: 'gpt/luna', expectedVersion: (await admin.get('/admin/api/models?id=gpt%2Fluna')).json.version, multiplier: '1.25' })).json;
  const pv = (await admin.post('/admin/api/models/price/preview', { id: 'gpt/luna', which: 'draft', usage })).json;
  assert.equal(pv.debitMicro, String(1_250n * C)); assert.equal(d.draft.multiplier, '1.25');
  assert.equal(holdMicro(1000, 1000, (await pricing.snapshotForAdmission(db, 'gpt/luna'))!.price), 4_000n * C);
});

test('a request may reach into the allowance but not past it, and needs a positive balance to start', async () => {
  await makeCustomer(app, admin, 'budi'); const t = await tenantOf('budi'); await topup('budi', '1000', 'topup-small-0001');
  const hold = (id: string, credits: bigint) => withTx(db, tx => ledger.placeHold(tx, { tenantId: t, requestId: id, amount: credits * C }));
  await assert.rejects(hold('r-too-big', 501_001n), (e: any) => e.code === 'insufficient_balance');
  await hold('r1', 501_000n); // 1,000 balance + 500,000 allowance
  await assert.rejects(hold('r2', 1n), (e: any) => e.code === 'insufficient_balance', 'nothing is available while the first hold is open');
  await withTx(db, tx => ledger.settleHold(tx, { tenantId: t, requestId: 'r1', debit: 400_000n * C }));
  const b = await ledger.getBalance(db, t); assert.equal(b.posted, -399_000n * C); assert.equal(b.held, 0n);
  await assert.rejects(hold('r3', 1n), (e: any) => e.code === 'insufficient_balance', 'a negative balance is stopped');
  await topup('budi', '400000', 'topup-small-0002'); await hold('r4', 1n);
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('parallel requests cannot stack the allowance', async () => {
  await makeCustomer(app, admin, 'budi'); const t = await tenantOf('budi'); await topup('budi', '100000', 'topup-par-0001');
  const rs = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => withTx(db, tx => ledger.placeHold(tx, { tenantId: t, requestId: 'p' + i, amount: 100_000n * C }))));
  assert.equal(rs.filter(r => r.status === 'fulfilled').length, 1, '100,000 balance: one hold fits; a second would need 100,000 available again');
  const b = await ledger.getBalance(db, t); assert.ok(b.posted - b.held >= -ledger.DEFAULT_OVERDRAFT_MICRO);
});

test('the allowance is changed only by an admin with a fresh second factor, and is audited', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  assert.equal((await client.post('/admin/api/settings/overdraft', { tokens: '0' })).status, 401);
  assert.equal((await admin.get('/admin/api/settings/overdraft')).json.overdraftMicro, String(500_000n * C));
  for (const tokens of ['-1', '1.5', 5, '']) assert.equal((await admin.post('/admin/api/settings/overdraft', { tokens })).status, 400);
  await db.query("update session set auth_at = now() - interval '6 minutes' where kind='ADMIN'");
  assert.equal((await admin.post('/admin/api/settings/overdraft', { tokens: '0' })).json.error.code, 'step_up_required');
  await admin.post('/admin/api/second-factor', { code: adm.code(0) });
  assert.equal((await admin.post('/admin/api/settings/overdraft', { tokens: '250000' })).json.overdraftMicro, String(250_000n * C));
  const ev = (await admin.get('/admin/api/audit')).json.events.find((e: any) => e.action === 'setting.overdraft');
  assert.deepEqual([ev.summary.beforeMicro, ev.summary.afterMicro], [String(500_000n * C), String(250_000n * C)]);
});
