import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client, ADMIN } from './helpers.ts';
import type { Db } from '../src/db/pool.ts';

let db: Db; let app: FastifyInstance; let admin: Client; let owner: Client;
let adm: Awaited<ReturnType<typeof makeAdmin>>;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => {
  await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm);
  owner = (await makeCustomer(app, admin, 'budi')).client;
});
const input = { name: 'coding laptop', allowedModels: ['model-b', 'model-a'], spendLimitMicro: '1000000', expiresAt: null, idempotencyKey: 'create-key-test-01' };

test('key secret is revealed once, only a verifier is stored, and creation retry never reveals it again', async () => {
  const created = await owner.post('/api/keys', input);
  assert.equal(created.status, 201);
  assert.match(created.json.secret, /^rtr_[A-Za-z0-9_-]{43}$/);
  const secret: string = created.json.secret;
  const id: string = created.json.key.id;
  assert.equal(created.json.key.version, '1');
  assert.deepEqual(created.json.key.allowedModels, ['model-a', 'model-b']);
  const saved = (await db.query('select * from api_key where id=$1', [id])).rows[0];
  assert.notEqual(saved.token_hash, secret);
  assert.match(saved.token_hash, /^[0-9a-f]{64}$/);
  const listed = await owner.get('/api/keys');
  assert.equal(listed.status, 200); assert.equal(listed.json.keys.length, 1);
  assert.equal(listed.json.keys[0].maskedKey, secret.slice(0, 12) + '...');
  const detail = await owner.get(`/api/keys/${id}`);
  assert.equal(detail.status, 200);
  const retry = await owner.post('/api/keys', input);
  assert.equal(retry.status, 409); assert.equal(retry.json.error.code, 'key_already_created');
  const inspected = JSON.stringify([saved, listed.json, detail.json, retry.json, (await db.query('select * from audit_event')).rows, (await db.query('select * from idempotency_record')).rows]);
  assert.ok(!inspected.includes(secret));
  assert.ok(!JSON.stringify(listed.json).includes(saved.token_hash));
  assert.equal((await db.query("select count(*) n from audit_event where action='api_key.create'")).rows[0].n, '1');
});

test('owner can replace limits with a version check and revoke; admin sees only masked keys and revokes with step-up', async () => {
  const first = await owner.post('/api/keys', input);
  assert.equal(first.status, 201);
  const id: string = first.json.key.id;
  const limits = { name: 'renamed', allowedModels: [], spendLimitMicro: '0', expiresAt: null, expectedVersion: '1' };
  const changed = await owner.post(`/api/keys/${id}/limits`, limits);
  assert.equal(changed.status, 200); assert.equal(changed.json.key.version, '2');
  assert.deepEqual(changed.json.key.allowedModels, []);
  assert.equal((await owner.post(`/api/keys/${id}/limits`, limits)).status, 409);
  const viewed = await admin.get('/admin/api/customers/budi/keys');
  assert.equal(viewed.status, 200);
  assert.ok(!JSON.stringify(viewed.json).includes(first.json.secret));
  await db.query("update session set auth_at=now()-interval '6 minutes' where kind='ADMIN'");
  const url = `/admin/api/customers/budi/keys/${id}/revoke`;
  assert.equal((await admin.post(url, { expectedVersion: '2' })).json.error.code, 'step_up_required');
  await admin.post('/admin/api/second-factor', { code: adm.code(0) });
  const revoked = await admin.post(url, { expectedVersion: '2' });
  assert.equal(revoked.status, 200); assert.equal(revoked.json.key.status, 'REVOKED');
  assert.equal((await owner.post(`/api/keys/${id}/revoke`, { expectedVersion: '2' })).status, 409);
  assert.equal((await owner.post(`/api/keys/${id}/limits`, { ...limits, expectedVersion: '3' })).status, 409);
  const second = await owner.post('/api/keys', { ...input, idempotencyKey: 'create-key-test-02' });
  assert.equal(second.status, 201);
  assert.equal((await owner.post(`/api/keys/${second.json.key.id}/revoke`, { expectedVersion: '1' })).status, 200);
  assert.equal((await db.query("select count(*) n from audit_event where action='api_key.revoke'")).rows[0].n, '2');
});

test('foreign key IDs are indistinguishable from absent IDs and anonymous/admin cannot mint customer keys', async () => {
  const other = (await makeCustomer(app, admin, 'ani')).client;
  const created = await owner.post('/api/keys', input);
  assert.equal(created.status, 201);
  const id: string = created.json.key.id;
  const missing = '00000000-0000-4000-8000-000000000000';
  for (const suffix of ['', '/limits', '/revoke']) {
    const body = { ...input, expectedVersion: '1' };
    const foreign = suffix ? await other.post(`/api/keys/${id}${suffix}`, body) : await other.get(`/api/keys/${id}`);
    const absent = suffix ? await other.post(`/api/keys/${missing}${suffix}`, body) : await other.get(`/api/keys/${missing}`);
    assert.equal(foreign.status, 404); assert.deepEqual(foreign.json, absent.json);
  }
  assert.equal((await other.get('/api/keys')).json.keys.length, 0);
  assert.equal((await new Client(app).post('/api/keys', input)).status, 401);
  assert.equal((await admin.post('/api/keys', input)).status, 401);
  assert.equal((await owner.post('/api/keys', input, { csrf: false })).status, 403);
  const partial = new Client(app);
  await partial.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  assert.equal((await partial.get('/admin/api/customers/budi/keys')).json.error.code, 'second_factor_required');
  assert.equal((await owner.get('/admin/api/customers/budi/keys')).status, 401);
  assert.equal((await admin.post(`/admin/api/customers/ani/keys/${id}/revoke`, { expectedVersion: '1' })).status, 404);
});

test('validation rejects malformed scope, money, expiry and create keys without persisting or leaking input', async () => {
  for (const change of [
    { name: '' }, { name: 'x'.repeat(81) }, { name: 1 },
    { allowedModels: 'model-a' }, { allowedModels: ['model-a', 'model-a'] }, { allowedModels: ['\nsecret'] },
    { spendLimitMicro: 1 }, { spendLimitMicro: '-1' }, { spendLimitMicro: '1.5' }, { spendLimitMicro: '01' }, { spendLimitMicro: '9223372036854775808' },
    { expiresAt: 'yesterday' }, { expiresAt: '2020-01-01T00:00:00.000Z' }, { idempotencyKey: '' },
  ]) {
    const result = await owner.post('/api/keys', { ...input, ...change });
    assert.equal(result.status, 400);
    assert.ok(!JSON.stringify(result.json).includes('\\nsecret'));
  }
  assert.equal((await db.query('select count(*) n from api_key')).rows[0].n, '0');
});

test('expired keys cannot be renewed to bypass the active-key quota', async () => {
  const expired = await owner.post('/api/keys', input);
  assert.equal(expired.status, 201);
  await db.query("update api_key set expires_at=now()-interval '1 minute' where id=$1", [expired.json.key.id]);
  for (let i = 0; i < 10; i++) assert.equal((await owner.post('/api/keys', { name: `active ${i}`, idempotencyKey: `active-create-${i}` })).status, 201);
  const renewed = await owner.post(`/api/keys/${expired.json.key.id}/limits`, { name: 'renewed', expiresAt: null, expectedVersion: '1' });
  assert.equal(renewed.status, 409);
  assert.equal((await owner.get(`/api/keys/${expired.json.key.id}`)).json.key.status, 'EXPIRED');
});

test('parallel duplicate creation reveals one secret and parallel revoke writes one audit event', async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, () => owner.post('/api/keys', input)));
  assert.equal(responses.filter(r => r.status === 201 && typeof r.json.secret === 'string').length, 1);
  assert.equal(responses.filter(r => r.status === 409).length, 5);
  const id: string = responses.find(r => r.status === 201)!.json.key.id;
  const revoked = await Promise.all(Array.from({ length: 6 }, () => owner.post(`/api/keys/${id}/revoke`, { expectedVersion: '1' })));
  assert.equal(revoked.filter(r => r.status === 200).length, 1);
  assert.equal(revoked.filter(r => r.status === 409).length, 5);
  assert.equal((await db.query("select count(*) n from audit_event where action='api_key.revoke'")).rows[0].n, '1');
});

test('stale admin principal cannot revoke after its session is revoked', async () => {
  const created = await owner.post('/api/keys', input);
  assert.equal(created.status, 201);
  const identity = await import('../src/identity.ts');
  const keys = await import('../src/keys.ts');
  const p = await identity.authenticate(db, admin.cookies.asid, 'ADMIN', 0.5);
  assert.ok(p);
  await db.query('update session set revoked_at=now() where id=$1', [p.sessionId]);
  const tenantId = (await db.query('select tenant_id from api_key where id=$1', [created.json.key.id])).rows[0].tenant_id;
  await assert.rejects(keys.revoke(db, p, tenantId, created.json.key.id, '1'), { code: 'unauthorized' });
  assert.equal((await owner.get(`/api/keys/${created.json.key.id}`)).json.key.status, 'ACTIVE');
});

test('audit storage failure rolls back key creation, limit updates and revocation', async () => {
  await db.query(`create function reject_key_audit() returns trigger language plpgsql as $$
    begin if new.action like 'api_key.%' then raise exception 'fixture key audit unavailable'; end if; return new; end $$;
    create trigger fixture_key_audit before insert on audit_event for each row execute function reject_key_audit()`);
  try {
    assert.equal((await owner.post('/api/keys', input)).status, 500);
    assert.equal((await db.query('select count(*) n from api_key')).rows[0].n, '0');
  } finally { await db.query('drop trigger fixture_key_audit on audit_event'); }
  const created = await owner.post('/api/keys', input);
  assert.equal(created.status, 201);
  await db.query('create trigger fixture_key_audit before insert on audit_event for each row execute function reject_key_audit()');
  try {
    const id = created.json.key.id as string;
    assert.equal((await owner.post(`/api/keys/${id}/limits`, { name: 'changed', expectedVersion: '1' })).status, 500);
    assert.equal((await owner.post(`/api/keys/${id}/revoke`, { expectedVersion: '1' })).status, 500);
    const stored = (await owner.get(`/api/keys/${id}`)).json.key;
    assert.equal(stored.name, input.name); assert.equal(stored.version, '1'); assert.equal(stored.status, 'ACTIVE');
  } finally { await db.query('drop trigger fixture_key_audit on audit_event; drop function reject_key_audit()'); }
});

test('parallel creation enforces active-key quota and list pagination is stable and tenant-scoped', async () => {
  const results = await Promise.all(Array.from({ length: 14 }, (_, i) => owner.post('/api/keys', { name: `key ${i}`, idempotencyKey: `create-quota-${i}` })));
  assert.equal(results.filter(r => r.status === 201).length, 10);
  assert.equal(results.filter(r => r.status === 409 && r.json.error.code === 'key_limit_reached').length, 4);
  const ids: string[] = [];
  let url = '/api/keys?limit=3';
  do {
    const page = await owner.get(url);
    assert.equal(page.status, 200); ids.push(...page.json.keys.map((k: { id: string }) => k.id));
    if (!page.json.nextAfter) break;
    url = `/api/keys?limit=3&after=${page.json.nextAfter}`;
  } while (ids.length <= 10);
  assert.equal(new Set(ids).size, 10); assert.equal(ids.length, 10);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal((await owner.post(`/api/keys/${ids[0]}/revoke`, { expectedVersion: '1' })).status, 200);
  assert.equal((await owner.post('/api/keys', { name: 'replacement', idempotencyKey: 'create-replacement-01' })).status, 201);
});
