// Token packs and redeem codes (FR-004, FR-005; unit per docs/TOKEN_CREDIT.md).
import crypto from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { AppError, withTx, type Db } from './db/pool.ts';
import { audit } from './audit.ts';
import { tokenHash } from './crypto.ts';
import { creditsToMicro } from './money.ts';
import * as identity from './identity.ts';
import * as ledger from './ledger.ts';
import * as rl from './ratelimit.ts';

export const REDEEM_LIMITS = { invalidPerAccount: 5, invalidPerIp: 30, windowSec: 900 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (m: string) => new AppError('invalid_request', m, 400);
const text = (v: unknown, max: number, name: string) => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw bad(`Invalid ${name}`); return v.trim(); };
const whole = (v: unknown, name: string) => { if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,11})$/.test(v)) throw bad(`${name} must be a whole number given as a string of digits`); return BigInt(v); };
const versionOf = (v: unknown) => { if (typeof v !== 'string' || !/^[1-9][0-9]{0,17}$/.test(v)) throw bad('Invalid version'); return v; };

// ---- Token packs: what the customer sees for sale. Changing a pack never touches balances already bought. ----
const packView = (r: QueryResultRow) => ({ id: r.id as string, name: r.name as string, tokens: String(r.tokens), displayPriceIdr: String(r.display_price_idr), isPromo: r.is_promo as boolean, active: r.active as boolean, version: String(r.version) });
function packInput(b: Record<string, unknown>) {
  const tokens = whole(b.tokens, 'tokens'); if (tokens <= 0n) throw bad('tokens must be greater than zero');
  return { name: text(b.name, 80, 'name'), tokens, price: whole(b.displayPriceIdr, 'displayPriceIdr'), isPromo: b.isPromo === true, active: b.active !== false };
}
export async function createPack(db: Db, b: Record<string, unknown>, actorUser: string) {
  const p = packInput(b);
  return withTx(db, async tx => {
    const r = (await tx.query('insert into token_pack(name, tokens, display_price_idr, is_promo, active) values($1,$2,$3,$4,$5) returning *', [p.name, String(p.tokens), String(p.price), p.isPromo, p.active])).rows[0];
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'pack.create', targetType: 'token_pack', targetId: r.id, summary: { tokens: String(p.tokens), displayPriceIdr: String(p.price), isPromo: p.isPromo } });
    return packView(r);
  });
}
export async function updatePack(db: Db, id: string, b: Record<string, unknown>, actorUser: string) {
  if (!UUID.test(id)) throw new AppError('not_found', 'Not found', 404);
  const p = packInput(b); const expected = versionOf(b.expectedVersion);
  return withTx(db, async tx => {
    const old = (await tx.query('select * from token_pack where id=$1 for update', [id])).rows[0];
    if (!old) throw new AppError('not_found', 'Not found', 404);
    if (String(old.version) !== expected) throw new AppError('version_conflict', 'This pack was changed by someone else. Reload and try again.', 409);
    const r = (await tx.query('update token_pack set name=$2, tokens=$3, display_price_idr=$4, is_promo=$5, active=$6, version=version+1 where id=$1 returning *', [id, p.name, String(p.tokens), String(p.price), p.isPromo, p.active])).rows[0];
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'pack.update', targetType: 'token_pack', targetId: id, summary: { before: `${old.tokens}@${old.display_price_idr} active=${old.active}`, after: `${p.tokens}@${p.price} active=${p.active}` } });
    return packView(r);
  });
}
export async function listPacks(db: Db, onlyActive: boolean) {
  const rows = (await db.query(`select * from token_pack ${onlyActive ? 'where active' : ''} order by display_price_idr, tokens, id`)).rows;
  return { packs: rows.map(r => (onlyActive ? { id: r.id as string, name: r.name as string, tokens: String(r.tokens), displayPriceIdr: String(r.display_price_idr), isPromo: r.is_promo as boolean } : packView(r))) };
}

// ---- Redeem codes ----
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I, L, O, U, 0, 1: hard to misread
/** 26 symbols from a 30-symbol alphabet: about 127 bits of entropy from a CSPRNG, shown in groups. */
function newCode(): string {
  let s = '';
  while (s.length < 26) { const b = crypto.randomBytes(1)[0]; if (b < 240) s += ALPHABET[b % 30]; } // rejection sampling: no modulo bias
  return `ZR-${s.slice(0, 5)}-${s.slice(5, 12)}-${s.slice(12, 19)}-${s.slice(19)}`;
}
/** The only normalisation: upper-case, drop spaces and dashes. No fuzzy matching and no character fixing. */
export function canonicalCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 80) return null;
  const c = input.toUpperCase().replace(/[\s-]/g, '');
  return /^ZR[ABCDEFGHJKMNPQRSTVWXYZ23456789]{26}$/.test(c) ? c : null;
}
const state = (r: QueryResultRow) => (r.status === 'ACTIVE' && r.expires_at && r.expires_at <= new Date() ? 'EXPIRED' : r.status as string);
const voucherView = (r: QueryResultRow) => ({
  id: r.id as string, maskedCode: `${r.prefix}…`, amountMicro: String(r.amount), kind: r.kind as string, saleRef: r.sale_ref as string, packId: r.pack_id as string | null,
  priceIdr: r.price_idr === null ? null : String(r.price_idr), recipientBound: r.recipient_tenant !== null, expiresAt: r.expires_at?.toISOString() ?? null,
  status: state(r), issuedAt: r.issued_at.toISOString(), closedAt: r.closed_at?.toISOString() ?? null,
});

/**
 * Issue one single-use code. The raw code is returned exactly once; a replay with the same key returns the voucher without it.
 * Issuing is not proof that money was received; the sale reference links it to the founder's own record.
 */
export async function issue(db: Db, b: Record<string, unknown>, actorUser: string) {
  const issueKey = text(b.idempotencyKey, 128, 'idempotency key'); if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(issueKey)) throw bad('Invalid idempotency key');
  const kind = b.kind === 'PROMO' ? 'PROMO' : b.kind === 'SALE' || b.kind === undefined ? 'SALE' : (() => { throw bad('Invalid kind'); })();
  const saleRef = text(b.saleRef, 200, kind === 'SALE' ? 'sale reference' : 'promo reason');
  const expires = b.expiresAt ?? null;
  if (expires !== null && (typeof expires !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires) || new Date(expires).toISOString() !== expires || Date.parse(expires) <= Date.now())) throw bad('Expiry must be a future UTC timestamp');
  const packId = b.packId ?? null; if (packId !== null && (typeof packId !== 'string' || !UUID.test(packId))) throw bad('Invalid pack');
  if ((packId === null) === (b.tokens === undefined || b.tokens === null)) throw bad('Give either a pack or a token amount');
  const recipient = b.recipientUsername ?? null;
  return withTx(db, async tx => {
    const prev = (await tx.query('select * from voucher where issued_by=$1 and issue_key_hash=$2', [actorUser, tokenHash(issueKey)])).rows[0];
    if (prev) return { voucher: voucherView(prev), code: null, replayed: true }; // the code is not recoverable: revoke and reissue if it was lost
    let amount: bigint, price: bigint | null = null;
    if (packId !== null) {
      const pack = (await tx.query('select tokens, display_price_idr, active from token_pack where id=$1 for share', [packId])).rows[0];
      if (!pack || !pack.active) throw new AppError('pack_unavailable', 'This pack is not available', 409);
      amount = creditsToMicro(String(pack.tokens)); price = BigInt(pack.display_price_idr);
    } else { const t = whole(b.tokens, 'tokens'); if (t <= 0n) throw bad('tokens must be greater than zero'); amount = creditsToMicro(String(t)); }
    let recipientTenant: string | null = null;
    if (recipient !== null) { const r = await identity.findTenantByUsername(tx, text(recipient, 64, 'recipient')); if (!r) throw new AppError('username_not_found', 'No customer with that username', 404); recipientTenant = r.tenantId; }
    const code = newCode(); const canon = canonicalCode(code)!;
    let row: QueryResultRow;
    try {
      row = (await tx.query('insert into voucher(code_hash, prefix, amount, kind, sale_ref, pack_id, price_idr, recipient_tenant, expires_at, issued_by, issue_key_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *',
        [tokenHash(canon), code.slice(0, 8), String(amount), kind, saleRef, packId, price === null ? null : String(price), recipientTenant, expires, actorUser, tokenHash(issueKey)])).rows[0];
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint) === 'voucher_sale_ref_live') throw new AppError('duplicate_sale_ref', 'A live code already exists for this sale reference', 409);
      throw e;
    }
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'voucher.issue', targetType: 'voucher', targetId: row.id, summary: { amountMicro: String(amount), kind, saleRef, recipientBound: recipientTenant !== null } });
    return { voucher: voucherView(row), code, replayed: false };
  });
}

export async function revoke(db: Db, id: string, reason: unknown, actorUser: string) {
  if (!UUID.test(id)) throw new AppError('not_found', 'Not found', 404);
  const why = text(reason, 500, 'reason');
  return withTx(db, async tx => {
    const v = (await tx.query('select * from voucher where id=$1 for update', [id])).rows[0];
    if (!v) throw new AppError('not_found', 'Not found', 404);
    if (v.status !== 'ACTIVE') throw new AppError('voucher_closed', 'This code is already redeemed or revoked', 409);
    const r = (await tx.query("update voucher set status='REVOKED', closed_at=now() where id=$1 returning *", [id])).rows[0];
    await audit(tx, { actorUser, actorKind: 'ADMIN', action: 'voucher.revoke', targetType: 'voucher', targetId: id, summary: { reason: why } });
    return voucherView(r);
  });
}

export async function list(db: Db, q: { before?: string }) {
  const before = q.before && /^[0-9]+$/.test(q.before) ? q.before : null;
  const rows = (await db.query('select * from voucher where ($1::bigint is null or seq < $1::bigint) order by seq desc limit 50', [before])).rows;
  // Unredeemed live codes are a liability: tokens owed but not yet credited.
  const liability = (await db.query("select coalesce(sum(amount),0) s from voucher where status='ACTIVE' and (expires_at is null or expires_at > now())")).rows[0].s;
  return { vouchers: rows.map(voucherView), nextBefore: rows.length ? String(rows[rows.length - 1].seq) : null, outstandingMicro: String(liability) };
}

const UNUSABLE = () => new AppError('code_unusable', 'This code cannot be used. Check the spelling or contact the seller.', 400);

/**
 * Redeem a code into the caller's own tenant. Voucher state, redemption record and ledger credit commit together.
 * Wrong, expired, revoked, already-used and bound-to-someone-else codes are indistinguishable to the caller.
 */
export async function redeem(db: Db, p: identity.Principal & { tenantId: string }, input: unknown, ip: string) {
  const acct = `redeem:acct:${p.userId}`, ipb = `redeem:ip:${ip}`;
  await rl.check(db, acct, REDEEM_LIMITS.invalidPerAccount, REDEEM_LIMITS.windowSec);
  await rl.check(db, ipb, REDEEM_LIMITS.invalidPerIp, REDEEM_LIMITS.windowSec);
  const miss = async () => { await rl.hit(db, acct, REDEEM_LIMITS.windowSec); await rl.hit(db, ipb, REDEEM_LIMITS.windowSec); return UNUSABLE(); };
  const canon = canonicalCode(input);
  if (!canon) throw await miss();
  const out = await withTx(db, async tx => {
    const tenant = (await tx.query('select status from tenant where id=$1 for share', [p.tenantId])).rows[0];
    if (!tenant || tenant.status === 'CLOSED') throw new AppError('unauthorized', 'Sign in required', 401);
    const v = (await tx.query('select * from voucher where code_hash=$1 for update', [tokenHash(canon)])).rows[0];
    if (!v) return null;
    if (v.status === 'REDEEMED') {
      const r = (await tx.query('select r.created_at, e.id as entry_id from redemption r join ledger_entry e on e.id=r.entry_id where r.voucher_id=$1 and r.tenant_id=$2', [v.id, p.tenantId])).rows[0];
      if (!r) return null; // someone else's: reveal nothing
      const bal = await ledger.getBalance(tx, p.tenantId);
      return { redemptionId: v.id as string, entryId: String(r.entry_id), amountMicro: String(v.amount), postedMicro: String(bal.posted), redeemedAt: r.created_at.toISOString(), replayed: true }; // postedMicro on a replay is the balance now, not the balance right after the original redemption
    }
    if (state(v) !== 'ACTIVE' || (v.recipient_tenant !== null && v.recipient_tenant !== p.tenantId)) return null;
    const g = await ledger.grantRedeem(tx, { tenantId: p.tenantId, amount: BigInt(v.amount), voucherId: v.id, actorUser: p.userId });
    await tx.query("update voucher set status='REDEEMED', closed_at=now() where id=$1", [v.id]);
    const r = (await tx.query('insert into redemption(voucher_id, tenant_id, entry_id) values($1,$2,$3) returning created_at', [v.id, p.tenantId, g.entryId])).rows[0];
    await audit(tx, { actorUser: p.userId, actorKind: 'CUSTOMER', action: 'voucher.redeem', targetType: 'voucher', targetId: v.id, summary: { amountMicro: String(v.amount), tenantId: p.tenantId } });
    return { redemptionId: v.id as string, entryId: g.entryId, amountMicro: String(v.amount), postedMicro: g.postedAfter, redeemedAt: r.created_at.toISOString(), replayed: false };
  });
  if (!out) throw await miss();
  return out;
}
