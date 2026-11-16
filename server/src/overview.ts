import type { Db } from './db/pool.ts';

/**
 * Operations overview for the admin (SCR-014). Read-only aggregates; no customer content.
 * All money values are micro-credit integer strings. Upstream cost is not tracked yet (TASK-003), so there is no spend or margin figure here.
 */
export async function overview(db: Db) {
  const [tenants, balances, vouchers, requests, unresolved, upstreams] = await Promise.all([
    db.query("select status, count(*)::int as n from tenant group by status"),
    db.query(`select coalesce(sum(a.posted), 0)::text as posted, coalesce(sum(a.held), 0)::text as held,
      coalesce(sum(a.posted) filter (where a.posted > 0), 0)::text as positive,
      count(*) filter (where a.posted < 0)::int as negative_accounts, coalesce(sum(a.posted) filter (where a.posted < 0), 0)::text as negative
      from ledger_account a join tenant t on t.id = a.tenant_id where t.status <> 'CLOSED'`),
    db.query(`select count(*)::int as n, coalesce(sum(amount), 0)::text as amount from voucher
      where status = 'ACTIVE' and (expires_at is null or expires_at > now())`),
    db.query(`select count(*)::int as total, count(*) filter (where state = 'FAILED')::int as failed,
      count(*) filter (where estimated)::int as estimated, coalesce(sum(debit), 0)::text as debit
      from request where created_at > now() - interval '24 hours'`),
    db.query("select count(*)::int as n, coalesce(sum(hold), 0)::text as held from request where state = 'UNRESOLVED'"),
    db.query("select status, count(*)::int as n from upstream where not archived group by status"),
  ]);
  const byStatus = (rows: { status: string; n: number }[], keys: string[]) =>
    Object.fromEntries(keys.map(k => [k, rows.find(r => r.status === k)?.n ?? 0]));
  const b = balances.rows[0]; const v = vouchers.rows[0]; const r = requests.rows[0]; const u = unresolved.rows[0];
  return {
    generatedAt: new Date().toISOString(),
    customers: byStatus(tenants.rows, ['ACTIVE', 'SUSPENDED', 'CLOSED']),
    balances: { postedMicro: b.posted, heldMicro: b.held, positiveMicro: b.positive, negativeAccounts: b.negative_accounts, negativeMicro: b.negative },
    activeVouchers: { count: v.n, amountMicro: v.amount },
    requests24h: { total: r.total, failed: r.failed, estimated: r.estimated, debitMicro: r.debit },
    unresolved: { count: u.n, heldMicro: u.held },
    upstreams: byStatus(upstreams.rows, ['PENDING', 'ELIGIBLE', 'BLOCKED']),
  };
}
