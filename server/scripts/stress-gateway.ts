// Concurrent financial stress script for the gateway against a loopback mock upstream.
// Usage: node scripts/stress-gateway.ts [--requests 180] [--concurrency 32]
// Requires TEST_DATABASE_URL (must target a *test* DB other than router_test, or defaults to router_test_antigravity).
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto, { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createPool, withTx } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import { bootstrapAdmin } from '../src/admin.ts';
import { activateInvite, createInvite } from '../src/identity.ts';
import * as ledger from '../src/ledger.ts';
import { seal, totpAt, totpStep } from '../src/crypto.ts';
import { resetRouteHealth } from '../src/gateway.ts';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function unbase32(s: string): Buffer {
  let bits = 0, v = 0;
  const out: number[] = [];
  for (const ch of s) {
    v = (v << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const C = 1_000_000n;
const UPKEY = 'sk-upstream-STRESS-test-000111';

function parseArgs(argv: string[]): { totalRequests: number; concurrency: number } {
  let totalRequests = 180;
  let concurrency = 32;
  const positional: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      process.stdout.write('Usage: node scripts/stress-gateway.ts [--requests <n>] [--concurrency <n>] [requests concurrency]\n');
      process.exit(0);
    } else if (a.startsWith('--requests=')) {
      totalRequests = Number(a.slice('--requests='.length));
    } else if (a === '--requests' && argv[i + 1]) {
      totalRequests = Number(argv[++i]);
    } else if (a.startsWith('--concurrency=')) {
      concurrency = Number(a.slice('--concurrency='.length));
    } else if (a === '--concurrency' && argv[i + 1]) {
      concurrency = Number(argv[++i]);
    } else if (/^\d+$/.test(a)) {
      positional.push(Number(a));
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (positional[0] !== undefined) totalRequests = positional[0];
  if (positional[1] !== undefined) concurrency = positional[1];
  if (!Number.isInteger(totalRequests) || totalRequests < 10) throw new Error('requests must be an integer >= 10');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be an integer >= 1');
  return { totalRequests, concurrency: Math.min(concurrency, totalRequests) };
}

function resolveTestDbUrl(): URL {
  const raw = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:spike_local_only@127.0.0.1:55432/router_test_antigravity';
  const parsed = new URL(raw);
  const dbName = parsed.pathname.replace(/^\/+/, '');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Database host must be loopback');
  assert.ok(dbName && dbName !== 'router_test' && dbName.includes('test'), `Refusing unsafe database '${dbName}'`);
  return parsed;
}

function startStressMock(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; max_tokens?: number };
    const mode = body.model ?? 'ok';
    const outTokens = Math.min(Number.isInteger(body.max_tokens) && body.max_tokens! > 0 ? body.max_tokens! : 20, 20);

    if (mode === 'fail500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'upstream 500 fault' } }));
    }
    if (mode === 'slow-first') {
      await sleep(240);
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
    const parts = mode === 'slow-stream' ? ['S1', 'S2', 'S3', 'S4'] : ['ok'];
    for (const part of parts) {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: part } }] })}\n\n`);
      if (mode === 'slow-stream') await sleep(30);
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

const { totalRequests, concurrency } = parseArgs(process.argv.slice(2));
const dbUrl = resolveTestDbUrl();
const schema = `stress_gw_${randomUUID().replaceAll('-', '')}`;
const root = createPool(dbUrl.href, 4);
const encKey = crypto.randomBytes(32);

let db: ReturnType<typeof createPool> | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let mock: { server: http.Server; port: number } | undefined;

try {
  await root.query(`create schema "${schema}"`);
  dbUrl.searchParams.set('options', `-c search_path=${schema}`);
  db = createPool(dbUrl.href, Math.max(40, concurrency + 16));
  await migrate(db);

  let capturedInviteToken = '';
  const mailer = {
    invite: async (_to: string, token: string) => { capturedInviteToken = token; },
    passwordReset: async () => {},
  };
  const offlineResolver = async () => ['93.184.216.34'];
  const adm = await bootstrapAdmin(db, encKey, { username: 'stress_admin', email: 'stress-admin@example.test', password: 'stress-admin-password-14' });

  const overdraftCredits = 500n;
  const overdraftMicro = overdraftCredits * C;
  await db.query("update system_setting set value=$1, updated_by=$2 where name='overdraft_micro'", [String(overdraftMicro), adm.userId]);

  await createInvite(db, { email: 'stress-cust@example.test', adminUser: adm.userId }, mailer);
  const cust = await activateInvite(db, { token: capturedInviteToken, username: 'stress_cust', password: 'stress-customer-password-1' });
  const initialCredits = 3_000n;
  const initialPosted = initialCredits * C;
  await withTx(db, tx => ledger.grantAdminTopup(tx, {
    tenantId: cust.tenantId,
    amount: initialPosted,
    saleRef: 'STRESS-TOPUP',
    actorUser: adm.userId,
    idemKey: 'stress-topup-0001',
  }));

  mock = await startStressMock();
  resetRouteHealth();

  app = await buildApp({
    db,
    key: encKey,
    mailer,
    secureCookies: false,
    resolveHost: offlineResolver,
    gateway: {
      unsafeAllowAnyUpstreamUrl: true,
      firstByteTimeoutMs: 110,
      idleTimeoutMs: 1_500,
      requestsPerMinutePerKey: 100_000,
      concurrentPerTenant: Math.max(500, concurrency * 4),
      authFailuresPerMinutePerIp: 10_000,
    },
  });

  const adminCookies: Record<string, string> = {};
  const custCookies: Record<string, string> = {};
  async function injectReq(cookies: Record<string, string>, url: string, payload?: unknown) {
    const res = await app!.inject({
      method: payload === undefined ? 'GET' : 'POST',
      url,
      payload: payload as Record<string, unknown> | undefined,
      remoteAddress: '10.9.9.1',
      cookies,
      headers: { 'x-router-csrf': '1', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    });
    for (const c of res.cookies as { name: string; value: string }[]) {
      if (c.value) cookies[c.name] = c.value;
      else delete cookies[c.name];
    }
    return { status: res.statusCode, json: res.json() as any };
  }

  const admSeed = unbase32(adm.totpSecretBase32);
  const step = totpStep(Date.now());
  assert.equal((await injectReq(adminCookies, '/admin/api/login', { identifier: 'stress_admin', password: 'stress-admin-password-14' })).status, 200);
  assert.equal((await injectReq(adminCookies, '/admin/api/second-factor', { code: totpAt(admSeed, step - 1n) })).status, 200);
  assert.equal((await injectReq(custCookies, '/api/auth/login', { identifier: 'stress_cust', password: 'stress-customer-password-1' })).status, 200);

  const key1 = (await injectReq(custCookies, '/api/keys', { name: 'stress-k1', idempotencyKey: 'stress-key-create-01' })).json.secret as string;
  const key2 = (await injectReq(custCookies, '/api/keys', { name: 'stress-k2', idempotencyKey: 'stress-key-create-02' })).json.secret as string;
  const spendLimitMicro = 300n * C;
  const keyLimited = (await injectReq(custCookies, '/api/keys', { name: 'stress-lim', spendLimitMicro: String(spendLimitMicro), idempotencyKey: 'stress-key-create-03' })).json.secret as string;

  async function publishRouteModel(id: string, routes: [string, number][]) {
    assert.equal((await injectReq(adminCookies, '/admin/api/models', { id, displayName: id })).status, 201);
    const d = (await injectReq(adminCookies, '/admin/api/models/price/draft', { id, expectedVersion: '1', multiplier: '1' })).json;
    assert.equal((await injectReq(adminCookies, '/admin/api/models/price/publish', { id, expectedVersion: d.version, reason: 'stress test' })).status, 200);
    for (const [mode, priority] of routes) {
      const up = (await db!.query(
        'insert into upstream(name, status, base_url_chat, key_enc, key_set_at) values($1,$2,$3,$4,now()) returning id',
        [`${id}-${mode}-${priority}`, 'ELIGIBLE', `http://127.0.0.1:${mock!.port}/v1`, seal(encKey, Buffer.from(UPKEY))],
      )).rows[0];
      await db!.query('insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,$5)', [id, up.id, 'CHAT', mode, priority]);
    }
  }

  await publishRouteModel('st/normal', [['ok', 1]]);
  await publishRouteModel('st/no-usage', [['no-usage', 1]]);
  await publishRouteModel('st/abort', [['slow-stream', 1]]);
  await publishRouteModel('st/fallback', [['fail500', 1], ['ok', 2]]);
  await publishRouteModel('st/timeout', [['slow-first', 1]]);

  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  type Kind = 'normal' | 'stream' | 'no_usage' | 'abort_mid' | 'fallback_500' | 'slow_timeout' | 'limited_key';
  const pattern: Kind[] = ['limited_key', 'normal', 'stream', 'fallback_500', 'no_usage', 'abort_mid', 'normal', 'limited_key', 'slow_timeout', 'stream', 'fallback_500'];
  const jobs = Array.from({ length: totalRequests }, (_, idx) => pattern[idx % pattern.length]);
  const promptContent = 's '.repeat(45);

  let cursor = 0;
  const results: { kind: Kind; status: number; code: string | null }[] = [];
  const tStart = performance.now();

  async function worker() {
    for (;;) {
      const idx = cursor++;
      if (idx >= jobs.length) return;
      const kind = jobs[idx];
      const token = kind === 'limited_key' ? keyLimited : idx % 2 === 0 ? key1 : key2;
      const model = kind === 'no_usage' ? 'st/no-usage' : kind === 'abort_mid' ? 'st/abort' : kind === 'fallback_500' ? 'st/fallback' : kind === 'slow_timeout' ? 'st/timeout' : 'st/normal';
      const stream = kind === 'stream' || kind === 'abort_mid' || (kind === 'fallback_500' && idx % 3 === 0);
      const ac = new AbortController();

      try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, stream, max_tokens: 20, messages: [{ role: 'user', content: promptContent }] }),
          signal: ac.signal,
        });
        if (kind === 'abort_mid' && res.status === 200 && res.body) {
          const reader = res.body.getReader();
          await reader.read();
          ac.abort();
          await reader.cancel().catch(() => {});
          results.push({ kind, status: res.status, code: null });
          continue;
        }
        const txt = await res.text();
        let code: string | null = null;
        if (res.status >= 400) {
          try { code = JSON.parse(txt)?.error?.code ?? null; } catch { code = null; }
        }
        results.push({ kind, status: res.status, code });
      } catch {
        results.push({ kind, status: 0, code: 'client_aborted' });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = Math.round(performance.now() - tStart);

  for (let attempt = 0; attempt < 150; attempt++) {
    const active = Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n);
    const pending = Number((await db.query("select count(*) n from request where debit is null")).rows[0].n);
    if (active === 0 && pending === 0) break;
    await sleep(30);
  }

  const violations = await ledger.invariantViolations(db);
  const finalBal = await ledger.getBalance(db, cust.tenantId);
  const activeHolds = Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n);
  const activeFinalizedHolds = Number((await db.query("select count(*) n from hold h join request r on r.id=h.request_id where h.status='ACTIVE' and (r.debit is not null or r.state in ('SETTLED','SETTLED_ESTIMATED','FAILED','CANCELLED','RESOLVED'))")).rows[0].n);
  const sumReqDebit = BigInt((await db.query('select coalesce(sum(debit),0)::text s from request')).rows[0].s);
  const sumLedgerDebit = BigInt((await db.query("select coalesce(sum(-amount),0)::text s from ledger_entry where kind='DEBIT_USAGE'")).rows[0].s);
  const doubleDebits = (await db.query("select idem_key, count(*)::int n from ledger_entry where kind='DEBIT_USAGE' group by idem_key having count(*) > 1")).rows;
  const limitedRow = (await db.query("select spent, held from api_key where name='stress-lim'")).rows[0];

  const statusCounts: Record<string, number> = {};
  for (const r of results) statusCounts[String(r.status)] = (statusCounts[String(r.status)] ?? 0) + 1;
  const http500 = results.filter(r => r.status === 500);
  const wrong402 = results.filter(r => r.status === 402 && r.code !== 'insufficient_balance');

  assert.equal(http500.length, 0, `HTTP 500 occurred: ${JSON.stringify(http500.slice(0, 5))}`);
  assert.equal(wrong402.length, 0, `Non-insufficient_balance 402: ${JSON.stringify(wrong402.slice(0, 5))}`);
  assert.ok((statusCounts['402'] ?? 0) > 0, `Expected balance exhaustion (402), got statusCounts=${JSON.stringify(statusCounts)}`);
  assert.deepEqual(violations, [], `Ledger invariant violations: ${JSON.stringify(violations)}`);
  assert.ok(finalBal.posted >= -overdraftMicro, `Posted balance ${finalBal.posted} below -overdraft ${-overdraftMicro}`);
  assert.equal(finalBal.held, 0n, `Final held ${finalBal.held} != 0`);
  assert.equal(activeHolds, 0, `Active holds remain: ${activeHolds}`);
  assert.equal(activeFinalizedHolds, 0, `Active holds on finalized requests: ${activeFinalizedHolds}`);
  assert.equal(initialPosted - finalBal.posted, sumReqDebit, 'Balance change != sum(request.debit)');
  assert.equal(sumLedgerDebit, sumReqDebit, 'sum(-DEBIT_USAGE) != sum(request.debit)');
  assert.deepEqual(doubleDebits, [], `Double debit found: ${JSON.stringify(doubleDebits)}`);
  assert.ok(BigInt(limitedRow.spent) <= spendLimitMicro, 'Limited key spent exceeded spendLimitMicro');
  assert.equal(BigInt(limitedRow.held), 0n, 'Limited key held != 0');

  process.stdout.write(
    `stress-gateway: PASS (requests=${totalRequests}, concurrency=${concurrency}, elapsedMs=${elapsedMs}, statusCounts=${JSON.stringify(statusCounts)}, initialPosted=${initialPosted}, finalPosted=${finalBal.posted}, overdraftMicro=${overdraftMicro}, totalDebit=${sumReqDebit}, invariantViolations=0)\n`,
  );
} finally {
  mock?.server.closeAllConnections();
  mock?.server.close();
  app?.server.closeAllConnections();
  await app?.close().catch(() => {});
  if (db) await db.end().catch(() => {});
  await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
  await root.end().catch(() => {});
}
