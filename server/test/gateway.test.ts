// TEST-011, TEST-012 (routing and fallback) and TEST-020 against a mock upstream. No real upstream is called.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, KEY } from './helpers.ts';
import { startMock, type MockStats } from './fixtures/mock-upstream.ts';
import { resetRouteHealth, normalizeUsage, recoverStuck } from '../src/gateway.ts';
import { seal } from '../src/crypto.ts';
import * as ledger from '../src/ledger.ts';
import type { Db } from '../src/db/pool.ts';

const MOCK = 18211; const UPKEY = 'sk-upstream-GATEWAY-secret-000111';
let db: Db; let app: any; let base: string; let mock: Awaited<ReturnType<typeof startMock>>; let stats: MockStats;
let adm: Awaited<ReturnType<typeof makeAdmin>>; let admin: Client; let cust: Client; let apiKey: string; let tenantId: string;
const C = 1_000_000n;

before(async () => { ({ db, app } = await setup()); await app.listen({ host: '127.0.0.1', port: 0 }); base = `http://127.0.0.1:${app.server.address().port}`; mock = await startMock(MOCK); stats = mock.stats; });
after(async () => { mock.server.closeAllConnections(); mock.server.close(); app.server.closeAllConnections(); await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => {
  await wipe(db); resetRouteHealth(); stats.aborts = 0; stats.last = undefined; for (const k of Object.keys(stats.calls)) delete stats.calls[k];
  adm = await makeAdmin(db); admin = await adminClient(app, adm); cust = (await makeCustomer(app, admin, 'budi')).client;
  tenantId = (await db.query("select m.tenant_id from membership m join app_user u on u.id=m.user_id where u.username='budi'")).rows[0].tenant_id;
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '1000000', saleRef: 'paket', idempotencyKey: 'topup-gw-0001' });
  apiKey = (await cust.post('/api/keys', { name: 'tool', idempotencyKey: 'key-gw-00001' })).json.secret;
});

/** Publishes a model at the given multiplier and adds routes [protocol, mock mode, priority] on eligible upstreams. */
async function model(id: string, multiplier: string, routes: ['CHAT' | 'ANTHROPIC' | 'RESPONSES', string, number][], upstreamStatus = 'ELIGIBLE') {
  await admin.post('/admin/api/models', { id, displayName: id });
  const d = (await admin.post('/admin/api/models/price/draft', { id, expectedVersion: '1', multiplier })).json;
  await admin.post('/admin/api/models/price/publish', { id, expectedVersion: d.version, reason: 'uji gateway' });
  let i = 0;
  for (const [protocol, mode, priority] of routes) {
    const up = (await db.query('insert into upstream(name, status, base_url_chat, base_url_anthropic, base_url_responses, key_enc, key_set_at) values($1,$2,$3,$4,$3,$5,now()) returning id', [`${id}-${++i}`, upstreamStatus, `http://127.0.0.1:${MOCK}/v1`, `http://127.0.0.1:${MOCK}/anthropic`, seal(KEY, Buffer.from(UPKEY))])).rows[0];
    await db.query('insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,$5)', [id, up.id, protocol, mode, priority]);
  }
}
// The mock reports 10,000 input tokens. Requests carry a 12,000-byte prompt so that usage is plausible for the request size;
// the input cap (CR-018) has its own test with a small prompt.
const PAD = ' ' + 'kata '.repeat(2400);
const call = (path: string, m: string, extra: object = {}, init: RequestInit = {}, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ model: m, stream: true, max_tokens: 2000, messages: [{ role: 'user', content: 'halo PENANDA-PROMPT-RAHASIA' + PAD }], ...extra }), ...init });
const row = async (id: string) => (await db.query('select * from request where id=$1', [id])).rows[0];
async function settled(id: string) { for (let i = 0; i < 100; i++) { const r = await row(id); if (r?.debit !== null && r?.debit !== undefined) return r; await new Promise(r => setTimeout(r, 30)); } throw new Error('not settled ' + id); }
const balance = () => ledger.getBalance(db, tenantId);
const clean = async () => { assert.deepEqual(await ledger.invariantViolations(db), []); assert.equal((await balance()).held, 0n); };
const attempts = async (id: string) => (await db.query('select outcome from attempt where request_id=$1 order by seq', [id])).rows.map(r => r.outcome);

test('chat stream: relayed unchanged, charged tokens x multiplier in token credits, upstream sees its own key and model', async () => {
  await model('ds/flash', '2', [['CHAT', 'ok', 1]]);
  const direct = await (await fetch(`http://127.0.0.1:${MOCK}/v1/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'ok', stream: true }) })).text();
  const res = await call('/v1/chat/completions', 'ds/flash'); const text = await res.text();
  assert.equal(res.status, 200); assert.equal(text, direct, 'the stream is not altered'); assert.match(text, /"prompt_tokens":10000/, 'raw usage is not multiplied');
  const r = await settled(res.headers.get('x-request-id')!);
  assert.deepEqual(r.usage_norm, { input: 2000, output: 1000, cacheRead: 8000, cacheWrite: 0 });
  assert.equal(BigInt(r.debit), 22_000n * C); // 11,000 tokens read x2
  assert.equal((await balance()).posted, (1_000_000n - 22_000n) * C); assert.equal(r.state, 'SETTLED');
  assert.equal(stats.last!.headers.authorization, `Bearer ${UPKEY}`); assert.equal(stats.last!.body.model, 'ok'); assert.equal(stats.last!.body.stream_options.include_usage, true);
  assert.ok(!JSON.stringify(stats.last!.headers).includes(apiKey), "the customer's key never reaches the upstream"); await clean();
});

test('anthropic stream and non-stream chat charge the same; anthropic headers are forwarded', async () => {
  await model('ds/flash', '1', [['ANTHROPIC', 'ok', 1], ['CHAT', 'ok', 1]]);
  const a = await call('/v1/messages', 'ds/flash', {}, {}, { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'extended-cache-ttl-2025-04-11,uji' }); const text = await a.text();
  assert.match(text, /event: ping/); assert.match(text, /event: message_stop/);
  assert.equal(stats.last!.headers['x-api-key'], UPKEY); assert.equal(stats.last!.headers['anthropic-beta'], 'extended-cache-ttl-2025-04-11,uji'); assert.equal(stats.last!.url, '/anthropic/v1/messages');
  const viaXApiKey = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'ds/flash', max_tokens: 100, messages: [{ role: 'user', content: PAD }] }) });
  assert.equal(viaXApiKey.status, 200); const body = await viaXApiKey.json(); assert.equal(body.usage.input_tokens, 2000);
  const n = await call('/v1/chat/completions', 'ds/flash', { stream: false }); assert.equal((await n.json()).usage.prompt_tokens, 10000);
  const omitted = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'ds/flash', messages: [] }) }); await omitted.json();
  assert.equal(stats.last!.body.stream, false, 'stream is sent explicitly even when the client omitted it'); assert.equal((await settled(omitted.headers.get('x-request-id')!)).estimated, false);
  for (const res of [a, viaXApiKey, n]) assert.equal(BigInt((await settled(res.headers.get('x-request-id')!)).debit), 11_000n * C);
  await clean();
});

test('usage normaliser refuses inconsistent shapes', () => {
  assert.equal(normalizeUsage('CHAT', { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 30 }), null);
  assert.equal(normalizeUsage('CHAT', { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 80 }), null);
  assert.equal(normalizeUsage('CHAT', { prompt_tokens: 100 }), null); assert.equal(normalizeUsage('ANTHROPIC', { input_tokens: -1, output_tokens: 1 }), null);
  assert.deepEqual(normalizeUsage('CHAT', { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40 } }), { input: 60, output: 5, cacheRead: 40, cacheWrite: 0 });
});

test('fallback before the first byte: next route for the same model, one debit; attempts recorded', async () => {
  await model('m/fb', '1', [['CHAT', 'fail503', 1], ['CHAT', 'hang-first', 2], ['CHAT', 'ok', 3]]);
  const res = await call('/v1/chat/completions', 'm/fb'); await res.text(); assert.equal(res.status, 200);
  const id = res.headers.get('x-request-id')!; const r = await settled(id);
  assert.deepEqual(await attempts(id), ['upstream_503', 'connect_or_first_byte_failed', 'completed']);
  assert.equal(BigInt(r.debit), 11_000n * C); assert.equal((await db.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '1'); await clean();
});

test('all routes down: one structured error, nothing charged; request errors are forwarded without fallback', async () => {
  await model('m/down', '1', [['CHAT', 'fail503', 1], ['CHAT', 'fail503', 2]]); await model('m/bad', '1', [['CHAT', 'bad400', 1], ['CHAT', 'ok', 2]]);
  const d = await call('/v1/chat/completions', 'm/down'); const dj = await d.json();
  assert.equal(d.status, 503); assert.equal(dj.error.code, 'upstream_unavailable'); assert.ok(!JSON.stringify(dj).match(/overloaded|127\.0\.0\.1|sk-/), 'no upstream detail leaks');
  const b = await call('/v1/chat/completions', 'm/bad'); await b.text(); assert.equal(b.status, 400); assert.equal(stats.calls.ok ?? 0, 0);
  assert.equal((await balance()).posted, 1_000_000n * C); await clean();
});

test('after the stream starts there is no fallback; missing usage is charged as an estimate, zero usage is free', async () => {
  await model('m/die', '1', [['CHAT', 'die-mid', 1], ['CHAT', 'ok', 2]]); await model('m/zero', '3', [['CHAT', 'zero', 1]]);
  const d = await call('/v1/chat/completions', 'm/die'); await d.text().catch(() => ''); assert.equal(stats.calls.ok ?? 0, 0, 'no fallback after the first byte');
  const dr = await settled(d.headers.get('x-request-id')!);
  assert.deepEqual([dr.state, dr.estimated, BigInt(dr.debit) > 0n], ['SETTLED_ESTIMATED', true, true]);
  const z = await call('/v1/chat/completions', 'm/zero'); await z.text(); const zr = await settled(z.headers.get('x-request-id')!);
  assert.deepEqual([BigInt(zr.debit), zr.estimated], [0n, false]);
  assert.equal((await db.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '1'); await clean();
});

test('client disconnect cancels the upstream call and settles exactly once', async () => {
  await model('m/slow', '1', [['ANTHROPIC', 'slow', 1]]);
  const ac = new AbortController(); const res = await call('/v1/messages', 'm/slow', {}, { signal: ac.signal });
  const id = res.headers.get('x-request-id')!; await res.body!.getReader().read(); ac.abort();
  const r = await settled(id); await new Promise(r => setTimeout(r, 300));
  assert.equal(stats.aborts, 1); assert.equal(r.state, 'SETTLED_ESTIMATED'); assert.equal((await db.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '1'); await clean();
});

test('routing: wrong protocol, pending upstream, unpriced model and unknown model are never served', async () => {
  await model('m/chatonly', '1', [['CHAT', 'ok', 1]]); await model('m/pending', '1', [['CHAT', 'ok', 1]], 'PENDING');
  await admin.post('/admin/api/models', { id: 'm/unpriced', displayName: 'x' });
  const a = await call('/v1/messages', 'm/chatonly'); assert.equal(a.status, 503); assert.equal((await a.json()).error.type, 'upstream_unavailable');
  assert.equal((await call('/v1/chat/completions', 'm/pending')).status, 503);
  for (const m of ['m/unpriced', 'tidak/ada']) { const r = await call('/v1/chat/completions', m); assert.equal(r.status, 404); assert.equal((await r.json()).error.code, 'model_not_available'); }
  assert.equal(stats.calls.ok ?? 0, 0); assert.equal((await balance()).posted, 1_000_000n * C); await clean();
  const list = await (await fetch(base + '/v1/models', { headers: { authorization: `Bearer ${apiKey}` } })).json();
  assert.deepEqual(list.data.map((m: any) => m.id), ['m/chatonly']);
});

test('authentication and account state: bad, revoked and scoped keys, suspended tenant, empty balance', async () => {
  await model('m/a', '1', [['CHAT', 'ok', 1]]); await model('m/b', '1', [['CHAT', 'ok', 1]]);
  const bad = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer rtr_salah', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm/a', messages: [] }) });
  assert.equal(bad.status, 401); assert.equal((await bad.json()).error.code, 'auth_invalid');
  assert.equal((await fetch(base + '/v1/models')).status, 401);
  const scoped = (await cust.post('/api/keys', { name: 'sempit', allowedModels: ['m/a'], idempotencyKey: 'key-gw-00002' })).json;
  const viaScoped = (m: string) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${scoped.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: m, messages: [], stream: false }) });
  assert.equal((await viaScoped('m/a')).status, 200); assert.equal((await viaScoped('m/b')).status, 404);
  await cust.post(`/api/keys/${scoped.key.id}/revoke`, { expectedVersion: scoped.key.version });
  const rv = await viaScoped('m/a'); assert.equal(rv.status, 401); assert.equal((await rv.json()).error.code, 'key_revoked');
  const v = (await admin.get('/admin/api/customers/budi')).json.version;
  await admin.post('/admin/api/customers/budi/suspend', { expectedVersion: v, reason: 'uji suspend' });
  const sus = await call('/v1/chat/completions', 'm/a'); assert.equal(sus.status, 403); assert.equal((await sus.json()).error.code, 'tenant_suspended');
  const siti = (await makeCustomer(app, admin, 'siti')).client; const k2 = (await siti.post('/api/keys', { name: 'kosong', idempotencyKey: 'key-gw-00003' })).json.secret;
  const empty = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${k2}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm/a', messages: [] }) });
  assert.equal(empty.status, 402); assert.equal((await empty.json()).error.code, 'insufficient_balance');
  assert.equal((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n, '0');
});

test('input cap: tokens an upstream adds on its own are not billed to the customer', async () => {
  await model('m/pad', '2', [['CHAT', 'ok', 1]]);
  const body = JSON.stringify({ model: 'm/pad', max_tokens: 2000, stream: false, messages: [{ role: 'user', content: 'ok' }] });
  const res = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body });
  assert.equal((await res.json()).usage.prompt_tokens, 10000, 'the customer still sees the raw usage');
  const r = await settled(res.headers.get('x-request-id')!); const sent = r.max_input;
  assert.ok(sent < 200, `request size ${sent}`);
  assert.deepEqual(r.usage_norm, { input: 0, output: 1000, cacheRead: sent, cacheWrite: 0 }, 'plain input is cut first, then cache read down to the request size');
  assert.equal(r.unbilled_input_tokens, 10000 - sent); assert.equal(BigInt(r.debit), BigInt(sent + 1000) * 2n * C); assert.equal(r.bound_exceeded, false);
  assert.equal(r.usage_raw.prompt_tokens, 10000, 'the upstream figure is kept for reconciliation'); await clean();
});

test('overrun allowance: output is capped to what the balance plus allowance can pay, then new requests are refused', async () => {
  await db.query("update system_setting set value=$1 where name='overdraft_micro'", [String(500n * C)]);
  try {
    await model('m/x', '1', [['CHAT', 'ok', 1]]);
    await admin.post('/admin/api/adjustments', { username: 'budi', amountMicro: String(-999_200n * C), reason: 'sisakan delapan ratus', idempotencyKey: 'adjust-gw-0001' }); // 800 credits left, 500 allowance
    const small = (extra: object) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm/x', messages: [{ role: 'user', content: 'ok' }], ...extra }) });
    const res = await small({ max_tokens: 100000, stream: false }); assert.equal(res.status, 200);
    const sent = stats.last!.body.max_tokens; assert.ok(sent > 1000 && sent < 1300, `output cap sent upstream was ${sent}`);
    const r = await settled(res.headers.get('x-request-id')!); assert.equal(r.max_output, sent);
    assert.equal((await balance()).posted, (800n - 1000n - BigInt(r.max_input)) * C, 'the mock produced 1,000 output tokens: the balance went below zero, within the allowance');
    assert.equal((await small({})).status, 402, 'no new request once the balance is not above zero');
  } finally { await db.query("update system_setting set value=0 where name='overdraft_micro'"); }
});

test('price changes do not touch a request already admitted', async () => {
  await model('m/p', '1', [['CHAT', 'slow', 1]]);
  const pending = call('/v1/chat/completions', 'm/p'); await new Promise(r => setTimeout(r, 150));
  const v = (await admin.get('/admin/api/models?id=m%2Fp')).json.version;
  const d = (await admin.post('/admin/api/models/price/draft', { id: 'm/p', expectedVersion: v, multiplier: '5' })).json;
  assert.equal((await admin.post('/admin/api/models/price/publish', { id: 'm/p', expectedVersion: d.version, reason: 'naik' })).status, 200);
  const res = await pending; await res.text();
  assert.equal(BigInt((await settled(res.headers.get('x-request-id')!)).debit), 11_000n * C, 'charged at the price it was admitted with');
  const again = await call('/v1/chat/completions', 'm/p'); await again.text();
  assert.equal(BigInt((await settled(again.headers.get('x-request-id')!)).debit), 55_000n * C); await clean();
});

test('nothing from the prompt, the customer key or the upstream key is stored; customers see only their own requests', async () => {
  await model('m/a', '1', [['CHAT', 'ok', 1]]); const res = await call('/v1/chat/completions', 'm/a'); await res.text(); await settled(res.headers.get('x-request-id')!);
  const fail = await call('/v1/chat/completions', 'tidak/ada'); await fail.text();
  const dump = JSON.stringify((await db.query('select (select json_agg(t) from request t) a, (select json_agg(t) from attempt t) b, (select json_agg(t) from ledger_entry t) c, (select json_agg(t) from audit_event t) d, (select json_agg(t) from hold t) e')).rows[0]);
  for (const s of ['PENANDA-PROMPT-RAHASIA', apiKey, UPKEY, 'Halo dari']) assert.ok(!dump.includes(s), s);
  const mine = (await cust.get('/api/requests')).json.requests; assert.equal(mine.length, 1); assert.deepEqual([mine[0].model, mine[0].debitMicro, mine[0].final], ['m/a', String(11_000n * C), true]);
  const siti = (await makeCustomer(app, admin, 'siti')).client; assert.deepEqual((await siti.get('/api/requests')).json.requests, []);
  assert.equal((await new Client(app).get('/api/requests')).status, 401);
});

test('parallel requests never hold more than the balance', async () => {
  await model('m/slow', '1', [['CHAT', 'slow', 1]]);
  await admin.post('/admin/api/adjustments', { username: 'budi', amountMicro: String(-950_000n * C), reason: 'sisakan lima puluh ribu', idempotencyKey: 'adjust-gw-0002' }); // 50,000 credits; each hold is about 14,100
  const rs = await Promise.all(Array.from({ length: 4 }, () => call('/v1/chat/completions', 'm/slow').then(async r => { await r.text(); return r; })));
  const ok = rs.filter(r => r.status === 200).length; assert.equal(ok, 3, `admitted ${ok}: 50,000 credits fit three holds of about 14,100, the fourth is refused`); assert.ok(rs.every(r => r.status === 200 || r.status === 402));
  for (const r of rs.filter(r => r.status === 200)) await settled(r.headers.get('x-request-id')!);
  await clean();
});

test('rate limits: per key, per tenant concurrency and failed-auth per address answer 429 with Retry-After and place no hold', async () => {
  await model('m/slow', '1', [['CHAT', 'slow', 1]]); await model('m/a', '1', [['CHAT', 'ok', 1]]);
  // helpers.ts configures 12 requests per minute per key, 4 concurrent per tenant and 5 failed authentications per address for tests
  const slow = await Promise.all(Array.from({ length: 6 }, () => call('/v1/chat/completions', 'm/slow').then(async r => { await r.text(); return r; })));
  assert.equal(slow.filter(r => r.status === 200).length, 4); const busy = slow.find(r => r.status === 429)!; assert.equal((await Promise.resolve(busy.headers.get('retry-after'))) !== null, true);
  const more = []; for (let i = 0; i < 8; i++) more.push(await call('/v1/chat/completions', 'm/a', { stream: false }));
  assert.deepEqual(more.map(r => r.status), [200, 200, 200, 200, 200, 200, 429, 429], 'six more fit in the per-key minute, then the key is limited');
  assert.ok(Number(more[7].headers.get('retry-after')) > 0); assert.equal((await more[7].json()).error.code, 'limit_exceeded');
  assert.equal((await db.query('select count(*) n from request')).rows[0].n, '10', 'limited requests never reach admission');
  const other = (await cust.post('/api/keys', { name: 'kedua', idempotencyKey: 'key-gw-00009' })).json.secret;
  assert.equal((await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${other}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm/a', messages: [{ role: 'user', content: PAD }], stream: false }) })).status, 200, 'another key has its own budget');
  const wrong = () => fetch(base + '/v1/models', { headers: { authorization: 'Bearer rtr_' + 'x'.repeat(43) } });
  const bad = []; for (let i = 0; i < 5; i++) bad.push((await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer rtr_' + 'y'.repeat(43), 'content-type': 'application/json' }, body: '{"model":"m/a"}' })).status); void wrong;
  assert.deepEqual(bad, [401, 401, 401, 401, 401]);
  assert.equal((await call('/v1/chat/completions', 'm/a', { stream: false })).status, 429, 'the address is paused after repeated bad keys');
  await clean();
});

test('recovery: a request lost before the first byte is released; one lost mid-stream waits for the admin, who settles it once', async () => {
  await model('m/a', '1', [['CHAT', 'ok', 1]]);
  const mk = async (state: string) => { const res = await call('/v1/chat/completions', 'm/a', { stream: false }); const id = res.headers.get('x-request-id')!; const r = await settled(id);
    // put the request back as if the process had died before settlement: reopen the hold exactly as admission left it
    await db.query('alter table ledger_entry disable trigger ledger_entry_append_only'); await db.query("delete from ledger_entry where kind='DEBIT_USAGE' and idem_key=$1", [id]); await db.query('alter table ledger_entry enable trigger ledger_entry_append_only');
    await db.query("update hold set status='ACTIVE', closed_at=null, settled_debit=null where request_id=$1", [id]);
    await db.query('update ledger_account set posted=posted+$1, held=held+$2 where tenant_id=$3', [r.debit, r.hold, tenantId]);
    await db.query('update api_key set spent=spent-$1, held=held+$2 where id=$3', [r.debit, r.hold, r.api_key_id]);
    await db.query("update request set state=$2, debit=null, settled_at=null, usage_norm=null, created_at=now() - interval '2 hours' where id=$1", [id, state]); return { id, hold: BigInt(r.hold) }; };
  const a = await mk('ADMITTED'); const s = await mk('STREAMING');
  assert.deepEqual(await ledger.invariantViolations(db), [], 'the simulated crash state is itself consistent');
  const fresh = await call('/v1/chat/completions', 'm/a', { stream: false }); await settled(fresh.headers.get('x-request-id')!);
  assert.deepEqual(await recoverStuck(db), { released: 1, unresolved: 1 }); assert.deepEqual(await recoverStuck(db), { released: 0, unresolved: 0 }, 'running it again changes nothing');
  assert.deepEqual([(await row(a.id)).state, BigInt((await row(a.id)).debit)], ['FAILED', 0n]); assert.equal((await row(s.id)).state, 'UNRESOLVED');
  assert.equal((await balance()).held, s.hold, 'the unresolved hold is kept');
  const list = (await admin.get('/admin/api/requests/unresolved')).json.requests; assert.deepEqual(list.map((x: any) => [x.id, x.username]), [[s.id, 'budi']]);
  assert.equal((await cust.post(`/admin/api/requests/${s.id}/resolve`, { debitTokens: '0', reason: 'x y z' })).status, 401);
  assert.equal((await admin.post(`/admin/api/requests/${s.id}/resolve`, { debitTokens: String(s.hold / C + 1n), reason: 'terlalu besar' })).status, 400);
  assert.equal((await admin.post(`/admin/api/requests/${s.id}/resolve`, { debitTokens: '500', reason: '' })).status, 400);
  const before = (await balance()).posted;
  assert.equal((await admin.post(`/admin/api/requests/${s.id}/resolve`, { debitTokens: '500', reason: 'perkiraan dari log upstream' })).json.state, 'RESOLVED');
  assert.equal((await admin.post(`/admin/api/requests/${s.id}/resolve`, { debitTokens: '500', reason: 'ulang' })).json.error.code, 'not_unresolved');
  assert.equal((await balance()).posted, before - 500n * C); await clean();
});

test('responses surface (Codex): stream and non-stream are relayed and charged; stateless only; no cross-protocol routing', async () => {
  await model('gpt/sol', '2', [['RESPONSES', 'ok', 1]]); await model('m/chatonly', '1', [['CHAT', 'ok', 1]]);
  const resp = (m: string, extra: object = {}) => fetch(base + '/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: m, instructions: 'Asisten.', input: 'halo PENANDA-PROMPT-RAHASIA' + PAD, max_output_tokens: 2000, ...extra }) });
  const s = await resp('gpt/sol', { stream: true }); const text = await s.text();
  assert.equal(s.status, 200); assert.match(text, /event: response\.created/); assert.match(text, /event: response\.completed/); assert.doesNotMatch(text, /\[DONE\]/);
  const sr = await settled(s.headers.get('x-request-id')!);
  assert.deepEqual(sr.usage_norm, { input: 2000, output: 1000, cacheRead: 8000, cacheWrite: 0 }); assert.equal(BigInt(sr.debit), 22_000n * C); assert.equal(sr.estimated, false);
  assert.deepEqual([stats.last!.url, stats.last!.body.store, stats.last!.body.max_output_tokens, stats.last!.body.model, stats.last!.headers.authorization], ['/v1/responses', false, 2000, 'ok', `Bearer ${UPKEY}`]);
  const n = await resp('gpt/sol'); const body = await n.json(); assert.equal(body.usage.input_tokens, 10000); assert.equal(stats.last!.body.stream, false);
  assert.equal(BigInt((await settled(n.headers.get('x-request-id')!)).debit), 22_000n * C);
  for (const extra of [{ previous_response_id: 'resp_abc' }, { background: true }, { conversation: 'conv_1' }]) { const r = await resp('gpt/sol', extra); assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'invalid_request'); }
  assert.equal((await resp('m/chatonly')).status, 503, 'a chat-only model is not served on the responses surface');
  assert.equal((await call('/v1/chat/completions', 'gpt/sol')).status, 503, 'and a responses-only model is not served on the chat surface');
  assert.equal((await db.query("select count(*) n from ledger_entry where kind='DEBIT_USAGE'")).rows[0].n, '2'); await clean();
});

test('customer catalogue lists only callable models with per-token credit cost and never upstream details', async () => {
  await model('gpt/luna', '2', [['RESPONSES', 'ok', 1], ['CHAT', 'ok', 2]]); await model('m/pending', '1', [['CHAT', 'ok', 1]], 'PENDING');
  await admin.post('/admin/api/models', { id: 'm/unpriced', displayName: 'x' }); await admin.post('/admin/api/models', { id: 'm/weighted', displayName: 'Berbobot' });
  const d = (await admin.post('/admin/api/models/price/draft', { id: 'm/weighted', expectedVersion: '1', multiplier: '1.25', outputRateMicro: '4000000000000', cacheReadRateMicro: '100000000000' })).json;
  await admin.post('/admin/api/models/price/publish', { id: 'm/weighted', expectedVersion: d.version, reason: 'bobot output' });
  const up = (await db.query("select upstream_id from route limit 1")).rows[0].upstream_id; await db.query("insert into route(model_id, upstream_id, protocol, upstream_model) values('m/weighted',$1,'ANTHROPIC','ok')", [up]);
  const res = await cust.get('/api/models'); const list = res.json.models;
  assert.deepEqual(list.map((m: any) => m.id), ['gpt/luna', 'm/weighted']);
  assert.deepEqual(list[0], { id: 'gpt/luna', displayName: 'gpt/luna', multiplier: '2', protocols: ['CHAT', 'RESPONSES'], creditsPerToken: { input: '2', output: '2', cacheRead: '2', cacheWrite: '2' } });
  assert.deepEqual(list[1].creditsPerToken, { input: '1.25', output: '5', cacheRead: '0.125', cacheWrite: '1.25' });
  assert.ok(!JSON.stringify(res.json).match(/127\.0\.0\.1|upstream|sk-/i)); assert.equal((await new Client(app).get('/api/models')).status, 401);
});
