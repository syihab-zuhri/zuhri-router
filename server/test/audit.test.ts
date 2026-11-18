import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client } from './helpers.ts';
import { audit } from '../src/audit.ts';
import { withTx, type Db } from '../src/db/pool.ts';

let db: Db; let app: FastifyInstance; let admin: Client; let adminId: string;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0, 'no leaked connections'); await db.end(); });
beforeEach(async () => { await wipe(db); const a = await makeAdmin(db); adminId = a.userId; admin = await adminClient(app, a); });

test('audit list is admin-only and filters by action prefix, actor, target and cursor (SCR-018)', async () => {
  const { client } = await makeCustomer(app, admin, 'budi');
  assert.equal((await new Client(app).get('/admin/api/audit')).status, 401);
  assert.equal((await client.get('/admin/api/audit')).status, 401, 'a customer session is not an admin session');

  await withTx(db, async tx => {
    await audit(tx, { actorUser: adminId, actorKind: 'ADMIN', action: 'setting.overdraft', targetType: 'system_setting', targetId: 'overdraft_micro' });
    await audit(tx, { actorUser: adminId, actorKind: 'ADMIN', action: 'setting.gateway_pause', targetType: 'system_setting', targetId: 'gateway_paused', summary: { reason: 'uji' } });
    await audit(tx, { actorKind: 'SYSTEM', action: 'setting_x.other', targetType: 'request', targetId: 'req_1' });
    for (let i = 0; i < 55; i++) await audit(tx, { actorKind: 'SYSTEM', action: 'request.recover_release', targetType: 'request', targetId: `req_${i}` });
  });

  const settings = (await admin.get('/admin/api/audit?action=setting.')).json;
  assert.deepEqual(settings.events.map((e: any) => e.action), ['setting.gateway_pause', 'setting.overdraft'], 'prefix match; `_` in the filter is literal, not a wildcard');
  assert.equal(settings.events[0].actorUsername, 'founder', 'the actor is shown by username, not only by id');
  assert.ok(settings.events.every((e: any) => e.actorUsername !== null && e.actorUser === adminId));
  assert.equal(settings.nextBefore, null);

  const byActor = (await admin.get(`/admin/api/audit?actor=${encodeURIComponent(settings.events[0].actorUsername)}&action=setting.`)).json.events;
  assert.equal(byActor.length, 2);
  assert.equal((await admin.get('/admin/api/audit?actor=tidak-ada')).json.events.length, 0, 'unknown actor: empty list');
  const byTarget = (await admin.get('/admin/api/audit?targetType=request&targetId=req_7')).json.events;
  assert.deepEqual(byTarget.map((e: any) => [e.action, e.targetId, e.actorKind, e.actorUsername]), [['request.recover_release', 'req_7', 'SYSTEM', null]]);

  const page1 = (await admin.get('/admin/api/audit?action=request.')).json;
  assert.equal(page1.events.length, 50); assert.ok(page1.nextBefore);
  const page2 = (await admin.get(`/admin/api/audit?action=request.&before=${page1.nextBefore}`)).json;
  assert.equal(page2.events.length, 5); assert.equal(page2.nextBefore, null);
  assert.equal(new Set([...page1.events, ...page2.events].map((e: any) => e.id)).size, 55, 'pages do not overlap');

  assert.equal((await admin.get(`/admin/api/audit?action=${'x'.repeat(65)}`)).status, 400);
  assert.equal((await admin.get('/admin/api/audit?actor=a&actor=b')).status, 400, 'a repeated parameter is refused');
});
