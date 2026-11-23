// Gateway latency overhead & DB query breakdown benchmark: direct loopback mock upstream vs gateway pass-through.
// Usage:
//   node scripts/bench-gateway.ts                     (full NFR-002 matrix: tenants=1 vs tenants=concurrency for c=1,10,50 + c=1 DB breakdown)
//   node scripts/bench-gateway.ts --tenants 20        (custom tenant count across c=1,10,50 + c=1 DB breakdown)
//   node scripts/bench-gateway.ts --pool-max 20       (override pg.Pool max connections; default 80)
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import crypto, { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { createPool, withTx, type Db } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import { bootstrapAdmin } from '../src/admin.ts';
import * as ledger from '../src/ledger.ts';
import { newToken, seal, tokenHash, totpAt, totpStep } from '../src/crypto.ts';
import { resetRouteHealth } from '../src/gateway.ts';

const C = 1_000_000n;
const UPKEY = 'sk-upstream-BENCH-test-000111';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function parseArgs(argv: string[]): { tenantsArg: number | null; poolMax: number; poolSweep: boolean; repeats: number } {
  let tenantsArg: number | null = null;
  let poolMax = 80;
  let poolSweep = false;
  let repeats = 3;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tenants') {
      const next = argv[++i];
      assert.ok(next && /^[1-9][0-9]*$/.test(next), `--tenants requires a positive integer (got '${next ?? ''}')`);
      tenantsArg = Number(next);
    } else if (arg.startsWith('--tenants=')) {
      const val = arg.slice('--tenants='.length);
      assert.ok(/^[1-9][0-9]*$/.test(val), `--tenants requires a positive integer (got '${val}')`);
      tenantsArg = Number(val);
    } else if (arg === '--pool-max') {
      const next = argv[++i];
      assert.ok(next && /^[1-9][0-9]*$/.test(next), `--pool-max requires a positive integer (got '${next ?? ''}')`);
      poolMax = Number(next);
    } else if (arg.startsWith('--pool-max=')) {
      const val = arg.slice('--pool-max='.length);
      assert.ok(/^[1-9][0-9]*$/.test(val), `--pool-max requires a positive integer (got '${val}')`);
      poolMax = Number(val);
    } else if (arg === '--pool-sweep') {
      poolSweep = true;
    } else if (arg === '--repeats') {
      const next = argv[++i];
      assert.ok(next && /^[1-9][0-9]*$/.test(next), `--repeats requires a positive integer (got '${next ?? ''}')`);
      repeats = Number(next);
    } else if (arg.startsWith('--repeats=')) {
      const val = arg.slice('--repeats='.length);
      assert.ok(/^[1-9][0-9]*$/.test(val), `--repeats requires a positive integer (got '${val}')`);
      repeats = Number(val);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { tenantsArg, poolMax, poolSweep, repeats };
}

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

function normalizeSql(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : (typeof raw === 'object' && raw !== null && 'text' in raw ? String((raw as { text: unknown }).text) : '');
  return text.replace(/\s+/g, ' ').trim();
}

type QueryEvent = {
  via: 'pool.query' | 'tx.connect' | 'tx.query';
  txId: number | null;
  sql: string;
  connectWaitMs: number;
  queryMs: number;
};

type TraceState = {
  enabled: boolean;
  nextTxId: number;
  events: QueryEvent[];
  poolWaitSamples: number[] | null;
};

function instrumentPool(rawDb: Db, trace: TraceState): Db {
  return new Proxy(rawDb, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return async (...args: unknown[]) => {
          if (!trace.enabled) {
            if (!trace.poolWaitSamples) return (target.query as (...a: unknown[]) => Promise<unknown>)(...args);
            const tConn0 = performance.now();
            const client = await target.connect();
            trace.poolWaitSamples.push(performance.now() - tConn0);
            try {
              return await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
            } finally {
              client.release();
            }
          }
          const sql = normalizeSql(args[0]);
          const tConn0 = performance.now();
          const client = await target.connect();
          const connectWaitMs = performance.now() - tConn0;
          try {
            const tQ0 = performance.now();
            const res = await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
            const queryMs = performance.now() - tQ0;
            trace.events.push({ via: 'pool.query', txId: null, sql, connectWaitMs, queryMs });
            return res;
          } finally {
            client.release();
          }
        };
      }
      if (prop === 'connect') {
        return async (...args: unknown[]) => {
          if (!trace.enabled || args.length > 0) {
            if (!trace.poolWaitSamples || args.length > 0) {
              return (target.connect as (...a: unknown[]) => Promise<pg.PoolClient>)(...args);
            }
            const tConn0 = performance.now();
            const client = await target.connect();
            trace.poolWaitSamples.push(performance.now() - tConn0);
            return client;
          }
          const tConn0 = performance.now();
          const client = await target.connect();
          const connectWaitMs = performance.now() - tConn0;
          const txId = ++trace.nextTxId;
          trace.events.push({ via: 'tx.connect', txId, sql: '[pool.connect]', connectWaitMs, queryMs: 0 });
          return new Proxy(client, {
            get(cTarget, cProp, cReceiver) {
              if (cProp === 'query') {
                return async (...qArgs: unknown[]) => {
                  const sql = normalizeSql(qArgs[0]);
                  const tQ0 = performance.now();
                  const res = await (cTarget.query as (...a: unknown[]) => Promise<unknown>)(...qArgs);
                  const queryMs = performance.now() - tQ0;
                  trace.events.push({ via: 'tx.query', txId, sql, connectWaitMs: 0, queryMs });
                  return res;
                };
              }
              const value = Reflect.get(cTarget, cProp, cReceiver);
              return typeof value === 'function' ? value.bind(cTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

type Category = 'Autentikasi key' | 'Admission' | 'Settlement' | 'Pembaruan lain';

function classifyRequestEvents(events: QueryEvent[]): {
  txRoles: Map<number, Category>;
  rows: Array<{ category: Category; sql: string; queryMs: number; connectWaitMs: number; isQuery: boolean }>;
} {
  const txSqls = new Map<number, string[]>();
  for (const ev of events) {
    if (ev.txId !== null && ev.via === 'tx.query') {
      const list = txSqls.get(ev.txId) ?? [];
      list.push(ev.sql.toLowerCase());
      txSqls.set(ev.txId, list);
    }
  }
  const txRoles = new Map<number, Category>();
  for (const [txId, sqls] of txSqls.entries()) {
    const joined = sqls.join('\n');
    if (
      joined.includes('insert into hold')
      || joined.includes('insert into request')
      || joined.includes('with h as (insert into hold')
    ) {
      txRoles.set(txId, 'Admission');
    } else if (
      joined.includes('insert into ledger_entry')
      || joined.includes('update hold')
      || joined.includes('with k as (update api_key')
      || (joined.includes('with t as (insert into attempt') && joined.includes('update request'))
    ) {
      txRoles.set(txId, 'Settlement');
    } else {
      txRoles.set(txId, 'Pembaruan lain');
    }
  }

  const rows = events.map(ev => {
    const low = ev.sql.toLowerCase();
    let category: Category;
    if (ev.txId !== null) {
      category = txRoles.get(ev.txId) ?? 'Pembaruan lain';
    } else if (low.startsWith('select') && low.includes('from api_key')) {
      category = 'Autentikasi key';
    } else if (low.includes('from system_setting') && low.includes('gateway_paused')) {
      category = 'Autentikasi key';
    } else if (low.includes('from route') || low.includes('from model') || low.includes('from price_version') || low.includes('from upstream') || low.includes('from system_setting')) {
      category = 'Admission';
    } else if (low.startsWith('update api_key set last_used_at')) {
      category = 'Pembaruan lain';
    } else if (low.includes('update request') && (low.includes('debit') || low.includes('settled'))) {
      category = 'Settlement';
    } else {
      category = 'Pembaruan lain';
    }
    return {
      category,
      sql: ev.sql,
      queryMs: ev.queryMs,
      connectWaitMs: ev.connectWaitMs,
      isQuery: ev.via !== 'tx.connect',
    };
  });

  return { txRoles, rows };
}

function summarizeSql(sql: string): string {
  const low = sql.toLowerCase();
  if (low.startsWith('with h as (insert into hold')) {
    return 'CTE[admission hold+ledger_account+api_key]: with h as (insert into hold...), a as (update ledger_account...), k as (update api_key...)';
  }
  if (low.startsWith('with k as (update api_key') && low.includes('insert into ledger_entry')) {
    return 'CTE[settlement api_key+ledger_entry+ledger_account+hold]: with k as (update api_key...), e as (insert into ledger_entry...), a as (update ledger_account...), h as (update hold...)';
  }
  if (low.startsWith('with t as (insert into attempt') && low.includes('update request')) {
    return 'CTE[settlement attempt+request]: with t as (insert into attempt...) update request set state=$2, debit=$3, ...';
  }
  if (low.startsWith('select k.id,') && low.includes('from api_key k join tenant t')) {
    if (low.includes('gateway_paused')) return 'select k.*, t.status, (select value from system_setting gateway_paused) from api_key k join tenant t where k.token_hash=$1';
    if (low.includes('for update of k')) return 'select k.*, t.status from api_key k join tenant t where k.token_hash=$1 for update of k';
    return 'select k.*, t.status from api_key k join tenant t where k.token_hash=$1 (tanpa lock)';
  }
  return sql.length > 125 ? `${sql.slice(0, 122)}...` : sql;
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
  headersList: Record<string, string>[],
  bodyStr: string,
  total: number,
  concurrency: number,
): Promise<{ ttfbP50: number; ttfbP95: number; totalP50: number; totalP95: number }> {
  assert.ok(headersList.length > 0, 'headersList must not be empty');
  const samples: Sample[] = [];
  async function worker(workerIdx: number) {
    for (let i = workerIdx; i < total; i += concurrency) {
      const headers = headersList[i % headersList.length];
      samples.push(await measureOne(url, headers, bodyStr));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));
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
  for (let i = 0; i < 400; i++) {
    const active = Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n);
    const pending = Number((await db.query('select count(*) n from request where debit is null')).rows[0].n);
    if (active === 0 && pending === 0) return;
    await sleep(10);
  }
  throw new Error('Timed out waiting for settlements to drain');
}

async function seedBenchTenants(db: Db, adminUserId: string, count: number): Promise<string[]> {
  const keys: string[] = [];
  const dummyPasswordHash = '$bench$unused-password-hash';
  for (let i = 1; i <= count; i++) {
    const username = `bench_t${String(i).padStart(3, '0')}`;
    const email = `${username}@example.test`;
    const secret = 'rtr_' + newToken();
    const creationKey = `bench-seed-key-${String(i).padStart(4, '0')}`;
    await withTx(db, async tx => {
      const user = (await tx.query(
        "insert into app_user(username, email, password_hash, role) values($1,$2,$3,'CUSTOMER') returning id",
        [username, email, dummyPasswordHash],
      )).rows[0];
      const tenant = (await tx.query('insert into tenant default values returning id')).rows[0];
      await tx.query("insert into membership(user_id, tenant_id, role) values($1,$2,'OWNER')", [user.id, tenant.id]);
      await ledger.createAccount(tx, tenant.id);
      await ledger.grantAdminTopup(tx, {
        tenantId: tenant.id,
        amount: 100_000_000n * C,
        saleRef: `BENCH-SEED-${String(i).padStart(4, '0')}`,
        actorUser: adminUserId,
        idemKey: `bench-topup-${String(i).padStart(4, '0')}`,
      });
      await tx.query(
        'insert into api_key(tenant_id, name, prefix, token_hash, creation_key_hash) values($1,$2,$3,$4,$5)',
        [tenant.id, `bench-key-${i}`, secret.slice(0, 12), tokenHash(secret), tokenHash(creationKey)],
      );
    });
    keys.push(secret);
  }
  return keys;
}

const fmt = (ms: number) => `${ms.toFixed(2)} ms`;
const medianOf = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const rangeOf = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return `${fmt(s[0])} .. ${fmt(s[s.length - 1])}`;
};
const { tenantsArg, poolMax, poolSweep, repeats } = parseArgs(process.argv.slice(2));
const maxTenants = poolSweep ? 50 : (tenantsArg === null ? 50 : Math.max(1, tenantsArg));

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
  db = createPool(dbUrl.href, poolMax);
  await migrate(db);

  const mailer = {
    invite: async () => {},
    passwordReset: async () => {},
  };
  const offlineResolver = async () => ['93.184.216.34'];
  const adm = await bootstrapAdmin(db, encKey, {
    username: 'bench_admin',
    email: 'bench-admin@example.test',
    password: 'bench-admin-password-14',
  });
  const tenantKeys = await seedBenchTenants(db, adm.userId, maxTenants);

  mock = await startBenchMock();
  resetRouteHealth();

  const trace: TraceState = { enabled: false, nextTxId: 0, events: [], poolWaitSamples: null };
  const appDb = instrumentPool(db, trace);

  app = await buildApp({
    db: appDb,
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
  const directHeaders = [{ authorization: `Bearer ${UPKEY}`, 'content-type': 'application/json' }];
  const gwHeadersAll = tenantKeys.map(k => ({ authorization: `Bearer ${k}`, 'content-type': 'application/json' }));

  const scenarios = [
    { name: 'non-stream', stream: false },
    { name: 'stream', stream: true },
  ] as const;

  const matrixLevels = tenantsArg === null
    ? [
      { concurrency: 1, tenants: 1, total: 40 },
      { concurrency: 10, tenants: 1, total: 100 },
      { concurrency: 10, tenants: 10, total: 100 },
      { concurrency: 50, tenants: 1, total: 200 },
      { concurrency: 50, tenants: 50, total: 200 },
    ]
    : [
      { concurrency: 1, tenants: tenantsArg, total: 40 },
      { concurrency: 10, tenants: tenantsArg, total: 100 },
      { concurrency: 50, tenants: tenantsArg, total: 200 },
    ];

  const pgVersion = String((await db.query('select version()')).rows[0].version).split(',')[0];
  const cpus = os.cpus();
  const specs = {
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    cpu: `${cpus[0]?.model ?? 'unknown'} (${cpus.length} vCPU)`,
    ramGiB: (os.totalmem() / (1024 ** 3)).toFixed(2),
    node: process.version,
    postgres: pgVersion,
  };

  if (poolSweep) {
    const poolSizes = [20, 40, 80] as const;
    const sweepLevels = [
      { concurrency: 20, tenants: 20, total: 120 },
      { concurrency: 30, tenants: 30, total: 150 },
      { concurrency: 50, tenants: 50, total: 200 },
    ] as const;

    type SweepRecord = {
      mode: string;
      concurrency: number;
      tenants: number;
      poolSize: number;
      overheadP95Runs: number[];
      poolWaitAvgRuns: number[];
    };
    const records: SweepRecord[] = [];

    process.stdout.write(`Machine specs: OS=${specs.os} | CPU=${specs.cpu} | RAM=${specs.ramGiB} GiB | Node=${specs.node} | DB=${specs.postgres} | SweepPools=${poolSizes.join(',')} | Repeats=${repeats}\n\n`);

    for (const poolSize of poolSizes) {
      const sweepDb = createPool(dbUrl.href, poolSize);
      const sweepTrace: TraceState = { enabled: false, nextTxId: 0, events: [], poolWaitSamples: null };
      const sweepApp = await buildApp({
        db: instrumentPool(sweepDb, sweepTrace),
        key: encKey,
        mailer,
        secureCookies: false,
        resolveHost: offlineResolver,
        gateway: {
          unsafeAllowAnyUpstreamUrl: true,
          firstByteTimeoutMs: 10_000,
          idleTimeoutMs: 15_000,
          requestsPerMinutePerKey: 1_000_000,
          concurrentPerTenant: 1_000,
          authFailuresPerMinutePerIp: 10_000,
        },
      });
      try {
        await sweepApp.listen({ host: '127.0.0.1', port: 0 });
        const sAddr = sweepApp.server.address();
        const sweepGwUrl = `http://127.0.0.1:${typeof sAddr === 'object' && sAddr ? sAddr.port : 0}/v1/chat/completions`;

        for (const sc of scenarios) {
          const directBody = JSON.stringify({ model: 'bench-model', stream: sc.stream, max_tokens: 64, messages: [{ role: 'user', content: 'halo benchmark' }] });
          const gwBody = JSON.stringify({ model: 'bench/chat', stream: sc.stream, max_tokens: 64, messages: [{ role: 'user', content: 'halo benchmark' }] });

          // Warmup direct & gateway pool before repeating measurements
          await runBatch(directUrl, directHeaders, directBody, 20, 4);
          await runBatch(sweepGwUrl, gwHeadersAll, gwBody, 50, Math.min(poolSize, 20));
          await drainSettlements(db);

          for (const lvl of sweepLevels) {
            const sliceHeaders = gwHeadersAll.slice(0, lvl.tenants);
            const overheadP95Runs: number[] = [];
            const poolWaitAvgRuns: number[] = [];

            for (let rep = 0; rep < repeats; rep++) {
              const direct = await runBatch(directUrl, directHeaders, directBody, lvl.total, lvl.concurrency);
              const waits: number[] = [];
              sweepTrace.poolWaitSamples = waits;
              const gw = await runBatch(sweepGwUrl, sliceHeaders, gwBody, lvl.total, lvl.concurrency);
              await drainSettlements(db);
              sweepTrace.poolWaitSamples = null;

              overheadP95Runs.push(gw.ttfbP95 - direct.ttfbP95);
              poolWaitAvgRuns.push(waits.reduce((s, v) => s + v, 0) / Math.max(1, lvl.total));
            }

            records.push({
              mode: sc.name,
              concurrency: lvl.concurrency,
              tenants: lvl.tenants,
              poolSize,
              overheadP95Runs,
              poolWaitAvgRuns,
            });
          }
        }
      } finally {
        sweepApp.server.closeAllConnections();
        await sweepApp.close().catch(() => {});
        await sweepDb.end().catch(() => {});
      }
    }

    process.stdout.write('| Mode | Concurrency / Tenants | PoolMax | Overhead TTFB p95 (median) | Overhead TTFB p95 (range) | Overhead TTFB p95 (3 runs) | PoolWait/req avg (median) | PoolWait/req avg (range) | PoolWait/req avg (3 runs) |\n');
    process.stdout.write('|---|---|---:|---:|---:|---|---:|---:|---|\n');
    for (const sc of scenarios) {
      for (const lvl of sweepLevels) {
        for (const poolSize of poolSizes) {
          const rec = records.find(r => r.mode === sc.name && r.concurrency === lvl.concurrency && r.poolSize === poolSize)!;
          process.stdout.write(
            `| ${rec.mode} | c=${rec.concurrency}/t=${rec.tenants} | ${rec.poolSize} | ${fmt(medianOf(rec.overheadP95Runs))} | ${rangeOf(rec.overheadP95Runs)} | ${rec.overheadP95Runs.map(fmt).join(' / ')} | ${fmt(medianOf(rec.poolWaitAvgRuns))} | ${rangeOf(rec.poolWaitAvgRuns)} | ${rec.poolWaitAvgRuns.map(fmt).join(' / ')} |\n`,
          );
        }
      }
    }

    assert.deepEqual(await ledger.invariantViolations(db), []);
    assert.equal(Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n), 0);
  } else {
    process.stdout.write(`Machine specs: OS=${specs.os} | CPU=${specs.cpu} | RAM=${specs.ramGiB} GiB | Node=${specs.node} | DB=${specs.postgres} | PoolMax=${poolMax}\n\n`);
    process.stdout.write('| Mode | Concurrency | Tenants | Direct TTFB p50 | Gateway TTFB p50 | Overhead TTFB p50 | Direct TTFB p95 | Gateway TTFB p95 | Overhead TTFB p95 | Direct Total p50 | Gateway Total p50 | Overhead Total p50 | Direct Total p95 | Gateway Total p95 | Overhead Total p95 | PoolWait/req avg | PoolWait/acq p95 | PoolWait/acq max |\n');
    process.stdout.write('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n');

    for (const sc of scenarios) {
      const directBody = JSON.stringify({ model: 'bench-model', stream: sc.stream, max_tokens: 64, messages: [{ role: 'user', content: 'halo benchmark' }] });
      const gwBody = JSON.stringify({ model: 'bench/chat', stream: sc.stream, max_tokens: 64, messages: [{ role: 'user', content: 'halo benchmark' }] });

      // Warmup both paths and all tenant keys before collecting latency distributions
      await runBatch(directUrl, directHeaders, directBody, 10, 2);
      await runBatch(gwUrl, gwHeadersAll, gwBody, Math.max(10, Math.min(maxTenants, 50)), Math.min(10, maxTenants));
      await drainSettlements(db);

      const directCache = new Map<number, Awaited<ReturnType<typeof runBatch>>>();
      for (const lvl of matrixLevels) {
        let direct = directCache.get(lvl.concurrency);
        if (!direct) {
          direct = await runBatch(directUrl, directHeaders, directBody, lvl.total, lvl.concurrency);
          directCache.set(lvl.concurrency, direct);
        }
        const sliceHeaders = gwHeadersAll.slice(0, lvl.tenants);
        const waits: number[] = [];
        trace.poolWaitSamples = waits;
        const gw = await runBatch(gwUrl, sliceHeaders, gwBody, lvl.total, lvl.concurrency);
        await drainSettlements(db);
        trace.poolWaitSamples = null;

        const sortedWaits = [...waits].sort((a, b) => a - b);
        const poolWaitPerReqAvg = waits.reduce((s, v) => s + v, 0) / Math.max(1, lvl.total);
        const poolWaitAcqP95 = percentile(sortedWaits, 95);
        const poolWaitAcqMax = sortedWaits.length > 0 ? sortedWaits[sortedWaits.length - 1] : 0;

        const dTtfbP50 = gw.ttfbP50 - direct.ttfbP50;
        const dTtfbP95 = gw.ttfbP95 - direct.ttfbP95;
        const dTotalP50 = gw.totalP50 - direct.totalP50;
        const dTotalP95 = gw.totalP95 - direct.totalP95;

        process.stdout.write(
          `| ${sc.name} | ${lvl.concurrency} | ${lvl.tenants} | ${fmt(direct.ttfbP50)} | ${fmt(gw.ttfbP50)} | ${fmt(dTtfbP50)} | ${fmt(direct.ttfbP95)} | ${fmt(gw.ttfbP95)} | ${fmt(dTtfbP95)} | ${fmt(direct.totalP50)} | ${fmt(gw.totalP50)} | ${fmt(dTotalP50)} | ${fmt(direct.totalP95)} | ${fmt(gw.totalP95)} | ${fmt(dTotalP95)} | ${fmt(poolWaitPerReqAvg)} | ${fmt(poolWaitAcqP95)} | ${fmt(poolWaitAcqMax)} |\n`,
        );
      }
    }

    // ---- Concurrency=1 DB query breakdown ----
    const profileSamples = 20;
    process.stdout.write(`\n### Rincian waktu database pada konkurensi 1 (rata-rata ${profileSamples} request berurutan)\n\n`);

    const categories: Category[] = ['Autentikasi key', 'Admission', 'Settlement', 'Pembaruan lain'];
    for (const sc of scenarios) {
      const gwBody = JSON.stringify({ model: 'bench/chat', stream: sc.stream, max_tokens: 64, messages: [{ role: 'user', content: 'halo benchmark' }] });
      const reqWallTotals: number[] = [];
      const reqTtfbs: number[] = [];
      const reqQueryCounts: number[] = [];
      const reqDbTotals: number[] = [];
      const reqPoolWaits: number[] = [];
      const reqTxCounts: number[] = [];

      const catStats = new Map<Category, { queries: number; dbMs: number; poolWaitMs: number }>();
      for (const c of categories) catStats.set(c, { queries: 0, dbMs: 0, poolWaitMs: 0 });
      const sqlStats = new Map<string, { category: Category; count: number; totalMs: number }>();

      for (let i = 0; i < profileSamples; i++) {
        trace.events = [];
        trace.enabled = true;
        const sample = await measureOne(gwUrl, gwHeadersAll[0], gwBody);
        await drainSettlements(db);
        // Small settle margin for fire-and-forget updates (e.g., api_key.last_used_at)
        await sleep(5);
        trace.enabled = false;

        const { txRoles, rows } = classifyRequestEvents(trace.events);
        const qCount = rows.filter(r => r.isQuery).length;
        const dbMs = rows.reduce((s, r) => s + r.queryMs, 0);
        const waitMs = rows.reduce((s, r) => s + r.connectWaitMs, 0);

        reqWallTotals.push(sample.totalMs);
        reqTtfbs.push(sample.ttfbMs);
        reqQueryCounts.push(qCount);
        reqDbTotals.push(dbMs);
        reqPoolWaits.push(waitMs);
        reqTxCounts.push(txRoles.size);

        for (const r of rows) {
          const cs = catStats.get(r.category)!;
          cs.poolWaitMs += r.connectWaitMs;
          if (r.isQuery) {
            cs.queries += 1;
            cs.dbMs += r.queryMs;
            const key = `${r.category}::${r.sql}`;
            const ss = sqlStats.get(key) ?? { category: r.category, count: 0, totalMs: 0 };
            ss.count += 1;
            ss.totalMs += r.queryMs;
            sqlStats.set(key, ss);
          }
        }
      }

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
      const avgQueries = avg(reqQueryCounts);
      const avgTx = avg(reqTxCounts);
      const avgDbMs = avg(reqDbTotals);
      const avgWaitMs = avg(reqPoolWaits);
      const avgTtfb = avg(reqTtfbs);
      const avgWall = avg(reqWallTotals);
      const nonDbMs = Math.max(0, avgWall - avgDbMs - avgWaitMs);

      process.stdout.write(
        `#### Mode: \`${sc.name}\`\n`
        + `- Rata-rata per request: **${avgQueries.toFixed(1)} query** (${avgTx.toFixed(1)} transaksi \`withTx\`) | TTFB ${fmt(avgTtfb)} | Total ${fmt(avgWall)} | Total waktu DB ${fmt(avgDbMs)} | Tunggu koneksi pool ${fmt(avgWaitMs)} | Non-DB (HTTP/upstream/JS) ${fmt(nonDbMs)}\n\n`,
      );
      process.stdout.write('| Bagian | Query / req | Total waktu DB / req | Tunggu pool / req | Porsi waktu DB |\n');
      process.stdout.write('|---|---:|---:|---:|---:|\n');
      for (const c of categories) {
        const st = catStats.get(c)!;
        const qPerReq = st.queries / profileSamples;
        const dbPerReq = st.dbMs / profileSamples;
        const waitPerReq = st.poolWaitMs / profileSamples;
        const share = avgDbMs > 0 ? (dbPerReq / avgDbMs) * 100 : 0;
        process.stdout.write(`| ${c} | ${qPerReq.toFixed(2)} | ${fmt(dbPerReq)} | ${fmt(waitPerReq)} | ${share.toFixed(1)}% |\n`);
      }

      process.stdout.write('\n| Bagian | Query / req | Rata-rata DB / req | SQL (ringkas) |\n');
      process.stdout.write('|---|---:|---:|---|\n');
      const sortedSql = [...sqlStats.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
      for (const [k, st] of sortedSql) {
        const sql = k.slice(k.indexOf('::') + 2);
        const shortSql = summarizeSql(sql);
        process.stdout.write(`| ${st.category} | ${(st.count / profileSamples).toFixed(2)} | ${fmt(st.totalMs / profileSamples)} | \`${shortSql}\` |\n`);
      }
      process.stdout.write('\n');
    }

    assert.deepEqual(await ledger.invariantViolations(db), []);
    assert.equal(Number((await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n), 0);
  }
} finally {
  mock?.server.closeAllConnections();
  mock?.server.close();
  app?.server.closeAllConnections();
  await app?.close().catch(() => {});
  if (db) await db.end().catch(() => {});
  await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
  await root.end().catch(() => {});
}
