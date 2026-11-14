import assert from 'node:assert/strict';
import { setup, makeAdmin, adminClient, makeCustomer, KEY, mailer } from '../helpers.ts';
import { buildApp } from '../../src/http/app.ts';

const { db, app: silent } = await setup();
await silent.close();
const app = await buildApp({ db, key: KEY, mailer, secureCookies: false, logger: true });
try {
  const admin = await adminClient(app, await makeAdmin(db));
  const owner = (await makeCustomer(app, admin, 'log_owner')).client;
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const created = await fetch(base + '/api/keys', { method: 'POST', headers: { 'content-type': 'application/json', 'x-router-csrf': '1', cookie: `sid=${owner.cookies.sid}` }, body: JSON.stringify({ name: 'HTTP fixture', idempotencyKey: 'http-key-create-01' }) });
  assert.equal(created.status, 201);
  const result = await created.json() as { secret: string; key: { id: string } };
  assert.match(result.secret, /^rtr_[A-Za-z0-9_-]{43}$/);
  process.send?.({ secret: result.secret });
  const list = await fetch(base + '/api/keys', { headers: { cookie: `sid=${owner.cookies.sid}` } });
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(await list.json()).includes(result.secret));
  const probe = await fetch(base + '/healthz', { headers: { 'x-api-key': result.secret, authorization: `Bearer ${result.secret}` } });
  assert.equal(probe.status, 200);
  const denied = await fetch(base + '/api/keys', { headers: { authorization: `Bearer ${result.secret}` } });
  assert.equal(denied.status, 401, 'API keys do not authorize portal operations');
} finally {
  await app.close();
  assert.equal(db.totalCount-db.idleCount,0);
  await db.end();
  process.disconnect?.();
}
