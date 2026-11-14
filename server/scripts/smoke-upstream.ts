// Operator smoke test: a handful of tiny real requests through the local gateway to one upstream.
// Usage: node scripts/smoke-upstream.ts <env-file>   (UPSTREAM_NAME, UPSTREAM_BASE_URL, UPSTREAM_MODEL, UPSTREAM_API_KEY)
// Sends real, possibly billable requests: run only with the founder's permission. Prints no key and no response content.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createPool } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import { Client, makeAdmin, adminClient, makeCustomer, mailer, KEY } from '../test/helpers.ts';

const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
for (const k of ['UPSTREAM_NAME', 'UPSTREAM_BASE_URL', 'UPSTREAM_MODEL', 'UPSTREAM_API_KEY']) if (!env[k]) { console.error(`${k} missing in env file`); process.exit(1); }
const DB = process.env.SMOKE_DATABASE_URL ?? 'postgres://postgres:spike_local_only@127.0.0.1:55432/router_smoke';
if (!new URL(DB).pathname.endsWith('/router_smoke')) { console.error('refusing to wipe a database that is not router_smoke'); process.exit(1); }

const db = createPool(DB); await db.query('drop schema public cascade; create schema public;'); await migrate(db);
await db.query("update system_setting set value=0 where name='overdraft_micro'");
const app = await buildApp({ db, key: KEY, mailer, secureCookies: false, gateway: { firstByteTimeoutMs: 45_000, idleTimeoutMs: 45_000 } }); // real DNS resolver and real base URL guard
await app.listen({ host: '127.0.0.1', port: 0 }); const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
const adm = await makeAdmin(db); const admin = await adminClient(app, adm); const cust = (await makeCustomer(app, admin, 'smoke')).client;
await admin.post('/admin/api/topups', { username: 'smoke', amountTokens: '200000', saleRef: 'smoke', idempotencyKey: 'smoke-topup-0001' });
const apiKey = (await cust.post('/api/keys', { name: 'smoke', idempotencyKey: 'smoke-key-0001' })).json.secret;
const MODEL = 'smoke/model'; await admin.post('/admin/api/models', { id: MODEL, displayName: 'smoke' });
const d = (await admin.post('/admin/api/models/price/draft', { id: MODEL, expectedVersion: '1', multiplier: '1' })).json;
await admin.post('/admin/api/models/price/publish', { id: MODEL, expectedVersion: d.version, reason: 'smoke test' });

const report: any = { at: new Date().toISOString(), upstreamHost: new URL(env.UPSTREAM_BASE_URL).host, upstreamModel: env.UPSTREAM_MODEL, steps: [] };
const step = (name: string, data: object) => { report.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };
async function upstream(name: string, urls: object, key: string) {
  const r = await admin.post('/admin/api/upstreams', { name, baseUrls: urls, apiKey: key, termsNote: 'smoke test' });
  if (r.status !== 201) return { error: r.json?.error };
  await admin.post(`/admin/api/upstreams/${r.json.id}/status`, { status: 'ELIGIBLE', expectedVersion: r.json.version, reason: 'smoke test' });
  return { id: r.json.id as string };
}
const route = (upstreamId: string, protocol: string, priority: number, enabled = true) => admin.post('/admin/api/routes', { modelId: MODEL, upstreamId, protocol, upstreamModel: env.UPSTREAM_MODEL, priority, enabled });
const row = async (id: string | null) => { if (!id) return null; for (let i = 0; i < 200; i++) { const r = (await db.query('select state, debit, hold, estimated, bound_exceeded, usage_raw, usage_norm, outcome from request where id=$1', [id])).rows[0]; if (r?.debit !== null && r?.debit !== undefined) return { state: r.state, debitMicro: String(r.debit), holdMicro: String(r.hold), estimated: r.estimated, boundExceeded: r.bound_exceeded, usageKeys: r.usage_raw ? Object.keys(r.usage_raw) : null, usageNorm: r.usage_norm, outcome: r.outcome }; await new Promise(r => setTimeout(r, 50)); } return { state: 'NOT_SETTLED' }; };
const attempts = async (id: string | null) => (id ? (await db.query('select outcome from attempt where request_id=$1 order by seq', [id])).rows.map(r => r.outcome) : []);
const post = (path: string, body: object, init: RequestInit = {}) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), ...init });
const msg = (text: string) => [{ role: 'user', content: text }];

const up = await upstream(env.UPSTREAM_NAME, { CHAT: env.UPSTREAM_BASE_URL }, env.UPSTREAM_API_KEY);
step('register upstream (real URL guard and DNS)', up.error ? { ok: false, error: up.error } : { ok: true });
if (up.id) {
  const r1id = (await route(up.id, 'CHAT', 10)).json.id;
  // 1. non-stream
  let t0 = Date.now(); let res = await post('/v1/chat/completions', { model: MODEL, max_tokens: 16, messages: msg('Jawab satu kata: ok') }); let body: any = await res.json().catch(() => null); let id = res.headers.get('x-request-id');
  step('chat non-stream', { status: res.status, ms: Date.now() - t0, hasChoices: Array.isArray(body?.choices), contentChars: body?.choices?.[0]?.message?.content?.length ?? null, finish: body?.choices?.[0]?.finish_reason ?? null, errorCode: body?.error?.code ?? null, attempts: await attempts(id), settled: await row(id) });
  // 2. stream
  t0 = Date.now(); res = await post('/v1/chat/completions', { model: MODEL, stream: true, max_tokens: 32, messages: msg('Hitung 1 sampai 5.') }); id = res.headers.get('x-request-id');
  let text = '', ttfb: number | null = null; if (res.body) { const rd = res.body.getReader(); const dec = new TextDecoder(); for (;;) { const c = await rd.read(); if (c.done) break; ttfb ??= Date.now() - t0; text += dec.decode(c.value, { stream: true }); } }
  const events = text.split('\n\n').filter(Boolean);
  step('chat stream', { status: res.status, contentType: res.headers.get('content-type'), ttfbMs: ttfb, totalMs: Date.now() - t0, events: events.length, done: text.includes('data: [DONE]'), usageChunk: /"usage"\s*:\s*\{/.test(text), keepAliveComments: events.filter(e => e.startsWith(':')).length, attempts: await attempts(id), settled: await row(id) });
  // 3. client cancels mid-stream
  const ac = new AbortController(); t0 = Date.now(); res = await post('/v1/chat/completions', { model: MODEL, stream: true, max_tokens: 400, messages: msg('Tulis penjelasan panjang tentang sejarah internet dalam sepuluh paragraf.') }, { signal: ac.signal }); id = res.headers.get('x-request-id');
  if (res.body) { const rd = res.body.getReader(); await rd.read().catch(() => {}); await rd.read().catch(() => {}); ac.abort(); }
  step('chat stream cancelled by client', { status: res.status, attempts: await attempts(id), settled: await row(id) });
  // 4. max_tokens omitted and a tool definition, to see pass-through of a typical coding-tool request
  res = await post('/v1/chat/completions', { model: MODEL, max_tokens: 64, messages: msg('Berapa cuaca di Jakarta? Pakai tool.'), tools: [{ type: 'function', function: { name: 'get_weather', description: 'Cuaca kota', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }] }); body = await res.json().catch(() => null); id = res.headers.get('x-request-id');
  step('chat non-stream with a tool', { status: res.status, toolCalls: body?.choices?.[0]?.message?.tool_calls?.length ?? 0, finish: body?.choices?.[0]?.finish_reason ?? null, settled: await row(id) });
  // 5. wrong upstream key: must fail closed with no charge and no upstream detail
  await admin.post(`/admin/api/routes/${r1id}`, { upstreamModel: env.UPSTREAM_MODEL, priority: 10, enabled: false, expectedVersion: '1' });
  const badUp = await upstream('bad-key', { CHAT: env.UPSTREAM_BASE_URL }, 'sk-' + crypto.randomBytes(16).toString('hex'));
  if (badUp.id) { await route(badUp.id, 'CHAT', 5); res = await post('/v1/chat/completions', { model: MODEL, max_tokens: 8, messages: msg('ok') }); const raw = await res.text(); id = res.headers.get('x-request-id');
    step('wrong upstream key', { status: res.status, body: raw.slice(0, 160), leaksHost: raw.includes(report.upstreamHost), attempts: await attempts(id), settled: await row(id) }); }
  // 6. Anthropic surface on the same host, if the upstream offers it
  const origin = new URL(env.UPSTREAM_BASE_URL).origin; const an = await upstream('anthropic-probe', { ANTHROPIC: origin }, env.UPSTREAM_API_KEY);
  if (an.id) { await route(an.id, 'ANTHROPIC', 10); res = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: msg('Jawab satu kata: ok') }) }); body = await res.json().catch(() => null); id = res.headers.get('x-request-id');
    step('anthropic non-stream', { status: res.status, type: body?.type ?? null, errorCode: body?.error?.type ?? null, attempts: await attempts(id), settled: await row(id) }); }
}
// 7. Responses surface (what Codex speaks), if the upstream offers it at the same base URL
const rs = await upstream('responses-probe', { RESPONSES: env.UPSTREAM_BASE_URL }, env.UPSTREAM_API_KEY);
if (rs.id) {
  await route(rs.id, 'RESPONSES', 10);
  for (const stream of [false, true]) {
    const res = await post('/v1/responses', { model: MODEL, input: 'Jawab satu kata: ok', max_output_tokens: 32, stream }); const raw = await res.text(); const id = res.headers.get('x-request-id');
    let j: any = null; try { j = JSON.parse(raw); } catch { /* stream */ }
    step(`responses ${stream ? 'stream' : 'non-stream'}`, { status: res.status, object: j?.object ?? null, errorCode: j?.error?.code ?? null, completedEvent: /response\.completed/.test(raw), events: stream ? raw.split('\n\n').filter(Boolean).length : null, attempts: await attempts(id), settled: await row(id) });
  }
}
const bal = (await cust.get('/api/balance')).json; const inv = (await import('../src/ledger.ts')).invariantViolations;
step('final', { postedMicro: bal.postedMicro, heldMicro: bal.heldMicro, invariantViolations: (await inv(db)).length, openHolds: (await db.query("select count(*) n from hold where status='ACTIVE'")).rows[0].n });
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
app.server.closeAllConnections(); await app.close(); await db.end(); void Client;
