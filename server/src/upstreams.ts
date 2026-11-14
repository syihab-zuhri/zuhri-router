// TASK-013 / FR-012: upstream registry (base URL per protocol, write-only API key, eligibility) and per-model routes.
// Not here yet: cost profiles and margin guard (TASK-003), connection test, circuit breaker (gateway, TASK-012).
import type { QueryResultRow } from 'pg';
import { AppError, withTx, type Db, type Tx } from './db/pool.ts';
import { audit } from './audit.ts';
import { seal, unseal } from './crypto.ts';
import { assertSafeUpstreamUrl, type Resolver } from './netguard.ts';

export const PROTOCOLS = ['CHAT', 'ANTHROPIC', 'RESPONSES'] as const;
export type Protocol = (typeof PROTOCOLS)[number];
const URL_COL: Record<Protocol, string> = { CHAT: 'base_url_chat', ANTHROPIC: 'base_url_anthropic', RESPONSES: 'base_url_responses' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (m: string) => new AppError('invalid_request', m, 400);
const notFound = () => new AppError('not_found', 'Not found', 404);
const uuid = (v: unknown) => { if (typeof v !== 'string' || !UUID.test(v)) throw notFound(); return v; };
const text = (v: unknown, max: number, name: string, allowEmpty = false) => { if (typeof v !== 'string' || v.length > max || (!allowEmpty && !v.trim()) || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)) throw bad(`Invalid ${name}`); return v.trim(); };
const versionOf = (v: unknown) => { if (typeof v !== 'string' || !/^[1-9][0-9]{0,17}$/.test(v)) throw bad('Invalid version'); return v; };
function apiKey(v: unknown): string {
  if (typeof v !== 'string' || v.length < 8 || v.length > 500 || /\s/.test(v)) throw bad('Invalid API key');
  return v;
}

/** The API key never leaves the server: views only say whether one is stored and when it was set. */
const view = (r: QueryResultRow) => ({
  id: r.id as string, name: r.name as string, status: r.status as string,
  baseUrls: { CHAT: r.base_url_chat as string | null, ANTHROPIC: r.base_url_anthropic as string | null, RESPONSES: r.base_url_responses as string | null },
  keySet: r.key_enc !== null, keySetAt: r.key_set_at?.toISOString() ?? null, termsNote: r.terms_note as string, archived: r.archived as boolean, version: String(r.version),
});

async function urls(b: Record<string, unknown>, resolve: Resolver) {
  const src = (b.baseUrls && typeof b.baseUrls === 'object' ? b.baseUrls : {}) as Record<string, unknown>;
  const out = {} as Record<Protocol, string | null>;
  for (const p of PROTOCOLS) out[p] = src[p] === undefined || src[p] === null || src[p] === '' ? null : await assertSafeUpstreamUrl(src[p], resolve);
  if (PROTOCOLS.every(p => out[p] === null)) throw bad('At least one base URL is required');
  return out;
}

export async function create(db: Db, key: Buffer, resolve: Resolver, b: Record<string, unknown>, actorUser: string) {
  const name = text(b.name, 80, 'name'); const u = await urls(b, resolve); const secret = apiKey(b.apiKey); const note = text(b.termsNote ?? '', 2000, 'note', true);
  return withTx(db, async tx => {
    let r: QueryResultRow;
    try { r = (await tx.query('insert into upstream(name, base_url_chat, base_url_anthropic, base_url_responses, key_enc, key_set_at, terms_note) values($1,$2,$3,$4,$5,now(),$6) returning *', [name, u.CHAT, u.ANTHROPIC, u.RESPONSES, seal(key, Buffer.from(secret, 'utf8')), note])).rows[0]; }
    catch (e: any) { if (e?.code === '23505') throw new AppError('conflict', 'An upstream with this name already exists', 409); throw e; }
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'upstream.create', targetType: 'upstream', targetId: r.id, summary: { name, chat: u.CHAT, anthropic: u.ANTHROPIC, responses: u.RESPONSES } });
    return view(r);
  });
}

/** Full replacement of name, URLs and note. Changing any base URL requires the API key again, so a key is never sent to a new host by accident. */
export async function update(db: Db, key: Buffer, resolve: Resolver, id: string, b: Record<string, unknown>, actorUser: string) {
  uuid(id); const expected = versionOf(b.expectedVersion); const name = text(b.name, 80, 'name'); const u = await urls(b, resolve); const note = text(b.termsNote ?? '', 2000, 'note', true);
  const secret = b.apiKey === undefined || b.apiKey === null ? null : apiKey(b.apiKey);
  return withTx(db, async tx => {
    const old = (await tx.query('select * from upstream where id=$1 for update', [id])).rows[0];
    if (!old) throw notFound();
    if (String(old.version) !== expected) throw new AppError('version_conflict', 'This upstream was changed by someone else. Reload and try again.', 409);
    const urlChanged = PROTOCOLS.some(p => old[URL_COL[p]] !== u[p]);
    if (urlChanged && secret === null) throw new AppError('api_key_required', 'Enter the API key again when changing a base URL', 400);
    const r = (await tx.query(`update upstream set name=$2, base_url_chat=$3, base_url_anthropic=$4, base_url_responses=$5, terms_note=$6, version=version+1${secret === null ? '' : ', key_enc=$7, key_set_at=now()'} where id=$1 returning *`,
      secret === null ? [id, name, u.CHAT, u.ANTHROPIC, u.RESPONSES, note] : [id, name, u.CHAT, u.ANTHROPIC, u.RESPONSES, note, seal(key, Buffer.from(secret, 'utf8'))])).rows[0];
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'upstream.update', targetType: 'upstream', targetId: id, summary: { urlChanged, keyReplaced: secret !== null } });
    return view(r);
  });
}

export async function setStatus(db: Db, id: string, b: Record<string, unknown>, actorUser: string) {
  uuid(id); const expected = versionOf(b.expectedVersion); const reason = text(b.reason, 500, 'reason');
  if (b.status !== 'PENDING' && b.status !== 'ELIGIBLE' && b.status !== 'BLOCKED') throw bad('Invalid status');
  return withTx(db, async tx => {
    const old = (await tx.query('select * from upstream where id=$1 for update', [id])).rows[0];
    if (!old) throw notFound();
    if (String(old.version) !== expected) throw new AppError('version_conflict', 'This upstream was changed by someone else. Reload and try again.', 409);
    const r = (await tx.query('update upstream set status=$2, version=version+1 where id=$1 returning *', [id, b.status])).rows[0];
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'upstream.status', targetType: 'upstream', targetId: id, summary: { from: old.status, to: b.status as string, reason } });
    return view(r);
  });
}

export async function list(db: Db, includeArchived = false) {
  return { upstreams: (await db.query('select * from upstream where ($1 or not archived) order by name', [includeArchived])).rows.map(view) };
}

/** Archive or restore an upstream. Archiving blocks it and disables its routes, so nothing is sent there any more. Restoring leaves it BLOCKED. */
export async function setArchived(db: Db, id: string, b: Record<string, unknown>, actorUser: string) {
  uuid(id); const expected = versionOf(b.expectedVersion); if (typeof b.archived !== 'boolean') throw bad('Invalid request');
  return withTx(db, async tx => {
    const old = (await tx.query('select * from upstream where id=$1 for update', [id])).rows[0];
    if (!old) throw notFound();
    if (String(old.version) !== expected) throw new AppError('version_conflict', 'This upstream was changed by someone else. Reload and try again.', 409);
    const r = (await tx.query("update upstream set archived=$2, status='BLOCKED', version=version+1 where id=$1 returning *", [id, b.archived])).rows[0];
    if (b.archived) await tx.query('update route set enabled=false, version=version+1 where upstream_id=$1 and enabled', [id]);
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: b.archived ? 'upstream.archive' : 'upstream.restore', targetType: 'upstream', targetId: id, summary: { name: old.name } });
    return view(r);
  });
}

/**
 * Ask an upstream which model ids it offers, using the stored key, so route forms can offer a list instead of free typing.
 * Read-only GET to the upstream's model list. Returns ids only; nothing from the upstream's answer is passed through otherwise.
 */
export async function fetchModelIds(db: Db, key: Buffer, resolve: Resolver, id: string, protocolInput: unknown, unsafeAllowAnyUrl = false) {
  uuid(id); if (!PROTOCOLS.includes(protocolInput as Protocol)) throw bad('Invalid protocol');
  const protocol = protocolInput as Protocol;
  const u = (await db.query('select * from upstream where id=$1', [id])).rows[0];
  if (!u) throw notFound();
  const base = u[URL_COL[protocol]] as string | null;
  if (!base || !u.key_enc) throw new AppError('protocol_not_offered', 'This upstream has no base URL or key for that protocol', 409);
  const apiKey = unseal(key, u.key_enc).toString('utf8');
  const unavailable = (why: string) => new AppError('upstream_models_unavailable', `The upstream did not return a model list (${why}). Type the model id by hand.`, 502);
  let ids: string[];
  try {
    const url = (unsafeAllowAnyUrl ? base : await assertSafeUpstreamUrl(base, resolve)) + (protocol === 'ANTHROPIC' ? '/v1/models' : '/models');
    const res = await fetch(url, { headers: protocol === 'ANTHROPIC' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw unavailable('HTTP ' + res.status); }
    const text = await res.text(); if (text.length > 2_000_000) throw unavailable('answer too large');
    const data = JSON.parse(text)?.data; if (!Array.isArray(data)) throw unavailable('unexpected answer');
    ids = [...new Set(data.map((m: any) => m?.id).filter((x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/\[\]-]{0,127}$/.test(x)))].sort().slice(0, 2000);
  } catch (e) { if (e instanceof AppError) throw e; throw unavailable('no usable answer'); }
  return { upstreamId: id, protocol, models: ids };
}

// ---- Routes: which upstream serves which public model, per protocol ----
const routeView = (r: QueryResultRow) => ({ id: r.id as string, modelId: r.model_id as string, upstreamId: r.upstream_id as string, protocol: r.protocol as Protocol, upstreamModel: r.upstream_model as string, priority: r.priority as number, enabled: r.enabled as boolean, maxConcurrency: r.max_concurrency as number | null, version: String(r.version) });
function routeInput(b: Record<string, unknown>) {
  if (typeof b.upstreamModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/\[\]-]{0,127}$/.test(b.upstreamModel)) throw bad('Invalid upstream model');
  const priority = b.priority ?? 100; if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 1 || priority > 1000) throw bad('Priority must be 1 to 1000');
  const mc = b.maxConcurrency ?? null; if (mc !== null && (typeof mc !== 'number' || !Number.isInteger(mc) || mc < 1 || mc > 100000)) throw bad('Invalid concurrency limit');
  return { upstreamModel: b.upstreamModel, priority, enabled: b.enabled !== false, maxConcurrency: mc as number | null };
}
export async function createRoute(db: Db, b: Record<string, unknown>, actorUser: string) {
  const upstreamId = uuid(b.upstreamId); const r = routeInput(b);
  if (typeof b.modelId !== 'string' || b.modelId.length > 128) throw bad('Invalid model id');
  if (!PROTOCOLS.includes(b.protocol as Protocol)) throw bad('Invalid protocol');
  const protocol = b.protocol as Protocol;
  return withTx(db, async tx => {
    if (!(await tx.query('select 1 from public_model where id=$1 and not archived', [b.modelId])).rowCount) throw new AppError('model_not_found', 'No such model', 404);
    const up = (await tx.query('select * from upstream where id=$1 and not archived for share', [upstreamId])).rows[0];
    if (!up) throw new AppError('upstream_not_found', 'No such upstream', 404);
    if (up[URL_COL[protocol]] === null) throw new AppError('protocol_not_offered', 'This upstream has no base URL for that protocol', 409);
    let row: QueryResultRow;
    try { row = (await tx.query('insert into route(model_id, upstream_id, protocol, upstream_model, priority, enabled, max_concurrency) values($1,$2,$3,$4,$5,$6,$7) returning *', [b.modelId, upstreamId, protocol, r.upstreamModel, r.priority, r.enabled, r.maxConcurrency])).rows[0]; }
    catch (e: any) { if (e?.code === '23505') throw new AppError('conflict', 'This model already has a route to that upstream for this protocol', 409); throw e; }
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'route.create', targetType: 'route', targetId: row.id, summary: { modelId: b.modelId as string, upstream: up.name, protocol, upstreamModel: r.upstreamModel, priority: r.priority } });
    return routeView(row);
  });
}
export async function updateRoute(db: Db, id: string, b: Record<string, unknown>, actorUser: string) {
  uuid(id); const expected = versionOf(b.expectedVersion); const r = routeInput(b);
  return withTx(db, async tx => {
    const old = (await tx.query('select * from route where id=$1 for update', [id])).rows[0];
    if (!old) throw notFound();
    if (String(old.version) !== expected) throw new AppError('version_conflict', 'This route was changed by someone else. Reload and try again.', 409);
    const row = (await tx.query('update route set upstream_model=$2, priority=$3, enabled=$4, max_concurrency=$5, version=version+1 where id=$1 returning *', [id, r.upstreamModel, r.priority, r.enabled, r.maxConcurrency])).rows[0];
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'route.update', targetType: 'route', targetId: id, summary: { before: `${old.upstream_model} p${old.priority} enabled=${old.enabled}`, after: `${r.upstreamModel} p${r.priority} enabled=${r.enabled}` } });
    return routeView(row);
  });
}
export async function listRoutes(db: Db, modelId?: string) {
  const rows = (await db.query('select r.* from route r join public_model m on m.id=r.model_id join upstream u on u.id=r.upstream_id where ($1::text is null or r.model_id=$1) and not m.archived and not u.archived order by r.model_id, r.protocol, r.priority, r.id', [modelId ?? null])).rows;
  return { routes: rows.map(routeView) };
}

export type Candidate = { routeId: string; upstreamId: string; upstreamName: string; baseUrl: string; upstreamModel: string; apiKey: string; maxConcurrency: number | null };
/**
 * Routing primitive for the gateway (TASK-012): candidates for a model on one protocol surface, best first.
 * Only enabled routes on ELIGIBLE upstreams that offer the same protocol and have a key. The decrypted key is for
 * the outbound request only and must never be logged or returned to a client.
 */
export async function candidatesFor(db: Db | Tx, key: Buffer, modelId: string, protocol: Protocol): Promise<Candidate[]> {
  const rows = (await db.query(
    `select r.id, r.upstream_model, r.max_concurrency, u.id as upstream_id, u.name, u.key_enc, u.${URL_COL[protocol]} as base_url
     from route r join upstream u on u.id = r.upstream_id
     where r.model_id=$1 and r.protocol=$2 and r.enabled and u.status='ELIGIBLE' and not u.archived and u.key_enc is not null and u.${URL_COL[protocol]} is not null
     order by r.priority, r.created_at, r.id`, [modelId, protocol])).rows;
  return rows.map(r => ({ routeId: r.id, upstreamId: r.upstream_id, upstreamName: r.name, baseUrl: r.base_url, upstreamModel: r.upstream_model, apiKey: unseal(key, r.key_enc).toString('utf8'), maxConcurrency: r.max_concurrency }));
}
