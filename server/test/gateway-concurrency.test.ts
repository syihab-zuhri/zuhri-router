// Concurrent financial stress test for the gateway against a loopback mock upstream.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPool, type Db } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import { seal } from '../src/crypto.ts';
import { resetRouteHealth } from '../src/gateway.ts';
import * as ledger from '../src/ledger.ts';
import { DB_URL, KEY, mailer, fakeResolver, makeAdmin, adminClient, makeCustomer } from './helpers.ts';

const C = 1_000_000n;
const UPKEY = 'sk-upstream-CONC-test-000111';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function startConcurrencyMock(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; max_tokens?: number };
    const mode = body.model ?? 'ok';
    const outTokens = Math.min(Number.isInteger(body.max_tokens) && body.max_tokens! > 0 ? body.max_tokens! : 20, 20);

    if (mode === 'fail500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'upstream internal error' } }));
    }
    if (mode === 'slow-first') {
      await sleep(280);
      if (req.destroyed || res.destroyed) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: outTokens, total_tokens: 40 + outTokens } }));
    }

    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      const payload: Record<string, unknown> = {
        choices: [{ index: 0, message: { role: 'assistant', content: 'halo' }, finish_reason: 'stop' }],
      };
      if (mode !== 'no-usage') {
        payload.usage = { prompt_tokens: 40, completion_tokens: outTokens, total_tokens: 40 + outTokens };
      }
      return res.end(JSON.stringify(payload));
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunks = mode === 'slow-stream' ? ['A', 'B', 'C', 'D'] : ['ok'];
    for (const part of chunks) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: part } }] })}\n\n`);
      if (mode === 'slow-stream') await sleep(35);
    }
    if (!res.destroyed) {
      const tail: Record<string, unknown> = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      if (mode !== 'no-usage') {
        tail.usage = { prompt_tokens: 40, completion_tokens: outTokens, total_tokens: 40 + outTokens };
      }
      res.write(`data: ${JSON.stringify(tail)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let base = '';
let mock: { server: http.Server; port: number };

before(async () => {
  db = createPool(DB_URL, 40);
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db);
  await db.query("update system_setting set value=0 where name='overdraft_micro'");
  mock = await startConcurrencyMock();
  app = await buildApp({
    db,
    key: KEY,
    mailer,
    secureCookies: false,
    resolveHost: fakeResolver,
    gateway: {
      unsafeAllowAnyUpstreamUrl: true,
      firstByteTimeoutMs: 120,
      idleTimeoutMs: 1_500,
      requestsPerMinutePerKey: 10_000,
      concurrentPerTenant: 200,
      authFailuresPerMinutePerIp: 500,
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  mock?.server.closeAllConnections();
  mock?.server.close();
  app?.server.closeAllConnections();
  await app?.close();
  if (db) {
    assert.equal(db.totalCount - db.idleCount, 0, 'no leaked database connections');
    await db.end();
  }
});

test('gateway keeps ledger, hold, overdraft, spend-limit, and single-debit invariants under mixed concurrent load', async () => {
  resetRouteHealth();
  const adm = await makeAdmin(db);
  const admin = await adminClient(app, adm);
  const { client: cust } = await makeCustomer(app, admin, 'stresstenant');
  const tenantId = (await db.query("select m.tenant_id from membership m join app_user u on u.id=m.user_id where u.username='stresstenant'")).rows[0].tenant_id as string;

  const overdraftCredits = 300n;
  const overdraftMicro = overdraftCredits * C;
  await db.query("update system_setting set value=$1 where name='overdraft_micro'", [String(overdraftMicro)]);

  const initialCredits = 1_600n;
  const initialPosted = initialCredits * C;
  assert.equal((await admin.post('/admin/api/topups', { username: 'stresstenant', amountTokens: String(initialCredits), saleRef: 'stress-seed', idempotencyKey: 'topup-conc-0001' })).status, 201);

  const keyA = (await cust.post('/api/keys', { name: 'unlimited-a', idempotencyKey: 'key-conc-0001' })).json.secret as string;
  const keyB = (await cust.post('/api/keys', { name: 'unlimited-b', idempotencyKey: 'key-conc-0002' })).json.secret as string;
  const spendLimitMicro = 260n * C;
  const keyLimited = (await cust.post('/api/keys', { name: 'limited-c', spendLimitMicro: String(spendLimitMicro), idempotencyKey: 'key-conc-0003' })).json.secret as string;

  async function publishRouteModel(id: string, routes: [string, number][]) {
    await admin.post('/admin/api/models', { id, displayName: id });
    const d = (await admin.post('/admin/api/models/price/draft', { id, expectedVersion: '1', multiplier: '1' })).json;
    await admin.post('/admin/api/models/price/publish', { id, expectedVersion: d.version, reason: 'uji konkurensi' });
    for (const [mode, priority] of routes) {
      const up = (await db.query(
        'insert into upstream(name, status, base_url_chat, key_enc, key_set_at) values($1,$2,$3,$4,now()) returning id',
        [`${id}-${mode}-${priority}`, 'ELIGIBLE', `http://127.0.0.1:${mock.port}/v1`, seal(KEY, Buffer.from(UPKEY))],
      )).rows[0];
      await db.query('insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,$5)', [id, up.id, 'CHAT', mode, priority]);
    }
  }

  await publishRouteModel('st/normal', [['ok', 1]]);
  await publishRouteModel('st/no-usage', [['no-usage', 1]]);
  await publishRouteModel('st/abort', [['slow-stream', 1]]);
  await publishRouteModel('st/fallback', [['fail500', 1], ['ok', 2]]);
  await publishRouteModel('st/timeout', [['slow-first', 1]]);

  type Kind = 'normal' | 'stream' | 'no_usage' | 'abort_mid' | 'fallback_500' | 'slow_timeout' | 'limited_key';
  const pattern: Kind[] = [
    'limited_key', 'fallback_500', 'normal', 'no_usage', 'stream', 'abort_mid', 'slow_timeout',
    'limited_key', 'normal', 'stream', 'fallback_500', 'normal',
  ];
  const plan: Kind[] = Array.from({ length: 60 }, (_, idx) => pattern[idx % pattern.length]);

  const promptContent = 'p '.repeat(45); // ~90 bytes -> hold ~180 credits; 2nd concurrent request on 260-limit key hits 429 limit_exceeded
  const outcomes: { kind: Kind; status: number; code: string | null; id: string | null }[] = [];

  await Promise.all(plan.map(async (kind, idx) => {
    const token = kind === 'limited_key' ? keyLimited : idx % 2 === 0 ? keyA : keyB;
    const model = kind === 'no_usage' ? 'st/no-usage' : kind === 'abort_mid' ? 'st/abort' : kind === 'fallback_500' ? 'st/fallback' : kind === 'slow_timeout' ? 'st/timeout' : 'st/normal';
    const stream = kind === 'stream' || kind === 'abort_mid' || (kind === 'fallback_500' && idx % 2 === 0);
    const ac = new AbortController();

    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream, max_tokens: 20, messages: [{ role: 'user', content: promptContent }] }),
        signal: ac.signal,
      });
      const reqId = res.headers.get('x-request-id');
      if (kind === 'abort_mid' && res.status === 200 && res.body) {
        const reader = res.body.getReader();
        await reader.read();
        ac.abort();
        await reader.cancel().catch(() => {});
        outcomes.push({ kind, status: res.status, code: null, id: reqId });
        return;
      }
      const txt = await res.text();
      let code: string | null = null;
      if (res.status >= 400) {
        try { code = JSON.parse(txt)?.error?.code ?? null; } catch { code = null; }
      }
      outcomes.push({ kind, status: res.status, code, id: reqId });
    } catch {
      outcomes.push({ kind, status: 0, code: 'client_aborted', id: null });
    }
  }));

  // Wait for async mid-stream aborts & background settle transactions to finalize.
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n);
    const pending = Number((await db.query("select count(*) n from request where debit is null")).rows[0].n);
    if (active === 0 && pending === 0) break;
    await sleep(30);
  }

  // 1. No 500s anywhere; balance rejections must use insufficient_balance (402).
  assert.equal(outcomes.filter(o => o.status === 500).length, 0, 'no request may fail with HTTP 500');
  const rejected402 = outcomes.filter(o => o.status === 402);
  assert.ok(rejected402.length > 0, 'small balance must cause 402 insufficient_balance rejections under concurrency');
  assert.ok(rejected402.every(o => o.code === 'insufficient_balance'), 'all 402 responses must return code insufficient_balance');

  // At least one limited_key request must be rejected by limit_exceeded (or 402 once balance drops), without exceeding limit.
  const limitedOutcomes = outcomes.filter(o => o.kind === 'limited_key');
  assert.ok(limitedOutcomes.some(o => o.status === 429 && o.code === 'limit_exceeded'), 'limited key must hit 429 limit_exceeded');
  const limitedRow = (await db.query("select spent, held from api_key where name='limited-c'")).rows[0];
  assert.ok(BigInt(limitedRow.spent) <= spendLimitMicro, 'limited key spent must never exceed spend_limit');
  assert.equal(BigInt(limitedRow.held), 0n, 'limited key held must be 0 after completion');

  // Slow timeout requests must release hold with 0 debit (either 503 upstream_unavailable or 402 if balance already exhausted).
  const timeoutRows = (await db.query("select state, debit from request where model_id='st/timeout'")).rows;
  for (const tr of timeoutRows) {
    assert.equal(tr.state, 'FAILED');
    assert.equal(BigInt(tr.debit), 0n);
  }

  // 2. Ledger invariants must hold with 0 violations.
  assert.deepEqual(await ledger.invariantViolations(db), []);

  // 3. Balance never below -overdraft_micro; all holds settled (0 ACTIVE holds).
  const finalBal = await ledger.getBalance(db, tenantId);
  assert.ok(finalBal.posted >= -overdraftMicro, `posted ${finalBal.posted} fell below -overdraft ${-overdraftMicro}`);
  assert.equal(finalBal.held, 0n);
  assert.equal(Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n), 0);
  assert.equal(Number((await db.query("select count(*) n from hold h join request r on r.id=h.request_id where h.status='ACTIVE' and r.debit is not null")).rows[0].n), 0);

  // 4. Total debit equals exact posted balance drop, and no request ever receives two DEBIT_USAGE entries.
  const sumReqDebit = BigInt((await db.query("select coalesce(sum(debit),0)::text s from request")).rows[0].s);
  const sumLedgerDebit = BigInt((await db.query("select coalesce(sum(-amount),0)::text s from ledger_entry where kind='DEBIT_USAGE'")).rows[0].s);
  assert.equal(initialPosted - finalBal.posted, sumReqDebit, 'balance change must equal total request debit');
  assert.equal(sumLedgerDebit, sumReqDebit, 'ledger DEBIT_USAGE sum must equal total request debit');

  const doubleDebits = (await db.query("select idem_key, count(*)::int n from ledger_entry where kind='DEBIT_USAGE' group by idem_key having count(*) > 1")).rows;
  assert.deepEqual(doubleDebits, [], 'no request may have two DEBIT_USAGE entries');

  // Verify fallback attempts: at least one fallback request recorded upstream_500 before route 2 succeeded.
  const fbAttempts = (await db.query("select count(*) n from attempt where outcome='upstream_500'")).rows[0].n;
  assert.ok(Number(fbAttempts) >= 1, 'fallback route should hit upstream_500 on priority 1 before route 2');
});
