import { AppError, type Db, type Tx } from './db/pool.ts';
import { audit } from './audit.ts';
import { sha256Hex } from './crypto.ts';
import * as keys from './keys.ts';

export const DEFAULT_OVERDRAFT_MICRO = 500_000n * 1_000_000n;
/** Overrun allowance in micro-credits (FR: a customer may exceed the balance by this much before being stopped). */
export async function overdraftMicro(db: Db | Tx): Promise<bigint> {
  const r = (await db.query("select value from system_setting where name='overdraft_micro'")).rows[0];
  if (!r) throw new AppError('internal_error', 'Overdraft setting is missing', 503); // fail closed
  return BigInt(r.value);
}
export async function setOverdraft(tx: Tx, a: { micro: bigint; actorUser: string }): Promise<void> {
  if (a.micro < 0n || a.micro > 9_000_000_000_000_000n) throw new AppError('invalid_request', 'Invalid allowance', 400);
  const before = await overdraftMicro(tx);
  await tx.query("update system_setting set value=$1, updated_by=$2, updated_at=now() where name='overdraft_micro'", [String(a.micro), a.actorUser]);
  await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: 'setting.overdraft', targetType: 'system_setting', targetId: 'overdraft_micro', summary: { beforeMicro: String(before), afterMicro: String(a.micro) } });
}
/**
 * Admission rule: a request needs a positive available balance, and its hold may reach into the overrun allowance.
 * Settlement can therefore take the balance below zero, but never by more than the allowance plus a bound violation.
 */
function assertFunds(available: bigint, hold: bigint, overdraft: bigint) {
  if (available <= 0n || available + overdraft < hold) throw new AppError('insufficient_balance', 'Insufficient balance', 402);
}

export type Balance = { posted: bigint; held: bigint; available: bigint; currency: string };

async function lockAccount(tx: Tx, tenantId: string) {
  const a = (await tx.query('select id, posted, held, currency from ledger_account where tenant_id=$1 for update', [tenantId])).rows[0];
  if (!a) throw new AppError('not_found', 'Not found', 404);
  return { id: a.id as string, posted: BigInt(a.posted), held: BigInt(a.held), currency: a.currency as string };
}
/** lockAccount plus the overrun allowance, read in the same round trip (admission needs both). */
async function lockAccountForAdmission(tx: Tx, tenantId: string) {
  const a = (await tx.query("select id, posted, held, (select value from system_setting where name='overdraft_micro') as overdraft from ledger_account where tenant_id=$1 for update", [tenantId])).rows[0];
  if (!a) throw new AppError('not_found', 'Not found', 404);
  if (a.overdraft === null) throw new AppError('internal_error', 'Overdraft setting is missing', 503); // fail closed
  return { id: a.id as string, available: BigInt(a.posted) - BigInt(a.held), overdraft: BigInt(a.overdraft) };
}

export async function createAccount(tx: Tx, tenantId: string): Promise<void> {
  await tx.query('insert into ledger_account(tenant_id) values($1)', [tenantId]);
}

export async function getBalance(db: Db | Tx, tenantId: string): Promise<Balance> {
  const a = (await db.query('select posted, held, currency from ledger_account where tenant_id=$1', [tenantId])).rows[0];
  if (!a) throw new AppError('not_found', 'Not found', 404);
  const posted = BigInt(a.posted), held = BigInt(a.held);
  return { posted, held, available: posted - held, currency: a.currency };
}

/**
 * Idempotency guard for money-moving operations. Same key + same payload returns the stored result;
 * same key + different payload is a conflict. Must run inside the operation's transaction.
 */
async function once<T extends object>(tx: Tx, scope: string, key: string, payload: unknown, run: () => Promise<T>): Promise<T & { replayed: boolean }> {
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new AppError('invalid_request', 'Invalid idempotency key', 400);
  const hash = sha256Hex(JSON.stringify(payload));
  const ins = await tx.query("insert into idempotency_record(scope, key, payload_hash, result) values($1,$2,$3,'{}') on conflict do nothing", [scope, key, hash]);
  if (ins.rowCount === 0) {
    const prev = (await tx.query('select payload_hash, result from idempotency_record where scope=$1 and key=$2 for update', [scope, key])).rows[0];
    if (prev.payload_hash !== hash) throw new AppError('idempotency_conflict', 'This key was already used with different values', 409);
    return { ...(prev.result as T), replayed: true };
  }
  const result = await run();
  await tx.query('update idempotency_record set result=$3 where scope=$1 and key=$2', [scope, key, JSON.stringify(result)]);
  return { ...result, replayed: false };
}

export type GrantResult = { entryId: string; amount: string; postedAfter: string; createdAt?: string };

/** Admin direct top-up (FR-014). Positive micro-credit amount; one ledger entry; audited. */
export async function grantAdminTopup(tx: Tx, a: { tenantId: string; amount: bigint; saleRef: string; actorUser: string; idemKey: string }): Promise<GrantResult & { replayed: boolean }> {
  if (a.amount <= 0n) throw new AppError('invalid_request', 'Amount must be positive', 400);
  if (a.saleRef.length < 1 || a.saleRef.length > 200) throw new AppError('invalid_request', 'Sale reference is required', 400);
  return once(tx, 'admin_topup', a.idemKey, { tenantId: a.tenantId, amount: String(a.amount), saleRef: a.saleRef }, async () => {
    const acc = await lockAccount(tx, a.tenantId);
    const e = (await tx.query(
      "insert into ledger_entry(account_id, kind, amount, idem_key, ref, actor_user) values($1,'GRANT_ADMIN_TOPUP',$2,$3,$4,$5) returning id, created_at",
      [acc.id, String(a.amount), a.idemKey, JSON.stringify({ saleRef: a.saleRef }), a.actorUser])).rows[0];
    await tx.query('update ledger_account set posted = posted + $1 where id=$2', [String(a.amount), acc.id]);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: 'ledger.admin_topup', targetType: 'tenant', targetId: a.tenantId, summary: { amountMicro: String(a.amount), saleRef: a.saleRef, entryId: String(e.id) } });
    return { entryId: String(e.id), amount: String(a.amount), postedAfter: String(acc.posted + a.amount), createdAt: (e.created_at as Date).toISOString() };
  });
}

/** Credit for a redeemed code. The voucher id is the idempotency key, so one code can never credit twice. */
export async function grantRedeem(tx: Tx, a: { tenantId: string; amount: bigint; voucherId: string; actorUser: string }): Promise<GrantResult> {
  if (a.amount <= 0n) throw new AppError('invalid_request', 'Amount must be positive', 400);
  const acc = await lockAccount(tx, a.tenantId);
  const e = (await tx.query("insert into ledger_entry(account_id, kind, amount, idem_key, ref, actor_user) values($1,'GRANT_REDEEM',$2,$3,$4,$5) returning id",
    [acc.id, String(a.amount), a.voucherId, JSON.stringify({ voucherId: a.voucherId }), a.actorUser])).rows[0];
  await tx.query('update ledger_account set posted = posted + $1 where id=$2', [String(a.amount), acc.id]);
  return { entryId: String(e.id), amount: String(a.amount), postedAfter: String(acc.posted + a.amount) };
}

/** Correction as a new linked entry; existing entries are never edited. */
export async function adjust(tx: Tx, a: { tenantId: string; amount: bigint; reason: string; actorUser: string; idemKey: string }): Promise<GrantResult & { replayed: boolean }> {
  if (a.amount === 0n) throw new AppError('invalid_request', 'Amount must not be zero', 400);
  if (a.reason.trim().length < 3 || a.reason.length > 500) throw new AppError('invalid_request', 'A reason is required', 400);
  return once(tx, 'adjustment', a.idemKey, { tenantId: a.tenantId, amount: String(a.amount), reason: a.reason }, async () => {
    const acc = await lockAccount(tx, a.tenantId);
    const kind = a.amount > 0n ? 'ADJUSTMENT_CREDIT' : 'ADJUSTMENT_DEBIT';
    const e = (await tx.query('insert into ledger_entry(account_id, kind, amount, idem_key, ref, actor_user) values($1,$2,$3,$4,$5,$6) returning id',
      [acc.id, kind, String(a.amount), a.idemKey, JSON.stringify({ reason: a.reason }), a.actorUser])).rows[0];
    await tx.query('update ledger_account set posted = posted + $1 where id=$2', [String(a.amount), acc.id]);
    await audit(tx, { actorUser: a.actorUser, actorKind: 'ADMIN', action: 'ledger.adjustment', targetType: 'tenant', targetId: a.tenantId, summary: { amountMicro: String(a.amount), reason: a.reason, entryId: String(e.id) } });
    return { entryId: String(e.id), amount: String(a.amount), postedAfter: String(acc.posted + a.amount) };
  });
}

/** Admission primitive: reserve funds atomically. Fails when available balance is below the hold. */
export async function placeHold(tx: Tx, a: { tenantId: string; requestId: string; amount: bigint }): Promise<void> {
  if (a.amount <= 0n) throw new AppError('invalid_request', 'Hold must be positive', 400);
  const tenant = (await tx.query('select status from tenant where id=$1 for share', [a.tenantId])).rows[0];
  if (!tenant) throw new AppError('not_found', 'Not found', 404);
  if (tenant.status === 'SUSPENDED') throw new AppError('tenant_suspended', 'Tenant is suspended', 403);
  if (tenant.status !== 'ACTIVE') throw new AppError('auth_invalid', 'Account is closed', 401);
  const acc = await lockAccount(tx, a.tenantId);
  assertFunds(acc.posted - acc.held, a.amount, await overdraftMicro(tx));
  await tx.query('insert into hold(account_id, request_id, amount) values($1,$2,$3)', [acc.id, a.requestId, String(a.amount)]);
  await tx.query('update ledger_account set held = held + $1 where id=$2', [String(a.amount), acc.id]);
}

const MAX_HOLD = 9223372036854775807n;
/**
 * Tenant -> account -> key lock order matches settlement; no caller-supplied tenant/key identity.
 * `amount` may be a function of the locked funds, so a hold that has to be capped to what fits is sized under the account lock.
 * Five round trips: key, tenant share lock, account with allowance, key lock, then one statement for all three writes.
 */
export async function placeKeyHold(tx: Tx, a: { secret: string; requestId: string; amount: bigint | ((funds: { available: bigint; overdraft: bigint }) => bigint); model: string }): Promise<{ tenantId: string; keyId: string; amount: bigint }> {
  const valid = (n: bigint) => { if (n <= 0n || n > MAX_HOLD) throw new AppError('invalid_request', 'Invalid hold amount', 400); return n; };
  if (typeof a.amount === 'bigint') valid(a.amount);
  const initial = await keys.authenticate(tx, a.secret);
  const tenant = (await tx.query('select status from tenant where id=$1 for share', [initial.tenantId])).rows[0];
  if (!tenant || tenant.status === 'CLOSED') throw new AppError('auth_invalid', 'Invalid API key', 401);
  if (tenant.status !== 'ACTIVE') throw new AppError('tenant_suspended', 'Tenant is suspended', 403);
  const account = await lockAccountForAdmission(tx, initial.tenantId);
  const amount = valid(typeof a.amount === 'bigint' ? a.amount : a.amount({ available: account.available, overdraft: account.overdraft }));
  const key = await keys.authenticate(tx, a.secret, true);
  if (key.allowedModels !== null && !key.allowedModels.includes(a.model)) throw new AppError('model_not_available', 'Model is outside the key scope', 403);
  if (key.spendLimit !== null && key.spent + key.held + amount > key.spendLimit) throw new AppError('limit_exceeded', 'API key spending limit reached', 429);
  assertFunds(account.available, amount, account.overdraft);
  const w = (await tx.query(
    `with h as (insert into hold(account_id,request_id,amount,tenant_id,api_key_id) values($1,$2,$3,$4,$5) returning 1),
          a as (update ledger_account set held=held+$3 where id=$1 returning 1),
          k as (update api_key set held=held+$3,last_used_at=case when last_used_at is null or last_used_at<clock_timestamp()-interval '1 minute' then clock_timestamp() else last_used_at end where tenant_id=$4 and id=$5 returning 1)
     select (select count(*) from h)::int as holds, (select count(*) from a)::int as accounts, (select count(*) from k)::int as keys`,
    [account.id, a.requestId, String(amount), key.tenantId, key.keyId])).rows[0];
  if (w.holds !== 1 || w.accounts !== 1 || w.keys !== 1) throw new AppError('internal_error', 'Hold accounting unavailable', 500);
  return { tenantId: key.tenantId, keyId: key.keyId, amount };
}

/**
 * Settlement primitive: close the hold and post the final debit exactly once per request.
 * debit may be zero (zero usage: no entry) and may exceed the hold (bound violation: still charged, reported).
 */
export async function settleHold(tx: Tx, a: { tenantId: string; requestId: string; debit: bigint; ref?: Record<string, unknown> }): Promise<{ settled: boolean; boundExceeded: boolean }> {
  if (a.debit < 0n) throw new AppError('invalid_request', 'Debit must not be negative', 400);
  const acc = await lockAccount(tx, a.tenantId);
  const h = (await tx.query('select id, amount, status, api_key_id from hold where request_id=$1 and account_id=$2 for update', [a.requestId, acc.id])).rows[0];
  if (!h) throw new AppError('not_found', 'Not found', 404);
  if (h.status !== 'ACTIVE') return { settled: false, boundExceeded: false }; // already settled: replay is a no-op
  const held = BigInt(h.amount);
  // One statement for every write. Account and hold are locked above, so the key row is the only lock taken here: still last,
  // as before. The counts prove each write landed exactly once.
  const w = (await tx.query(
    `with k as (update api_key set held=held-$4::bigint, spent=spent+$5::bigint where $3::uuid is not null and tenant_id=$2 and id=$3 returning 1),
          e as (insert into ledger_entry(account_id, kind, amount, idem_key, ref) select $1::uuid, 'DEBIT_USAGE', -$5::bigint, $6::text, $7::jsonb where $5::bigint > 0 returning 1),
          a as (update ledger_account set posted=posted-$5::bigint, held=held-$4::bigint where id=$1 returning 1),
          h as (update hold set status=$9, closed_at=now(), settled_debit=$5::bigint where id=$8 returning 1)
     select (select count(*) from k)::int as keys, (select count(*) from e)::int as entries, (select count(*) from a)::int as accounts, (select count(*) from h)::int as holds`,
    [acc.id, a.tenantId, h.api_key_id, String(held), String(a.debit), a.requestId, JSON.stringify(a.ref ?? {}), h.id, a.debit > 0n ? 'CAPTURED' : 'RELEASED'])).rows[0];
  if (h.api_key_id && w.keys !== 1) throw new AppError('internal_error', 'Key accounting unavailable', 500);
  if (w.accounts !== 1 || w.holds !== 1 || w.entries !== (a.debit > 0n ? 1 : 0)) throw new AppError('internal_error', 'Ledger accounting unavailable', 500);
  return { settled: true, boundExceeded: a.debit > held };
}

export type Entry = { id: string; kind: string; amount: string; ref: unknown; createdAt: string };
/** Tenant-scoped ledger history, newest first, keyset pagination. */
export async function listEntries(db: Db, tenantId: string, opts: { before?: string; limit?: number } = {}): Promise<Entry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const before = opts.before && /^[0-9]+$/.test(opts.before) ? opts.before : null;
  const rows = (await db.query(
    `select e.id, e.kind, e.amount, e.ref, e.created_at from ledger_entry e join ledger_account a on a.id = e.account_id
     where a.tenant_id = $1 and ($2::bigint is null or e.id < $2::bigint) order by e.id desc limit $3`, [tenantId, before, limit])).rows;
  return rows.map(r => ({ id: String(r.id), kind: r.kind, amount: String(r.amount), ref: r.ref, createdAt: r.created_at.toISOString() }));
}

/** NFR-001: stored balance equals the sum of entries, and held equals the sum of active holds, for every account. */
export async function invariantViolations(db: Db): Promise<{ accountId: string; problem: string }[]> {
  const rows = (await db.query(
    `select a.id, a.posted, a.held,
            coalesce((select sum(amount) from ledger_entry e where e.account_id = a.id), 0) as entries,
            coalesce((select sum(amount) from hold h where h.account_id = a.id and h.status = 'ACTIVE'), 0) as holds
     from ledger_account a`)).rows;
  const out: { accountId: string; problem: string }[] = [];
  for (const r of rows) {
    if (BigInt(r.posted) !== BigInt(r.entries)) out.push({ accountId: r.id, problem: 'posted_differs_from_entries' });
    if (BigInt(r.held) !== BigInt(r.holds)) out.push({ accountId: r.id, problem: 'held_differs_from_active_holds' });
  }
  const keyRows = (await db.query(
    `select a.id as account_id, k.id, k.spent, k.held,
       coalesce((select sum(h.amount) from hold h where h.api_key_id=k.id and h.status='ACTIVE'),0) as active_holds,
       coalesce((select sum(h.settled_debit) from hold h where h.api_key_id=k.id and h.status<>'ACTIVE'),0) as settled
     from api_key k join ledger_account a on a.tenant_id=k.tenant_id`)).rows;
  for (const r of keyRows) {
    if (BigInt(r.held) !== BigInt(r.active_holds)) out.push({ accountId: r.account_id, problem: `key:${r.id}:held_differs_from_active_holds` });
    if (BigInt(r.spent) !== BigInt(r.settled)) out.push({ accountId: r.account_id, problem: `key:${r.id}:spent_differs_from_settlements` });
  }
  return out;
}
