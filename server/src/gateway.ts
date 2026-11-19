// TASK-012 / FR-011: inference gateway. Same-protocol pass-through with admission, fallback before the first byte,
// and exactly-once settlement in token credits. See docs/ARCHITECTURE.md sections 2, 3, 10 and docs/TOKEN_CREDIT.md.
// Not here yet: margin guard, per-route concurrency limits, persistent circuit state, recovery worker.
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, withTx, type Db } from './db/pool.ts';
import { audit } from './audit.ts';
import { tokenHash } from './crypto.ts';
import { creditsToMicro } from './money.ts';
import * as keys from './keys.ts';
import * as ledger from './ledger.ts';
import * as pricing from './pricing.ts';
import * as upstreams from './upstreams.ts';
import { debitMicro, holdMicro, type Price, type Usage } from './money.ts';
import { assertSafeUpstreamUrl, type Resolver } from './netguard.ts';
import { gatewayEvents } from './monitor.ts';
import { gatewayPaused } from './control.ts';
import { CURSOR_TIME_SQL, parseRequestCursor, requestCursor } from './paging.ts';

export type GatewayDeps = { db: Db; key: Buffer; resolveHost: Resolver; firstByteTimeoutMs?: number; idleTimeoutMs?: number; maxTotalMs?: number; maxAttempts?: number;
  /** Abuse limits (ABU-004), per process. */ requestsPerMinutePerKey?: number; concurrentPerTenant?: number; authFailuresPerMinutePerIp?: number;
  /** Test-only: skip the base URL guard so a loopback mock upstream can be used. Never set from configuration. */ unsafeAllowAnyUpstreamUrl?: boolean };
type Surface = 'CHAT' | 'ANTHROPIC' | 'RESPONSES';
export const GATEWAY_LIMITS = { bodyBytes: 8 * 1024 * 1024, defaultMaxOutput: 4096, maxOutputCap: 393_216, nonStreamBytes: 16 * 1024 * 1024 };

const errBody = (s: Surface, code: string, message: string) => (s === 'ANTHROPIC' ? { type: 'error', error: { type: code, message } } : { error: { code, type: code, message } });
// Product error codes (docs/ARCHITECTURE.md section 5.1). Internal codes are mapped so no upstream detail leaks.
const PUBLIC: Record<string, [number, string]> = { auth_invalid: [401, 'auth_invalid'], key_revoked: [401, 'key_revoked'], tenant_suspended: [403, 'tenant_suspended'], model_not_available: [404, 'model_not_available'], insufficient_balance: [402, 'insufficient_balance'], limit_exceeded: [429, 'limit_exceeded'], invalid_request: [400, 'invalid_request'] };

/** Usage normaliser v1. Returns null when the shape is inconsistent; that becomes an estimate, never a guess. */
export function normalizeUsage(s: Surface, raw: any): Usage | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = (v: any) => (Number.isSafeInteger(v) && v >= 0 ? (v as number) : null);
  if (s === 'CHAT') {
    const total = n(raw.prompt_tokens), out = n(raw.completion_tokens);
    const hit = n(raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0);
    if (total === null || out === null || hit === null || hit > total) return null;
    if (raw.prompt_cache_miss_tokens !== undefined && n(raw.prompt_cache_miss_tokens) !== total - hit) return null; // inclusive total must equal hit + miss
    return { input: total - hit, output: out, cacheRead: hit, cacheWrite: 0 };
  }
  if (s === 'RESPONSES') { // input_tokens includes cached tokens, reported under input_tokens_details
    const total = n(raw.input_tokens), out = n(raw.output_tokens), hit = n(raw.input_tokens_details?.cached_tokens ?? 0);
    if (total === null || out === null || hit === null || hit > total) return null;
    return { input: total - hit, output: out, cacheRead: hit, cacheWrite: 0 };
  }
  const inp = n(raw.input_tokens), out = n(raw.output_tokens), hit = n(raw.cache_read_input_tokens ?? 0), write = n(raw.cache_creation_input_tokens ?? 0);
  if (inp === null || out === null || hit === null || write === null) return null;
  return { input: inp, output: out, cacheRead: hit, cacheWrite: write }; // Anthropic-style input_tokens already excludes cache
}

/**
 * Founder decision (CR-018): a customer is never billed for more input than the request could contain.
 * maxInput is the request size in bytes, which no tokenizer exceeds. Anything an upstream reports above it was added
 * by the upstream itself; it is cut from plain input first, then cache write, then cache read, and reported as unbilled.
 */
export function capInput(u: Usage, maxInput: number): { billed: Usage; unbilled: number } {
  let over = u.input + u.cacheRead + u.cacheWrite - maxInput;
  if (over <= 0) return { billed: u, unbilled: 0 };
  const unbilled = over; const b = { ...u };
  for (const k of ['input', 'cacheWrite', 'cacheRead'] as const) { const cut = Math.min(b[k], over); b[k] -= cut; over -= cut; }
  return { billed: b, unbilled };
}

/** Reads SSE as it passes through, without changing a byte: collects usage, counts content, sees the end marker. */
class StreamObserver {
  private buf = ''; private dec = new TextDecoder();
  usageRaw: any = null; contentChars = 0; done = false; s: Surface;
  constructor(s: Surface) { this.s = s; }
  push(chunk: Uint8Array) {
    this.buf += this.dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    for (let i; (i = this.buf.indexOf('\n\n')) >= 0;) { this.event(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 2); }
    if (this.buf.length > 4_000_000) this.buf = ''; // malformed stream: stop buffering; usage will be missing and settle as an estimate
  }
  private event(block: string) {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { this.done = true; return; }
    let j: any; try { j = JSON.parse(data); } catch { return; }
    if (this.s === 'CHAT') {
      if (j.usage) this.usageRaw = j.usage;
      const d = j.choices?.[0]?.delta;
      for (const t of [d?.content, d?.reasoning_content]) if (typeof t === 'string') this.contentChars += t.length;
      for (const tc of d?.tool_calls ?? []) if (typeof tc?.function?.arguments === 'string') this.contentChars += tc.function.arguments.length;
    } else if (this.s === 'RESPONSES') {
      // The stream ends with response.completed / response.incomplete / response.failed carrying the full response; there is no [DONE].
      if (typeof j.type === 'string' && /^response\.(completed|incomplete|failed)$/.test(j.type)) { this.done = true; if (j.response?.usage) this.usageRaw = j.response.usage; }
      else if (typeof j.type === 'string' && j.type.endsWith('.delta') && typeof j.delta === 'string') this.contentChars += j.delta.length;
    } else {
      if (j.type === 'message_start' && j.message?.usage) this.usageRaw = { ...j.message.usage };
      if (j.type === 'message_delta' && j.usage) this.usageRaw = { ...(this.usageRaw ?? {}), ...j.usage };
      if (j.type === 'content_block_delta') for (const t of [j.delta?.text, j.delta?.thinking, j.delta?.partial_json]) if (typeof t === 'string') this.contentChars += t.length;
      if (j.type === 'message_stop') this.done = true;
    }
  }
}

// In-memory route health (one process). Opens after repeated failures; 401/402 from an upstream needs the admin, so it stays open longer.
const health = new Map<string, { fails: number; openUntil: number }>();
const routeOpen = (id: string) => (health.get(id)?.openUntil ?? 0) > Date.now();
function routeFailed(id: string, upstreamName: string, status?: number) {
  const h = health.get(id) ?? { fails: 0, openUntil: 0 }; h.fails++;
  const before = h.openUntil;
  if (status === 401 || status === 402) h.openUntil = Date.now() + 5 * 60_000; else if (h.fails >= 3) h.openUntil = Date.now() + 30_000;
  health.set(id, h);
  if (h.openUntil > Date.now() && h.openUntil !== before) gatewayEvents.emit('route_open', { upstreamName, status, untilMs: h.openUntil });
}
// In-memory limiters (one process). A second gateway instance would need a shared store.
const windows = new Map<string, { start: number; n: number }>();
function overLimit(bucket: string, limit: number, add: boolean): number {
  const now = Date.now(); let w = windows.get(bucket);
  if (!w || now - w.start >= 60_000) { w = { start: now, n: 0 }; windows.set(bucket, w); }
  if (w.n >= limit) return Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000));
  if (add) w.n++;
  if (windows.size > 50_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
  return 0;
}
const active = new Map<string, number>();
export const resetRouteHealth = () => { health.clear(); windows.clear(); active.clear(); };

export function registerGateway(app: FastifyInstance, deps: GatewayDeps) {
  const { db } = deps; const firstByteMs = deps.firstByteTimeoutMs ?? 60_000, idleMs = deps.idleTimeoutMs ?? 120_000, maxTotalMs = deps.maxTotalMs ?? 30 * 60_000, maxAttempts = deps.maxAttempts ?? 3;
  const perKey = deps.requestsPerMinutePerKey ?? 120, perTenant = deps.concurrentPerTenant ?? 20, perIpFail = deps.authFailuresPerMinutePerIp ?? 30;

  const secretOf = (req: FastifyRequest) => { const a = req.headers.authorization; const x = req.headers['x-api-key']; return typeof a === 'string' && /^Bearer\s+/i.test(a) ? a.replace(/^Bearer\s+/i, '') : typeof x === 'string' ? x : ''; };
  const fail = (reply: FastifyReply, s: Surface, status: number, code: string, message: string, requestId?: string, retryAfter?: number) => {
    if (requestId) reply.header('x-request-id', requestId); if (retryAfter) reply.header('retry-after', String(retryAfter));
    return reply.code(status).send(errBody(s, code, message));
  };
  const failApp = (reply: FastifyReply, s: Surface, e: unknown, requestId?: string) => {
    if (e instanceof AppError && PUBLIC[e.code]) return fail(reply, s, PUBLIC[e.code][0], PUBLIC[e.code][1], e.message, requestId);
    if (e instanceof AppError && e.code === 'rate_limited') return fail(reply, s, 429, 'limit_exceeded', e.message, requestId, e.retryAfterSec);
    app.log.error({ code: (e as any)?.code, name: (e as any)?.name }, 'gateway error');
    return fail(reply, s, 503, 'internal_error', 'Service unavailable', requestId); // ledger or database trouble: refuse, never let a billable request through
  };

  async function settle(a: { requestId: string; tenantId: string; price: Price; usage: Usage | null; estimated: boolean; state: string; usageRaw: unknown; outcome: string; maxIn: number }) {
    const capped = a.usage ? capInput(a.usage, a.maxIn) : null; const billed = capped?.billed ?? null;
    const debit = billed ? debitMicro(billed, a.price) : 0n;
    await withTx(db, async tx => {
      const r = await ledger.settleHold(tx, { tenantId: a.tenantId, requestId: a.requestId, debit, ref: { requestId: a.requestId } });
      if (!r.settled) return; // already settled: nothing to do
      await tx.query('update request set state=$2, debit=$3, estimated=$4, bound_exceeded=$5, usage_raw=$6, usage_norm=$7, outcome=$8, unbilled_input_tokens=$9, settled_at=now() where id=$1',
        [a.requestId, a.state, String(debit), a.estimated, r.boundExceeded, a.usageRaw === null || a.usageRaw === undefined ? null : JSON.stringify(a.usageRaw), billed ? JSON.stringify(billed) : null, a.outcome, capped?.unbilled ?? 0]);
    });
  }

  /** Cheap refusals first: nothing below touches the database or an upstream until these pass. */
  async function guarded(s: Surface, req: FastifyRequest, reply: FastifyReply) {
    const secret = secretOf(req);
    let wait = overLimit('fail:' + req.ip, perIpFail, false);
    if (wait) return fail(reply, s, 429, 'limit_exceeded', 'Too many failed requests from this address', undefined, wait);
    let tenantId: string;
    try { tenantId = (await keys.authenticate(db, secret)).tenantId; }
    catch (e) { if (e instanceof AppError && (e.code === 'auth_invalid' || e.code === 'key_revoked')) overLimit('fail:' + req.ip, perIpFail, true); return failApp(reply, s, e); }
    // Kill switch: checked after the key so strangers learn nothing, before any hold. Requests already admitted are not affected.
    try { if (await gatewayPaused(db)) return fail(reply, s, 503, 'service_paused', 'The service is paused by the operator. Try again later.', undefined, 60); }
    catch (e) { return failApp(reply, s, e); }
    wait = overLimit('key:' + tokenHash(secret), perKey, true);
    if (wait) return fail(reply, s, 429, 'limit_exceeded', 'Request rate limit reached for this API key', undefined, wait);
    const running = active.get(tenantId) ?? 0;
    if (running >= perTenant) return fail(reply, s, 429, 'limit_exceeded', 'Too many requests in progress', undefined, 2);
    active.set(tenantId, running + 1);
    try { return await handle(s, req, reply, tenantId); }
    finally { const n = (active.get(tenantId) ?? 1) - 1; if (n <= 0) active.delete(tenantId); else active.set(tenantId, n); }
  }

  /** `tenantId` comes from the key check in `guarded`; the hold transaction checks the key again under lock. */
  async function handle(s: Surface, req: FastifyRequest, reply: FastifyReply, tenantId: string) {
    const secret = secretOf(req);
    const json = req.body as Record<string, any> | null;
    if (!json || typeof json !== 'object' || Array.isArray(json)) return fail(reply, s, 400, 'invalid_request', 'Request body must be a JSON object');
    const model = json.model;
    if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(model)) return fail(reply, s, 400, 'invalid_request', 'model is required');
    const stream = json.stream === true;
    const bodyText = JSON.stringify(json);
    const asked = s === 'CHAT' ? json.max_completion_tokens ?? json.max_tokens : s === 'RESPONSES' ? json.max_output_tokens : json.max_tokens;
    // Stateless only: responses are not stored upstream on the customer's behalf, so a request cannot continue an earlier one.
    if (s === 'RESPONSES' && (json.previous_response_id != null || json.conversation != null || json.background === true)) return fail(reply, s, 400, 'invalid_request', 'Stored conversations and background mode are not supported; send the full input with each request');
    if (asked !== undefined && asked !== null && (!Number.isInteger(asked) || asked < 1)) return fail(reply, s, 400, 'invalid_request', 'max_tokens must be a positive integer');
    const requestId = 'req_' + crypto.randomUUID();
    const maxIn = Buffer.byteLength(bodyText); // upper bound: a token is never shorter than one byte of the request

    // ---- Admission: key, scope, price snapshot, hold. Everything billable is decided in one transaction. ----
    let adm: { tenantId: string; price: Price; maxOut: number };
    try {
      const snap = await pricing.snapshotForAdmission(db, model);
      if (!snap) throw new AppError('model_not_available', 'This model is not available', 404);
      // Overrun rule: when the requested output does not fit the balance plus allowance, the output is capped to what fits.
      const bal = await ledger.getBalance(db, tenantId); const budget = bal.available + await ledger.overdraftMicro(db);
      let maxOut = Math.min(asked ?? GATEWAY_LIMITS.defaultMaxOutput, GATEWAY_LIMITS.maxOutputCap);
      if (bal.available > 0n && holdMicro(maxIn, maxOut, snap.price) > budget) {
        const inputOnly = holdMicro(maxIn, 0, snap.price), perOut = holdMicro(0, 1000, snap.price);
        const fit = budget > inputOnly && perOut > 0n ? Number(((budget - inputOnly) * 1000n) / perOut) : 0;
        if (fit < 1) throw new AppError('insufficient_balance', 'Insufficient balance', 402);
        maxOut = Math.min(maxOut, fit);
      }
      const hold = holdMicro(maxIn, maxOut, snap.price);
      const placed = await withTx(db, async tx => {
        const h = await ledger.placeKeyHold(tx, { secret, requestId, amount: hold, model });
        const fresh = await pricing.snapshotForAdmission(tx, model); // re-read inside the transaction: the snapshot stored is the one charged
        if (!fresh || fresh.priceVersionId !== snap.priceVersionId) throw new AppError('model_not_available', 'Price changed, retry the request', 404);
        await tx.query('insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [requestId, h.tenantId, h.keyId, model, s, stream, 'ADMITTED', snap.priceVersionId, JSON.stringify({ seq: snap.price.version, inputRate: String(snap.price.inputRate), outputRate: String(snap.price.outputRate), cacheReadRate: String(snap.price.cacheReadRate), cacheWriteRate: String(snap.price.cacheWriteRate), multiplierE4: String(snap.price.multiplierE4) }), maxIn, maxOut, String(hold)]);
        return h;
      });
      adm = { tenantId: placed.tenantId, price: snap.price, maxOut };
    } catch (e) { return failApp(reply, s, e, requestId); }

    const done = (usage: Usage | null, estimated: boolean, state: string, usageRaw: unknown, outcome: string) => settle({ requestId, tenantId: adm.tenantId, price: adm.price, usage, estimated, state, usageRaw, outcome, maxIn });
    const estimate = (chars: number): Usage => ({ input: Math.ceil(maxIn / 3), output: Math.ceil(chars / 2), cacheRead: 0, cacheWrite: 0 });

    // ---- Routing: same protocol only, eligible upstreams, healthy routes, best priority first. ----
    const candidates = (await upstreams.candidatesFor(db, deps.key, model, s)).filter(c => !routeOpen(c.routeId)).slice(0, maxAttempts);
    const client = new AbortController(); let clientGone = false;
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) { clientGone = true; client.abort(); } });

    let seq = 0;
    for (const c of candidates) {
      seq++;
      const note = (outcome: string) => db.query('insert into attempt(request_id, seq, route_id, outcome) values($1,$2,$3,$4)', [requestId, seq, c.routeId, outcome]);
      const fb = new AbortController(); const timer = setTimeout(() => fb.abort(), firstByteMs);
      let up: Response, reader: ReadableStreamDefaultReader<Uint8Array> | null = null, first: Uint8Array | undefined;
      try {
        const base = deps.unsafeAllowAnyUpstreamUrl ? c.baseUrl : await assertSafeUpstreamUrl(c.baseUrl, deps.resolveHost); // re-checked at connect time: DNS answers can change
        const out: Record<string, any> = { ...json, model: c.upstreamModel, stream }; // always explicit: some upstreams stream by default when the field is absent
        if (s === 'CHAT') { delete out.max_completion_tokens; out.max_tokens = adm.maxOut; if (stream) out.stream_options = { ...(json.stream_options ?? {}), include_usage: true }; }
        else if (s === 'RESPONSES') { out.max_output_tokens = adm.maxOut; out.store = false; }
        else out.max_tokens = adm.maxOut;
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (s !== 'ANTHROPIC') headers.authorization = `Bearer ${c.apiKey}`;
        else { headers['x-api-key'] = c.apiKey; headers['anthropic-version'] = String(req.headers['anthropic-version'] ?? '2023-06-01'); if (req.headers['anthropic-beta']) headers['anthropic-beta'] = String(req.headers['anthropic-beta']); }
        up = await fetch(base + (s === 'CHAT' ? '/chat/completions' : s === 'RESPONSES' ? '/responses' : '/v1/messages'), { method: 'POST', headers, body: JSON.stringify(out), redirect: 'error', signal: AbortSignal.any([client.signal, fb.signal]) });
        if (up.status === 400 || up.status === 422) { // the request itself is wrong: forward, never fall back, never charge
          clearTimeout(timer); const text = (await up.text()).slice(0, 65_536); await note('rejected_' + up.status);
          await done(null, false, 'FAILED', null, 'upstream_rejected');
          return reply.code(up.status).header('x-request-id', requestId).header('content-type', 'application/json').send(text);
        }
        if (!up.ok || !up.body) { clearTimeout(timer); await up.body?.cancel().catch(() => {}); routeFailed(c.routeId, c.upstreamName, up.status); await note('upstream_' + up.status); continue; }
        if (!stream) {
          const buf = Buffer.from(await up.arrayBuffer()); clearTimeout(timer);
          if (buf.length > GATEWAY_LIMITS.nonStreamBytes) { routeFailed(c.routeId, c.upstreamName); await note('response_too_large'); continue; }
          let parsed: any = null; try { parsed = JSON.parse(buf.toString('utf8')); } catch { /* settled as an estimate below */ }
          health.delete(c.routeId); await note('completed');
          const usage = normalizeUsage(s, parsed?.usage);
          if (usage) await done(usage, false, 'SETTLED', parsed.usage, 'completed'); else await done(estimate(buf.length), true, 'SETTLED_ESTIMATED', parsed?.usage ?? null, 'usage_missing');
          return reply.code(200).header('x-request-id', requestId).header('content-type', 'application/json').send(buf);
        }
        reader = up.body.getReader(); const r = await reader.read(); clearTimeout(timer);
        if (r.done) { routeFailed(c.routeId, c.upstreamName); await note('empty_stream'); continue; }
        first = r.value;
      } catch {
        clearTimeout(timer);
        if (clientGone) { await note('client_cancelled'); await done(null, false, 'CANCELLED', null, 'cancelled_before_first_byte'); return reply; }
        routeFailed(c.routeId, c.upstreamName); await note('connect_or_first_byte_failed'); continue;
      }

      // First byte in hand: this route is committed. No fallback from here on.
      health.delete(c.routeId);
      await db.query("update request set state='STREAMING' where id=$1", [requestId]);
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-request-id': requestId, 'x-accel-buffering': 'no' });
      const obs = new StreamObserver(s); let broke = false; const started = Date.now();
      try {
        obs.push(first!); reply.raw.write(first!);
        for (;;) {
          let idle: NodeJS.Timeout; const next = await Promise.race([reader!.read(), new Promise<never>((_, rej) => { idle = setTimeout(() => rej(new Error('idle')), idleMs); })]).finally(() => clearTimeout(idle!));
          if (next.done) break;
          if (Date.now() - started > maxTotalMs) throw new Error('total duration exceeded');
          obs.push(next.value); if (!reply.raw.write(next.value)) await new Promise(ok => reply.raw.once('drain', ok));
        }
      } catch { broke = true; await reader!.cancel().catch(() => {}); }
      const state = clientGone ? 'CANCELLED' : obs.done && !broke ? 'COMPLETED' : 'FAILED';
      await note(state.toLowerCase()); if (!reply.raw.writableEnded) reply.raw.end();
      try {
        const usage = obs.done ? normalizeUsage(s, obs.usageRaw) : null;
        if (usage) await done(usage, false, 'SETTLED', obs.usageRaw, 'completed');
        else if (obs.contentChars === 0 && !obs.usageRaw) await done(null, false, state === 'COMPLETED' ? 'SETTLED' : state, null, 'no_content'); // zero usage: no charge
        else await done(estimate(obs.contentChars), true, 'SETTLED_ESTIMATED', obs.usageRaw, state === 'CANCELLED' ? 'cancelled_mid_stream' : 'usage_missing'); // content went out but usage did not arrive: not zero
      } catch (e) { app.log.error({ requestId, code: (e as any)?.code }, 'settlement failed; hold stays open for reconciliation'); }
      return reply;
    }
    await done(null, false, 'FAILED', null, candidates.length ? 'all_routes_failed' : 'no_route');
    if (candidates.length) gatewayEvents.emit('all_routes_failed', { model });
    return fail(reply, s, 503, 'upstream_unavailable', 'No upstream is available for this model right now', requestId, 5);
  }

  const opts = { bodyLimit: GATEWAY_LIMITS.bodyBytes };
  app.post('/v1/chat/completions', opts, (req, reply) => guarded('CHAT', req, reply));
  app.post('/v1/messages', opts, (req, reply) => guarded('ANTHROPIC', req, reply));
  app.post('/v1/responses', opts, (req, reply) => guarded('RESPONSES', req, reply));

  /** Models this key can call right now: published price, in key scope, and at least one usable route. */
  app.get('/v1/models', async (req, reply) => {
    try {
      const p = await keys.authenticate(db, secretOf(req));
      const rows = (await db.query(
        `select distinct m.id, extract(epoch from m.created_at)::bigint as created from public_model m
         join price_version pv on pv.model_id=m.id and pv.status='PUBLISHED'
         join route r on r.model_id=m.id and r.enabled 
         join upstream u on u.id=r.upstream_id and u.status='ELIGIBLE' and u.key_enc is not null order by m.id`)).rows;
      const data = rows.filter(r => p.allowedModels === null || p.allowedModels.includes(r.id)).map(r => ({ id: r.id as string, object: 'model', created: Number(r.created), owned_by: 'router' }));
      return { object: 'list', data };
    } catch (e) { return failApp(reply, 'CHAT', e); }
  });
}

/** Tenant-scoped request history (FR-013): metadata only. */
export async function listRequests(db: Db, tenantId: string, q: { before?: string; limit?: string }) {
  const limit = Math.min(Math.max(Number.isInteger(Number(q.limit)) ? Number(q.limit) : 50, 1), 100);
  const before = parseRequestCursor(q.before);
  const rows = (await db.query(`select id, model_id, protocol, stream, state, hold, debit, estimated, usage_norm, unbilled_input_tokens, created_at, ${CURSOR_TIME_SQL} as cursor_time
    from request where tenant_id=$1 and ($2::timestamptz is null or created_at < $2::timestamptz or ($4::text is not null and created_at = $2::timestamptz and id > $4::text))
    order by created_at desc, id limit $3`, [tenantId, before?.time ?? null, limit, before?.id ?? null])).rows;
  return { requests: rows.map(r => ({ id: r.id as string, model: r.model_id as string, protocol: r.protocol as string, stream: r.stream as boolean, state: r.state as string, final: r.debit !== null, heldMicro: String(r.hold), debitMicro: r.debit === null ? null : String(r.debit), estimated: r.estimated as boolean, usage: r.usage_norm, createdAt: (r.created_at as Date).toISOString() })), nextBefore: rows.length === limit ? requestCursor(rows[rows.length - 1].cursor_time as string, rows[rows.length - 1].id as string) : null };
}

/**
 * Recovery for requests left open by a process that died (FR-015, FR-017). Only requests older than the longest
 * possible stream are touched. Nothing sent to the client: the hold is released. Possibly sent: UNRESOLVED, hold kept,
 * an admin decides. Safe to run repeatedly and from several processes.
 */
export async function recoverStuck(db: Db, olderThanSec = 45 * 60): Promise<{ released: number; unresolved: number }> {
  const rows = (await db.query("select id, tenant_id, state from request where debit is null and state in ('ADMITTED','STREAMING') and created_at < now() - make_interval(secs => $1) order by created_at limit 200", [olderThanSec])).rows;
  let released = 0, unresolved = 0;
  for (const r of rows) {
    await withTx(db, async tx => {
      const cur = (await tx.query('select state, debit from request where id=$1 for update', [r.id])).rows[0];
      if (!cur || cur.debit !== null || cur.state !== r.state) return;
      if (r.state === 'ADMITTED') {
        const s = await ledger.settleHold(tx, { tenantId: r.tenant_id, requestId: r.id, debit: 0n });
        if (s.settled) { await tx.query("update request set state='FAILED', debit=0, outcome='recovered_before_first_byte', settled_at=now() where id=$1", [r.id]); released++; }
      } else { await tx.query("update request set state='UNRESOLVED', outcome='process_lost_mid_stream' where id=$1", [r.id]); unresolved++; }
      await audit(tx, { actorKind: 'SYSTEM', action: r.state === 'ADMITTED' ? 'request.recover_release' : 'request.mark_unresolved', targetType: 'request', targetId: r.id });
    });
  }
  return { released, unresolved };
}

export async function listUnresolved(db: Db) {
  const rows = (await db.query("select r.id, u.username, r.model_id, r.hold, r.max_output, r.created_at from request r join membership m on m.tenant_id=r.tenant_id join app_user u on u.id=m.user_id where r.state='UNRESOLVED' order by r.created_at limit 200")).rows;
  return { requests: rows.map(r => ({ id: r.id as string, username: r.username as string, model: r.model_id as string, heldMicro: String(r.hold), maxOutput: r.max_output as number, createdAt: (r.created_at as Date).toISOString() })) };
}

/** Admin decision on an UNRESOLVED request: charge a number of token credits (0 releases the hold), exactly once, with a reason. */
export async function resolveRequest(db: Db, id: string, b: Record<string, unknown>, actorUser: string) {
  if (!/^req_[0-9a-f-]{36}$/.test(id)) throw new AppError('not_found', 'Not found', 404);
  if (typeof b.reason !== 'string' || b.reason.trim().length < 3 || b.reason.length > 500) throw new AppError('invalid_request', 'A reason is required', 400);
  let debit: bigint; try { debit = creditsToMicro(String(typeof b.debitTokens === 'string' ? b.debitTokens : 'x')); } catch { throw new AppError('invalid_request', 'debitTokens must be a whole number given as a string of digits', 400); }
  return withTx(db, async tx => {
    const r = (await tx.query('select tenant_id, state, hold from request where id=$1 for update', [id])).rows[0];
    if (!r) throw new AppError('not_found', 'Not found', 404);
    if (r.state !== 'UNRESOLVED') throw new AppError('not_unresolved', 'This request is not waiting for a decision', 409);
    if (debit > BigInt(r.hold)) throw new AppError('invalid_request', 'The charge cannot exceed the amount held for this request', 400);
    await ledger.settleHold(tx, { tenantId: r.tenant_id, requestId: id, debit, ref: { requestId: id, resolvedBy: actorUser } });
    await tx.query("update request set state='RESOLVED', debit=$2, estimated=true, outcome='resolved_by_admin', settled_at=now() where id=$1", [id, String(debit)]);
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'request.resolve', targetType: 'request', targetId: id, summary: { debitMicro: String(debit), reason: (b.reason as string).trim() } });
    return { id, state: 'RESOLVED', debitMicro: String(debit) };
  });
}
