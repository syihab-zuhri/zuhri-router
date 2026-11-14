import crypto from 'node:crypto';
import { AppError, withTx, type Db } from './db/pool.ts';
import { audit } from './audit.ts';
import { base32, hashPassword, seal, tokenHash, totpMatch, unseal, verifyPassword } from './crypto.ts';
import { passwordLogin, type Principal } from './identity.ts';
import * as rl from './ratelimit.ts';

export const ADMIN_LIMITS = { sessionHours: 8, idleHours: 0.5, stepUpMaxAgeSec: 300, totpPerAccount: 5, totpWindowSec: 900, recoveryCodes: 8 };

/**
 * Create the admin account. Only callable from the operator CLI; there is no HTTP route for it (FR-007).
 * Returns the TOTP seed and recovery codes exactly once.
 */
export async function bootstrapAdmin(db: Db, key: Buffer, a: { username: string; email: string; password: string }): Promise<{ userId: string; totpSecretBase32: string; otpauthUri: string; recoveryCodes: string[] }> {
  if (a.password.length < 14) throw new AppError('weak_password', 'Admin password must be at least 14 characters', 400);
  const secret = crypto.randomBytes(20);
  const codes = Array.from({ length: ADMIN_LIMITS.recoveryCodes }, () => crypto.randomBytes(10).toString('hex'));
  const passwordHash = await hashPassword(a.password);
  const userId = await withTx(db, async tx => {
    const u = (await tx.query("insert into app_user(username, email, password_hash, role) values($1,$2,$3,'ADMIN') returning id", [a.username.toLowerCase(), a.email.toLowerCase(), passwordHash])).rows[0];
    await tx.query('insert into admin_credential(user_id, totp_secret_enc) values($1,$2)', [u.id, seal(key, secret)]);
    for (const c of codes) await tx.query('insert into admin_recovery_code(user_id, code_hash) values($1,$2)', [u.id, tokenHash(c)]);
    await audit(tx, { actorKind: 'SYSTEM', action: 'admin.bootstrap', targetType: 'user', targetId: u.id });
    return u.id as string;
  });
  const b32 = base32(secret);
  return { userId, totpSecretBase32: b32, otpauthUri: `otpauth://totp/Router:${encodeURIComponent(a.username)}?secret=${b32}&issuer=Router&algorithm=SHA1&digits=6&period=30`, recoveryCodes: codes };
}

/** Step 1: password. The session exists but is useless until the second factor is verified. */
export const adminLogin = (db: Db, a: { identifier: string; password: string; ip: string }) =>
  passwordLogin(db, { ...a, role: 'ADMIN', sessionHours: ADMIN_LIMITS.sessionHours });

/**
 * Step 2 and step-up: verify a TOTP code (or a one-time recovery code) and stamp auth_at.
 * A TOTP step is accepted once; wrong codes are rate limited per admin.
 */
export async function verifySecondFactor(db: Db, key: Buffer, p: Principal, code: string, nowMs = Date.now()): Promise<void> {
  const bucket = `totp:${p.userId}`;
  await rl.check(db, bucket, ADMIN_LIMITS.totpPerAccount, ADMIN_LIMITS.totpWindowSec);
  const ok = await withTx(db, async tx => {
    const c = (await tx.query('select totp_secret_enc, last_totp_step from admin_credential where user_id=$1 for update', [p.userId])).rows[0];
    if (!c) return false;
    const input = String(code ?? '').trim();
    let how: string | null = null;
    const step = totpMatch(unseal(key, c.totp_secret_enc), input, nowMs);
    if (step !== null && step > BigInt(c.last_totp_step)) {
      await tx.query('update admin_credential set last_totp_step=$2 where user_id=$1', [p.userId, String(step)]); how = 'totp';
    } else if (/^[0-9a-f]{20}$/.test(input)) {
      const r = await tx.query('update admin_recovery_code set used_at=now() where user_id=$1 and code_hash=$2 and used_at is null', [p.userId, tokenHash(input)]);
      if (r.rowCount === 1) how = 'recovery_code';
    }
    if (!how) return false;
    await tx.query('update session set mfa_verified=true, auth_at=now() where id=$1', [p.sessionId]);
    await audit(tx, { actorUser: p.userId, actorKind: 'ADMIN', action: 'admin.second_factor', targetType: 'session', targetId: p.sessionId, summary: { method: how } });
    return true;
  });
  if (!ok) { await rl.hit(db, bucket, ADMIN_LIMITS.totpWindowSec); throw new AppError('invalid_code', 'The code is not valid', 401); }
  await rl.clear(db, bucket);
}

/** Gate for every admin operation. stepUp=true additionally requires a recent second-factor check. */
export function requireAdmin(p: Principal | null, opts: { stepUp?: boolean } = {}): Principal {
  if (!p || p.role !== 'ADMIN') throw new AppError('unauthorized', 'Sign in required', 401);
  if (!p.mfaVerified) throw new AppError('second_factor_required', 'Second factor required', 401);
  if (opts.stepUp && Date.now() - p.authAt.getTime() > ADMIN_LIMITS.stepUpMaxAgeSec * 1000) throw new AppError('step_up_required', 'Enter your authenticator code to continue', 401);
  return p;
}

const otpauth = (username: string, b32: string) => `otpauth://totp/Router:${encodeURIComponent(username)}?secret=${b32}&issuer=Router&algorithm=SHA1&digits=6&period=30`;

/** Change the admin's own password. Requires the current password; every other admin session is revoked. */
export async function changeAdminPassword(db: Db, p: Principal, a: { current: unknown; next: unknown }): Promise<void> {
  if (typeof a.next !== 'string' || a.next.length < 14 || a.next.length > 200) throw new AppError('weak_password', 'Admin password must be 14 to 200 characters', 400);
  const bucket = `adminpw:${p.userId}`;
  await rl.check(db, bucket, ADMIN_LIMITS.totpPerAccount, ADMIN_LIMITS.totpWindowSec);
  const u = (await db.query("select password_hash from app_user where id=$1 and role='ADMIN' and status='ACTIVE'", [p.userId])).rows[0];
  if (!u || typeof a.current !== 'string' || !(await verifyPassword(a.current, u.password_hash))) { await rl.hit(db, bucket, ADMIN_LIMITS.totpWindowSec); throw new AppError('invalid_credentials', 'Current password does not match', 401); }
  const hash = await hashPassword(a.next);
  await withTx(db, async tx => {
    await tx.query('update app_user set password_hash=$2 where id=$1', [p.userId, hash]);
    await tx.query('update session set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null', [p.userId, p.sessionId]);
    await audit(tx, { actorUser: p.userId, actorKind: 'ADMIN', action: 'admin.password_change', targetType: 'user', targetId: p.userId });
  });
  await rl.clear(db, bucket);
}

/** Step 1 of replacing the authenticator: create a new secret and keep it pending. The current one keeps working. Shown once. */
export async function startTotpRotation(db: Db, key: Buffer, p: Principal): Promise<{ secretBase32: string; otpauthUri: string }> {
  const secret = crypto.randomBytes(20);
  await withTx(db, async tx => {
    const r = await tx.query('update admin_credential set pending_totp_enc=$2 where user_id=$1', [p.userId, seal(key, secret)]);
    if (r.rowCount !== 1) throw new AppError('not_found', 'Not found', 404);
    await audit(tx, { actorUser: p.userId, actorKind: 'ADMIN', action: 'admin.totp_rotation_start', targetType: 'user', targetId: p.userId });
  });
  const b32 = base32(secret);
  return { secretBase32: b32, otpauthUri: otpauth(p.username, b32) };
}

/**
 * Step 2: prove the new authenticator works with one code from it. Only then is the old secret replaced, the old recovery
 * codes discarded, new ones issued (shown once) and every other admin session revoked. A wrong code changes nothing.
 */
export async function confirmTotpRotation(db: Db, key: Buffer, p: Principal, code: unknown, nowMs = Date.now()): Promise<{ recoveryCodes: string[] }> {
  const bucket = `totp:${p.userId}`;
  await rl.check(db, bucket, ADMIN_LIMITS.totpPerAccount, ADMIN_LIMITS.totpWindowSec);
  const codes = Array.from({ length: ADMIN_LIMITS.recoveryCodes }, () => crypto.randomBytes(10).toString('hex'));
  const ok = await withTx(db, async tx => {
    const c = (await tx.query('select pending_totp_enc from admin_credential where user_id=$1 for update', [p.userId])).rows[0];
    if (!c?.pending_totp_enc) throw new AppError('no_rotation', 'There is no authenticator change in progress', 409);
    const step = totpMatch(unseal(key, c.pending_totp_enc), String(code ?? '').trim(), nowMs);
    if (step === null) return false;
    await tx.query('update admin_credential set totp_secret_enc=pending_totp_enc, pending_totp_enc=null, last_totp_step=$2 where user_id=$1', [p.userId, String(step)]);
    await tx.query('delete from admin_recovery_code where user_id=$1', [p.userId]);
    for (const rc of codes) await tx.query('insert into admin_recovery_code(user_id, code_hash) values($1,$2)', [p.userId, tokenHash(rc)]);
    await tx.query('update session set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null', [p.userId, p.sessionId]);
    await tx.query('update session set auth_at=now() where id=$1', [p.sessionId]);
    await audit(tx, { actorUser: p.userId, actorKind: 'ADMIN', action: 'admin.totp_rotation_confirm', targetType: 'user', targetId: p.userId });
    return true;
  });
  if (!ok) { await rl.hit(db, bucket, ADMIN_LIMITS.totpWindowSec); throw new AppError('invalid_code', 'The code is not valid', 401); }
  await rl.clear(db, bucket);
  return { recoveryCodes: codes };
}
