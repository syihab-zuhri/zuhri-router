import { AppError, type Db, type Tx } from './db/pool.ts';

export type AuditInput = {
  actorUser?: string | null; actorKind: 'ADMIN' | 'CUSTOMER' | 'SYSTEM' | 'ANON';
  action: string; targetType: string; targetId?: string | null;
  /** Never put secrets, tokens, codes, passwords or prompt content here. */
  summary?: Record<string, string | number | boolean | null>;
};

/** Append one audit event inside the caller's transaction, so the action and its record commit together. */
export async function audit(tx: Tx, e: AuditInput): Promise<void> {
  await tx.query(
    'insert into audit_event(actor_user, actor_kind, action, target_type, target_id, summary) values($1,$2,$3,$4,$5,$6)',
    [e.actorUser ?? null, e.actorKind, e.action, e.targetType, e.targetId ?? null, JSON.stringify(e.summary ?? {})]);
}

const auditFilter = (v: unknown, max: number): string | null => {
  if (v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.length > max) throw new AppError('invalid_request', 'Invalid filter', 400);
  return v;
};

/**
 * Audit events for the admin screen (SCR-018), newest first, 50 per page. Filters: `action` matches the start of the action
 * name (so `setting.` lists every setting change), `actor` is an exact username, `targetType` and `targetId` are exact.
 */
export async function listAudit(db: Db, q: Record<string, unknown>) {
  const action = auditFilter(q.action, 64), actor = auditFilter(q.actor, 64), targetType = auditFilter(q.targetType, 64), targetId = auditFilter(q.targetId, 200);
  const before = typeof q.before === 'string' && /^[0-9]{1,18}$/.test(q.before) ? q.before : null;
  const prefix = action === null ? null : action.replace(/[\\%_]/g, c => '\\' + c) + '%';
  const rows = (await db.query(
    `select e.id, e.actor_user, u.username as actor_username, e.actor_kind, e.action, e.target_type, e.target_id, e.summary, e.created_at
     from audit_event e left join app_user u on u.id = e.actor_user
     where ($1::bigint is null or e.id < $1::bigint) and ($2::text is null or e.action like $2)
       and ($3::text is null or u.username = $3) and ($4::text is null or e.target_type = $4) and ($5::text is null or e.target_id = $5)
     order by e.id desc limit 50`, [before, prefix, actor, targetType, targetId])).rows;
  return {
    events: rows.map(r => ({ id: String(r.id), actorUser: r.actor_user as string | null, actorUsername: (r.actor_username ?? null) as string | null, actorKind: r.actor_kind as string,
      action: r.action as string, targetType: r.target_type as string, targetId: r.target_id as string | null, summary: r.summary, createdAt: (r.created_at as Date).toISOString() })),
    nextBefore: rows.length === 50 ? String(rows[rows.length - 1].id) : null,
  };
}
