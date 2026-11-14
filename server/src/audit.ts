import type { Tx } from './db/pool.ts';

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
