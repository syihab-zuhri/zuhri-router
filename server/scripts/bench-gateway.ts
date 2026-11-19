// Gateway latency overhead benchmark: direct loopback mock upstream vs gateway pass-through.
// Usage: node scripts/bench-gateway.ts
// Measures TTFB (first body byte) and total duration for non-stream and stream at concurrencies 1, 10, 50.
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import crypto, { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createPool, withTx, type Db } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import { bootstrapAdmin } from '../src/admin.ts';
import { activateInvite, createInvite } from '../src/identity.ts';
import * as ledger from '../src/ledger.ts';
import { seal, totpAt, totpStep } from '../src/crypto.ts';
import { resetRouteHealth } from '../src/gateway.ts';

const C = 1_000_000n;
const UPKEY = 'sk-upstream-BENCH-test-000111';
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

function resolveTestDbUrl(): URL {
  const raw = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:spike_local_only@127.0.0.1:55432/router_test_antigravity';
  const parsed = new URL(raw);
  const dbName = parsed.pathname.replace(/^\/+/, '');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Database host must be loopback');
  assert.ok(dbName && dbName !== 'router_test' && dbName.includes('test'), `Refusing unsafe database '${dbName}'`);
  return parsed;
}

function startBenchMock(): Promise<{ server: http.Server; port: number }> {
  const jsonPayload = JSON.stringify({
    id: 'chatcmpl_bench',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Halo bench' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 32, completion_tokens: 8, total_tokens: 40 },
  });
  const sseChunks = [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Halo' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: ' bench' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '!' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 32, completion_tokens: 8, total_tokens: 40 } })}\n\n`,
    'data: [DONE]\n\n',
  ];

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}') as { stream?: boolean };
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(jsonPayload) });
      res.end(jsonPayload);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const chunk of sseChunks) {
      if (res.destroyed) return;
      res.write(chunk);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (!res.destroyed) res.end();
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
    });
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

type Sample = { ttfbMs: number; totalMs: number };

async function measureOne(url: string, headers: Record<string, string>, bodyStr: string): Promise<Sample> {
  const t0 = performance.now();
  const res = await fetch(url, { method: 'POST', headers, body: bodyStr });
  assert.equal(res.status, 200, `Unexpected HTTP ${res.status} from ${url}`);
  const reader = res.body!.getReader();
  const first = await reader.read();
  const ttfbMs = performance.now() - t0;
  if (!first.done) {
    while (!(await reader.read()).done) { /* drain stream/body */ }
  }
  const totalMs = performance.now() - t0;
  return { ttfbMs, totalMs };
}

async function runBatch(
  url: string,
  headers: Record<string, string>,
  bodyStr: string,
  total: number,
  concurrency: number,
): Promise<{ ttfbP50: number; ttfbP95: number; totalP50: number; totalP95: number }> {
  const samples: Sample[] = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const idx = cursor++;
      if (idx >= total) return;
      samples.push(await measureOne(url, headers, bodyStr));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const ttfbs = samples.map(s => s.ttfbMs).sort((a, b) => a - b);
  const totals = samples.map(s => s.totalMs).sort((a, b) => a - b);
  return {
    ttfbP50: percentile(ttfbs, 50),
    ttfbP95: percentile(ttfbs, 95),
    totalP50: percentile(totals, 50),
    totalP95: percentile(totals, 95),
  };
}

async function drainSettlements(db: Db) {
  for (let i = 0; i < 200; i++) {
    const active = Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n);
    const pending = Number((await db.query('select count(*) n from request where debit is null')).rows[0].n);
    if (active === 0 && pending === 0) return;
    await sleep(20);
  }
}

const fmt = (ms: number) => `${ms.toFixed(2)} ms`;

const dbUrl = resolveTestDbUrl();
const schema = `bench_gw_${randomUUID().replaceAll('-', '')}`;
const root = createPool(dbUrl.href, 4);
const encKey = crypto.randomBytes(32);

let db: Db | undefined;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let mock: { server: http.Server; port: number } | undefined;

try {
  await root.query(`create schema "${schema}"`);
  dbUrl.searchParams.set('options', `-c search_path=${schema}`);
  db = createPool(dbUrl.href, 80);
  await migrate(db);

  let inviteToken = '';
  const mailer = {
    invite: async (_to: string, token: string) => { inviteToken = token; },
    passwordReset: async () => {},
  };
  const offlineResolver = async () => ['93.184.216.34'];
  const adm = await bootstrapAdmin(db, encKey, { username: 'bench_admin', email: 'bench-admin@example.test', password: 'bench-admin-password-14' });
  await createInvite(db, { email: 'bench-cust@example.test', adminUser: adm.userId }, mailer);
  const cust = await activateInvite(db, { token: inviteToken, username: 'bench_cust', password: 'bench-customer-password-1' });
  await withTx(db, tx => ledger.grantAdminTopup(tx, {
    tenantId: cust.tenantId,
    amount: 100_000_000n * C,
    saleRef: 'BENCH-SEED',
    actorUser: adm.userId,
    idemKey: 'bench-topup-0001',
  }));

  mock = await startBenchMock();
  resetRouteHealth();

  app = await buildApp({
    db,
    key: encKey,
    mailer,
    secureCookies: false,
    resolveHost: offlineResolver,
    gateway: {
      unsafeAllowAnyUpstreamUrl: true,
      firstByteTimeoutMs: 5_000,
      idleTimeoutMs: 10_000,
      requestsPerMinutePerKey: 1_000_000,
      concurrentPerTenant: 1_000,
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
      remoteAddress: '10.9.9.2',
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
  assert.equal((await injectReq(adminCookies, '/admin/api/login', { identifier: 'bench_admin', password: 'bench-admin-password-14' })).status, 200);
  assert.equal((await injectReq(adminCookies, '/admin/api/second-factor', { code: totpAt(admSeed, step - 1n) })).status, 200);
  assert.equal((await injectReq(custCookies, '/api/auth/login', { identifier: 'bench_cust', password: 'bench-customer-password-1' })).status, 200);

  const apiKey = (await injectReq(custCookies, '/api/keys', { name: 'bench-key', idempotencyKey: 'bench-key-0001' })).json.secret as string;
  assert.equal((await injectReq(adminCookies, '/admin/api/models', { id: 'bench/chat', displayName: 'Bench Chat' })).status, 201);
  const draft = (await injectReq(adminCookies, '/admin/api/models/price/draft', { id: 'bench/chat', expectedVersion: '1', multiplier: '1' })).json;
  assert.equal((await injectReq(adminCookies, '/admin/api/models/price/publish', { id: 'bench/chat', expectedVersion: draft.version, reason: 'benchmark' })).status, 200);
  const up = (await db.query(
    'insert into upstream(name, status, base_url_chat, key_enc, key_set_at) values($1,$2,$3,$4,now()) returning id',
    ['bench-upstream', 'ELIGIBLE', `http://127.0.0.1:${mock.port}/v1`, seal(encKey, Buffer.from(UPKEY))],
  )).rows[0];
  await db.query('insert into route(model_id, upstream_id, protocol, upstream_model, priority) values($1,$2,$3,$4,1)', ['bench/chat', up.id, 'CHAT', 'bench-model']);

  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const gwUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/v1/chat/completions`;
  const directUrl = `http://127.0.0.1:${mock.port}/v1/chat/completions`;
  const directHeaders = { authorization: `Bearer ${UPKEY}`, 'content-type': 'application/json' };
  const gwHeaders = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };

  const scenarios = [
    { name: 'non-stream', stream: false },
    { name: 'stream', stream: true },
  ] as const;
  const levels = [
    { concurrency: 1, total: 40 },
    { concurrency: 10, total: 100 },
    { concurrency: 50, total: 200 },
  ] as const;

  const pgVersion = String((await db.query('select version()')).rows[0].version).split(',')[0];
  const cpus = os.cpus();
  const specs = {
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    cpu: `${cpus[0]?.model ?? 'unknown'} (${cpus.length} vCPU)`,
    ramGiB: (os.totalmem() / (1024 ** 3)).toFixed(2),
    node: process.version,
    postgres: pgVersion,
  };

  process.stdout.write(`Machine specs: OS=${specs.os} | CPU=${specs.cpu} | RAM=${specs.ramGiB} GiB | Node=${specs.node} | DB=${specs.postgres}\n\n`);
  process.stdout.write('| Mode | Concurrency | Direct TTFB p50 | Gateway TTFB p50 | Overhead TTFB p50 | Direct TTFB p95 | Gateway TTFB p95 | Overhead TTFB p95 | Direct Total p50 | Gateway Total p50 | Overhead Total p50 | Direct Total p95 | Gateway Total p95 | Overhead Total p95 |\n');
  process.stdout.write('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n');

  for (const sc of scenarios) {
    const directBody = JSON.stringify({ model: 'bench-model', stream: sc.stream, max_tokens: 64, messages: [{ role: 'user', content: 'halo benchmark' }] });
    const gwBody = JSON.stringify({ model: 'bench/chat', stream: sc.stream, max_tokens: 64, messages: [{ role: 'user', content: 'halo benchmark' }] });

    // Warmup both paths before collecting latency distributions
    await runBatch(directUrl, directHeaders, directBody, 10, 2);
    await runBatch(gwUrl, gwHeaders, gwBody, 10, 2);
    await drainSettlements(db);

    for (const lvl of levels) {
      const direct = await runBatch(directUrl, directHeaders, directBody, lvl.total, lvl.concurrency);
      const gw = await runBatch(gwUrl, gwHeaders, gwBody, lvl.total, lvl.concurrency);
      await drainSettlements(db);

      const dTtfbP50 = gw.ttfbP50 - direct.ttfbP50;
      const dTtfbP95 = gw.ttfbP95 - direct.ttfbP95;
      const dTotalP50 = gw.totalP50 - direct.totalP50;
      const dTotalP95 = gw.totalP95 - direct.totalP95;

      process.stdout.write(
        `| ${sc.name} | ${lvl.concurrency} | ${fmt(direct.ttfbP50)} | ${fmt(gw.ttfbP50)} | ${fmt(dTtfbP50)} | ${fmt(direct.ttfbP95)} | ${fmt(gw.ttfbP95)} | ${fmt(dTtfbP95)} | ${fmt(direct.totalP50)} | ${fmt(gw.totalP50)} | ${fmt(dTotalP50)} | ${fmt(direct.totalP95)} | ${fmt(gw.totalP95)} | ${fmt(dTotalP95)} |\n`,
      );
    }
  }

  assert.deepEqual(await ledger.invariantViolations(db), []);
  assert.equal(Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n), 0);
} finally {
  mock?.server.closeAllConnections();
  mock?.server.close();
  app?.server.closeAllConnections();
  await app?.close().catch(() => {});
  if (db) await db.end().catch(() => {});
  await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
  await root.end().catch(() => {});
}
