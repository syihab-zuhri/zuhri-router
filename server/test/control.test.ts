// TASK-018 kill switch (SCR-014) and the admin request list across customers (SCR-017), against a mock upstream.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, KEY } from './helpers.ts';
import { startMock } from './fixtures/mock-upstream.ts';
import { resetRouteHealth } from '../src/gateway.ts';
import { seal } from '../src/crypto.ts';
import * as ledger from '../src/ledger.ts';
import type { Db } from '../src/db/pool.ts';

const MOCK = 18241; const UPKEY = 'sk-upstream-CONTROL-secret-000222';
let db: Db; let app: any; let base: string; let mock: Awaited<ReturnType<typeof startMock>>;
let adm: Awaited<ReturnType<typeof makeAdmin>>; let admin: Client; let cust: Client; let apiKey: string;

before(async () => { ({ db, app } = await setup()); await app.listen({ host: '127.0.0.1', port: 0 }); base = `http://127.0.0.1:${app.server.address().port}`; mock = await startMock(MOCK); });
after(async () => { mock.server.closeAllConnections(); mock.server.close(); app.server.closeAllConnections(); await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => {
  await wipe(db); resetRouteHealth();
  await db.query("update system_setting set value=0, note=null, updated_by=null where name='gateway_paused'");
  adm = await makeAdmin(db); admin = await adminClient(app, adm);
  ({ client: cust } = await makeCustomer(app, admin, 'budi'));
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '1000000', saleRef: 'paket', idempotencyKey: 'topup-ctl-0001' });
  apiKey = (await cust.post('/api/keys', { name: 'tool', idempotencyKey: 'key-ctl-00001' })).json.secret;
});

async function model(id: string, routes: ['CHAT' | 'ANTHROPIC' | 'RESPONSES', string][]) {
  await admin.post('/admin/api/models', { id, displayName: id });
  const d = (await admin.post('/admin/api/models/price/draft', { id, expectedVersion: '1', multiplier: '1' })).json;
  await admin.post('/admin/api/models/price/publish', { id, expectedVersion: d.version, reason: 'uji kontrol' });
  let i = 0;
  for (const [protocol, mode] of routes) {
    const up = (await db.query('insert into upstream(name, status, base_url_chat, base_url_anthropic, base_url_responses, key_enc, key_set_at) values($1,$2,$3,$4,$3,$5,now()) returning id', [`${id}-${++i}`, 'ELIGIBLE', `http://127.0.0.1:${MOCK}/v1`, `http://127.0.0.1:${MOCK}/anthropic`, seal(KEY, Buffer.from(UPKEY))])).rows[0];
    await db.query('insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,1)', [id, up.id, protocol, mode]);
  }
}
const PAD = ' ' + 'kata '.repeat(2400);
const call = (path: string, m: string, key = apiKey, extra: object = {}) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: m, stream: true, max_tokens: 2000, messages: [{ role: 'user', content: 'halo PENANDA-PROMPT-KONTROL' + PAD }], input: 'halo' + PAD, ...extra }) });
async function settled(id: string) { for (let i = 0; i < 100; i++) { const r = (await db.query('select * from request where id=$1', [id])).rows[0]; if (r?.debit !== null && r?.debit !== undefined) return r; await new Promise(r => setTimeout(r, 30)); } throw new Error('not settled ' + id); }
const auditCount = async (action: string) => Number((await db.query('select count(*) n from audit_event where action=$1', [action])).rows[0].n);
const expireStepUp = () => db.query("update session set auth_at = now() - interval '6 minutes' where kind='ADMIN'");

test('kill switch: admin only, step-up and a reason required, nothing changes without them', async () => {
  assert.equal((await new Client(app).get('/admin/api/settings/gateway')).status, 401);
  assert.equal((await cust.get('/admin/api/settings/gateway')).status, 401, 'a customer session is not an admin session');
  assert.equal((await cust.post('/admin/api/settings/gateway', { paused: true, reason: 'x' })).status, 401);
  assert.deepEqual((await admin.get('/admin/api/settings/gateway')).json, { paused: false, reason: null, changedAt: null, changedBy: null });
  assert.equal((await admin.post('/admin/api/settings/gateway', { paused: true, reason: 'tanpa csrf' }, { csrf: false })).status, 403);

  await expireStepUp();
  const stale = await admin.post('/admin/api/settings/gateway', { paused: true, reason: 'step-up kedaluwarsa' });
  assert.equal(stale.status, 401); assert.equal(stale.json.error.code, 'step_up_required');
  assert.equal((await admin.get('/admin/api/settings/gateway')).json.paused, false, 'refused request changed nothing');
  assert.equal(await auditCount('setting.gateway_pause'), 0);
  assert.equal((await admin.post('/admin/api/second-factor', { code: adm.code(0) })).status, 200);

  for (const bad of [{}, { paused: 'yes' }, { paused: true }, { paused: true, reason: '   ' }, { paused: true, reason: 'x'.repeat(201) }]) {
    const r = await admin.post('/admin/api/settings/gateway', bad);
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.json.error.code, 'invalid_request');
  }
  const paused = (await admin.post('/admin/api/settings/gateway', { paused: true, reason: '  pemeliharaan database  ' })).json;
  assert.equal(paused.paused, true); assert.equal(paused.reason, 'pemeliharaan database'); assert.equal(paused.changedBy, 'founder'); assert.ok(!Number.isNaN(Date.parse(paused.changedAt)));
  assert.deepEqual((await admin.get('/admin/api/settings/gateway')).json, paused);
  assert.equal((await admin.post('/admin/api/settings/gateway', { paused: true, reason: 'pemeliharaan database' })).status, 200);
  assert.equal(await auditCount('setting.gateway_pause'), 1, 'the same state again writes no second audit event');
  const ev = (await db.query("select summary, target_id from audit_event where action='setting.gateway_pause'")).rows[0];
  assert.deepEqual(ev.summary, { reason: 'pemeliharaan database' }); assert.equal(ev.target_id, 'gateway_paused');
  assert.deepEqual((await admin.get('/admin/api/overview')).json.gateway, { paused: true, reason: 'pemeliharaan database', changedAt: paused.changedAt });

  const resumed = (await admin.post('/admin/api/settings/gateway', { paused: false })).json;
  assert.equal(resumed.paused, false); assert.equal(resumed.reason, null); assert.equal(resumed.changedBy, 'founder');
  assert.equal(await auditCount('setting.gateway_resume'), 1);
  assert.deepEqual((await db.query("select summary from audit_event where action='setting.gateway_resume'")).rows[0].summary, { previousReason: 'pemeliharaan database' });
  assert.equal((await admin.get('/admin/api/overview')).json.gateway.paused, false);
});

test('kill switch: paused gateway refuses every surface with service_paused, keeps the model list, lets admitted requests finish', async () => {
  await model('m/semua', [['CHAT', 'ok'], ['ANTHROPIC', 'ok'], ['RESPONSES', 'ok']]); await model('m/lambat', [['CHAT', 'slow']]);
  const inflight = await call('/v1/chat/completions', 'm/lambat'); assert.equal(inflight.status, 200);
  const reader = inflight.body!.getReader(); await reader.read(); // first byte reached the client before the pause
  const before = Number((await db.query('select count(*) n from request')).rows[0].n);

  assert.equal((await admin.post('/admin/api/settings/gateway', { paused: true, reason: 'insiden upstream' })).status, 200);
  for (const [path, shape] of [['/v1/chat/completions', 'openai'], ['/v1/messages', 'anthropic'], ['/v1/responses', 'openai']] as const) {
    const r = await call(path, 'm/semua'); const j = await r.json();
    assert.equal(r.status, 503, path); assert.equal(r.headers.get('retry-after'), '60', path);
    if (shape === 'anthropic') { assert.equal(j.type, 'error'); assert.equal(j.error.type, 'service_paused'); }
    else { assert.equal(j.error.code, 'service_paused'); assert.equal(j.error.type, 'service_paused'); }
  }
  assert.equal(Number((await db.query('select count(*) n from request')).rows[0].n), before, 'a paused gateway admits nothing and places no hold');
  const wrong = await call('/v1/chat/completions', 'm/semua', 'rtr_0000000000000000000000000000000000000000000');
  assert.equal(wrong.status, 401, 'the key is checked first: strangers do not learn that the service is paused');
  const models = await fetch(base + '/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
  assert.equal(models.status, 200); assert.ok((await models.json()).data.some((m: { id: string }) => m.id === 'm/semua'));

  while (!(await reader.read()).done) { /* drain the stream admitted before the pause */ }
  const r = await settled(inflight.headers.get('x-request-id')!);
  assert.equal(r.state, 'SETTLED'); assert.equal(r.estimated, false);

  assert.equal((await admin.post('/admin/api/settings/gateway', { paused: false })).status, 200);
  const again = await call('/v1/chat/completions', 'm/semua', apiKey, { stream: false });
  assert.equal(again.status, 200); await settled(again.headers.get('x-request-id')!);
  assert.deepEqual(await ledger.invariantViolations(db), []);
  assert.equal((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n, '0');
});

test('request list: admin only, newest first across customers, exact filters, validation and cursor paging', async () => {
  const ani = (await makeCustomer(app, admin, 'ani')).client;
  await admin.post('/admin/api/topups', { username: 'ani', amountTokens: '1000000', saleRef: 'paket ani', idempotencyKey: 'topup-ctl-0002' });
  const aniKey = (await ani.post('/api/keys', { name: 'kunci ani', idempotencyKey: 'key-ctl-00002' })).json.secret;
  await model('m/a', [['CHAT', 'ok']]); await model('m/b', [['CHAT', 'ok']]); await model('m/mati', [['CHAT', 'fail503']]);
  const ids: string[] = [];
  for (const [m, key] of [['m/a', apiKey], ['m/b', apiKey], ['m/a', aniKey], ['m/mati', apiKey], ['m/a', apiKey]] as const) {
    const res = await call('/v1/chat/completions', m, key, { stream: false }); assert.equal(res.status, m === 'm/mati' ? 503 : 200, m); await res.text(); ids.push(res.headers.get('x-request-id')!);
    if (m !== 'm/mati') await settled(ids[ids.length - 1]);
  }
  assert.equal((await new Client(app).get('/admin/api/requests')).status, 401);
  assert.equal((await cust.get('/admin/api/requests')).status, 401, 'a customer session is not an admin session');

  const all = (await admin.get('/admin/api/requests')).json;
  assert.equal(all.requests.length, 5); assert.equal(all.nextBefore, null);
  assert.deepEqual(all.requests.map((r: { id: string }) => r.id), [...ids].reverse(), 'newest first');
  const first = all.requests[0];
  assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'debitMicro', 'estimated', 'final', 'heldMicro', 'id', 'keyName', 'model', 'outcome', 'protocol', 'state', 'stream', 'usage', 'username'].sort());
  assert.equal(first.username, 'budi'); assert.equal(first.keyName, 'tool'); assert.equal(first.model, 'm/a'); assert.equal(first.protocol, 'CHAT'); assert.equal(first.stream, false);
  assert.equal(first.state, 'SETTLED'); assert.equal(first.final, true); assert.equal(first.outcome, 'completed'); assert.match(first.debitMicro, /^[0-9]+$/); assert.ok(first.usage);
  assert.ok(!JSON.stringify(all).includes('PENANDA-PROMPT-KONTROL'), 'metadata only, never prompt content');
  const failed = all.requests.find((r: { model: string }) => r.model === 'm/mati');
  assert.equal(failed.state, 'FAILED'); assert.equal(failed.final, true); assert.equal(failed.debitMicro, '0');

  const q = async (s: string) => (await admin.get('/admin/api/requests?' + s)).json;
  assert.deepEqual((await q('username=ani')).requests.map((r: { keyName: string }) => r.keyName), ['kunci ani']);
  assert.deepEqual((await q('username=tidakada')).requests, [], 'unknown username is an empty list, not an error');
  assert.deepEqual((await q('username=BUDI')).requests, [], 'username matches exactly');
  assert.equal((await q('state=FAILED')).requests.length, 1);
  assert.equal((await q('state=SETTLED&username=budi&model=m/a')).requests.length, 2);
  assert.equal((await q('model=m/b')).requests.length, 1);
  for (const s of ['UNRESOLVED', 'RESOLVED', 'REJECTED', 'COMPLETED']) assert.deepEqual((await q('state=' + s)).requests, [], s);
  for (const bad of ['state=bogus', 'state=settled', 'username=' + 'u'.repeat(65), 'state=SETTLED&state=FAILED']) {
    const r = await admin.get('/admin/api/requests?' + bad); assert.equal(r.status, 400, bad); assert.equal(r.json.error.code, 'invalid_request');
  }

  const page1 = await q('limit=2'); assert.equal(page1.requests.length, 2); assert.ok(page1.nextBefore);
  const page2 = await q('limit=2&before=' + encodeURIComponent(page1.nextBefore)); assert.equal(page2.requests.length, 2);
  const page3 = await q('limit=2&before=' + encodeURIComponent(page2.nextBefore)); assert.equal(page3.requests.length, 1); assert.equal(page3.nextBefore, null);
  assert.deepEqual([...page1.requests, ...page2.requests, ...page3.requests].map((r: { id: string }) => r.id), [...ids].reverse());
  assert.equal((await q('limit=500')).requests.length, 5, 'limit is capped, not refused');

  assert.equal((await admin.get('/admin/api/requests/unresolved')).status, 200, 'the unresolved queue keeps its own route');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});
