// Operator check after a restore or at any time: balances equal ledger entries, holds add up, no request is left without a hold.
// Usage: DATABASE_URL=... node scripts/check-invariants.ts   (exit code 1 when something is wrong)
import { createPool } from '../src/db/pool.ts';
import { invariantViolations } from '../src/ledger.ts';
const db = createPool(process.env.DATABASE_URL ?? (console.error('DATABASE_URL is required'), process.exit(1), ''));
const v = await invariantViolations(db);
const c = (await db.query("select (select count(*) from ledger_account) accounts, (select count(*) from ledger_entry) entries, (select count(*) from voucher) vouchers, (select count(*) from redemption) redemptions, (select count(*) from request) requests, (select count(*) from hold where status='ACTIVE') open_holds, (select coalesce(sum(posted),0) from ledger_account) posted, (select count(*) from schema_migration) migrations")).rows[0];
console.log(JSON.stringify({ violations: v, ...c }));
await db.end(); process.exit(v.length ? 1 : 0);
