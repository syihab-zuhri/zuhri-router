import type { QueryResultRow } from 'pg';
import { AppError, withTx, type Db, type Tx } from './db/pool.ts';
import { audit } from './audit.ts';
import { newToken, tokenHash } from './crypto.ts';
import type { Principal } from './identity.ts';

export const KEY_LIMITS = { activePerTenant: 10, modelsPerKey: 100 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MONEY = 9223372036854775807n;
const fields = 'id, name, prefix, allowed_models, spend_limit, spent, held, expires_at, status, version, created_at, last_used_at, revoked_at';
export type KeyPolicy = { name: string; allowedModels: string[] | null; spendLimitMicro: string | null; expiresAt: string | null };

export function policy(input: Record<string, unknown>): KeyPolicy {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\u0000-\u001f\u007f]/.test(input.name)) throw new AppError('invalid_request', 'Invalid key name', 400);
  const models = input.allowedModels ?? null;
  if (models !== null && (!Array.isArray(models) || models.length > KEY_LIMITS.modelsPerKey || models.some(m => typeof m !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/.test(m)) || new Set(models).size !== models.length)) throw new AppError('invalid_request', 'Invalid model scope', 400);
  const money = input.spendLimitMicro ?? null;
  if (money !== null && (typeof money !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(money) || BigInt(money) > MAX_MONEY)) throw new AppError('invalid_request', 'Invalid spending limit', 400);
  const expires = input.expiresAt ?? null;
  if (expires !== null && (typeof expires !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires) || !Number.isFinite(Date.parse(expires)) || new Date(expires).toISOString() !== expires || Date.parse(expires) <= Date.now())) throw new AppError('invalid_request', 'Expiry must be a future UTC timestamp', 400);
  return { name: input.name.trim(), allowedModels: models === null ? null : [...models].sort(), spendLimitMicro: money, expiresAt: expires };
}

export function version(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) >= MAX_MONEY) throw new AppError('invalid_request', 'Invalid key version', 400);
  return value;
}
function keyId(id: string) {
  if (!UUID.test(id)) throw new AppError('not_found', 'Not found', 404);
}
function view(r: QueryResultRow) {
  return { id: r.id as string, name: r.name as string, maskedKey: r.prefix + '...', allowedModels: r.allowed_models as string[] | null,
    spendLimitMicro: r.spend_limit === null ? null : String(r.spend_limit), spentMicro: String(r.spent), heldMicro: String(r.held),
    expiresAt: r.expires_at?.toISOString() ?? null, status: r.status === 'ACTIVE' && r.expires_at && r.expires_at <= new Date() ? 'EXPIRED' : r.status as string,
    version: String(r.version), createdAt: r.created_at.toISOString(), lastUsedAt: r.last_used_at?.toISOString() ?? null, revokedAt: r.revoked_at?.toISOString() ?? null };
}

async function ownerAccess(tx: Tx, p: Principal, exclusive = false): Promise<string> {
  if (p.role !== 'CUSTOMER' || !p.tenantId) throw new AppError('unauthorized', 'Sign in required', 401);
  const t = (await tx.query(`select status from tenant where id=$1 for ${exclusive ? 'update' : 'share'}`, [p.tenantId])).rows[0];
  if (!t || t.status === 'CLOSED') throw new AppError('unauthorized', 'Sign in required', 401);
  const u = (await tx.query("select 1 from app_user u join membership m on m.user_id=u.id where u.id=$1 and m.tenant_id=$2 and m.role='OWNER' and u.role='CUSTOMER' and u.status='ACTIVE' for share of u", [p.userId, p.tenantId])).rows[0];
  const s = (await tx.query("select 1 from session where id=$1 and user_id=$2 and kind='CUSTOMER' and revoked_at is null and expires_at>now() and last_seen_at>now()-interval '24 hours' for share", [p.sessionId, p.userId])).rows[0];
  if (!u || !s) throw new AppError('unauthorized', 'Sign in required', 401);
  return p.tenantId;
}

export async function create(db: Db, p: Principal, data: KeyPolicy, creationKey: string) {
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(creationKey)) throw new AppError('invalid_request', 'Invalid idempotency key', 400);
  return withTx(db, async tx => {
    const tenantId = await ownerAccess(tx, p, true);
    if ((await tx.query('select 1 from api_key where tenant_id=$1 and creation_key_hash=$2', [tenantId, tokenHash(creationKey)])).rowCount) throw new AppError('key_already_created', 'Key already created; secret cannot be shown again. Revoke it if lost.', 409);
    const count = (await tx.query("select count(*) n from api_key where tenant_id=$1 and status='ACTIVE' and (expires_at is null or expires_at>now())", [tenantId])).rows[0].n;
    if (BigInt(count) >= BigInt(KEY_LIMITS.activePerTenant)) throw new AppError('key_limit_reached', 'Revoke an old key before creating another', 409);
    const secret = 'rtr_' + newToken();
    const r = (await tx.query(`insert into api_key(tenant_id,name,prefix,token_hash,creation_key_hash,allowed_models,spend_limit,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8) returning ${fields}`, [tenantId, data.name, secret.slice(0, 12), tokenHash(secret), tokenHash(creationKey), data.allowedModels, data.spendLimitMicro, data.expiresAt])).rows[0];
    await audit(tx, { actorUser: p.userId, actorKind: 'CUSTOMER', action: 'api_key.create', targetType: 'api_key', targetId: r.id, summary: { tenantId } });
    return { key: view(r), secret };
  });
}

export type KeyPrincipal = { tenantId: string; keyId: string; allowedModels: string[] | null; spendLimit: bigint | null; spent: bigint; held: bigint };

/** A preflight only; admission must recheck under tenant/account/key locks. */
export async function authenticate(db: Db | Tx, secret: string, lock = false): Promise<KeyPrincipal> {
  if (typeof secret !== 'string' || !/^rtr_[A-Za-z0-9_-]{43}$/.test(secret)) throw new AppError('auth_invalid', 'Invalid API key', 401);
  const row = (await db.query(
    `select k.id, k.tenant_id, k.allowed_models, k.spend_limit, k.spent, k.held, k.status,
     k.expires_at, t.status as tenant_status, clock_timestamp() as checked_at
     from api_key k join tenant t on t.id=k.tenant_id where k.token_hash=$1 ${lock ? 'for update of k' : ''}`,
    [tokenHash(secret)])).rows[0];
  if (!row || row.tenant_status === 'CLOSED') throw new AppError('auth_invalid', 'Invalid API key', 401);
  if (row.status !== 'ACTIVE') throw new AppError('key_revoked', 'API key was revoked', 401);
  if (row.expires_at !== null && row.expires_at <= row.checked_at) throw new AppError('auth_invalid', 'Invalid API key', 401);
  if (row.tenant_status !== 'ACTIVE') throw new AppError('tenant_suspended', 'Tenant is suspended', 403);
  return { tenantId: row.tenant_id, keyId: row.id, allowedModels: row.allowed_models, spendLimit: row.spend_limit === null ? null : BigInt(row.spend_limit), spent: BigInt(row.spent), held: BigInt(row.held) };
}

export async function list(db: Db, tenantId: string, opts: { after?: string; limit?: string } = {}) {
  if (opts.after) keyId(opts.after);
  if (opts.limit !== undefined && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(opts.limit)) throw new AppError('invalid_request', 'Invalid page size', 400);
  const limit = opts.limit === undefined ? 50 : Number(opts.limit);
  const rows = (await db.query(`select ${fields} from api_key where tenant_id=$1 and ($2::uuid is null or id>$2::uuid) order by id limit $3`, [tenantId, opts.after ?? null, limit + 1])).rows;
  const page = rows.slice(0, limit);
  return { keys: page.map(view), nextAfter: rows.length > limit ? page[page.length - 1].id as string : null };
}
export async function get(db: Db, tenantId: string, id: string) {
  keyId(id);
  const r = (await db.query(`select ${fields} from api_key where tenant_id=$1 and id=$2`, [tenantId, id])).rows[0];
  if (!r) throw new AppError('not_found', 'Not found', 404);
  return { key: view(r) };
}
export async function update(db: Db, p: Principal, id: string, expectedVersion: string, data: KeyPolicy) {
  keyId(id); version(expectedVersion);
  return withTx(db, async tx => {
    const tenantId = await ownerAccess(tx, p, true);
    const row = (await tx.query(`select ${fields} from api_key where tenant_id=$1 and id=$2 for update`, [tenantId, id])).rows[0];
    if (!row) throw new AppError('not_found', 'Not found', 404);
    if (String(row.version) !== expectedVersion || row.status !== 'ACTIVE' || (row.expires_at !== null && row.expires_at <= new Date())) throw new AppError('version_conflict', 'Key changed or expired; create a new key instead', 409);
    if (data.spendLimitMicro !== null && BigInt(data.spendLimitMicro) < BigInt(row.spent) + BigInt(row.held)) throw new AppError('limit_conflict', 'Limit is below spent plus reserved funds', 409);
    const result = (await tx.query(`update api_key set name=$3,allowed_models=$4,spend_limit=$5,expires_at=$6,version=version+1 where tenant_id=$1 and id=$2 returning ${fields}`, [tenantId, id, data.name, data.allowedModels, data.spendLimitMicro, data.expiresAt])).rows[0];
    await audit(tx, { actorUser: p.userId, actorKind: 'CUSTOMER', action: 'api_key.update', targetType: 'api_key', targetId: id, summary: { tenantId, previousVersion: expectedVersion, version: String(result.version) } });
    return { key: view(result) };
  });
}
export async function revoke(db: Db, p: Principal, tenantId: string, id: string, expectedVersion: string) {
  keyId(id); version(expectedVersion);
  return withTx(db, async tx => {
    if (p.role === 'CUSTOMER') {
      if (tenantId !== p.tenantId) throw new AppError('not_found', 'Not found', 404);
      await ownerAccess(tx, p);
    } else {
      if (p.role !== 'ADMIN') throw new AppError('unauthorized', 'Sign in required', 401);
      await tx.query('select id from tenant where id=$1 for share', [tenantId]);
      const user = (await tx.query("select 1 from app_user where id=$1 and role='ADMIN' and status='ACTIVE' for share", [p.userId])).rows[0];
      const session = (await tx.query("select mfa_verified,auth_at,clock_timestamp() as checked_at from session where id=$1 and user_id=$2 and kind='ADMIN' and revoked_at is null and expires_at>clock_timestamp() and last_seen_at>clock_timestamp()-interval '30 minutes' for share", [p.sessionId,p.userId])).rows[0];
      if (!user || !session) throw new AppError('unauthorized', 'Sign in required', 401);
      if (!session.mfa_verified) throw new AppError('second_factor_required', 'Second factor required', 401);
      if (session.checked_at.getTime()-session.auth_at.getTime()>300_000) throw new AppError('step_up_required', 'Second factor required', 401);
    }
    const row = (await tx.query(`select ${fields} from api_key where tenant_id=$1 and id=$2 for update`, [tenantId, id])).rows[0];
    if (!row) throw new AppError('not_found', 'Not found', 404);
    if (String(row.version) !== expectedVersion || row.status !== 'ACTIVE') throw new AppError('version_conflict', 'Key changed; reload before retrying', 409);
    const result = (await tx.query(`update api_key set status='REVOKED',revoked_at=now(),version=version+1 where tenant_id=$1 and id=$2 returning ${fields}`, [tenantId, id])).rows[0];
    await audit(tx, { actorUser: p.userId, actorKind: p.role, action: 'api_key.revoke', targetType: 'api_key', targetId: id, summary: { tenantId, previousVersion: expectedVersion, version: String(result.version) } });
    return { key: view(result) };
  });
}
