import { AppError, withTx, type Db, type Tx } from './db/pool.ts';
import { audit } from './audit.ts';
import { DUMMY_HASH, hashPassword, newToken, tokenHash, verifyPassword } from './crypto.ts';
import * as ledger from './ledger.ts';
import * as rl from './ratelimit.ts';

/** Sends account email. Receives the raw one-time token; tokens are never stored or logged in plaintext. */
export interface Mailer {
  invite(to: string, token: string): Promise<void>;
  passwordReset(to: string, token: string): Promise<void>;
}

export const LIMITS = {
  inviteTtlHours: 72, resetTtlMinutes: 30,
  customerSessionHours: 24 * 7, customerIdleHours: 24,
  // Tight limit per (account, IP); looser limits per IP and per account across all IPs. An attacker on one network
  // cannot stop the owner signing in from another, and distributed guessing against one account is still capped.
  loginPerAccountIp: 5, loginPerIp: 30, loginPerAccount: 50, loginWindowSec: 900,
  resetPerEmail: 3, resetPerIp: 10, resetWindowSec: 3600,
  closeFailures: 5, closeWindowSec: 900,
  minPasswordLength: 10, maxPasswordLength: 200,
};

const USERNAME = /^[a-z0-9_]{3,24}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const normEmail = (e: string) => e.trim().toLowerCase(); // lower-case only; no provider-specific local-part rules
const normUser = (u: string) => u.trim().toLowerCase();

function assertPassword(p: string) {
  if (typeof p !== 'string' || p.length < LIMITS.minPasswordLength || p.length > LIMITS.maxPasswordLength) throw new AppError('weak_password', `Password must be ${LIMITS.minPasswordLength} to ${LIMITS.maxPasswordLength} characters`, 400);
}

export async function createInvite(db: Db, a: { email: string; adminUser: string }, mailer: Mailer): Promise<{ inviteId: string; emailSent: boolean; manualToken: string | null }> {
  const email = normEmail(a.email);
  if (!EMAIL.test(email)) throw new AppError('invalid_request', 'Invalid email', 400);
  const token = newToken();
  const inviteId = await withTx(db, async tx => {
    await tx.query("select pg_advisory_xact_lock(hashtextextended('identity-email:' || $1, 0))", [email]);
    if ((await tx.query('select 1 from app_user where email=$1', [email])).rowCount) throw new AppError('conflict', 'This email already has an account', 409);
    await tx.query("update invite set status='REVOKED' where email=$1 and status='PENDING'", [email]); // one live invite per email
    const r = (await tx.query("insert into invite(token_hash, email, expires_at, created_by) values($1,$2, now() + make_interval(hours => $3), $4) returning id", [tokenHash(token), email, LIMITS.inviteTtlHours, a.adminUser])).rows[0];
    await audit(tx, { actorUser: a.adminUser, actorKind: 'ADMIN', action: 'invite.create', targetType: 'invite', targetId: r.id, summary: { email } });
    return r.id as string;
  });
  let emailSent = true;
  try { await mailer.invite(email, token); } catch { emailSent = false; }
  // When the email could not be sent, the admin gets the one-time token once to pass on by another channel. It is never stored or logged.
  return { inviteId, emailSent, manualToken: emailSent ? null : token };
}

/** FR-006: activation creates user, tenant, owner membership and ledger account exactly once. */
export async function activateInvite(db: Db, a: { token: string; username: string; password: string }): Promise<{ userId: string; tenantId: string }> {
  const username = normUser(a.username);
  if (!USERNAME.test(username)) throw new AppError('invalid_username', 'Username must be 3 to 24 characters: a-z, 0-9, underscore', 400);
  assertPassword(a.password);
  const passwordHash = await hashPassword(a.password);
  const tokenVerifier = tokenHash(String(a.token));
  const invitation = (await db.query("select email from invite where token_hash=$1 and status='PENDING' and expires_at>now()", [tokenVerifier])).rows[0];
  if (!invitation) throw new AppError('invite_invalid', 'This invitation cannot be used. Ask the seller for a new one.', 400);
  try {
    return await withTx(db, async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended('identity-email:' || $1, 0))", [invitation.email]);
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [username]);
      const inv = (await tx.query("select id, email from invite where token_hash=$1 and status='PENDING' and expires_at > now() for update", [tokenVerifier])).rows[0];
      if (!inv || inv.email !== invitation.email) throw new AppError('invite_invalid', 'This invitation cannot be used. Ask the seller for a new one.', 400);
      if ((await tx.query('select 1 from retired_username where username_hash=$1', [tokenHash(username)])).rowCount) throw new AppError('username_taken', 'This username is already taken', 409);
      const user = (await tx.query("insert into app_user(username, email, password_hash, role) values($1,$2,$3,'CUSTOMER') returning id", [username, inv.email, passwordHash])).rows[0];
      const tenant = (await tx.query('insert into tenant default values returning id')).rows[0];
      await tx.query("insert into membership(user_id, tenant_id, role) values($1,$2,'OWNER')", [user.id, tenant.id]);
      await ledger.createAccount(tx, tenant.id);
      await tx.query("update invite set status='ACCEPTED', accepted_user=$2 where id=$1", [inv.id, user.id]);
      await audit(tx, { actorUser: user.id, actorKind: 'CUSTOMER', action: 'invite.accept', targetType: 'tenant', targetId: tenant.id, summary: { username } });
      return { userId: user.id as string, tenantId: tenant.id as string };
    });
  } catch (e: any) {
    if (e?.code === '23505' && String(e.constraint).includes('username')) throw new AppError('username_taken', 'This username is already taken', 409);
    throw e;
  }
}

export type Principal = { sessionId: string; userId: string; username: string; role: 'CUSTOMER' | 'ADMIN'; tenantId: string | null; tenantStatus: string | null; tenantVersion: string | null; mfaVerified: boolean; authAt: Date };

async function openSession(tx: Tx, userId: string, kind: 'CUSTOMER' | 'ADMIN', hours: number): Promise<string> {
  const token = newToken();
  await tx.query('insert into session(token_hash, user_id, kind, expires_at) values($1,$2,$3, now() + make_interval(hours => $4))', [tokenHash(token), userId, kind, hours]);
  return token;
}

/** Password login shared by customer and admin flows. Uniform failure; limits per account and per IP; no global lockout. */
export async function passwordLogin(db: Db, a: { identifier: string; password: string; ip: string; role: 'CUSTOMER' | 'ADMIN'; sessionHours: number }): Promise<{ token: string; userId: string }> {
  const id = normUser(String(a.identifier ?? '')).slice(0, 254);
  const pairBucket = `login:${a.role}:pair:${id}|${a.ip}`, acctBucket = `login:${a.role}:acct:${id}`, ipBucket = `login:${a.role}:ip:${a.ip}`;
  await rl.check(db, pairBucket, LIMITS.loginPerAccountIp, LIMITS.loginWindowSec);
  await rl.check(db, ipBucket, LIMITS.loginPerIp, LIMITS.loginWindowSec);
  await rl.check(db, acctBucket, LIMITS.loginPerAccount, LIMITS.loginWindowSec);
  const u = (await db.query("select id, password_hash from app_user where (username=$1 or email=$1) and role=$2 and status='ACTIVE'", [id, a.role])).rows[0];
  const ok = await verifyPassword(String(a.password ?? ''), u ? u.password_hash : await DUMMY_HASH); // same work whether or not the account exists
  if (!u || !ok) {
    await rl.hit(db, pairBucket, LIMITS.loginWindowSec); await rl.hit(db, acctBucket, LIMITS.loginWindowSec); await rl.hit(db, ipBucket, LIMITS.loginWindowSec);
    throw new AppError('invalid_credentials', 'Username or password does not match', 401);
  }
  await rl.clear(db, pairBucket);
  const token = await withTx(db, async tx => {
    const current = (await tx.query("select password_hash from app_user where id=$1 and status='ACTIVE' and role=$2 for share", [u.id, a.role])).rows[0];
    if (!current || current.password_hash !== u.password_hash) throw new AppError('invalid_credentials', 'Username or password does not match', 401);
    const t = await openSession(tx, u.id, a.role, a.sessionHours);
    await audit(tx, { actorUser: u.id, actorKind: a.role, action: 'session.login', targetType: 'user', targetId: u.id });
    return t;
  });
  return { token, userId: u.id };
}

export const login = (db: Db, a: { identifier: string; password: string; ip: string }) =>
  passwordLogin(db, { ...a, role: 'CUSTOMER', sessionHours: LIMITS.customerSessionHours });

/** Resolve a raw session token to a principal, enforcing revocation, absolute expiry and idle timeout. */
export async function authenticate(db: Db, token: string | undefined, kind: 'CUSTOMER' | 'ADMIN', idleHours: number): Promise<Principal | null> {
  if (!token || token.length > 200) return null;
  const r = (await db.query(
    `select s.id, s.mfa_verified, s.auth_at, u.id as user_id, u.username, u.role, m.tenant_id, t.status as tenant_status, t.version as tenant_version
     from session s join app_user u on u.id = s.user_id
     left join membership m on m.user_id = u.id left join tenant t on t.id = m.tenant_id
     where s.token_hash=$1 and s.kind=$2 and s.revoked_at is null and s.expires_at > now()
       and s.last_seen_at > now() - make_interval(secs => $3) and u.status='ACTIVE' and u.role=$2`, [tokenHash(token), kind, Math.round(idleHours * 3600)])).rows[0];
  if (!r) return null;
  await db.query("update session set last_seen_at=now() where id=$1 and last_seen_at < now() - interval '1 minute'", [r.id]);
  return { sessionId: r.id, userId: r.user_id, username: r.username, role: r.role, tenantId: r.tenant_id, tenantStatus: r.tenant_status, tenantVersion: r.tenant_version === null ? null : String(r.tenant_version), mfaVerified: r.mfa_verified, authAt: r.auth_at };
}

export async function logout(db: Db, sessionId: string): Promise<void> {
  await db.query('update session set revoked_at=now() where id=$1 and revoked_at is null', [sessionId]);
}
export async function listSessions(db: Db, userId: string) {
  return (await db.query("select id, created_at, last_seen_at from session where user_id=$1 and revoked_at is null and expires_at > now() order by created_at desc", [userId])).rows
    .map(r => ({ id: r.id as string, createdAt: r.created_at.toISOString(), lastSeenAt: r.last_seen_at.toISOString() }));
}
/** Revoke one of the caller's own sessions. Another user's session id behaves as not found. */
export async function revokeSession(db: Db, userId: string, sessionId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new AppError('not_found', 'Not found', 404);
  const r = await db.query('update session set revoked_at=now() where id=$1 and user_id=$2 and revoked_at is null', [sessionId, userId]);
  if (r.rowCount === 0) throw new AppError('not_found', 'Not found', 404);
}

/** Always resolves the same way, whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(db: Db, a: { email: string; ip: string }, mailer: Mailer): Promise<void> {
  const email = normEmail(String(a.email ?? '')).slice(0, 254);
  const eb = `reset:email:${email}`, ib = `reset:ip:${a.ip}`;
  await rl.check(db, ib, LIMITS.resetPerIp, LIMITS.resetWindowSec);
  await rl.hit(db, ib, LIMITS.resetWindowSec);
  try { await rl.check(db, eb, LIMITS.resetPerEmail, LIMITS.resetWindowSec); } catch { return; } // silently ignore excess for one address
  await rl.hit(db, eb, LIMITS.resetWindowSec);
  const u = (await db.query("select id from app_user where email=$1 and status='ACTIVE' and role='CUSTOMER'", [email])).rows[0];
  if (!u) return;
  const token = newToken();
  const created = await withTx(db, async tx => {
    const current = (await tx.query("select 1 from app_user where id=$1 and status='ACTIVE' and role='CUSTOMER' for update", [u.id])).rows[0];
    if (!current) return false;
    await tx.query('update password_reset set used_at=now() where user_id=$1 and used_at is null', [u.id]); // one live token per account
    await tx.query("insert into password_reset(token_hash, user_id, expires_at) values($1,$2, now() + make_interval(mins => $3))", [tokenHash(token), u.id, LIMITS.resetTtlMinutes]);
    await audit(tx, { actorKind: 'ANON', action: 'password_reset.request', targetType: 'user', targetId: u.id });
    return true;
  });
  if (!created) return;
  try { await mailer.passwordReset(email, token); } catch { /* delivery failure must not reveal whether the account exists */ }
}

export async function completePasswordReset(db: Db, a: { token: string; password: string }): Promise<void> {
  assertPassword(a.password);
  const passwordHash = await hashPassword(a.password);
  const hash = tokenHash(String(a.token));
  const owner = (await db.query('select user_id from password_reset where token_hash=$1 and used_at is null and expires_at > now()', [hash])).rows[0];
  if (!owner) throw new AppError('reset_invalid', 'This link cannot be used. Request a new one.', 400);
  await withTx(db, async tx => {
    // All identity mutations lock the user before sessions or reset tokens.
    const user = (await tx.query("select 1 from app_user where id=$1 and status='ACTIVE' and role='CUSTOMER' for update", [owner.user_id])).rows[0];
    if (!user) throw new AppError('reset_invalid', 'This link cannot be used. Request a new one.', 400);
    const r = (await tx.query('select id from password_reset where token_hash=$1 and user_id=$2 and used_at is null and expires_at > now() for update', [hash, owner.user_id])).rows[0];
    if (!r) throw new AppError('reset_invalid', 'This link cannot be used. Request a new one.', 400);
    await tx.query('update app_user set password_hash=$2 where id=$1', [owner.user_id, passwordHash]);
    await tx.query('update session set revoked_at=now() where user_id=$1 and revoked_at is null', [owner.user_id]);
    await tx.query('update password_reset set used_at=now() where user_id=$1 and used_at is null', [owner.user_id]);
    await audit(tx, { actorUser: owner.user_id, actorKind: 'CUSTOMER', action: 'password_reset.complete', targetType: 'user', targetId: owner.user_id });
  });
}

export async function changePassword(db: Db, p: Principal, a: { current: string; next: string }): Promise<void> {
  assertPassword(a.next);
  const u = (await db.query('select password_hash from app_user where id=$1', [p.userId])).rows[0];
  if (!u || !(await verifyPassword(String(a.current ?? ''), u.password_hash))) throw new AppError('invalid_credentials', 'Current password does not match', 401);
  const passwordHash = await hashPassword(a.next);
  await withTx(db, async tx => {
    const current = (await tx.query("select password_hash from app_user where id=$1 and status='ACTIVE' for update", [p.userId])).rows[0];
    if (!current || current.password_hash !== u.password_hash) throw new AppError('invalid_credentials', 'Current password does not match', 401);
    await tx.query('update app_user set password_hash=$2 where id=$1', [p.userId, passwordHash]);
    await tx.query('update session set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null', [p.userId, p.sessionId]);
    await audit(tx, { actorUser: p.userId, actorKind: p.role, action: 'password.change', targetType: 'user', targetId: p.userId });
  });
}

/** Admin lookup by username (FR-014). Returns null when there is no such customer. */
export async function findTenantByUsername(db: Db | Tx, username: string): Promise<{ tenantId: string; userId: string; username: string } | null> {
  const r = (await db.query("select u.id, u.username, m.tenant_id from app_user u join membership m on m.user_id=u.id where u.username=$1 and u.role='CUSTOMER'", [normUser(String(username ?? ''))])).rows[0];
  return r ? { tenantId: r.tenant_id, userId: r.id, username: r.username } : null;
}

/** Admin customer list (SCR-015): keyset pagination by username, optional prefix filter. Metadata only. */
export async function listCustomers(db: Db, q: { after?: string; prefix?: string; limit?: string }) {
  const limit = Math.min(Math.max(Number.isInteger(Number(q.limit)) ? Number(q.limit) : 50, 1), 100);
  const after = typeof q.after === 'string' && /^[a-z0-9_]{1,40}$/.test(q.after) ? q.after : null;
  const prefix = typeof q.prefix === 'string' && /^[a-z0-9_]{1,24}$/.test(q.prefix.toLowerCase()) ? q.prefix.toLowerCase() : null;
  const rows = (await db.query(
    `select u.username, t.status, t.created_at, a.posted, a.held from app_user u join membership m on m.user_id=u.id join tenant t on t.id=m.tenant_id join ledger_account a on a.tenant_id=t.id
     where u.role='CUSTOMER' and u.status='ACTIVE' and ($1::text is null or u.username > $1) and ($2::text is null or left(u.username, length($2)) = $2) order by u.username limit $3`, [after, prefix, limit])).rows;
  return { customers: rows.map(r => ({ username: r.username as string, tenantStatus: r.status as string, createdAt: (r.created_at as Date).toISOString(), postedMicro: String(r.posted), heldMicro: String(r.held) })), nextAfter: rows.length === limit ? rows[rows.length - 1].username as string : null };
}

/** Admin lookup including status and version (FR-014, FR-019). */
export async function findTenantWithState(db: Db, username: string): Promise<{ tenantId: string; userId: string; username: string; userStatus: string; tenantStatus: string; tenantVersion: bigint } | null> {
  const r = (await db.query(
    "select u.id, u.username, u.status as user_status, m.tenant_id, t.status as tenant_status, t.version from app_user u join membership m on m.user_id=u.id join tenant t on t.id=m.tenant_id where u.username=$1 and u.role='CUSTOMER'",
    [normUser(String(username ?? ''))])).rows[0];
  return r ? { tenantId: r.tenant_id, userId: r.id, username: r.username, userStatus: r.user_status, tenantStatus: r.tenant_status, tenantVersion: BigInt(r.version) } : null;
}

/** Optimistic status transition; stale submissions cannot undo a newer operator decision. */
export async function changeTenantStatus(db: Db, a: { username: string; to: 'ACTIVE' | 'SUSPENDED'; expectedVersion: string; reason: string; actorUser: string }): Promise<{ tenantStatus: string; version: string }> {
  if (!/^[1-9][0-9]{0,18}$/.test(a.expectedVersion) || BigInt(a.expectedVersion) >= 9223372036854775807n) throw new AppError('invalid_request', 'Invalid tenant version', 400);
  const reason = a.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new AppError('invalid_request', 'A reason is required', 400);
  return withTx(db, async tx => {
    const row = (await tx.query(
      `select t.id, t.status, t.version from tenant t join membership m on m.tenant_id=t.id
       join app_user u on u.id=m.user_id where u.username=$1 and u.role='CUSTOMER' for update of t`,
      [normUser(a.username)])).rows[0];
    if (!row) throw new AppError('username_not_found', 'No customer with that username', 404);
    if (row.status === 'CLOSED' || String(row.version) !== a.expectedVersion || row.status === a.to) throw new AppError('version_conflict', 'Tenant changed; reload before retrying', 409);
    const version = String(BigInt(row.version) + 1n);
    await tx.query('update tenant set status=$2, version=$3 where id=$1', [row.id, a.to, version]);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: a.to === 'SUSPENDED' ? 'tenant.suspend' : 'tenant.restore', targetType: 'tenant', targetId: row.id, summary: { reason, previousStatus: row.status, nextStatus: a.to, version } });
    return { tenantStatus: a.to, version };
  });
}

/** Close only the authenticated owner's account; financial evidence and admitted holds survive. */
export async function closeAccount(db: Db, p: Principal & { tenantId: string }, a: { currentPassword: string; confirmUsername: string; expectedVersion: string }): Promise<void> {
  if (p.role !== 'CUSTOMER' || a.confirmUsername !== p.username) throw new AppError('invalid_request', 'Confirm your username to close the account', 400);
  if (!/^[1-9][0-9]{0,18}$/.test(a.expectedVersion) || BigInt(a.expectedVersion) >= 9223372036854775807n) throw new AppError('invalid_request', 'Invalid tenant version', 400);
  const bucket = `close:${p.userId}`;
  const owner = (await db.query("select email from app_user where id=$1 and role='CUSTOMER' and status='ACTIVE'", [p.userId])).rows[0];
  if (!owner) throw new AppError('unauthorized', 'Sign in required', 401);
  const valid = await withTx(db, async tx => {
    // Creation, activation and closure serialize email before username and row locks.
    await tx.query("select pg_advisory_xact_lock(hashtextextended('identity-email:' || $1, 0))", [owner.email]);
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [p.username]);
    await rl.check(tx, bucket, LIMITS.closeFailures, LIMITS.closeWindowSec);
    const tenant = (await tx.query(
      `select t.status, t.version from tenant t join membership m on m.tenant_id=t.id
       where t.id=$1 and m.user_id=$2 and m.role='OWNER' for update of t`, [p.tenantId, p.userId])).rows[0];
    if (!tenant || tenant.status === 'CLOSED') throw new AppError('unauthorized', 'Sign in required', 401);
    if (String(tenant.version) !== a.expectedVersion) throw new AppError('version_conflict', 'Tenant changed; reload before retrying', 409);
    const user = (await tx.query("select username, email, password_hash from app_user where id=$1 and role='CUSTOMER' and status='ACTIVE' for update", [p.userId])).rows[0];
    if (!user) throw new AppError('unauthorized', 'Sign in required', 401);
    const session = (await tx.query("select 1 from session where id=$1 and user_id=$2 and kind='CUSTOMER' and revoked_at is null and expires_at>now() for update", [p.sessionId, p.userId])).rows[0];
    if (!session) throw new AppError('unauthorized', 'Sign in required', 401);
    if (!(await verifyPassword(a.currentPassword, user.password_hash))) {
      await rl.hit(tx, bucket, LIMITS.closeWindowSec);
      return false;
    }
    const tombstone = `closed_${p.userId.replaceAll('-', '')}`;
    await tx.query('insert into retired_username(username_hash) values($1)', [tokenHash(user.username)]);
    await tx.query("update tenant set status='CLOSED', version=version+1 where id=$1", [p.tenantId]);
    await tx.query("update app_user set status='CLOSED', username=$2, email=$3, password_hash='CLOSED', anonymized_at=now() where id=$1", [p.userId, tombstone, `${tombstone}@closed.invalid`]);
    const revokedKeys = (await tx.query("update api_key set status='REVOKED',revoked_at=now(),version=version+1 where tenant_id=$1 and status='ACTIVE' returning id", [p.tenantId])).rows;
    for (const key of revokedKeys) await audit(tx, { actorUser: p.userId, actorKind: 'CUSTOMER', action: 'api_key.revoke', targetType: 'api_key', targetId: key.id, summary: { tenantId: p.tenantId, reason: 'account_closed' } });
    await tx.query('update session set revoked_at=now() where user_id=$1 and revoked_at is null', [p.userId]);
    await tx.query('update password_reset set used_at=now() where user_id=$1 and used_at is null', [p.userId]);
    await tx.query("update invite set email=$2, status=case when status='PENDING' then 'REVOKED' else status end where accepted_user=$1 or email=$3", [p.userId, `${tombstone}@closed.invalid`, user.email]);
    await rl.clear(tx, bucket);
    await audit(tx, { actorUser: p.userId, actorKind: 'CUSTOMER', action: 'account.close', targetType: 'tenant', targetId: p.tenantId, summary: { previousStatus: tenant.status, nextStatus: 'CLOSED', version: String(BigInt(tenant.version) + 1n) } });
    return true;
  });
  if (!valid) {
    throw new AppError('invalid_credentials', 'Current password does not match', 401);
  }
}

/**
 * Per-customer usage for the admin (FR-014, API-040): daily totals per model and per API key, plus recent requests.
 * Metadata only; never prompt content. "billed" token counts are what was charged, "unbilled" what the business absorbed.
 */
export async function customerUsage(db: Db, tenantId: string, daysInput: unknown) {
  const days = Math.min(Math.max(Number.isInteger(Number(daysInput)) ? Number(daysInput) : 7, 1), 90);
  const agg = (group: string, label: string) => db.query(
    `select ${group} as k, count(*) as requests, count(*) filter (where r.estimated) as estimated, count(*) filter (where r.state='FAILED') as failed,
            coalesce(sum(r.debit),0) as debit, coalesce(sum(r.unbilled_input_tokens),0) as unbilled,
            coalesce(sum((r.usage_norm->>'input')::bigint + (r.usage_norm->>'cacheRead')::bigint + (r.usage_norm->>'cacheWrite')::bigint),0) as input_tokens,
            coalesce(sum((r.usage_norm->>'output')::bigint),0) as output_tokens
     from request r ${label} where r.tenant_id=$1 and r.created_at > now() - make_interval(days => $2) group by 1 order by 1`, [tenantId, days]);
  const shape = (rows: any[]) => rows.map(r => ({ key: r.k instanceof Date ? r.k.toISOString().slice(0, 10) : String(r.k), requests: Number(r.requests), failed: Number(r.failed), estimated: Number(r.estimated), debitMicro: String(r.debit), inputTokens: String(r.input_tokens), outputTokens: String(r.output_tokens), unbilledInputTokens: String(r.unbilled) }));
  const [byDay, byModel, byKey] = await Promise.all([agg("date_trunc('day', r.created_at)", ''), agg('r.model_id', ''), agg("k.name || ' (' || k.prefix || '…)'", 'join api_key k on k.id=r.api_key_id')]);
  const recent = (await db.query('select id, model_id, protocol, state, debit, estimated, unbilled_input_tokens, created_at from request where tenant_id=$1 order by created_at desc limit 50', [tenantId])).rows;
  return { days, byDay: shape(byDay.rows), byModel: shape(byModel.rows), byKey: shape(byKey.rows),
    recent: recent.map(r => ({ id: r.id as string, model: r.model_id as string, protocol: r.protocol as string, state: r.state as string, debitMicro: r.debit === null ? null : String(r.debit), estimated: r.estimated as boolean, unbilledInputTokens: r.unbilled_input_tokens as number, createdAt: (r.created_at as Date).toISOString() })) };
}
