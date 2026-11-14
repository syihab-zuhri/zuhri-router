// TASK-013 / TEST-012 (registry part): upstream registry, write-only keys, base URL guard, routes and candidate selection.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, KEY } from './helpers.ts';
import * as upstreams from '../src/upstreams.ts';
import { isPublicAddress } from '../src/netguard.ts';
import type { Db } from '../src/db/pool.ts';

let db: Db; let app: any; let adm: Awaited<ReturnType<typeof makeAdmin>>; let admin: Client;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm); });

const SECRET = 'sk-upstream-SECRET-do-not-leak-123456';
const mkUp = (over: object = {}) => admin.post('/admin/api/upstreams', { name: 'DeepSeek', baseUrls: { CHAT: 'https://api.example.test', ANTHROPIC: 'https://api.example.test/anthropic/' }, apiKey: SECRET, termsNote: 'disetujui founder', ...over });
const mkModel = async (id: string) => { await admin.post('/admin/api/models', { id, displayName: id }); };
const eligible = async (u: any) => (await admin.post(`/admin/api/upstreams/${u.id}/status`, { status: 'ELIGIBLE', expectedVersion: u.version, reason: 'keputusan founder CR-014' })).json;

test('address guard: private, loopback, link-local, metadata and mapped addresses are not public', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.5', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip']) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
});

test('unsafe base URLs are rejected and nothing is stored', async () => {
  for (const url of ['http://api.example.test', 'https://internal.example.test', 'https://mixed.example.test', 'https://meta.example.test', 'https://10.0.0.5', 'https://[::1]', 'https://localhost', 'https://user:pw@api.example.test', 'https://api.example.test?x=1', 'https://api.example.test:8443', 'https://unknown.invalid', 'ftp://api.example.test', 'api.example.test', 'https://printer.local'])
    assert.equal((await mkUp({ baseUrls: { CHAT: url } })).json.error?.code, 'base_url_rejected', url);
  assert.equal((await mkUp({ baseUrls: {} })).status, 400); assert.equal((await mkUp({ apiKey: 'short' })).status, 400); assert.equal((await mkUp({ apiKey: undefined })).status, 400);
  assert.equal((await db.query('select count(*) n from upstream')).rows[0].n, '0');
});

test('the upstream API key is write-only: sealed at rest and absent from every response, list and audit record', async () => {
  const u = (await mkUp()).json;
  assert.deepEqual([u.keySet, u.status, u.baseUrls.ANTHROPIC, u.baseUrls.RESPONSES], [true, 'PENDING', 'https://api.example.test/anthropic', null]);
  const upd = (await admin.post(`/admin/api/upstreams/${u.id}`, { name: 'DeepSeek', baseUrls: u.baseUrls, termsNote: 'catatan baru', expectedVersion: u.version })).json;
  assert.equal(upd.termsNote, 'catatan baru'); assert.equal(upd.keySetAt, u.keySetAt, 'the key is kept when URLs do not change');
  const dump = JSON.stringify([u, upd, (await admin.get('/admin/api/upstreams')).json, (await admin.get('/admin/api/audit')).json, (await db.query('select (select json_agg(t) from upstream t) a, (select json_agg(t) from audit_event t) b')).rows[0]]);
  assert.ok(!dump.includes(SECRET)); assert.ok(!dump.includes('SECRET-do-not-leak'));
  assert.equal((await mkUp()).status, 409, 'names are unique');
});

test('changing a base URL requires the API key again; version conflicts change nothing', async () => {
  const u = (await mkUp()).json; const moved = { ...u.baseUrls, CHAT: 'https://gateway.example.test/v1' };
  assert.equal((await admin.post(`/admin/api/upstreams/${u.id}`, { name: 'DeepSeek', baseUrls: moved, expectedVersion: u.version })).json.error.code, 'api_key_required');
  assert.equal((await admin.post(`/admin/api/upstreams/${u.id}`, { name: 'DeepSeek', baseUrls: { CHAT: 'https://internal.example.test' }, apiKey: SECRET, expectedVersion: u.version })).json.error.code, 'base_url_rejected');
  const ok = await admin.post(`/admin/api/upstreams/${u.id}`, { name: 'DeepSeek', baseUrls: moved, apiKey: 'sk-a-new-upstream-key-999', expectedVersion: u.version });
  assert.equal(ok.json.baseUrls.CHAT, 'https://gateway.example.test/v1');
  assert.equal((await admin.post(`/admin/api/upstreams/${u.id}`, { name: 'X', baseUrls: moved, expectedVersion: u.version })).status, 409);
  assert.equal((await admin.get('/admin/api/upstreams')).json.upstreams[0].name, 'DeepSeek');
});

test('candidates: same protocol only, eligible upstreams only, priority order, disabled routes skipped', async () => {
  const ds = await eligible((await mkUp()).json);
  const dh = await eligible((await mkUp({ name: 'Dahono', baseUrls: { CHAT: 'https://gateway.example.test/v1' }, apiKey: 'dahono-key-abcdefgh' })).json);
  const pending = (await mkUp({ name: 'Lain', baseUrls: { CHAT: 'https://lain.example.test' } })).json;
  await mkModel('deepseek/flash');
  const route = (b: object) => admin.post('/admin/api/routes', { modelId: 'deepseek/flash', protocol: 'CHAT', ...b });
  const r1 = (await route({ upstreamId: dh.id, upstreamModel: 'dahono/deepseek-v4-flash', priority: 20 })).json;
  await route({ upstreamId: ds.id, upstreamModel: 'deepseek-flash', priority: 10 });
  await route({ upstreamId: pending.id, upstreamModel: 'x', priority: 1 });
  await route({ upstreamId: ds.id, upstreamModel: 'deepseek-flash[1m]', protocol: 'ANTHROPIC' });
  assert.equal((await route({ upstreamId: dh.id, upstreamModel: 'x', protocol: 'ANTHROPIC' })).json.error.code, 'protocol_not_offered');
  assert.equal((await route({ upstreamId: ds.id, upstreamModel: 'dup' })).status, 409);
  assert.equal((await route({ upstreamId: ds.id, upstreamModel: 'x', modelId: 'tidak/ada' })).json.error.code, 'model_not_found');
  const chat = await upstreams.candidatesFor(db, KEY, 'deepseek/flash', 'CHAT');
  assert.deepEqual(chat.map(c => [c.upstreamName, c.upstreamModel, c.baseUrl]), [['DeepSeek', 'deepseek-flash', 'https://api.example.test'], ['Dahono', 'dahono/deepseek-v4-flash', 'https://gateway.example.test/v1']]);
  assert.equal(chat[0].apiKey, SECRET, 'the gateway gets the real key for the outbound call');
  assert.deepEqual((await upstreams.candidatesFor(db, KEY, 'deepseek/flash', 'ANTHROPIC')).map(c => c.upstreamName), ['DeepSeek']);
  assert.deepEqual(await upstreams.candidatesFor(db, KEY, 'deepseek/flash', 'RESPONSES'), [], 'no silent cross-protocol routing');
  await admin.post(`/admin/api/routes/${r1.id}`, { upstreamModel: r1.upstreamModel, priority: 5, enabled: false, expectedVersion: r1.version });
  assert.deepEqual((await upstreams.candidatesFor(db, KEY, 'deepseek/flash', 'CHAT')).map(c => c.upstreamName), ['DeepSeek']);
  const now = (await admin.get('/admin/api/upstreams')).json.upstreams.find((x: any) => x.id === ds.id);
  await admin.post(`/admin/api/upstreams/${ds.id}/status`, { status: 'BLOCKED', expectedVersion: now.version, reason: 'saldo upstream habis' });
  assert.deepEqual(await upstreams.candidatesFor(db, KEY, 'deepseek/flash', 'CHAT'), [], 'a blocked upstream is never used');
});

test('only an admin with a fresh second factor can change upstreams, routes or eligibility; status changes are audited', async () => {
  const u = (await mkUp()).json; await mkModel('m/x'); const { client } = await makeCustomer(app, admin, 'budi');
  for (const c of [client, new Client(app)]) {
    assert.equal((await c.get('/admin/api/upstreams')).status, 401); assert.equal((await c.get('/admin/api/routes')).status, 401);
    assert.equal((await c.post('/admin/api/upstreams', { name: 'Evil', baseUrls: { CHAT: 'https://api.example.test' }, apiKey: 'sk-evil-evil-evil' })).status, 401);
    assert.equal((await c.post(`/admin/api/upstreams/${u.id}/status`, { status: 'ELIGIBLE', expectedVersion: u.version, reason: 'x y z' })).status, 401);
  }
  assert.equal((await admin.post(`/admin/api/upstreams/${u.id}/status`, { status: 'ELIGIBLE', expectedVersion: u.version, reason: '' })).status, 400);
  await db.query("update session set auth_at = now() - interval '6 minutes' where kind='ADMIN'");
  for (const r of [await mkUp({ name: 'B' }), await admin.post(`/admin/api/upstreams/${u.id}/status`, { status: 'ELIGIBLE', expectedVersion: u.version, reason: 'x y z' }), await admin.post('/admin/api/routes', { modelId: 'm/x', upstreamId: u.id, protocol: 'CHAT', upstreamModel: 'x' })]) assert.equal(r.json.error.code, 'step_up_required');
  assert.equal((await admin.get('/admin/api/upstreams')).status, 200);
  await admin.post('/admin/api/second-factor', { code: adm.code(0) }); await eligible(u);
  const ev = (await admin.get('/admin/api/audit')).json.events.find((e: any) => e.action === 'upstream.status');
  assert.deepEqual([ev.summary.from, ev.summary.to, ev.summary.reason], ['PENDING', 'ELIGIBLE', 'keputusan founder CR-014']);
});
