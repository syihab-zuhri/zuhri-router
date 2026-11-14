// TEST-001 (FR-001 / AC-001): versioned prices and one multiplier per model.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, ADMIN } from './helpers.ts';
import * as pricing from '../src/pricing.ts';
import { debitMicro } from '../src/money.ts';
import type { Db } from '../src/db/pool.ts';

let db: Db; let app: any; let adm: Awaited<ReturnType<typeof makeAdmin>>; let admin: Client;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm); });

const M = 1_000_000n; const ID = 'deepseek/flash';
// Synthetic fixture from BILLING_REDEEM.md section 2.3: Rp10.000 / Rp40.000 / Rp1.000 / Rp12.500 per 1M tokens, factor 1.5
const RATES = { inputRateMicro: String(10_000n * M), outputRateMicro: String(40_000n * M), cacheReadRateMicro: String(1_000n * M), cacheWriteRateMicro: String(12_500n * M), multiplier: '1.5', rateAsOf: '2026-11-14' };
const USAGE = { input: 2000, output: 1000, cacheRead: 8000, cacheWrite: 0 };
const mk = async () => (await admin.post('/admin/api/models', { id: ID, displayName: 'DeepSeek Flash' })).json;
const draft = (version: string, over: object = {}) => admin.post('/admin/api/models/price/draft', { id: ID, expectedVersion: version, ...RATES, ...over });
const publish = (version: string, c: Client = admin) => c.post('/admin/api/models/price/publish', { id: ID, expectedVersion: version, reason: 'harga awal' });
const priceRows = async () => (await db.query('select count(*) n from price_version')).rows[0].n;

test('a new model has no price and is not sellable; nothing is inherited', async () => {
  const m = await mk();
  assert.deepEqual([m.sellable, m.published, m.draft, m.version], [false, null, null, '1']);
  assert.equal(await pricing.snapshotForAdmission(db, ID), null);
  assert.equal((await admin.post('/admin/api/models', { id: ID, displayName: 'again' })).status, 409);
  for (const id of ['', ' bad', 'a b', '../x', 'x'.repeat(129), 5]) assert.equal((await admin.post('/admin/api/models', { id, displayName: 'x' })).status, 400, String(id));
});

test('draft, preview and publish: effective rates and the example charge match the documented fixture', async () => {
  await mk(); const d = (await draft('1')).json;
  assert.equal(d.sellable, false, 'a draft does not sell'); assert.equal(await pricing.snapshotForAdmission(db, ID), null);
  assert.deepEqual(d.draft.effective, { inputRateMicro: String(15_000n * M), outputRateMicro: String(60_000n * M), cacheReadRateMicro: String(1_500n * M), cacheWriteRateMicro: String(18_750n * M) });
  const pv = (await admin.post('/admin/api/models/price/preview', { id: ID, which: 'draft', usage: USAGE })).json;
  assert.equal(pv.debitMicro, String(102n * M)); // Rp68 reference x 1.5
  const p = (await publish(d.version)).json;
  assert.equal(p.sellable, true); assert.equal(p.draft, null); assert.equal(p.published.multiplier, '1.5'); assert.equal(p.published.seq, 1);
  const snap = await pricing.snapshotForAdmission(db, ID);
  assert.equal(debitMicro(USAGE, snap!.price), 102n * M);
});

test('invalid factors and rates are rejected on the server and nothing is stored', async () => {
  await mk();
  for (const multiplier of ['0', '-1', '1e2', 'NaN', 'Infinity', '', '1.23456', '0.05', '100.0001', '10000', ' 1.5', '1,5', 1.5, null]) assert.equal((await draft('1', { multiplier })).status, 400, 'multiplier ' + String(multiplier));
  const missing: any = { ...RATES }; delete missing.multiplier;
  assert.equal((await admin.post('/admin/api/models/price/draft', { id: ID, expectedVersion: '1', ...missing })).status, 400, 'an empty factor is not 1x');
  for (const over of [{ inputRateMicro: '-1' }, { outputRateMicro: '1.5' }, { inputRateMicro: 10 }, { cacheReadRateMicro: '1e9' }, { inputRateMicro: '0' }, { outputRateMicro: '0' }, { inputRateMicro: '9'.repeat(17) }, { rateAsOf: 'kemarin' }]) assert.equal((await draft('1', over)).status, 400, JSON.stringify(over));
  assert.equal(await priceRows(), '0');
  assert.equal((await admin.post('/admin/api/models/price/preview', { id: ID, which: 'draft', usage: { ...USAGE, input: -1 } })).status, 400);
});

test('requests admitted before a price change keep the old snapshot; new requests get the new version', async () => {
  await mk(); const v1 = (await publish((await draft('1')).json.version)).json;
  const admitted = await pricing.snapshotForAdmission(db, ID);
  const v2 = (await publish((await draft(v1.version, { multiplier: '2' })).json.version)).json;
  assert.equal(v2.published.seq, 2); assert.equal(v2.published.multiplier, '2');
  const fresh = await pricing.snapshotForAdmission(db, ID);
  assert.equal(debitMicro(USAGE, admitted!.price), 102n * M, 'the earlier snapshot is unchanged');
  assert.equal(debitMicro(USAGE, fresh!.price), 136n * M);
  const old = (await db.query('select status, multiplier_e4 from price_version where id=$1', [admitted!.priceVersionId])).rows[0];
  assert.deepEqual([old.status, String(old.multiplier_e4)], ['RETIRED', '15000'], 'the old version stays on record for settlement and disputes');
});

test('version conflicts fail without side effects, including concurrent publishes', async () => {
  await mk(); const d = (await draft('1')).json;
  assert.equal((await draft('1', { multiplier: '9' })).json.error.code, 'version_conflict');
  assert.equal((await admin.get('/admin/api/models?id=' + encodeURIComponent(ID))).json.draft.multiplier, '1.5');
  const rs = await Promise.all(Array.from({ length: 6 }, () => publish(d.version)));
  assert.equal(rs.filter(r => r.status === 200).length, 1); assert.ok(rs.filter(r => r.status !== 200).every(r => r.status === 409));
  assert.equal((await db.query("select count(*) n from price_version where status='PUBLISHED'")).rows[0].n, '1');
  assert.equal((await db.query("select count(*) n from audit_event where action='price.publish'")).rows[0].n, '1');
  assert.equal((await publish((await admin.get('/admin/api/models?id=' + encodeURIComponent(ID))).json.version)).json.error.code, 'no_draft');
});

test('published prices are immutable in the database; only a draft can be removed', async () => {
  await mk(); await publish((await draft('1')).json.version);
  for (const sql of ['update price_version set multiplier_e4 = 1', 'update price_version set input_rate = 1', "update price_version set status = 'DRAFT', published_at = null", 'delete from price_version'])
    await assert.rejects(db.query(sql), /immutable|cannot be deleted|violates/, sql);
  await db.query("update price_version set status='RETIRED', retired_at=now()");
  await assert.rejects(db.query("update price_version set status='PUBLISHED', retired_at=null"), /immutable/);
});

test('retire stops sales and is audited with a reason', async () => {
  await mk(); const p = (await publish((await draft('1')).json.version)).json;
  assert.equal((await admin.post('/admin/api/models/price/retire', { id: ID, expectedVersion: p.version, reason: '' })).status, 400);
  const r = (await admin.post('/admin/api/models/price/retire', { id: ID, expectedVersion: p.version, reason: 'biaya upstream naik' })).json;
  assert.equal(r.sellable, false); assert.equal(await pricing.snapshotForAdmission(db, ID), null);
  assert.equal((await admin.post('/admin/api/models/price/retire', { id: ID, expectedVersion: r.version, reason: 'lagi' })).json.error.code, 'not_published');
  const ev = (await admin.get('/admin/api/audit')).json.events.filter((e: any) => e.action.startsWith('price.') || e.action === 'model.create').map((e: any) => e.action).sort();
  assert.deepEqual(ev, ['model.create', 'price.draft_save', 'price.publish', 'price.retire']);
  const pub = (await admin.get('/admin/api/audit')).json.events.find((e: any) => e.action === 'price.publish').summary;
  assert.equal(pub.before, null); assert.match(pub.after, /x=1\.5/); assert.equal(pub.reason, 'harga awal');
});

test('customers, anonymous callers and admins without the second factor cannot read or change pricing', async () => {
  await mk(); const d = (await draft('1')).json; const { client } = await makeCustomer(app, admin, 'budi');
  const half = new Client(app, '10.7.7.7'); await half.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  for (const c of [client, new Client(app), half]) {
    assert.equal((await c.get('/admin/api/models')).status, 401);
    assert.equal((await c.post('/admin/api/models', { id: 'x/y', displayName: 'x' })).status, 401);
    assert.equal((await c.post('/admin/api/models/price/draft', { id: ID, expectedVersion: d.version, ...RATES })).status, 401);
    assert.equal((await publish(d.version, c)).status, 401);
  }
  assert.equal((await admin.post('/admin/api/models', { id: 'x/y', displayName: 'x' }, { csrf: false })).status, 403);
  assert.equal((await db.query("select count(*) n from price_version where status='PUBLISHED'")).rows[0].n, '0');
});

test('publishing and retiring need a recent second factor; drafts and reads do not', async () => {
  await mk(); const d = (await draft('1')).json;
  await db.query("update session set auth_at = now() - interval '6 minutes' where kind='ADMIN'");
  assert.equal((await publish(d.version)).json.error.code, 'step_up_required');
  assert.equal((await admin.get('/admin/api/models')).status, 200);
  const d2 = await draft(d.version, { multiplier: '1.75' }); assert.equal(d2.status, 200);
  assert.equal((await admin.post('/admin/api/second-factor', { code: adm.code(0) })).status, 200);
  assert.equal((await publish(d2.json.version)).json.published.multiplier, '1.75');
});
