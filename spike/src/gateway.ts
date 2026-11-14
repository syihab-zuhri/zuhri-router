// TASK-006 spike gateway. NOT production code: no rate limits, no TLS, no admin, minimal validation.
// Proves: atomic admission with holds, same-protocol stream relay, fallback before first byte,
// client-cancel propagation, idempotent settlement, zero-usage and missing-usage rules.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { debitMicro, holdMicro, priceToJson, priceFromJson, type Price, type Usage } from './money.ts';

type Protocol = 'chat' | 'anthropic';
export type GatewayOptions = { port: number; pool: pg.Pool; firstByteTimeoutMs?: number; maxAttempts?: number; upstreamKey?: string };
export const hashKey = (k: string) => crypto.createHash('sha256').update(k).digest('hex');

const errBody = (protocol: Protocol, code: string, message: string) =>
  protocol === 'anthropic' ? { type: 'error', error: { type: code, message } } : { error: { code, message, type: code } };

function sendError(res: http.ServerResponse, protocol: Protocol, status: number, code: string, message: string, requestId?: string) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}) });
  res.end(JSON.stringify(errBody(protocol, code, message)));
}

// Incremental SSE reader that extracts usage, content size and the protocol's end marker without altering bytes.
class StreamObserver {
  private buf = ''; private dec = new TextDecoder();
  usageRaw: any = null; contentChars = 0; done = false;
  protocol: Protocol;
  constructor(protocol: Protocol) { this.protocol = protocol; }
  push(chunk: Uint8Array) {
    this.buf += this.dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) { this.event(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 2); }
  }
  private event(block: string) {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { this.done = true; return; }
    let j: any; try { j = JSON.parse(data); } catch { return; }
    if (this.protocol === 'chat') {
      if (j.usage) this.usageRaw = j.usage;
      const t = j.choices?.[0]?.delta?.content; if (typeof t === 'string') this.contentChars += t.length;
    } else {
      if (j.type === 'message_start' && j.message?.usage) this.usageRaw = { ...j.message.usage };
      if (j.type === 'message_delta' && j.usage) this.usageRaw = { ...(this.usageRaw ?? {}), ...j.usage };
      if (j.type === 'content_block_delta' && typeof j.delta?.text === 'string') this.contentChars += j.delta.text.length;
      if (j.type === 'message_stop') this.done = true;
    }
  }
}

// Normalizer v1. Returns null when the usage shape is inconsistent, which must become UNRESOLVED, never a guess.
export function normalize(protocol: Protocol, raw: any): Usage | null {
  if (!raw) return null;
  const n = (v: any) => (Number.isInteger(v) && v >= 0 ? v : null);
  if (protocol === 'chat') {
    const hit = n(raw.prompt_cache_hit_tokens ?? 0), miss = n(raw.prompt_cache_miss_tokens ?? raw.prompt_tokens), out = n(raw.completion_tokens), total = n(raw.prompt_tokens);
    if (hit === null || miss === null || out === null || total === null) return null;
    if (raw.prompt_cache_miss_tokens !== undefined && hit + miss !== total) return null; // inclusive total must equal hit + miss
    return { input: raw.prompt_cache_miss_tokens !== undefined ? miss : total - hit, output: out, cacheRead: hit };
  }
  const inp = n(raw.input_tokens), out = n(raw.output_tokens), hit = n(raw.cache_read_input_tokens ?? 0);
  if (inp === null || out === null || hit === null) return null;
  return { input: inp, output: out, cacheRead: hit }; // Anthropic-style input_tokens is already exclusive of cache
}

export function startGateway(opts: GatewayOptions): Promise<http.Server> {
  const { pool } = opts; const firstByteTimeoutMs = opts.firstByteTimeoutMs ?? 2000; const maxAttempts = opts.maxAttempts ?? 3;

  async function settle(requestId: string, usage: Usage | null, estimated: boolean, state: string, usageRaw: any) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const r = (await c.query('select * from request where id=$1 for update', [requestId])).rows[0];
      if (!r || r.debit !== null) { await c.query('rollback'); return; } // idempotent: already settled
      const price = priceFromJson(r.price_snapshot);
      const debit = usage ? debitMicro(usage, price) : 0n;
      const acc = (await c.query('select id from ledger_account where tenant=$1 for update', [r.tenant])).rows[0];
      if (debit > 0n) await c.query('insert into ledger_entry(account_id,kind,amount,source_id) values($1,$2,$3,$4) on conflict (kind,source_id) do nothing', [acc.id, 'DEBIT_USAGE', String(-debit), requestId]);
      await c.query('update ledger_account set posted=posted-$1, held=held-$2 where id=$3', [String(debit), r.hold, acc.id]);
      await c.query('update request set state=$1, debit=$2, estimated=$3, usage_raw=$4, usage_norm=$5 where id=$6', [state, String(debit), estimated, JSON.stringify(usageRaw), JSON.stringify(usage), requestId]);
      await c.query('commit');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const protocol: Protocol | null = req.url === '/v1/chat/completions' ? 'chat' : req.url === '/v1/messages' ? 'anthropic' : null;
    if (req.method !== 'POST' || !protocol) { res.writeHead(404); return void res.end(); }
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 1_000_000) return sendError(res, protocol, 413, 'request_too_large', 'Body too large'); chunks.push(c); }
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? (req.headers['x-api-key'] as string | undefined);
    if (!auth) return sendError(res, protocol, 401, 'auth_invalid', 'Missing API key');
    const key = (await pool.query('select tenant,status from api_key where key_hash=$1', [hashKey(auth)])).rows[0];
    if (!key) return sendError(res, protocol, 401, 'auth_invalid', 'Invalid API key');
    if (key.status !== 'ACTIVE') return sendError(res, protocol, 401, 'key_revoked', 'API key revoked');
    let json: any; try { json = JSON.parse(bodyText); } catch { return sendError(res, protocol, 400, 'invalid_request', 'Invalid JSON'); }
    const model = String(json.model ?? ''); const maxOut = Number.isInteger(json.max_tokens) && json.max_tokens > 0 ? Math.min(json.max_tokens, 8192) : 1024;
    const maxIn = Math.ceil(Buffer.byteLength(bodyText) / 2); // conservative: assumes 2 bytes per token
    const requestId = 'req_' + crypto.randomUUID();

    // Admission: price snapshot + balance check + hold in one transaction with the account row locked.
    const c = await pool.connect(); let hold = 0n;
    try {
      await c.query('begin');
      const p = (await c.query('select * from price where model=$1', [model])).rows[0];
      if (!p) { await c.query('rollback'); return sendError(res, protocol, 404, 'model_not_available', 'Model is not sold', requestId); }
      const price: Price = { version: p.version, inputRate: BigInt(p.input_rate), outputRate: BigInt(p.output_rate), cacheReadRate: BigInt(p.cache_read_rate), multiplierE4: BigInt(p.multiplier_e4) };
      const acc = (await c.query('select id,posted,held from ledger_account where tenant=$1 for update', [key.tenant])).rows[0];
      hold = holdMicro(maxIn, maxOut, price);
      if (!acc || BigInt(acc.posted) - BigInt(acc.held) < hold) { await c.query('rollback'); return sendError(res, protocol, 402, 'insufficient_balance', 'Insufficient balance', requestId); }
      await c.query('update ledger_account set held=held+$1 where id=$2', [String(hold), acc.id]);
      await c.query('insert into request(id,tenant,model,protocol,state,price_snapshot,hold) values($1,$2,$3,$4,$5,$6,$7)', [requestId, key.tenant, model, protocol, 'ADMITTED', JSON.stringify(priceToJson(price)), String(hold)]);
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); return sendError(res, protocol, 503, 'internal_error', 'Ledger unavailable', requestId); }
    finally { c.release(); } // release on every path, including early rejections

    const routes = (await pool.query('select * from route where model=$1 and protocol=$2 and enabled order by priority', [model, protocol])).rows;
    let clientGone = false; const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) { clientGone = true; ac.abort(); } });

    let seq = 0;
    for (const route of routes.slice(0, maxAttempts)) {
      seq++;
      const note = (outcome: string) => pool.query('insert into attempt(request_id,route_id,seq,outcome) values($1,$2,$3,$4)', [requestId, route.id, seq, outcome]);
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null; let first: Uint8Array | undefined;
      const fb = new AbortController(); const timer = setTimeout(() => fb.abort(), firstByteTimeoutMs);
      try {
        const up = await fetch(route.upstream_url, {
          method: 'POST', signal: AbortSignal.any([ac.signal, fb.signal]),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.upstreamKey ?? 'mock'}`, ...(protocol === 'anthropic' && req.headers['anthropic-version'] ? { 'anthropic-version': String(req.headers['anthropic-version']) } : {}), ...(protocol === 'anthropic' && req.headers['anthropic-beta'] ? { 'anthropic-beta': String(req.headers['anthropic-beta']) } : {}) },
          body: JSON.stringify({ ...json, model: route.upstream_model, max_tokens: maxOut }),
        });
        if (up.status === 400 || up.status === 422) { // request problem: forward, never fall back, never charge
          clearTimeout(timer); await note('rejected_' + up.status); const text = await up.text();
          await settle(requestId, null, false, 'FAILED', null);
          res.writeHead(up.status, { 'content-type': 'application/json', 'x-request-id': requestId }); return void res.end(text);
        }
        if (!up.ok || !up.body) { clearTimeout(timer); await up.body?.cancel(); await note('upstream_' + up.status); continue; }
        reader = up.body.getReader();
        const r = await reader.read(); clearTimeout(timer);
        if (r.done) { await note('empty_stream'); continue; }
        first = r.value;
      } catch (e) {
        clearTimeout(timer);
        if (clientGone) { await note('client_cancelled'); await settle(requestId, null, false, 'CANCELLED', null); return; }
        await note('connect_or_first_byte_failed'); continue;
      }

      // First byte in hand: commit to this route. No fallback from here on.
      await pool.query("update request set state='STREAMING' where id=$1", [requestId]);
      const obs = new StreamObserver(protocol);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-request-id': requestId });
      let broke = false;
      try {
        obs.push(first!); res.write(first!);
        for (;;) { const r = await reader!.read(); if (r.done) break; obs.push(r.value); if (!res.write(r.value)) await new Promise(ok => res.once('drain', ok)); }
      } catch { broke = true; }
      const state = clientGone ? 'CANCELLED' : obs.done && !broke ? 'COMPLETED' : 'FAILED';
      await note(state.toLowerCase());
      if (!res.writableEnded) res.end();

      const usage = obs.done ? normalize(protocol, obs.usageRaw) : null;
      if (usage) return void await settle(requestId, usage, false, 'SETTLED', obs.usageRaw);
      if (obs.contentChars === 0 && !obs.usageRaw) return void await settle(requestId, null, false, state === 'COMPLETED' ? 'SETTLED' : state, null); // zero usage: no charge
      // Missing usage after content was relayed: not zero. Settle from a local estimate, flagged as estimated.
      const est: Usage = { input: maxIn, output: Math.ceil(obs.contentChars / 2), cacheRead: 0 };
      return void await settle(requestId, est, true, 'SETTLED_ESTIMATED', obs.usageRaw);
    }
    await settle(requestId, null, false, 'FAILED', null);
    sendError(res, protocol, 503, 'upstream_unavailable', 'No upstream route succeeded', requestId);
  }

  const server = http.createServer((req, res) => { handle(req, res).catch(e => { console.error('gateway handler error:', e?.message ?? e); if (!res.headersSent) res.writeHead(500); res.end(); }); });
  return new Promise(r => server.listen(opts.port, '127.0.0.1', () => r(server)));
}
