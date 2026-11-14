// Operator lab: a local gateway wired to one real upstream on all three surfaces, left running so real tools can be pointed at it.
// Usage: node scripts/tool-lab.ts <env-file> <out-json> [port]   Sends nothing by itself; requests made by the tools are real and billable upstream.
import fs from 'node:fs';
import { createPool } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import { makeAdmin, adminClient, makeCustomer, mailer, KEY } from '../test/helpers.ts';

const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const DB = 'postgres://postgres:spike_local_only@127.0.0.1:55432/router_smoke';
const db = createPool(DB); await db.query('drop schema public cascade; create schema public;'); await migrate(db);
const app = await buildApp({ db, key: KEY, mailer, secureCookies: false, logger: true, gateway: { firstByteTimeoutMs: 90_000, idleTimeoutMs: 120_000 } });
await app.listen({ host: '127.0.0.1', port: Number(process.argv[4] ?? 18555) });
const adm = await makeAdmin(db); const admin = await adminClient(app, adm); const cust = (await makeCustomer(app, admin, 'lab')).client;
await admin.post('/admin/api/topups', { username: 'lab', amountTokens: '20000000', saleRef: 'lab', idempotencyKey: 'lab-topup-0001' });
const apiKey = (await cust.post('/api/keys', { name: 'lab', idempotencyKey: 'lab-key-0001' })).json.secret;
const MODEL = 'zr-coder'; await admin.post('/admin/api/models', { id: MODEL, displayName: 'ZR Coder' });
const d = (await admin.post('/admin/api/models/price/draft', { id: MODEL, expectedVersion: '1', multiplier: '1' })).json;
await admin.post('/admin/api/models/price/publish', { id: MODEL, expectedVersion: d.version, reason: 'tool lab' });
const base = env.UPSTREAM_BASE_URL; const origin = new URL(base).origin;
const up = (await admin.post('/admin/api/upstreams', { name: 'lab-upstream', baseUrls: { CHAT: base, RESPONSES: base, ANTHROPIC: origin }, apiKey: env.UPSTREAM_API_KEY })).json;
await admin.post(`/admin/api/upstreams/${up.id}/status`, { status: 'ELIGIBLE', expectedVersion: up.version, reason: 'tool lab' });
for (const protocol of ['CHAT', 'RESPONSES', 'ANTHROPIC']) await admin.post('/admin/api/routes', { modelId: MODEL, upstreamId: up.id, protocol, upstreamModel: env.UPSTREAM_MODEL });
fs.writeFileSync(process.argv[3], JSON.stringify({ baseUrl: `http://127.0.0.1:${(app.server.address() as any).port}`, apiKey, model: MODEL }), { mode: 0o600 });
console.error('LAB READY');
