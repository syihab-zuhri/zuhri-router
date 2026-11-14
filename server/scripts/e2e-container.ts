// Operator end-to-end check against a RUNNING deployment (for example the container image), over HTTP only.
// Usage: node scripts/e2e-container.ts <origin> <otpauth-uri-file> <admin-user> <admin-password-env> <upstream-env-file> [out-json]
// Walks the whole pilot flow: admin sign-in, invite, activation, pack, redeem code, API key, upstream, model, price, routes,
// one small real request per gateway surface, then usage and balance checks. Real upstream requests are billable.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { totpAt, totpStep } from '../src/crypto.ts';

const [origin, uriFile, adminUser, pwEnv, envFile, outFile] = process.argv.slice(2);
const adminPassword = process.env[pwEnv] ?? '';
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const secretB32 = /secret=([A-Z2-7]+)/.exec(fs.readFileSync(uriFile, 'utf8'))![1];
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const seed = (() => { let bits = 0, v = 0; const out: number[] = []; for (const ch of secretB32) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); })();

class Session {
  jar = new Map<string, string>();
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(origin + path, { method, headers: { 'x-router-csrf': '1', ...(body ? { 'content-type': 'application/json' } : {}), cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) this.jar.set(kv.slice(0, i), v); else this.jar.delete(kv.slice(0, i)); }
    let json: any = null; try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, json };
  }
  get = (p: string) => this.req('GET', p); post = (p: string, b: unknown = {}) => this.req('POST', p, b);
}
const steps: { step: string; ok: boolean; detail?: unknown }[] = [];
const check = (step: string, ok: boolean, detail?: unknown) => { steps.push({ step, ok, detail }); console.log(ok ? 'OK  ' : 'FAIL', step, detail === undefined ? '' : JSON.stringify(detail)); };
const run = crypto.randomBytes(3).toString('hex'); const C = 1_000_000n;

const admin = new Session();
check('admin password login', (await admin.post('/admin/api/login', { identifier: adminUser, password: adminPassword })).status === 200);
check('admin operation refused before second factor', (await admin.get('/admin/api/audit')).status === 401);
check('admin second factor', (await admin.post('/admin/api/second-factor', { code: totpAt(seed, totpStep(Date.now())) })).status === 200);

const username = 'pilot_' + run; const email = `${username}@example.test`;
const inv = await admin.post('/admin/api/invites', { email });
check('invite without email delivery returns a one-time activation link', inv.status === 201 && inv.json.emailSent === false && /#token=/.test(inv.json.activationLink ?? ''));
const token = String(inv.json.activationLink).split('token=')[1];
const anon = new Session();
check('customer activation', (await anon.post('/api/auth/activate', { token, username, password: 'pilot-password-' + run })).status === 201);
check('activation link cannot be reused', (await anon.post('/api/auth/activate', { token, username: username + 'x', password: 'pilot-password-' + run })).status === 400);
const cust = new Session();
check('customer login', (await cust.post('/api/auth/login', { identifier: username, password: 'pilot-password-' + run })).status === 200);

const pack = await admin.post('/admin/api/packs', { name: 'Paket Uji ' + run, tokens: '2000000', displayPriceIdr: '10000' });
check('pack created', pack.status === 201);
check('customer sees the pack', ((await cust.get('/api/packs')).json?.packs ?? []).some((p: any) => p.id === pack.json.id));
const v = await admin.post('/admin/api/vouchers', { packId: pack.json.id, saleRef: 'E2E-' + run, idempotencyKey: 'e2e-issue-' + run });
check('redeem code issued and shown once', v.status === 201 && typeof v.json.code === 'string');
const red = await cust.post('/api/redeem', { code: v.json.code });
check('redeem credits the pack amount', red.status === 200 && red.json.postedMicro === String(2_000_000n * C), { posted: red.json?.postedMicro });
check('redeem replay returns the same receipt', (await cust.post('/api/redeem', { code: v.json.code })).json?.replayed === true);
const key = await cust.post('/api/keys', { name: 'e2e', idempotencyKey: 'e2e-key-' + run });
check('API key created', key.status === 201 && /^rtr_/.test(key.json.secret ?? ''));
const apiKey: string = key.json.secret;

const MODEL = 'e2e-' + run; const base = env.UPSTREAM_BASE_URL; const upOrigin = new URL(base).origin;
const up = await admin.post('/admin/api/upstreams', { name: 'e2e-' + run, baseUrls: { CHAT: base, RESPONSES: base, ANTHROPIC: upOrigin }, apiKey: env.UPSTREAM_API_KEY });
check('upstream registered (real URL guard)', up.status === 201 && up.json.keySet === true && !JSON.stringify(up.json).includes(env.UPSTREAM_API_KEY), up.json?.error);
check('model not listed before it has a price and an eligible route', !((await cust.get('/api/models')).json?.models ?? []).some((m: any) => m.id === MODEL));
await admin.post(`/admin/api/upstreams/${up.json.id}/status`, { status: 'ELIGIBLE', expectedVersion: up.json.version, reason: 'e2e' });
await admin.post('/admin/api/models', { id: MODEL, displayName: 'E2E ' + run });
const d = await admin.post('/admin/api/models/price/draft', { id: MODEL, expectedVersion: '1', multiplier: '2' });
check('price published', (await admin.post('/admin/api/models/price/publish', { id: MODEL, expectedVersion: d.json.version, reason: 'e2e' })).status === 200);
for (const protocol of ['CHAT', 'RESPONSES', 'ANTHROPIC']) await admin.post('/admin/api/routes', { modelId: MODEL, upstreamId: up.json.id, protocol, upstreamModel: env.UPSTREAM_MODEL });
const cat = ((await cust.get('/api/models')).json?.models ?? []).find((m: any) => m.id === MODEL);
check('customer catalogue shows the model at x2 on three surfaces', cat?.multiplier === '2' && cat?.protocols?.length === 3, cat);

const gw = (path: string, body: object, headers: Record<string, string> = {}) => fetch(origin + path, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const msg = [{ role: 'user', content: 'Jawab satu kata: ok' }];
let r = await gw('/v1/chat/completions', { model: MODEL, stream: true, max_tokens: 32, messages: msg }); let text = await r.text();
check('chat stream through the gateway', r.status === 200 && text.includes('[DONE]'));
r = await gw('/v1/messages', { model: MODEL, max_tokens: 32, messages: msg }, { 'anthropic-version': '2023-06-01' }); let j: any = await r.json().catch(() => null);
check('anthropic messages through the gateway', r.status === 200 && j?.type === 'message', j?.error);
r = await gw('/v1/responses', { model: MODEL, input: 'Jawab satu kata: ok', max_output_tokens: 32 }); j = await r.json().catch(() => null);
check('responses through the gateway', r.status === 200 && j?.object === 'response', j?.error);
r = await gw('/v1/chat/completions', { model: 'tidak-ada', messages: msg }); check('unknown model refused with a product error code', r.status === 404 && (await r.json()).error.code === 'model_not_available');
check('wrong API key refused', (await fetch(origin + '/v1/models', { headers: { authorization: 'Bearer rtr_' + 'x'.repeat(43) } })).status === 401);

await new Promise(res => setTimeout(res, 1500));
const reqs = (await cust.get('/api/requests')).json?.requests ?? [];
check('three requests recorded, all final, none estimated', reqs.length === 3 && reqs.every((x: any) => x.final && !x.estimated), reqs.map((x: any) => [x.protocol, x.state, x.debitMicro]));
const bal = (await cust.get('/api/balance')).json; const spent = reqs.reduce((s: bigint, x: any) => s + BigInt(x.debitMicro ?? 0), 0n);
check('balance equals redeem minus charges, nothing held', bal?.postedMicro === String(2_000_000n * C - spent) && bal?.heldMicro === '0', { posted: bal?.postedMicro, spentCredits: String(spent / C) });
check('charges are tokens x2', reqs.every((x: any) => x.usage && BigInt(x.debitMicro) === BigInt(x.usage.input + x.usage.output + x.usage.cacheRead + x.usage.cacheWrite) * 2n * C));
const usage = (await admin.get(`/admin/api/customers/${username}/usage`)).json;
check('admin usage for the customer matches', usage?.byModel?.[0]?.requests === 3 && usage.byModel[0].debitMicro === String(spent));
const ledger = (await cust.get('/api/ledger')).json?.entries ?? [];
check('ledger shows one redeem and three debits', ledger.filter((e: any) => e.kind === 'GRANT_REDEEM').length === 1 && ledger.filter((e: any) => e.kind === 'DEBIT_USAGE').length === 3);
const audit = JSON.stringify((await admin.get('/admin/api/audit')).json);
check('audit has the admin actions and no secrets', audit.includes('voucher.issue') && audit.includes('upstream.status') && ![apiKey, v.json.code, env.UPSTREAM_API_KEY, token].some(s => audit.includes(s)));
const page = await fetch(origin + '/'); const html = await page.text();
check('web app is served from the same origin with a CSP', page.status === 200 && html.includes('<div id="root"') && (page.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"));

const failed = steps.filter(s => !s.ok).length;
console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), origin, passed: steps.length - failed, total: steps.length, steps }, null, 2) + '\n');
process.exit(failed ? 1 : 0);
