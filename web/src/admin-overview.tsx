import { Link } from 'react-router';
import { formatCredits, formatDate, grouped } from './credits.ts';
import { useResource } from './hooks.tsx';
import { m, ov } from './messages.ts';
import { Button, ErrorBox, PageTitle, Pending } from './ui.tsx';

type OverviewData = {
  generatedAt: string;
  customers: { ACTIVE: number; SUSPENDED: number; CLOSED: number };
  balances: {
    postedMicro: string;
    heldMicro: string;
    positiveMicro: string;
    negativeAccounts: number;
    negativeMicro: string;
  };
  activeVouchers: { count: number; amountMicro: string };
  requests24h: { total: number; failed: number; estimated: number; debitMicro: string };
  unresolved: { count: number; heldMicro: string };
  upstreams: { PENDING: number; ELIGIBLE: number; BLOCKED: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isMicro(value: unknown): value is string {
  return typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value);
}

function parseOverview(raw: unknown): OverviewData | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt))) return null;

  const { customers, balances, activeVouchers, requests24h, unresolved, upstreams } = raw;
  if (!isRecord(customers) || !isRecord(balances) || !isRecord(activeVouchers)) return null;
  if (!isRecord(requests24h) || !isRecord(unresolved) || !isRecord(upstreams)) return null;

  if (!isCount(customers.ACTIVE) || !isCount(customers.SUSPENDED) || !isCount(customers.CLOSED)) return null;
  if (!isMicro(balances.postedMicro) || !isMicro(balances.heldMicro) || !isMicro(balances.positiveMicro)) return null;
  if (!isCount(balances.negativeAccounts) || !isMicro(balances.negativeMicro)) return null;
  if (!isCount(activeVouchers.count) || !isMicro(activeVouchers.amountMicro)) return null;
  if (!isCount(requests24h.total) || !isCount(requests24h.failed) || !isCount(requests24h.estimated) || !isMicro(requests24h.debitMicro)) return null;
  if (!isCount(unresolved.count) || !isMicro(unresolved.heldMicro)) return null;
  if (!isCount(upstreams.PENDING) || !isCount(upstreams.ELIGIBLE) || !isCount(upstreams.BLOCKED)) return null;

  return raw as OverviewData;
}

function formatCount(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_count');
  return grouped(String(value));
}

export function AdminOverviewPage() {
  const overview = useResource<unknown>('/admin/api/overview');
  const title = <PageTitle subtitle={ov.overviewSubtitle}>{ov.overviewTitle}</PageTitle>;

  if (overview.isPending) return <>{title}<Pending /></>;
  if (overview.isError) return <>{title}<ErrorBox error={overview.error} retry={() => { void overview.refetch(); }} /></>;

  const data = parseOverview(overview.data);
  if (!data) {
    return <>{title}<ErrorBox error={new Error('invalid_overview_payload')} retry={() => { void overview.refetch(); }} /></>;
  }
  const hasNegative = data.balances.negativeAccounts > 0;
  const isAllZero =
    data.customers.ACTIVE === 0 &&
    data.customers.SUSPENDED === 0 &&
    data.customers.CLOSED === 0 &&
    data.balances.postedMicro === '0' &&
    data.balances.heldMicro === '0' &&
    data.balances.negativeAccounts === 0 &&
    data.activeVouchers.count === 0 &&
    data.requests24h.total === 0 &&
    data.unresolved.count === 0 &&
    data.upstreams.PENDING === 0 &&
    data.upstreams.ELIGIBLE === 0 &&
    data.upstreams.BLOCKED === 0;

  return <>
    {title}
    <div className="overview-toolbar">
      <p className="muted">{ov.generatedAt}: {formatDate(data.generatedAt)}</p>
      <Button className="secondary" busy={overview.isFetching} onClick={() => { void overview.refetch(); }}>{m.refresh}</Button>
    </div>
    <p className="muted">{ov.costUnavailableNote}</p>
    {isAllZero && <p className="muted">{ov.zeroOverviewNote}</p>}

    <div className="metrics">
      <section className="metric" aria-label={ov.customersCard}>
        <h2>{ov.customersCard}</h2>
        <p className="number">{formatCount(data.customers.ACTIVE)}</p>
        <small>{ov.activeCustomers}</small>
        <dl className="overview-dl">
          <div><dt>{ov.activeCustomers}</dt><dd className="number">{formatCount(data.customers.ACTIVE)}</dd></div>
          <div><dt>{ov.suspendedCustomers}</dt><dd className="number">{formatCount(data.customers.SUSPENDED)}</dd></div>
          <div><dt>{ov.closedCustomers}</dt><dd className="number">{formatCount(data.customers.CLOSED)}</dd></div>
        </dl>
      </section>

      <section className="metric" aria-label={ov.totalBalanceCard}>
        <h2>{ov.totalBalanceCard}</h2>
        <p className="number">{formatCredits(data.balances.postedMicro)}</p>
        <small>{m.credits} · {ov.excludeClosedNote}</small>
        <dl className="overview-dl">
          <div><dt>{ov.positiveBalanceLabel}</dt><dd className="number">{formatCredits(data.balances.positiveMicro)} {m.credits}</dd></div>
        </dl>
      </section>

      <section className="metric" aria-label={ov.heldBalanceCard}>
        <h2>{ov.heldBalanceCard}</h2>
        <p className="number">{formatCredits(data.balances.heldMicro)}</p>
        <small>{m.credits} · {ov.excludeClosedNote}</small>
      </section>

      <section className={hasNegative ? 'metric metric-warning' : 'metric'} aria-label={ov.negativeAccountsCard}>
        <h2>{ov.negativeAccountsCard}</h2>
        {hasNegative && <span className="overview-warning-tag">{ov.negativeAccountsAttention}</span>}
        <p className="number">{formatCount(data.balances.negativeAccounts)}</p>
        <small>{hasNegative ? ov.negativeAccountsCount : ov.negativeAccountsNone}</small>
        <dl className="overview-dl">
          <div><dt>{ov.negativeAccountsTotal}</dt><dd className="number">{formatCredits(data.balances.negativeMicro)} {m.credits}</dd></div>
        </dl>
      </section>

      <section className="metric" aria-label={ov.activeVouchersCard}>
        <h2>{ov.activeVouchersCard}</h2>
        <p className="number">{formatCount(data.activeVouchers.count)}</p>
        <small>{ov.activeVouchersCount}</small>
        <dl className="overview-dl">
          <div><dt>{ov.activeVouchersLiability}</dt><dd className="number">{formatCredits(data.activeVouchers.amountMicro)} {m.credits}</dd></div>
        </dl>
      </section>

      <section className="metric" aria-label={ov.requests24hCard}>
        <h2>{ov.requests24hCard}</h2>
        <p className="number">{formatCredits(data.requests24h.debitMicro)}</p>
        <small>{ov.requestsDebit} ({m.credits})</small>
        <dl className="overview-dl">
          <div><dt>{ov.requestsTotal}</dt><dd className="number">{formatCount(data.requests24h.total)}</dd></div>
          <div><dt>{ov.requestsFailed}</dt><dd className="number">{formatCount(data.requests24h.failed)}</dd></div>
          <div><dt>{ov.requestsEstimated}</dt><dd className="number">{formatCount(data.requests24h.estimated)}</dd></div>
        </dl>
      </section>

      <section className="metric" aria-label={ov.unresolvedCard}>
        <h2>{ov.unresolvedCard}</h2>
        <p className="number">{formatCount(data.unresolved.count)}</p>
        <small>{ov.unresolvedCount}</small>
        <dl className="overview-dl">
          <div><dt>{ov.unresolvedHeld}</dt><dd className="number">{formatCredits(data.unresolved.heldMicro)} {m.credits}</dd></div>
        </dl>
        <Link className="overview-card-link" to="/admin/rekonsiliasi">{ov.openUnresolved}</Link>
      </section>

      <section className="metric" aria-label={ov.upstreamsCard}>
        <h2>{ov.upstreamsCard}</h2>
        <p className="number">{formatCount(data.upstreams.ELIGIBLE)}</p>
        <small>{m.stateText.ELIGIBLE}</small>
        <dl className="overview-dl">
          <div><dt>{m.stateText.PENDING}</dt><dd className="number">{formatCount(data.upstreams.PENDING)}</dd></div>
          <div><dt>{m.stateText.ELIGIBLE}</dt><dd className="number">{formatCount(data.upstreams.ELIGIBLE)}</dd></div>
          <div><dt>{m.stateText.BLOCKED}</dt><dd className="number">{formatCount(data.upstreams.BLOCKED)}</dd></div>
        </dl>
        <Link className="overview-card-link" to="/admin/upstream">{ov.openUpstreams}</Link>
      </section>
    </div>
  </>;
}
