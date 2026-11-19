import { useState } from 'react';
import { Link } from 'react-router';
import { post } from './api.ts';
import { formatCredits, formatDate, grouped } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m, ov } from './messages.ts';
import { Alert, Button, ErrorBox, Field, Modal, PageTitle, Pending } from './ui.tsx';

type OverviewGateway = {
  paused: boolean;
  reason: string | null;
  changedAt: string | null;
};

type GatewayState = OverviewGateway & {
  changedBy: string | null;
};

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
  gateway: OverviewGateway;
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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

function parseOverviewGateway(raw: unknown): OverviewGateway | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.paused !== 'boolean') return null;
  if (!isNullableString(raw.reason)) return null;
  if (!isNullableDate(raw.changedAt)) return null;
  return { paused: raw.paused, reason: raw.reason, changedAt: raw.changedAt };
}

function parseGatewayState(raw: unknown): GatewayState | null {
  const base = parseOverviewGateway(raw);
  if (!base || !isRecord(raw)) return null;
  if (!isNullableString(raw.changedBy)) return null;
  return { ...base, changedBy: raw.changedBy };
}

function parseOverview(raw: unknown): OverviewData | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt))) return null;

  const { customers, balances, activeVouchers, requests24h, unresolved, upstreams, gateway } = raw;
  if (!isRecord(customers) || !isRecord(balances) || !isRecord(activeVouchers)) return null;
  if (!isRecord(requests24h) || !isRecord(unresolved) || !isRecord(upstreams)) return null;

  if (!isCount(customers.ACTIVE) || !isCount(customers.SUSPENDED) || !isCount(customers.CLOSED)) return null;
  if (!isMicro(balances.postedMicro) || !isMicro(balances.heldMicro) || !isMicro(balances.positiveMicro)) return null;
  if (!isCount(balances.negativeAccounts) || !isMicro(balances.negativeMicro)) return null;
  if (!isCount(activeVouchers.count) || !isMicro(activeVouchers.amountMicro)) return null;
  if (!isCount(requests24h.total) || !isCount(requests24h.failed) || !isCount(requests24h.estimated) || !isMicro(requests24h.debitMicro)) return null;
  if (!isCount(unresolved.count) || !isMicro(unresolved.heldMicro)) return null;
  if (!isCount(upstreams.PENDING) || !isCount(upstreams.ELIGIBLE) || !isCount(upstreams.BLOCKED)) return null;
  if (!parseOverviewGateway(gateway)) return null;

  return raw as OverviewData;
}

function formatCount(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_count');
  return grouped(String(value));
}

export function AdminOverviewPage() {
  const overview = useResource<unknown>('/admin/api/overview');
  const gatewayRes = useResource<unknown>('/admin/api/settings/gateway');
  const action = useAdminAction();
  const [confirmMode, setConfirmMode] = useState<'pause' | 'resume' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<'paused' | 'resumed' | null>(null);

  const title = <PageTitle subtitle={ov.overviewSubtitle}>{ov.overviewTitle}</PageTitle>;
  const retryAll = () => {
    void overview.refetch();
    void gatewayRes.refetch();
  };
  const closeConfirm = () => {
    setConfirmMode(null);
    setReason('');
    setReasonError(null);
    action.setError(null);
  };
  const openConfirm = (mode: 'pause' | 'resume') => {
    setStatusNotice(null);
    setReason('');
    setReasonError(null);
    action.setError(null);
    setConfirmMode(mode);
  };

  if (overview.isPending || gatewayRes.isPending) return <>{title}<Pending /></>;
  if (overview.isError) return <>{title}<ErrorBox error={overview.error} retry={retryAll} /></>;
  if (gatewayRes.isError) return <>{title}<ErrorBox error={gatewayRes.error} retry={retryAll} /></>;

  const data = parseOverview(overview.data);
  const gateway = parseGatewayState(gatewayRes.data);
  if (!data || !gateway) {
    return <>{title}<ErrorBox error={new Error('invalid_overview_payload')} retry={retryAll} /></>;
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
      <Button
        className="secondary"
        busy={overview.isFetching || gatewayRes.isFetching}
        onClick={() => {
          setStatusNotice(null);
          retryAll();
        }}
      >
        {m.refresh}
      </Button>
    </div>

    <section
      className={gateway.paused ? 'panel gateway-panel gateway-paused' : 'panel gateway-panel'}
      aria-label={ov.gatewaySection}
    >
      <div className="gateway-header">
        <h2>{ov.gatewaySection}</h2>
        <span className="badge" data-status={gateway.paused ? 'PAUSED' : 'RUNNING'}>
          {gateway.paused ? ov.gatewayPaused : ov.gatewayRunning}
        </span>
      </div>

      {gateway.paused ? (
        <Alert danger>{ov.gatewayPausedBanner}</Alert>
      ) : (
        <p className="muted">{ov.gatewayRunningNote}</p>
      )}

      {statusNotice === 'paused' && <Alert>{ov.gatewayPausedConfirmed}</Alert>}
      {statusNotice === 'resumed' && <Alert>{ov.gatewayResumedConfirmed}</Alert>}

      <dl className="overview-dl">
        <div>
          <dt>{ov.gatewaySince}</dt>
          <dd>{gateway.changedAt ? formatDate(gateway.changedAt) : ov.gatewayNeverChanged}</dd>
        </div>
        <div>
          <dt>{ov.gatewayChangedBy}</dt>
          <dd>{gateway.changedBy ?? ov.gatewayNoActor}</dd>
        </div>
        <div>
          <dt>{ov.gatewayReason}</dt>
          <dd>{gateway.reason ?? ov.gatewayNoReason}</dd>
        </div>
      </dl>

      <div className="actions">
        {gateway.paused ? (
          <Button busy={action.busy} onClick={() => openConfirm('resume')}>{ov.resumeGateway}</Button>
        ) : (
          <Button className="danger-button" busy={action.busy} onClick={() => openConfirm('pause')}>{ov.pauseGateway}</Button>
        )}
      </div>
    </section>

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

    {confirmMode && (
      <Modal
        title={confirmMode === 'pause' ? ov.pauseDialogTitle : ov.resumeDialogTitle}
        busy={action.busy}
        onClose={closeConfirm}
      >
        <Alert danger={confirmMode === 'pause'}>
          {confirmMode === 'pause' ? ov.pauseImpact : ov.resumeImpact}
        </Alert>
        <form
          className="stack"
          onSubmit={event => {
            event.preventDefault();
            const trimmed = reason.trim();
            if (confirmMode === 'pause' && (trimmed.length < 1 || trimmed.length > 200)) {
              setReasonError(ov.pauseReasonInvalid);
              return;
            }
            setReasonError(null);
            const submittedMode = confirmMode;
            void action.run(async () => {
              const updated = await post<unknown>(
                '/admin/api/settings/gateway',
                submittedMode === 'pause' ? { paused: true, reason: trimmed } : { paused: false },
              );
              const parsed = parseGatewayState(updated);
              if (!parsed) throw new Error('invalid_gateway_payload');
              closeConfirm();
              await Promise.all([overview.refetch(), gatewayRes.refetch()]);
              setStatusNotice(parsed.paused ? 'paused' : 'resumed');
            });
          }}
        >
          {confirmMode === 'pause' ? (
            <Field
              label={m.reason}
              help={ov.pauseReasonHelp}
              value={reason}
              onChange={event => {
                setReason(event.target.value);
                setReasonError(null);
              }}
              maxLength={200}
              required
              autoFocus
            />
          ) : (
            <dl className="overview-dl">
              <div>
                <dt>{ov.gatewaySince}</dt>
                <dd>{gateway.changedAt ? formatDate(gateway.changedAt) : ov.gatewayNeverChanged}</dd>
              </div>
              <div>
                <dt>{ov.gatewayChangedBy}</dt>
                <dd>{gateway.changedBy ?? ov.gatewayNoActor}</dd>
              </div>
              <div>
                <dt>{ov.gatewayReason}</dt>
                <dd>{gateway.reason ?? ov.gatewayNoReason}</dd>
              </div>
            </dl>
          )}
          {reasonError && <Alert danger>{reasonError}</Alert>}
          {action.error && <ErrorBox error={action.error} />}
          {action.busy && <Alert>{ov.changingFlag}</Alert>}
          <div className="actions">
            <Button
              type="button"
              className="secondary"
              disabled={action.busy}
              onClick={closeConfirm}
              autoFocus={confirmMode === 'resume'}
            >
              {m.cancel}
            </Button>
            <Button
              className={confirmMode === 'pause' ? 'danger-button' : undefined}
              busy={action.busy}
            >
              {confirmMode === 'pause' ? ov.pauseGateway : ov.resumeGateway}
            </Button>
          </div>
        </form>
      </Modal>
    )}
    {action.dialog}
  </>;
}
