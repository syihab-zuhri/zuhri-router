// TASK-001 / FR-001: model catalogue, versioned prices, one multiplier per model.
// Not here yet: margin guard against upstream cost (TASK-003) and the customer catalogue (TASK-011).
import type { QueryResultRow } from 'pg';
import { AppError, withTx, type Db, type Tx } from './db/pool.ts';
import { audit } from './audit.ts';
import { debitMicro, RATE_ONE_CREDIT_PER_TOKEN, type Price, type Usage } from './money.ts';

/** Configured bounds. A missing or out-of-range factor is rejected; it never silently becomes 1x. */
export const PRICE_LIMITS = { multiplierMinE4: 1_000n, multiplierMaxE4: 1_000_000n, rateMaxMicro: 1_000_000_000_000_000n };
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const bad = (m: string) => new AppError('invalid_request', m, 400);

export function modelId(v: unknown): string {
  if (typeof v !== 'string' || !MODEL_ID.test(v)) throw bad('Invalid model id');
  return v;
}
/** A category rate left out defaults to one token credit per token, so a model can be priced with the multiplier alone. */
function rate(v: unknown, name: string): bigint {
  if (v === undefined || v === null) return RATE_ONE_CREDIT_PER_TOKEN;
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(v) || BigInt(v) > PRICE_LIMITS.rateMaxMicro) throw bad(`${name} must be an integer string of micro-credits per 1,000,000 tokens`);
  return BigInt(v);
}
/** Decimal string with at most 4 fraction digits, e.g. "1.5". No signs, exponents, NaN or Infinity can pass. */
export function multiplierE4(v: unknown): bigint {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,3})(\.[0-9]{1,4})?$/.test(v)) throw bad('Multiplier must be a positive decimal string with at most 4 decimals');
  const [int, frac = ''] = v.split('.');
  const e4 = BigInt(int) * 10_000n + BigInt(frac.padEnd(4, '0'));
  if (e4 < PRICE_LIMITS.multiplierMinE4 || e4 > PRICE_LIMITS.multiplierMaxE4) throw bad('Multiplier is outside the allowed range (0.1 to 100)');
  return e4;
}
export function versionOf(v: unknown): string {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,17}$/.test(v)) throw bad('Invalid version');
  return v;
}
export type PriceInput = { inputRate: bigint; outputRate: bigint; cacheReadRate: bigint; cacheWriteRate: bigint; multiplierE4: bigint; rateAsOf: string | null };
export function priceInput(b: Record<string, unknown>): PriceInput {
  const asOf = b.rateAsOf ?? null;
  if (asOf !== null && (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(asOf)))) throw bad('rateAsOf must be a date (YYYY-MM-DD)');
  const p = { inputRate: rate(b.inputRateMicro, 'inputRateMicro'), outputRate: rate(b.outputRateMicro, 'outputRateMicro'), cacheReadRate: rate(b.cacheReadRateMicro, 'cacheReadRateMicro'), cacheWriteRate: rate(b.cacheWriteRateMicro, 'cacheWriteRateMicro'), multiplierE4: multiplierE4(b.multiplier), rateAsOf: asOf as string | null };
  if (p.inputRate === 0n || p.outputRate === 0n) throw bad('Input and output rates must be greater than zero'); // an unpriced category must not sell for nothing
  return p;
}

const e4ToString = (e4: bigint) => { const s = (e4 % 10_000n).toString().padStart(4, '0').replace(/0+$/, ''); return `${e4 / 10_000n}${s ? '.' + s : ''}`; };
/** Effective sell rate = base rate x multiplier, exact, as a decimal string of micro-credits per 1,000,000 tokens. */
const effective = (r: bigint, e4: bigint) => e4ToString(r * e4);

function priceView(r: QueryResultRow) {
  const e4 = BigInt(r.multiplier_e4);
  return {
    id: r.id as string, seq: r.seq as number, status: r.status as string, currency: r.currency as string,
    inputRateMicro: String(r.input_rate), outputRateMicro: String(r.output_rate), cacheReadRateMicro: String(r.cache_read_rate), cacheWriteRateMicro: String(r.cache_write_rate),
    multiplier: e4ToString(e4), rateAsOf: r.rate_as_of ? (r.rate_as_of as Date).toISOString().slice(0, 10) : null,
    effective: { inputRateMicro: effective(BigInt(r.input_rate), e4), outputRateMicro: effective(BigInt(r.output_rate), e4), cacheReadRateMicro: effective(BigInt(r.cache_read_rate), e4), cacheWriteRateMicro: effective(BigInt(r.cache_write_rate), e4) },
    publishedAt: r.published_at?.toISOString() ?? null, retiredAt: r.retired_at?.toISOString() ?? null,
  };
}
const toPrice = (r: QueryResultRow): Price => ({ version: r.seq, inputRate: BigInt(r.input_rate), outputRate: BigInt(r.output_rate), cacheReadRate: BigInt(r.cache_read_rate), cacheWriteRate: BigInt(r.cache_write_rate), multiplierE4: BigInt(r.multiplier_e4) });
const PRICE_COLS = 'id, model_id, seq, status, currency, input_rate, output_rate, cache_read_rate, cache_write_rate, multiplier_e4, rate_as_of, published_at, retired_at';

async function lockModel(tx: Tx, id: string, expectedVersion?: string) {
  const m = (await tx.query('select id, display_name, version from public_model where id=$1 for update', [id])).rows[0];
  if (!m) throw new AppError('not_found', 'Not found', 404);
  if (expectedVersion !== undefined && String(m.version) !== expectedVersion) throw new AppError('version_conflict', 'This model was changed by someone else. Reload and try again.', 409);
  return m;
}
async function describe(db: Db | Tx, id: string) {
  const m = (await db.query('select id, display_name, version, archived from public_model where id=$1', [id])).rows[0];
  if (!m) throw new AppError('not_found', 'Not found', 404);
  const rows = (await db.query(`select ${PRICE_COLS} from price_version where model_id=$1 and status in ('DRAFT','PUBLISHED')`, [id])).rows;
  const published = rows.find(r => r.status === 'PUBLISHED'), draft = rows.find(r => r.status === 'DRAFT');
  return { id: m.id as string, displayName: m.display_name as string, version: String(m.version), archived: m.archived as boolean, sellable: !!published, published: published ? priceView(published) : null, draft: draft ? priceView(draft) : null };
}

/** New models start with no price and are therefore not sellable. Nothing is inherited from another model. */
export async function createModel(db: Db, a: { id: string; displayName: string; actorUser: string }) {
  if (typeof a.displayName !== 'string' || !a.displayName.trim() || a.displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(a.displayName)) throw bad('Invalid display name');
  return withTx(db, async tx => {
    const r = await tx.query('insert into public_model(id, display_name, created_by) values($1,$2,$3) on conflict do nothing', [a.id, a.displayName.trim(), a.actorUser]);
    if (r.rowCount === 0) throw new AppError('conflict', 'A model with this id already exists', 409);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: 'model.create', targetType: 'public_model', targetId: a.id });
    return describe(tx, a.id);
  });
}

export async function listModels(db: Db, includeArchived = false) {
  const ids = (await db.query('select id from public_model where ($1 or not archived) order by id', [includeArchived])).rows.map(r => r.id as string);
  return { models: await Promise.all(ids.map(id => describe(db, id))) };
}
export const getModel = (db: Db, id: string) => describe(db, id);

/** Create or replace the single draft of a model. A draft never affects requests. */
export async function saveDraft(db: Db, a: { id: string; expectedVersion: string; price: PriceInput; actorUser: string }) {
  return withTx(db, async tx => {
    await lockModel(tx, a.id, a.expectedVersion);
    const p = a.price;
    const existing = (await tx.query("select id from price_version where model_id=$1 and status='DRAFT'", [a.id])).rows[0];
    if (existing) await tx.query('update price_version set input_rate=$2, output_rate=$3, cache_read_rate=$4, cache_write_rate=$5, multiplier_e4=$6, rate_as_of=$7 where id=$1', [existing.id, String(p.inputRate), String(p.outputRate), String(p.cacheReadRate), String(p.cacheWriteRate), String(p.multiplierE4), p.rateAsOf]);
    else await tx.query('insert into price_version(model_id, seq, input_rate, output_rate, cache_read_rate, cache_write_rate, multiplier_e4, rate_as_of, created_by) values($1, (select coalesce(max(seq),0)+1 from price_version where model_id=$1), $2,$3,$4,$5,$6,$7,$8)', [a.id, String(p.inputRate), String(p.outputRate), String(p.cacheReadRate), String(p.cacheWriteRate), String(p.multiplierE4), p.rateAsOf, a.actorUser]);
    await tx.query('update public_model set version=version+1 where id=$1', [a.id]);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: 'price.draft_save', targetType: 'public_model', targetId: a.id, summary: { multiplier: e4ToString(p.multiplierE4) } });
    return describe(tx, a.id);
  });
}

/** Publish the draft. The previous published version is retired; requests already admitted keep their snapshot. */
export async function publish(db: Db, a: { id: string; expectedVersion: string; reason: string; actorUser: string }) {
  if (typeof a.reason !== 'string' || a.reason.trim().length < 3 || a.reason.length > 500) throw bad('A reason is required');
  return withTx(db, async tx => {
    await lockModel(tx, a.id, a.expectedVersion);
    const draft = (await tx.query(`select ${PRICE_COLS} from price_version where model_id=$1 and status='DRAFT' for update`, [a.id])).rows[0];
    if (!draft) throw new AppError('no_draft', 'There is no draft price to publish', 409);
    const before = (await tx.query(`update price_version set status='RETIRED', retired_at=now() where model_id=$1 and status='PUBLISHED' returning ${PRICE_COLS}`, [a.id])).rows[0];
    await tx.query("update price_version set status='PUBLISHED', published_at=now(), published_by=$2 where id=$1", [draft.id, a.actorUser]);
    await tx.query('update public_model set version=version+1 where id=$1', [a.id]);
    const s = (r: QueryResultRow | undefined) => (r ? `seq=${r.seq} in=${r.input_rate} out=${r.output_rate} cr=${r.cache_read_rate} cw=${r.cache_write_rate} x=${e4ToString(BigInt(r.multiplier_e4))}` : null);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: 'price.publish', targetType: 'public_model', targetId: a.id, summary: { reason: a.reason.trim(), before: s(before), after: s(draft) } });
    return describe(tx, a.id);
  });
}

/** Stop selling a model: the published price is retired and nothing replaces it. */
export async function retire(db: Db, a: { id: string; expectedVersion: string; reason: string; actorUser: string }) {
  if (typeof a.reason !== 'string' || a.reason.trim().length < 3 || a.reason.length > 500) throw bad('A reason is required');
  return withTx(db, async tx => {
    await lockModel(tx, a.id, a.expectedVersion);
    const r = await tx.query("update price_version set status='RETIRED', retired_at=now() where model_id=$1 and status='PUBLISHED' returning seq", [a.id]);
    if (r.rowCount === 0) throw new AppError('not_published', 'This model has no published price', 409);
    await tx.query('update public_model set version=version+1 where id=$1', [a.id]);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: 'price.retire', targetType: 'public_model', targetId: a.id, summary: { reason: a.reason.trim(), seq: r.rows[0].seq } });
    return describe(tx, a.id);
  });
}

/**
 * Archive or restore a model. A model that is still on sale must have its price retired first, so archiving can never
 * silently stop a model customers are using. Archiving also disables the model's routes.
 */
export async function setModelArchived(db: Db, a: { id: string; archived: boolean; expectedVersion: string; actorUser: string }) {
  return withTx(db, async tx => {
    await lockModel(tx, a.id, a.expectedVersion);
    if (a.archived && (await tx.query("select 1 from price_version where model_id=$1 and status='PUBLISHED'", [a.id])).rowCount) throw new AppError('model_on_sale', 'Retire the price before archiving this model', 409);
    await tx.query('update public_model set archived=$2, version=version+1 where id=$1', [a.id, a.archived]);
    if (a.archived) await tx.query('update route set enabled=false, version=version+1 where model_id=$1 and enabled', [a.id]);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: a.archived ? 'model.archive' : 'model.restore', targetType: 'public_model', targetId: a.id });
    return describe(tx, a.id);
  });
}

/** Example charge for a draft or published price, computed with the same function settlement uses. */
export async function preview(db: Db, id: string, which: 'draft' | 'published', usage: Usage) {
  const r = (await db.query(`select ${PRICE_COLS} from price_version where model_id=$1 and status=$2`, [id, which === 'draft' ? 'DRAFT' : 'PUBLISHED'])).rows[0];
  if (!r) throw new AppError('not_found', 'Not found', 404);
  let debit: bigint;
  try { debit = debitMicro(usage, toPrice(r)); } catch { throw bad('Token counts must be non-negative integers'); }
  return { price: priceView(r), usage, debitMicro: String(debit) };
}

/**
 * Admission primitive for the gateway (TASK-012): the price a new request is charged at, or null when the model is not sold.
 * The caller stores the returned snapshot with the request; later price changes never touch it.
 */
export async function snapshotForAdmission(tx: Db | Tx, id: string): Promise<{ priceVersionId: string; price: Price; currency: string } | null> {
  const r = (await tx.query(`select ${PRICE_COLS} from price_version where model_id=$1 and status='PUBLISHED'`, [id])).rows[0];
  return r ? { priceVersionId: r.id, price: toPrice(r), currency: r.currency } : null;
}

/** n / 10^scale as an exact decimal string without trailing zeros. */
function scaled(n: bigint, scale: number): string {
  const s = n.toString().padStart(scale + 1, '0'); const frac = s.slice(-scale).replace(/0+$/, '');
  return s.slice(0, -scale) + (frac ? '.' + frac : '');
}
/**
 * Customer catalogue (FR-010, TASK-011): models that can be called right now, with what one token costs in token credits.
 * A model appears only with a published price and at least one enabled route on an eligible upstream. No upstream names or costs.
 */
export async function catalogue(db: Db) {
  const rows = (await db.query(
    `select m.id, m.display_name, pv.input_rate, pv.output_rate, pv.cache_read_rate, pv.cache_write_rate, pv.multiplier_e4,
            array_agg(distinct r.protocol order by r.protocol) as protocols
     from public_model m join price_version pv on pv.model_id=m.id and pv.status='PUBLISHED' and not m.archived
     join route r on r.model_id=m.id and r.enabled join upstream u on u.id=r.upstream_id and u.status='ELIGIBLE' and u.key_enc is not null
     group by m.id, m.display_name, pv.input_rate, pv.output_rate, pv.cache_read_rate, pv.cache_write_rate, pv.multiplier_e4 order by m.id`)).rows;
  const per = (rate: unknown, e4: bigint) => scaled(BigInt(rate as string) * e4, 16); // micro per 1M tokens x multiplier(e4) -> credits per token
  return { models: rows.map(r => { const e4 = BigInt(r.multiplier_e4); return { id: r.id as string, displayName: r.display_name as string, multiplier: e4ToString(e4), protocols: r.protocols as string[],
    creditsPerToken: { input: per(r.input_rate, e4), output: per(r.output_rate, e4), cacheRead: per(r.cache_read_rate, e4), cacheWrite: per(r.cache_write_rate, e4) } }; }) };
}
