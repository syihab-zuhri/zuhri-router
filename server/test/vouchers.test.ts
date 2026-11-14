// TEST-004 (issue/revoke) and TEST-005 (redeem) with token-valued codes, plus token packs.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client } from './helpers.ts';
import * as ledger from '../src/ledger.ts';
import { canonicalCode } from '../src/vouchers.ts';
import type { Db } from '../src/db/pool.ts';

let db: Db; let app: any; let adm: Awaited<ReturnType<typeof makeAdmin>>; let admin: Client;
const C = 1_000_000n;
before(async () => { ({ db, app } = await setup()); });
after(async () => { await app.close(); assert.equal(db.totalCount - db.idleCount, 0); await db.end(); });
beforeEach(async () => { await wipe(db); adm = await makeAdmin(db); admin = await adminClient(app, adm); });
let n = 0;
const issue = (over: object = {}) => admin.post('/admin/api/vouchers', { tokens: '100000000', saleRef: 'INV-' + ++n, idempotencyKey: 'issue-key-' + String(n).padStart(4, '0'), ...over });
const entries = async () => (await db.query("select count(*) n from ledger_entry where kind='GRANT_REDEEM'")).rows[0].n;

test('packs: admin sets tokens and display price; customers see only active packs; price changes do not touch balances', async () => {
  const pack = (await admin.post('/admin/api/packs', { name: 'Paket 100 Juta', tokens: '100000000', displayPriceIdr: '10000' })).json;
  const promo = (await admin.post('/admin/api/packs', { name: 'Promo Pembukaan', tokens: '150000000', displayPriceIdr: '10000', isPromo: true })).json;
  const { client } = await makeCustomer(app, admin, 'budi');
  const code = (await issue({ tokens: undefined, packId: pack.id })).json;
  assert.equal(code.voucher.amountMicro, String(100_000_000n * C)); assert.equal(code.voucher.priceIdr, '10000');
  await client.post('/api/redeem', { code: code.code });
  const upd = await admin.post('/admin/api/packs/' + pack.id, { name: 'Paket 100 Juta', tokens: '100000000', displayPriceIdr: '12000', expectedVersion: pack.version });
  assert.equal(upd.json.displayPriceIdr, '12000');
  assert.equal((await admin.post('/admin/api/packs/' + pack.id, { name: 'x', tokens: '1', displayPriceIdr: '1', expectedVersion: pack.version })).status, 409);
  await admin.post('/admin/api/packs/' + promo.id, { name: 'Promo Pembukaan', tokens: '150000000', displayPriceIdr: '10000', isPromo: true, active: false, expectedVersion: promo.version });
  const seen = (await client.get('/api/packs')).json.packs;
  assert.deepEqual(seen.map((p: any) => [p.name, p.displayPriceIdr]), [['Paket 100 Juta', '12000']]);
  assert.equal((await client.get('/api/balance')).json.postedMicro, String(100_000_000n * C), 'the balance bought earlier is unchanged');
  assert.equal((await issue({ tokens: undefined, packId: promo.id })).json.error.code, 'pack_unavailable');
  for (const b of [{ tokens: '0' }, { tokens: '-1' }, { tokens: '1.5' }, { tokens: 5 }, { displayPriceIdr: '-1' }, { name: '' }]) assert.equal((await admin.post('/admin/api/packs', { name: 'x', tokens: '1', displayPriceIdr: '1', ...b })).status, 400, JSON.stringify(b));
  assert.equal((await client.post('/admin/api/packs', { name: 'x', tokens: '1', displayPriceIdr: '1' })).status, 401);
});

test('redeem credits the token amount once and returns a receipt; the owner replay gets the same receipt', async () => {
  const { client } = await makeCustomer(app, admin, 'budi'); const v = (await issue()).json;
  assert.match(v.code, /^ZR-[A-Z2-9]{5}-[A-Z2-9]{7}-[A-Z2-9]{7}-[A-Z2-9]{7}$/);
  const r = await client.post('/api/redeem', { code: ' ' + v.code.toLowerCase().replace(/-/g, ' ') + ' ' }); // typed with spaces and lower case
  assert.equal(r.status, 200); assert.deepEqual([r.json.amountMicro, r.json.postedMicro, r.json.replayed], [String(100_000_000n * C), String(100_000_000n * C), false]);
  const again = await client.post('/api/redeem', { code: v.code });
  assert.deepEqual([again.json.redemptionId, again.json.replayed, again.json.postedMicro], [r.json.redemptionId, true, r.json.postedMicro]);
  assert.equal(again.json.entryId, r.json.entryId); assert.equal((await client.get('/api/ledger')).json.entries[0].id, r.json.entryId, 'the receipt points at the ledger entry');
  assert.equal(await entries(), '1'); assert.equal((await client.get('/api/ledger')).json.entries[0].kind, 'GRANT_REDEEM');
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('two tenants racing for one code: exactly one is credited and the loser learns nothing', async () => {
  const a = await makeCustomer(app, admin, 'budi'); const b = await makeCustomer(app, admin, 'siti'); const v = (await issue()).json;
  const rs = await Promise.all([...Array(6)].flatMap(() => [a.client.post('/api/redeem', { code: v.code }), b.client.post('/api/redeem', { code: v.code })]));
  assert.equal(await entries(), '1'); assert.equal((await db.query('select count(*) n from redemption')).rows[0].n, '1');
  const total = BigInt((await a.client.get('/api/balance')).json.postedMicro) + BigInt((await b.client.get('/api/balance')).json.postedMicro);
  assert.equal(total, 100_000_000n * C);
  const loser = rs.filter(r => r.status !== 200); assert.ok(loser.length >= 1);
  assert.ok(loser.every(r => r.status === 429 || (r.json.error.code === 'code_unusable' && !JSON.stringify(r.json).match(/budi|siti|redeemed|already|tenant/i))));
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('wrong, revoked, expired and bound-to-another codes all look the same and credit nothing', async () => {
  const a = await makeCustomer(app, admin, 'budi'); await makeCustomer(app, admin, 'siti');
  const revoked = (await issue()).json; await admin.post(`/admin/api/vouchers/${revoked.voucher.id}/revoke`, { reason: 'salah kirim' });
  const expired = (await issue({ expiresAt: new Date(Date.now() + 1500).toISOString() })).json; await new Promise(r => setTimeout(r, 1600));
  const bound = (await issue({ recipientUsername: 'siti' })).json;
  const answers = [];
  for (const code of ['ZR-AAAAA-AAAAAAA-AAAAAAA-AAAAAAA', revoked.code, expired.code, bound.code]) answers.push((await a.client.post('/api/redeem', { code })).json);
  for (const x of answers) assert.deepEqual(x, answers[0]);
  assert.equal(answers[0].error.code, 'code_unusable'); assert.equal(await entries(), '0');
  assert.equal((await admin.get('/admin/api/vouchers')).json.vouchers.find((v: any) => v.id === expired.voucher.id).status, 'EXPIRED');
});

test('invalid attempts are limited per account with Retry-After and never consume a code', async () => {
  const a = await makeCustomer(app, admin, 'budi'); const v = (await issue()).json;
  for (let i = 0; i < 5; i++) assert.equal((await a.client.post('/api/redeem', { code: 'salah-' + i })).status, 400);
  const limited = await a.client.post('/api/redeem', { code: v.code });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal((await a.client.get('/api/me')).status, 200, 'the account itself is not locked');
  await db.query('delete from rate_limit');
  assert.equal((await a.client.post('/api/redeem', { code: v.code })).status, 200, 'the code was not consumed by the limit');
});

test('issuing: replay never re-reveals the code or creates a second one; duplicate sale references are refused', async () => {
  const body = { tokens: '5000000', saleRef: 'INV-777', idempotencyKey: 'issue-key-dup1' };
  const first = await admin.post('/admin/api/vouchers', body); assert.equal(first.status, 201); assert.ok(first.json.code);
  const replay = await admin.post('/admin/api/vouchers', body);
  assert.deepEqual([replay.status, replay.json.code, replay.json.replayed, replay.json.voucher.id], [200, null, true, first.json.voucher.id]);
  assert.equal((await admin.post('/admin/api/vouchers', { ...body, idempotencyKey: 'issue-key-dup2' })).json.error.code, 'duplicate_sale_ref');
  const racing = await Promise.all([...Array(5)].map(() => admin.post('/admin/api/vouchers', { tokens: '1', saleRef: 'INV-888', idempotencyKey: 'issue-key-race' })));
  assert.equal(racing.filter(r => r.status === 201).length, 1);
  assert.equal((await db.query('select count(*) n from voucher')).rows[0].n, '2');
  await admin.post(`/admin/api/vouchers/${first.json.voucher.id}/revoke`, { reason: 'kode hilang' });
  assert.equal((await admin.post('/admin/api/vouchers', { ...body, idempotencyKey: 'issue-key-dup3' })).status, 201, 'a revoked code frees the sale reference for a replacement');
  assert.equal((await admin.post('/admin/api/vouchers', { tokens: '1000', kind: 'PROMO', saleRef: 'promo pembukaan', idempotencyKey: 'issue-key-prm1' })).json.voucher.kind, 'PROMO');
  for (const b of [{ tokens: '0' }, { tokens: '1.5' }, { saleRef: '' }, { tokens: '5', packId: '00000000-0000-4000-8000-000000000000' }, { expiresAt: '2020-01-01T00:00:00.000Z' }, { kind: 'GRATIS' }, { recipientUsername: 'nobody' }])
    assert.ok([400, 404].includes((await issue(b)).status), JSON.stringify(b));
});

test('revoke versus redeem has a single outcome; redeemed codes cannot be revoked; rows are immutable', async () => {
  const a = await makeCustomer(app, admin, 'budi');
  for (let i = 0; i < 4; i++) {
    const v = (await issue()).json;
    const [rv, rd] = await Promise.all([admin.post(`/admin/api/vouchers/${v.voucher.id}/revoke`, { reason: 'uji balapan' }), a.client.post('/api/redeem', { code: v.code })]);
    assert.notEqual(rv.status === 200, rd.status === 200, 'exactly one of revoke and redeem wins');
  }
  const v = (await issue()).json; await a.client.post('/api/redeem', { code: v.code });
  assert.equal((await admin.post(`/admin/api/vouchers/${v.voucher.id}/revoke`, { reason: 'terlambat' })).json.error.code, 'voucher_closed');
  for (const sql of ['update voucher set amount = amount * 2', "update voucher set status = 'ACTIVE', closed_at = null", 'delete from voucher', 'delete from redemption', 'update redemption set tenant_id = tenant_id'])
    await assert.rejects(db.query(sql), /immutable|terminal|cannot be deleted|append-only/, sql);
  assert.deepEqual(await ledger.invariantViolations(db), []);
});

test('codes are never stored, listed or audited; issuing needs a fresh second factor; customers cannot issue', async () => {
  const a = await makeCustomer(app, admin, 'budi'); const v = (await issue()).json; const w = (await issue()).json; await a.client.post('/api/redeem', { code: w.code });
  const list = (await admin.get('/admin/api/vouchers')).json;
  assert.equal(list.outstandingMicro, String(100_000_000n * C), 'only the unredeemed code is outstanding');
  const dump = JSON.stringify(list) + JSON.stringify((await admin.get('/admin/api/audit')).json) + JSON.stringify((await db.query('select (select json_agg(t) from voucher t) a, (select json_agg(t) from redemption t) b, (select json_agg(t) from audit_event t) c, (select json_agg(t) from ledger_entry t) d, (select json_agg(t) from idempotency_record t) e')).rows[0]);
  for (const code of [v.code, w.code]) { assert.ok(!dump.includes(code)); assert.ok(!dump.includes(canonicalCode(code)!)); assert.ok(!dump.includes(code.slice(9))); }
  assert.equal((await a.client.post('/admin/api/vouchers', { tokens: '1', saleRef: 'x', idempotencyKey: 'issue-key-cust' })).status, 401);
  assert.equal((await a.client.get('/admin/api/vouchers')).status, 401);
  assert.equal((await new Client(app).post('/api/redeem', { code: v.code })).status, 401);
  await db.query("update session set auth_at = now() - interval '6 minutes' where kind='ADMIN'");
  assert.equal((await issue()).json.error.code, 'step_up_required');
  assert.equal((await admin.post(`/admin/api/vouchers/${v.voucher.id}/revoke`, { reason: 'x y z' })).json.error.code, 'step_up_required');
  assert.equal((await db.query('select count(*) n from voucher')).rows[0].n, '2');
});

test('a top-up after overrun covers the negative balance first', async () => {
  await db.query("update system_setting set value=$1 where name='overdraft_micro'", [String(ledger.DEFAULT_OVERDRAFT_MICRO)]);
  try {
    const a = await makeCustomer(app, admin, 'budi'); const t = (await db.query("select m.tenant_id from membership m join app_user u on u.id=m.user_id where u.username='budi'")).rows[0].tenant_id;
    await a.client.post('/api/redeem', { code: (await issue({ tokens: '1000' })).json.code });
    const { withTx } = await import('../src/db/pool.ts');
    await withTx(db, tx => ledger.placeHold(tx, { tenantId: t, requestId: 'r1', amount: 300_000n * C }));
    await withTx(db, tx => ledger.settleHold(tx, { tenantId: t, requestId: 'r1', debit: 201_000n * C }));
    const r = await a.client.post('/api/redeem', { code: (await issue({ tokens: '250000' })).json.code });
    assert.equal(r.json.postedMicro, String(50_000n * C)); // 1,000 - 201,000 + 250,000
  } finally { await db.query("update system_setting set value=0 where name='overdraft_micro'"); }
});
