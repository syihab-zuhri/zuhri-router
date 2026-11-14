// Overhead measurement for NFR-002: time to first byte and total time, direct to mock vs through the gateway.
import fs from 'node:fs'; import pg from 'pg';
import { startMock } from './src/mock-upstream.ts'; import { startGateway, hashKey } from './src/gateway.ts';
const DB = process.env.SPIKE_DATABASE_URL ?? 'postgres://postgres:spike_local_only@127.0.0.1:55432/spike';
const pool = new pg.Pool({ connectionString: DB, max: 40 }); const MOCK = 18111, GW = 18110, N = 400, CONC = [1, 20];
await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
await pool.query("insert into ledger_account(tenant,posted) values('t1',$1)", [String(10n ** 15n)]);
await pool.query("insert into api_key(key_hash,tenant) values($1,'t1')", [hashKey('k')]);
await pool.query("insert into price values('m',1,10000000000,40000000000,1000000000,15000)");
await pool.query("insert into route(model,protocol,upstream_url,upstream_model,priority) values('m','chat',$1,'ok',1)", [`http://127.0.0.1:${MOCK}/v1/chat/completions`]);
const mock = await startMock(MOCK); const gw = await startGateway({ port: GW, pool });
const body = JSON.stringify({ model: 'm', stream: true, max_tokens: 256, messages: [{ role: 'user', content: 'x'.repeat(2000) }] });
async function one(url: string, model: string) { const t0 = performance.now(); const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: body.replace('"m"', `"${model}"`) }); const rd = r.body!.getReader(); await rd.read(); const ttfb = performance.now() - t0; while (!(await rd.read()).done); return { ttfb, total: performance.now() - t0 }; }
const pct = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const out: any = { node: process.version, n: N, note: 'Single machine, loopback, mock upstream that answers immediately, PostgreSQL in local Docker. Not a capacity test.', runs: [] };
for (const conc of CONC) for (const [name, url, model] of [['direct', `http://127.0.0.1:${MOCK}/v1/chat/completions`, 'ok'], ['gateway', `http://127.0.0.1:${GW}/v1/chat/completions`, 'm']] as const) {
  for (let i = 0; i < 30; i++) await one(url, model); // warm-up
  const res: { ttfb: number; total: number }[] = []; let i = 0; const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, async () => { while (i++ < N) res.push(await one(url, model)); }));
  const wall = performance.now() - t0; const r2 = (x: number) => Math.round(x * 100) / 100;
  out.runs.push({ target: name, concurrency: conc, ttfb_ms_p50: r2(pct(res.map(r => r.ttfb), 0.5)), ttfb_ms_p95: r2(pct(res.map(r => r.ttfb), 0.95)), total_ms_p50: r2(pct(res.map(r => r.total), 0.5)), total_ms_p95: r2(pct(res.map(r => r.total), 0.95)), req_per_s: r2(res.length / (wall / 1000)) });
}
await new Promise(r => setTimeout(r, 500));
const a = (await pool.query("select posted,held,(select coalesce(sum(amount),0) from ledger_entry) s,(select count(*) from request where debit is null) open from ledger_account")).rows[0];
out.after = { held: a.held, unsettled_requests: a.open, debits: (await pool.query("select count(*) n from ledger_entry")).rows[0].n };
console.log(JSON.stringify(out, null, 2)); fs.writeFileSync(new URL('./bench-result.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
gw.close(); mock.server.close(); (gw as any).closeAllConnections?.(); (mock.server as any).closeAllConnections?.(); await pool.end();
