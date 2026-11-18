// Operator controls (TASK-018, SCR-014 and SCR-017): the gateway kill switch and the request list across tenants.
import { AppError, type Db, type Tx } from './db/pool.ts';
import { audit } from './audit.ts';

export type GatewayState = { paused: boolean; reason: string | null; changedAt: string | null; changedBy: string | null };

/** Current kill switch state. A missing setting refuses service rather than letting requests through. */
export async function gatewayState(db: Db | Tx): Promise<GatewayState> {
  const r = (await db.query("select s.value, s.note, s.updated_by, s.updated_at, u.username from system_setting s left join app_user u on u.id = s.updated_by where s.name = 'gateway_paused'")).rows[0];
  if (!r) throw new AppError('internal_error', 'Gateway setting is missing', 503); // fail closed
  const changed = r.updated_by !== null;
  return { paused: String(r.value) !== '0', reason: r.note ?? null, changedAt: changed ? (r.updated_at as Date).toISOString() : null, changedBy: changed ? (r.username ?? null) : null };
}

/** The per-request check in the gateway: one indexed read, no join. */
export async function gatewayPaused(db: Db): Promise<boolean> {
  const r = (await db.query("select value from system_setting where name = 'gateway_paused'")).rows[0];
  if (!r) throw new AppError('internal_error', 'Gateway setting is missing', 503); // fail closed
  return String(r.value) !== '0';
}

/** Body of POST /admin/api/settings/gateway: {paused: true, reason} or {paused: false}. */
export function parseGatewayChange(b: Record<string, unknown>): { paused: boolean; reason: string | null } {
  if (b.paused === false) return { paused: false, reason: null };
  if (b.paused !== true) throw new AppError('invalid_request', 'paused must be true or false', 400);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < 1 || reason.length > 200) throw new AppError('invalid_request', 'A reason of 1 to 200 characters is required to pause the service', 400);
  return { paused: true, reason };
}

/** Pause or resume. Setting the state it already has (same reason) changes nothing and writes no audit event. */
export async function setGatewayPaused(tx: Tx, a: { paused: boolean; reason: string | null; actorUser: string }): Promise<void> {
  const cur = (await tx.query("select value, note from system_setting where name = 'gateway_paused' for update")).rows[0];
  if (!cur) throw new AppError('internal_error', 'Gateway setting is missing', 503);
  const was = String(cur.value) !== '0';
  if (was === a.paused && (!a.paused || cur.note === a.reason)) return;
  await tx.query("update system_setting set value = $1, note = $2, updated_by = $3, updated_at = now() where name = 'gateway_paused'", [a.paused ? 1 : 0, a.reason, a.actorUser]);
  await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: a.paused ? 'setting.gateway_pause' : 'setting.gateway_resume', targetType: 'system_setting', targetId: 'gateway_paused',
    summary: a.paused ? { reason: a.reason } : { previousReason: cur.note ?? null } });
}

// States a request row can hold, plus the documented lifecycle states that are never stored (COMPLETED, REJECTED) so the
// filter accepts every name in docs/ARCHITECTURE.md section 2. RESOLVED is the state after an admin decides an UNRESOLVED request.
export const REQUEST_STATES = ['ADMITTED', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SETTLED', 'SETTLED_ESTIMATED', 'UNRESOLVED', 'RESOLVED', 'REJECTED'] as const;

const filter = (v: unknown, max: number): string | null => {
  if (v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.length > max) throw new AppError('invalid_request', 'Invalid filter', 400);
  return v;
};

/** Request metadata across all customers (SCR-017), newest first. Never prompt or response content. */
export async function listAllRequests(db: Db, q: Record<string, unknown>) {
  const username = filter(q.username, 64), model = filter(q.model, 128), state = filter(q.state, 32);
  if (state !== null && !(REQUEST_STATES as readonly string[]).includes(state)) throw new AppError('invalid_request', 'Unknown request state', 400);
  const limit = Math.min(Math.max(Number.isInteger(Number(q.limit)) ? Number(q.limit) : 50, 1), 100);
  const before = typeof q.before === 'string' && !Number.isNaN(Date.parse(q.before)) ? q.before : null;
  const rows = (await db.query(
    `select r.id, u.username, k.name as key_name, r.model_id, r.protocol, r.stream, r.state, r.outcome, r.hold, r.debit, r.estimated, r.usage_norm, r.created_at
     from request r
     join membership m on m.tenant_id = r.tenant_id
     join app_user u on u.id = m.user_id
     left join api_key k on k.tenant_id = r.tenant_id and k.id = r.api_key_id
     where ($1::text is null or u.username = $1) and ($2::text is null or r.state = $2) and ($3::text is null or r.model_id = $3)
       and ($4::timestamptz is null or r.created_at < $4::timestamptz)
     order by r.created_at desc, r.id limit $5`, [username, state, model, before, limit])).rows;
  return {
    requests: rows.map(r => ({ id: r.id as string, username: r.username as string, keyName: (r.key_name ?? null) as string | null, model: r.model_id as string, protocol: r.protocol as string, stream: r.stream as boolean,
      state: r.state as string, outcome: (r.outcome ?? null) as string | null, final: r.debit !== null, heldMicro: String(r.hold), debitMicro: r.debit === null ? null : String(r.debit), estimated: r.estimated as boolean,
      usage: r.usage_norm ?? null, createdAt: (r.created_at as Date).toISOString() })),
    nextBefore: rows.length === limit ? (rows[rows.length - 1].created_at as Date).toISOString() : null,
  };
}
