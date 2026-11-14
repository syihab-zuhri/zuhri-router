// TASK-006 spike tests. Requires the local PostgreSQL container (see README).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { startMock, type MockStats } from '../src/mock-upstream.ts';
import { startGateway, hashKey, normalize } from '../src/gateway.ts';
import { debitMicro } from '../src/money.ts';

const DB = process.env.SPIKE_DATABASE_URL ?? 'postgres://postgres:spike_local_only@127.0.0.1:55432/spike';
const MOCK = 18101, GW = 18100, KEY = 'spike-test-key';
const pool = new pg.Pool({ connectionString: DB, max: 30 });
let mock: Awaited<ReturnType<typeof startMock>>, gw: any, stats: MockStats;
const M = 1_000_000n; // micro-IDR per IDR
const BIG_INT = (v: any) => BigInt(v);
// Synthetic prices from BILLING_REDEEM.md section 2.3: Rp10.000 / Rp40.000 / Rp1.000 per 1M tokens, multiplier 1.5
const PRICE = { version: 1, inputRate: 10_000n * M, outputRate: 40_000n * M, cacheReadRate: 1_000n * M, multiplierE4: 15_000n };

async function seed(balanceIdr: bigint, routes: [string, string, string, number][]) {
  await pool.query(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const acc = (await pool.query("insert into ledger_account(tenant,posted) values('t1',$1) returning id", [String(balanceIdr * M)])).rows[0];
  await pool.query("insert into ledger_entry(account_id,kind,amount,source_id) values($1,'GRANT_ADMIN_TOPUP',$2,'seed')", [acc.id, String(balanceIdr * M)]);
  await pool.query("insert into api_key(key_hash,tenant) values($1,'t1')", [hashKey(KEY)]);
  for (const m of new Set(routes.map(r => r[0]))) await pool.query('insert into price values($1,$2,$3,$4,$5,$6)', [m, 1, String(PRICE.inputRate), String(PRICE.outputRate), String(PRICE.cacheReadRate), String(PRICE.multiplierE4)]);
  for (const [model, protocol, upModel, prio] of routes) await pool.query('insert into route(model,protocol,upstream_url,upstream_model,priority) values($1,$2,$3,$4,$5)', [model, protocol, `http://127.0.0.1:${MOCK}${protocol === 'chat' ? '/v1/chat/completions' : '/anthropic/v1/messages'}`, upModel, prio]);
}
const call = (path: string, model: string, extra: any = {}, init: any = {}) => fetch(`http://127.0.0.1:${GW}${path}`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true, max_tokens: 1024, messages: [{ role: 'user', content: 'halo' }], ...extra }), ...init });
const account = async () => { const a = (await pool.query("select posted,held from ledger_account where tenant='t1'")).rows[0]; return { posted: BigInt(a.posted), held: BigInt(a.held) }; };
const sumEntries = async () => BigInt((await pool.query('select coalesce(sum(amount),0) s from ledger_entry')).rows[0].s);
const reqRow = async (id: string) => (await pool.query('select * from request where id=$1', [id])).rows[0];
async function waitSettled(id: string) { for (let i = 0; i < 100; i++) { const r = await reqRow(id); if (r?.debit !== null && r?.debit !== undefined) return r; await new Promise(r => setTimeout(r, 30)); } throw new Error('not settled: ' + id); }
async function invariant() { const a = await account(); assert.equal(a.posted, await sumEntries(), 'posted balance must equal sum of ledger entries'); assert.equal(a.held, 0n, 'no hold may remain'); assert.ok(a.posted >= 0n); }

before(async () => { mock = await startMock(MOCK); stats = mock.stats; gw = await startGateway({ port: GW, pool, firstByteTimeoutMs: 800 }); });
after(async () => { gw.closeAllConnections?.(); mock.server.closeAllConnections?.(); gw.close(); mock.server.close(); assert.equal(pool.totalCount - pool.idleCount, 0, 'no leaked database connections'); await pool.end(); });
beforeEach(() => { stats.aborts = 0; for (const k of Object.keys(stats.calls)) delete stats.calls[k]; });

test('chat stream: bytes relayed unchanged, raw usage untouched, debit matches the documented example', async () => {
  await seed(1000n, [['m-ok', 'chat', 'ok', 1]]);
  const direct = await (await fetch(`http://127.0.0.1:${MOCK}/v1/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'ok' }) })).text();
  const res = await call('/v1/chat/completions', 'm-ok'); const text = await res.text();
  assert.equal(res.status, 200); assert.equal(text, direct, 'gateway must not alter the stream');
  assert.match(text, /"prompt_tokens":10000/); // raw usage is not multiplied
  const r = await waitSettled(res.headers.get('x-request-id')!);
  assert.deepEqual(r.usage_norm, { input: 2000, output: 1000, cacheRead: 8000 }); // inclusive prompt_tokens split, no double count
  assert.equal(BigInt(r.debit), 102n * M); // Rp68 reference x 1.5 = Rp102
  assert.equal(r.state, 'SETTLED'); assert.equal((await account()).posted, (1000n - 102n) * M); await invariant();
});

test('anthropic stream: exclusive input_tokens gives the same debit as the equivalent chat usage', async () => {
  await seed(1000n, [['m-ok', 'anthropic', 'ok', 1]]);
  const res = await call('/v1/messages', 'm-ok'); const text = await res.text();
  assert.match(text, /event: ping/); assert.match(text, /event: message_stop/);
  const r = await waitSettled(res.headers.get('x-request-id')!);
  assert.deepEqual(r.usage_norm, { input: 2000, output: 1000, cacheRead: 8000 }); assert.equal(BigInt(r.debit), 102n * M); await invariant();
});

test('normalizer rejects inconsistent usage instead of guessing', () => {
  assert.equal(normalize('chat', { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 30 }), null);
  assert.equal(normalize('chat', { prompt_tokens: 100 }), null);
  assert.deepEqual(normalize('chat', { prompt_tokens: 100, completion_tokens: 5 }), { input: 100, output: 5, cacheRead: 0 });
});

test('rounding happens once after summing; tiny costs do not round per category', () => {
  const p = { version: 1, inputRate: 1n, outputRate: 1n, cacheReadRate: 1n, multiplierE4: 15_000n };
  assert.equal(debitMicro({ input: 111_111, output: 111_111, cacheRead: 111_112 }, p), 1n); // 0.333334 x1.5 = 0.5 -> 1 (half up)
  assert.equal(debitMicro({ input: 111_111, output: 111_111, cacheRead: 111_111 }, p), 0n); // 0.4999995 -> 0
});

const BIG = { messages: [{ role: 'user', content: 'x'.repeat(21_000) }] }; // large enough that the hold covers the mock's 10,000 input tokens

test('concurrency: parallel requests never exceed the balance when the hold bounds the usage', async () => {
  await seed(10_000n, [['m-ok', 'chat', 'ok', 1]]); // measure one hold first
  const probe = await call('/v1/chat/completions', 'm-ok', BIG); await probe.text();
  const pr = await waitSettled(probe.headers.get('x-request-id')!); const hold = BIG_INT(pr.hold);
  assert.ok(hold >= BIG_INT(pr.debit), 'precondition: hold must cover the debit in this scenario');
  await seed(10_000n, [['m-ok', 'chat', 'slow', 1]]); // slow streams keep holds open while the rest arrive
  const capacity = Number((10_000n * M) / hold); const n = capacity + 15;
  const rs = await Promise.all(Array.from({ length: n }, () => call('/v1/chat/completions', 'm-ok', BIG).then(async r => { await r.text(); return r; })));
  const ok = rs.filter(r => r.status === 200).length, rejected = rs.filter(r => r.status === 402).length;
  assert.equal(ok + rejected, n); assert.ok(ok <= capacity, `admitted ${ok} must be <= capacity ${capacity}`); assert.ok(ok >= 1 && rejected >= 15);
  for (const r of rs.filter(r => r.status === 200)) await waitSettled(r.headers.get('x-request-id')!);
  await invariant();
});

test('FINDING: when upstream usage exceeds the body-based input estimate, the debit exceeds the hold and the balance can go negative', async () => {
  await seed(70n, [['m-ok', 'chat', 'ok', 1]]); // small body, but the mock reports 10,000 input tokens
  const res = await call('/v1/chat/completions', 'm-ok'); await res.text(); assert.equal(res.status, 200);
  const r = await waitSettled(res.headers.get('x-request-id')!);
  assert.ok(BIG_INT(r.debit) > BIG_INT(r.hold), 'debit exceeded the hold'); // documents RSK-009
  const a = await account(); assert.ok(a.posted < 0n, 'full usage is still debited'); assert.equal(a.posted, await sumEntries()); assert.equal(a.held, 0n);
  assert.equal((await call('/v1/chat/completions', 'm-ok')).status, 402, 'a negative balance rejects new requests');
});

test('fallback before first byte: next route for the same model, one debit, attempts recorded', async () => {
  await seed(1000n, [['m-fb', 'chat', 'fail503', 1], ['m-fb', 'chat', 'hang-first', 2], ['m-fb', 'chat', 'ok', 3]]);
  const res = await call('/v1/chat/completions', 'm-fb'); await res.text(); assert.equal(res.status, 200);
  const id = res.headers.get('x-request-id')!; const r = await waitSettled(id);
  const att = (await pool.query('select seq,outcome from attempt where request_id=$1 order by seq', [id])).rows;
  assert.deepEqual(att.map(a => a.outcome), ['upstream_503', 'connect_or_first_byte_failed', 'completed']);
  assert.equal(BigInt(r.debit), 102n * M); assert.equal((await pool.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '1'); await invariant();
});

test('all routes fail before first byte: structured error, no debit', async () => {
  await seed(1000n, [['m-down', 'chat', 'fail503', 1], ['m-down', 'chat', 'fail503', 2]]);
  const res = await call('/v1/chat/completions', 'm-down'); const body = await res.json();
  assert.equal(res.status, 503); assert.equal(body.error.code, 'upstream_unavailable');
  assert.equal((await account()).posted, 1000n * M); await invariant();
});

test('upstream 400 is forwarded without fallback or charge', async () => {
  await seed(1000n, [['m-bad', 'chat', 'bad400', 1], ['m-bad', 'chat', 'ok', 2]]);
  const res = await call('/v1/chat/completions', 'm-bad'); await res.text();
  assert.equal(res.status, 400); assert.equal(stats.calls['ok'] ?? 0, 0, 'must not fall back on a request error');
  assert.equal((await account()).posted, 1000n * M); await invariant();
});

test('failure after stream started: no fallback; missing usage is settled as an estimate, not as zero', async () => {
  await seed(1000n, [['m-die', 'chat', 'die-mid', 1], ['m-die', 'chat', 'ok', 2]]);
  const res = await call('/v1/chat/completions', 'm-die'); const text = await res.text().catch(() => '');
  assert.equal(stats.calls['ok'] ?? 0, 0, 'no fallback after first byte'); assert.doesNotMatch(text, /\[DONE\]/);
  const r = await waitSettled(res.headers.get('x-request-id')!);
  assert.equal(r.state, 'SETTLED_ESTIMATED'); assert.equal(r.estimated, true); assert.ok(BigInt(r.debit) > 0n); await invariant();
});

test('zero usage: no charge at all and the hold is fully released', async () => {
  await seed(1000n, [['m-zero', 'chat', 'zero', 1]]);
  const res = await call('/v1/chat/completions', 'm-zero'); await res.text();
  const r = await waitSettled(res.headers.get('x-request-id')!);
  assert.equal(BigInt(r.debit), 0n); assert.equal(r.estimated, false);
  assert.equal((await pool.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '0');
  assert.equal((await account()).posted, 1000n * M); await invariant();
});

test('client disconnect mid-stream cancels the upstream request and still settles exactly once', async () => {
  await seed(1000n, [['m-slow', 'anthropic', 'slow', 1]]);
  const ac = new AbortController(); const res = await call('/v1/messages', 'm-slow', {}, { signal: ac.signal });
  const id = res.headers.get('x-request-id')!; const reader = res.body!.getReader(); await reader.read(); ac.abort();
  const r = await waitSettled(id); await new Promise(r => setTimeout(r, 300));
  assert.equal(stats.aborts, 1, 'upstream must observe the cancellation');
  assert.equal(r.estimated, true); assert.equal((await pool.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '1'); await invariant();
});

test('unknown model and bad key are rejected before any hold', async () => {
  await seed(1000n, [['m-ok', 'chat', 'ok', 1]]);
  assert.equal((await call('/v1/chat/completions', 'nope')).status, 404);
  const bad = await fetch(`http://127.0.0.1:${GW}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' }); assert.equal(bad.status, 401);
  assert.equal((await account()).held, 0n); assert.equal((await pool.query('select count(*) n from request')).rows[0].n, '0');
});

test('wrong-protocol route is never used: a chat-only model is not available on the anthropic surface', async () => {
  await seed(1000n, [['m-ok', 'chat', 'ok', 1]]);
  const res = await call('/v1/messages', 'm-ok'); const body = await res.json();
  assert.equal(res.status, 503); assert.equal(body.error.type, 'upstream_unavailable'); assert.equal(stats.calls['ok'] ?? 0, 0); await invariant();
});
