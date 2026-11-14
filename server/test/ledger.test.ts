// Covers the ledger part of TASK-002 (TEST-002 subset), NFR-001, and append-only rules of TEST-016.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe } from './helpers.ts';
import { withTx, type Db } from '../src/db/pool.ts';
import * as ledger from '../src/ledger.ts';
import { debitMicro, holdMicro, creditsToMicro } from '../src/money.ts';

let db: Db; let app: any; let tenantId: string; let adminId: string;
const M = 1_000_000n;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => {
  await wipe(db);
  adminId = (await db.query("insert into app_user(username,email,password_hash,role) values('adm','adm@example.test','x','ADMIN') returning id")).rows[0].id;
  tenantId = (await db.query('insert into tenant default values returning id')).rows[0].id;
  await withTx(db, tx => ledger.createAccount(tx, tenantId));
});
const topup = (amount: bigint, key: string, saleRef = 'INV-1') => withTx(db, tx => ledger.grantAdminTopup(tx, { tenantId, amount, saleRef, actorUser: adminId, idemKey: key }));
const clean = async () => assert.deepEqual(await ledger.invariantViolations(db), []);

test('money: one rounding after summing, hold rounds up, amounts parse strictly', () => {
  const p = { version: 1, inputRate: 10_000n * M, outputRate: 40_000n * M, cacheReadRate: 1_000n * M, cacheWriteRate: 12_500n * M, multiplierE4: 15_000n };
  assert.equal(debitMicro({ input: 2000, output: 1000, cacheRead: 8000, cacheWrite: 0 }, p), 102n * M); // BILLING_REDEEM.md section 2.3
  const tiny = { ...p, inputRate: 1n, outputRate: 1n, cacheReadRate: 1n, cacheWriteRate: 1n };
  assert.equal(debitMicro({ input: 111_111, output: 111_111, cacheRead: 111_112, cacheWrite: 0 }, tiny), 1n);
  assert.equal(debitMicro({ input: 111_111, output: 111_111, cacheRead: 111_111, cacheWrite: 0 }, tiny), 0n);
  assert.ok(holdMicro(10, 10, tiny) >= 1n);
  assert.throws(() => debitMicro({ input: -1, output: 0, cacheRead: 0, cacheWrite: 0 }, p));
  assert.throws(() => debitMicro({ input: 1.5, output: 0, cacheRead: 0, cacheWrite: 0 }, p));
  assert.throws(() => debitMicro({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, { ...p, multiplierE4: 0n }));
  assert.equal(creditsToMicro('50000'), 50_000n * M);
  for (const bad of ['-1', '1.5', '1e3', '', ' 1', '0x10', '1234567890123']) assert.throws(() => creditsToMicro(bad), bad);
});

test('top-up is idempotent: replay returns the same result, a changed payload conflicts', async () => {
  const a = await topup(50_000n * M, 'topup-key-0001'); assert.equal(a.replayed, false);
  const b = await topup(50_000n * M, 'topup-key-0001'); assert.equal(b.replayed, true); assert.equal(b.entryId, a.entryId);
  await assert.rejects(topup(60_000n * M, 'topup-key-0001'), (e: any) => e.code === 'idempotency_conflict');
  assert.equal((await ledger.getBalance(db, tenantId)).posted, 50_000n * M);
  assert.equal((await db.query('select count(*) n from ledger_entry')).rows[0].n, '1'); await clean();
});

test('concurrent identical top-ups credit exactly once', async () => {
  const rs = await Promise.allSettled(Array.from({ length: 12 }, () => topup(10_000n * M, 'topup-key-race')));
  assert.ok(rs.every(r => r.status === 'fulfilled'), 'replays must succeed, not error');
  assert.equal((await ledger.getBalance(db, tenantId)).posted, 10_000n * M); await clean();
});

test('holds: parallel admission never reserves more than the balance', async () => {
  await topup(1000n * M, 'topup-key-0002');
  const rs = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => withTx(db, tx => ledger.placeHold(tx, { tenantId, requestId: `req-${i}`, amount: 100n * M }))));
  assert.equal(rs.filter(r => r.status === 'fulfilled').length, 10);
  assert.ok(rs.filter(r => r.status === 'rejected').every((r: any) => r.reason.code === 'insufficient_balance'));
  const b = await ledger.getBalance(db, tenantId); assert.equal(b.held, 1000n * M); assert.equal(b.available, 0n); await clean();
});

test('settlement: once per request, zero usage leaves no entry, bound violations are reported', async () => {
  await topup(1000n * M, 'topup-key-0003');
  for (const id of ['r-normal', 'r-zero', 'r-over']) await withTx(db, tx => ledger.placeHold(tx, { tenantId, requestId: id, amount: 100n * M }));
  const settle = (requestId: string, debit: bigint) => withTx(db, tx => ledger.settleHold(tx, { tenantId, requestId, debit }));
  assert.deepEqual(await settle('r-normal', 40n * M), { settled: true, boundExceeded: false });
  assert.deepEqual(await settle('r-normal', 40n * M), { settled: false, boundExceeded: false }); // replay
  const racing = await Promise.all(Array.from({ length: 8 }, () => settle('r-zero', 0n)));
  assert.equal(racing.filter(r => r.settled).length, 1);
  assert.deepEqual(await settle('r-over', 150n * M), { settled: true, boundExceeded: true });
  const b = await ledger.getBalance(db, tenantId);
  assert.equal(b.posted, (1000n - 40n - 150n) * M); assert.equal(b.held, 0n);
  assert.equal((await db.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '2'); await clean();
});

test('a hold cannot be settled through another tenant', async () => {
  await topup(1000n * M, 'topup-key-0004');
  await withTx(db, tx => ledger.placeHold(tx, { tenantId, requestId: 'r-mine', amount: 100n * M }));
  const other = (await db.query('insert into tenant default values returning id')).rows[0].id; await withTx(db, tx => ledger.createAccount(tx, other));
  await assert.rejects(withTx(db, tx => ledger.settleHold(tx, { tenantId: other, requestId: 'r-mine', debit: 1n })), (e: any) => e.code === 'not_found');
  assert.equal((await ledger.getBalance(db, tenantId)).held, 100n * M); await clean();
});

test('adjustments are new entries with a reason; ledger and audit rows cannot be changed or deleted', async () => {
  await topup(1000n * M, 'topup-key-0005');
  await withTx(db, tx => ledger.adjust(tx, { tenantId, amount: -200n * M, reason: 'salah nominal', actorUser: adminId, idemKey: 'adjust-key-0001' }));
  await assert.rejects(withTx(db, tx => ledger.adjust(tx, { tenantId, amount: 5n, reason: '', actorUser: adminId, idemKey: 'adjust-key-0002' })));
  assert.equal((await ledger.getBalance(db, tenantId)).posted, 800n * M);
  for (const sql of ['update ledger_entry set amount = 1', 'delete from ledger_entry', "update audit_event set action = 'x'", 'delete from audit_event'])
    await assert.rejects(db.query(sql), /append-only/, sql);
  assert.equal((await db.query("select count(*) n from audit_event where action in ('ledger.admin_topup','ledger.adjustment')")).rows[0].n, '2'); await clean();
});

test('invariant check detects a tampered balance', async () => {
  await topup(1000n * M, 'topup-key-0006');
  await db.query('update ledger_account set posted = posted + 1');
  assert.equal((await ledger.invariantViolations(db))[0].problem, 'posted_differs_from_entries');
});
