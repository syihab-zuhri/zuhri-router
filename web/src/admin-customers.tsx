import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, newIdempotencyKey, post } from './api.ts';
import { creditsToMicro, formatCredits, formatDate } from './credits.ts';
import { useAction, useAdminAction, useResource } from './hooks.tsx';
import { kindText, m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending, Receipt } from './ui.tsx';
import type { ReceiptData } from './ui.tsx';

type Customer = {
  username: string; tenantStatus: string; version: string;
  postedMicro: string; heldMicro: string; availableMicro: string;
  entries: { id: string; kind: string; amount: string; createdAt: string }[];
};
type Topup = { username: string; amountTokens: string; saleRef: string; idempotencyKey: string };
type InviteResult = { inviteId: string; emailSent: boolean; activationLink: string | null };
type AdminAction = 'suspend' | 'restore';
type ActionConfirmation = { action: AdminAction | 'adjustment'; username: string; expectedVersion?: string; amountMicro?: string; idempotencyKey?: string; reason: string };
type UsageAggregate = { key: string; requests: number; failed: number; estimated: number; debitMicro: string; inputTokens: string; outputTokens: string; unbilledInputTokens: string };
type CustomerUsage = { username: string; days: number; byDay: UsageAggregate[]; byModel: UsageAggregate[]; byKey: UsageAggregate[]; recent: { id: string; model: string; protocol: string; state: string; debitMicro: string | null; estimated: boolean; unbilledInputTokens: string; createdAt: string }[] };
type CustomerKey = { id: string; name: string; maskedKey: string; allowedModels: string[] | null; spendLimitMicro: string | null; spentMicro: string; heldMicro: string; expiresAt: string | null; status: string; version: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type CustomerKeysResult = { keys: CustomerKey[]; nextAfter: string | null };
type CustomerTab = 'summary' | 'balance' | 'usage' | 'ledger' | 'keys';
type AdminCustomer = { username: string; tenantStatus: string; createdAt: string; postedMicro: string; heldMicro: string };
const customerTabs: { id: CustomerTab; label: string }[] = [
  { id: 'summary', label: m.summary }, { id: 'balance', label: m.balanceTab }, { id: 'usage', label: m.usageTab }, { id: 'ledger', label: m.ledger }, { id: 'keys', label: m.apiKeys },
];


function CustomerKeyQuickRevoke({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button className="secondary" onClick={() => setOpen(true)}>{m.manageCustomerKeys}</Button>
    {open && <CustomerKeysDialog username={username} onClose={() => setOpen(false)} />}
  </>;
}


function CustomerKeysDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const [after, setAfter] = useState<string | null>(null);
  const [target, setTarget] = useState<CustomerKey | null>(null);
  const path = `/admin/api/customers/${encodeURIComponent(username)}/keys?limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`;
  const result = useResource<CustomerKeysResult>(path);
  const action = useAdminAction();
  const revoke = (key: CustomerKey) => { action.setError(null); setTarget(key); };
  const revokeSelected = () => {
    const selectedKey = target;
    if (!selectedKey) return;
    void action.run(async () => {
      await post(`/admin/api/customers/${encodeURIComponent(username)}/keys/${encodeURIComponent(selectedKey.id)}/revoke`, { expectedVersion: selectedKey.version });
      setTarget(null);
      await result.refetch();
    });
  };
  return <Modal title={target ? m.revokeConfirm : m.apiKeys} busy={action.busy} onClose={onClose}>
    {!target && <>
      <p>{m.customerKeysHelp}</p>
      {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => void result.refetch()} /> : result.data.keys.length === 0 ? <Empty title={m.customerKeysEmpty} /> : <DataList caption={m.apiKeys}>{result.data.keys.map(key => <article className="data-row" key={key.id}>
        <div className="request-heading"><h3>{key.name}</h3><Badge status={key.status} /></div>
        <p className="mono">{key.maskedKey}</p>
        <dl>
          <dt>{m.keyLimit}</dt><dd>{key.spendLimitMicro === null ? m.unlimited : `${formatCredits(key.spendLimitMicro)} ${m.credits}`}</dd>
          <dt>{m.spent}</dt><dd className="number">{formatCredits(key.spentMicro)} {m.credits}</dd>
          <dt>{m.held}</dt><dd className="number">{formatCredits(key.heldMicro)} {m.credits}</dd>
          <dt>{m.createdAt}</dt><dd>{formatDate(key.createdAt)}</dd>
          {key.expiresAt && <><dt>{m.expiry}</dt><dd>{formatDate(key.expiresAt)}</dd></>}
        </dl>
        {key.status === 'ACTIVE' && <Button className="danger-button" onClick={() => revoke(key)}>{m.revokeKey}</Button>}
      </article>)}</DataList>}
      {result.isSuccess && <nav className="pagination" aria-label={m.apiKeys}>{after && <Button className="secondary" disabled={result.isFetching} onClick={() => setAfter(null)}>{m.first}</Button>}{result.data.nextAfter && <Button className="secondary" disabled={result.isFetching} onClick={() => setAfter(result.data.nextAfter)}>{m.next}</Button>}</nav>}
    </>}
    {target && <>
      <p>{m.customerKeyRevokeImpact}</p>
      <dl><dt>{m.username}</dt><dd>{username}</dd><dt>{m.keyName}</dt><dd>{target.name}</dd><dt>{m.id}</dt><dd className="mono">{target.id}</dd><dt>{m.version}</dt><dd>{target.version}</dd></dl>
      {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
      <div className="actions"><Button className="secondary" autoFocus disabled={action.busy} onClick={() => setTarget(null)}>{m.cancel}</Button><Button className="danger-button" busy={action.busy} onClick={revokeSelected}>{m.revokeKey}</Button></div>
    </>}
    {action.dialog}
  </Modal>;
}

function CustomerKeyRevokeAction({ username, keyRecord, onRevoked }: { username: string; keyRecord: CustomerKey; onRevoked: () => Promise<void> }) {
  const action = useAdminAction();
  const [confirm, setConfirm] = useState(false);
  return <>
    {!confirm && <Button className="secondary" onClick={() => { action.setError(null); setConfirm(true); }}>{m.revokeKey}</Button>}
    {confirm && <Modal title={m.revokeConfirm} busy={action.busy} onClose={() => setConfirm(false)}>
      <p>{m.customerKeyRevokeImpact}</p>
      <dl><dt>{m.username}</dt><dd>{username}</dd><dt>{m.keyName}</dt><dd>{keyRecord.name}</dd><dt>{m.id}</dt><dd className="mono">{keyRecord.id}</dd><dt>{m.version}</dt><dd>{keyRecord.version}</dd></dl>
      {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
      <div className="actions"><Button className="secondary" autoFocus disabled={action.busy} onClick={() => setConfirm(false)}>{m.cancel}</Button><Button className="danger-button" busy={action.busy} onClick={() => void action.run(async () => {
        await post(`/admin/api/customers/${encodeURIComponent(username)}/keys/${encodeURIComponent(keyRecord.id)}/revoke`, { expectedVersion: keyRecord.version });
        setConfirm(false); await onRevoked();
      })}>{m.revokeKey}</Button></div>
    </Modal>}
    {action.dialog}
  </>;
}

function CustomerKeysPanel({ username }: { username: string }) {
  const [params, setParams] = useSearchParams();
  const after = params.get('keyAfter');
  const path = `/admin/api/customers/${encodeURIComponent(username)}/keys?limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`;
  const result = useResource<CustomerKeysResult>(path);
  return <section className="panel stack" aria-label={m.apiKeys}>
    <h2>{m.apiKeys}</h2><p>{m.customerKeysHelp}</p>
    {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => void result.refetch()} /> : result.data.keys.length === 0 ? <Empty title={m.customerKeysEmpty} /> : <DataList caption={m.apiKeys}>{result.data.keys.map(key => <article className="data-row" key={key.id}>
      <div className="request-heading"><h3>{key.name}</h3><Badge status={key.status} /></div>
      <p className="mono">{key.maskedKey}</p>
      <dl>
        <dt>{m.keyLimit}</dt><dd>{key.spendLimitMicro === null ? m.unlimited : `${formatCredits(key.spendLimitMicro)} ${m.credits}`}</dd>
        <dt>{m.spent}</dt><dd className="number">{formatCredits(key.spentMicro)} {m.credits}</dd>
        <dt>{m.held}</dt><dd className="number">{formatCredits(key.heldMicro)} {m.credits}</dd>
        <dt>{m.createdAt}</dt><dd>{formatDate(key.createdAt)}</dd>
        {key.expiresAt && <><dt>{m.expiry}</dt><dd>{formatDate(key.expiresAt)}</dd></>}
      </dl>
      {key.status === 'ACTIVE' && <CustomerKeyRevokeAction username={username} keyRecord={key} onRevoked={() => result.refetch().then(() => undefined)} />}
    </article>)}</DataList>}
    {result.isSuccess && <nav className="pagination" aria-label={m.apiKeys}>
      {after && <Button className="secondary" disabled={result.isFetching} onClick={() => { const next = new URLSearchParams(params); next.delete('keyAfter'); setParams(next); }}>{m.first}</Button>}
      {result.data.nextAfter && <Button className="secondary" disabled={result.isFetching} onClick={() => { const next = new URLSearchParams(params); next.set('keyAfter', result.data.nextAfter!); setParams(next); }}>{m.next}</Button>}
    </nav>}
  </section>;
}

function isCustomerTab(value: string | null): value is CustomerTab {
  return customerTabs.some(tab => tab.id === value);
}

function CustomerTabs({ active, onChange, prefix }: { active: CustomerTab; onChange: (tab: CustomerTab) => void; prefix: string }) {
  const changeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % customerTabs.length
      : event.key === 'ArrowLeft' ? (index + customerTabs.length - 1) % customerTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? customerTabs.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = customerTabs[nextIndex];
    document.getElementById(`${prefix}-tab-${next.id}`)?.focus();
    onChange(next.id);
  };
  return <nav className="customer-tabs" role="tablist" aria-label={m.customerDetailTabs}>
    {customerTabs.map((tab, index) => <button id={`${prefix}-tab-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={active === tab.id} aria-controls={`${prefix}-panel`} tabIndex={active === tab.id ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={event => changeWithKeyboard(event, index)}>{tab.label}</button>)}
  </nav>;
}

function CustomerTabPanel({ active, prefix, children }: { active: CustomerTab; prefix: string; children: ReactNode }) {
  const label = customerTabs.find(tab => tab.id === active)!.label;
  return <div id={`${prefix}-panel`} role="tabpanel" aria-labelledby={`${prefix}-tab-${active}`} aria-label={label} tabIndex={0}>{children}</div>;
}

function UsageAggregateList({ title, rows }: { title: string; rows: UsageAggregate[] }) {
  return <section className="panel stack"><h3>{title}</h3>{rows.length === 0 ? <Empty title={m.noCustomerUsage} /> : <DataList caption={title}>{rows.map(row => <article className="data-row" key={row.key}>
    <h4>{row.key}</h4><dl><dt>{m.requestsCount}</dt><dd>{row.requests}</dd><dt>{m.requestDebit}</dt><dd className="number">{formatCredits(row.debitMicro)} {m.credits}</dd><dt>{m.failedRequests}</dt><dd>{row.failed}</dd><dt>{m.estimatedRequests}</dt><dd>{row.estimated}</dd><dt>{m.inputUsage}</dt><dd>{row.inputTokens}</dd><dt>{m.outputUsage}</dt><dd>{row.outputTokens}</dd><dt>{m.unbilledInput}</dt><dd>{row.unbilledInputTokens}</dd></dl>
  </article>)}</DataList>}</section>;
}

function CustomerUsagePanel({ username }: { username: string }) {
  const [days, setDays] = useState('7');
  const usage = useResource<CustomerUsage>(`/admin/api/customers/${encodeURIComponent(username)}/usage?days=${days}`);
  return <section className="stack" aria-label={m.customerUsage}><div className="actions"><h2>{m.customerUsage}</h2><label className="field">{m.usagePeriod}<select value={days} onChange={event => setDays(event.target.value)}><option value="7">7</option><option value="30">30</option><option value="90">90</option></select></label></div><p>{m.customerUsageHelp}</p>
    {usage.isPending ? <Pending /> : usage.isError ? <ErrorBox error={usage.error} retry={() => { void usage.refetch(); }} /> : <><UsageAggregateList title={m.usageByDay} rows={usage.data.byDay} /><UsageAggregateList title={m.usageByModel} rows={usage.data.byModel} /><UsageAggregateList title={m.usageByKey} rows={usage.data.byKey} /><section className="panel stack"><h3>{m.recentRequests}</h3>{usage.data.recent.length === 0 ? <Empty title={m.noCustomerUsage} /> : <DataList caption={m.recentRequests}>{usage.data.recent.map(request => <article className="data-row" key={request.id}><dl><dt>{m.model}</dt><dd>{request.model}</dd><dt>{m.protocol}</dt><dd>{request.protocol}</dd><dt>{m.status}</dt><dd>{request.state}</dd><dt>{m.requestDebit}</dt><dd>{request.debitMicro === null ? m.notFinal : `${formatCredits(request.debitMicro)} ${m.credits}`}</dd><dt>{m.time}</dt><dd>{formatDate(request.createdAt)}</dd></dl>{request.estimated && <Alert>{m.estimated}</Alert>}</article>)}</DataList>}</section></>}
  </section>;
}

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const prefix = params.get('prefix') ?? '';
  const after = params.get('after');
  const selected = params.get('customer') ?? '';
  const query = new URLSearchParams({ limit: '50' });
  if (prefix) query.set('prefix', prefix);
  if (after) query.set('after', after);
  const path = `/admin/api/customers?${query.toString()}`;
  const result = useResource<{ customers: AdminCustomer[]; nextAfter: string | null }>(path);
  const [username, setUsername] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitation, setInvitation] = useState<InviteResult | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteAction = useAction(true);
  const inviteReceiptRef = useRef<HTMLElement>(null);
  useEffect(() => { if (invitation) inviteReceiptRef.current?.focus(); }, [invitation]);
  const applyFilter = () => {
    const nextPrefix = username.trim();
    setParams(nextPrefix ? { prefix: nextPrefix } : {});
  };
  const customerList = result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => { void result.refetch(); }} /> : result.data.customers.length === 0 ? <Empty title={prefix ? m.customerNoMatches : m.customerListEmpty} /> : <DataList caption={m.customerList}>{result.data.customers.map(customer => <article className="data-row customer-list-row" key={customer.username}>
    <div className="request-heading"><h2>{customer.username}</h2><Badge status={customer.tenantStatus} /></div>
    <dl><dt>{m.createdAt}</dt><dd>{formatDate(customer.createdAt)}</dd><dt>{m.posted}</dt><dd className="number">{formatCredits(customer.postedMicro)} {m.credits}</dd><dt>{m.held}</dt><dd className="number">{formatCredits(customer.heldMicro)} {m.credits}</dd></dl>
    <div className="actions"><Button className="secondary" onClick={() => { setUsername(customer.username); const next = new URLSearchParams(params); next.set('customer', customer.username); next.set('tab', 'summary'); next.delete('keyAfter'); setParams(next); }}>{m.customerDetails}</Button><CustomerKeyQuickRevoke username={customer.username} /></div>
  </article>)}</DataList>;
  return <>
    <PageTitle subtitle={m.customerHelp}>{m.customers}</PageTitle>
    <form className="panel stack form-width" onSubmit={event => {
      event.preventDefault(); inviteAction.setError(null); setInvitation(null); setInviteCopied(false);
      void inviteAction.run(async () => {
        const next = await post<InviteResult>('/admin/api/invites', { email: inviteEmail.trim() });
        if (!next.emailSent && !next.activationLink) { inviteAction.setError(new Error('invite_link_missing')); return; }
        setInvitation(next); setInviteEmail('');
      });
    }}>
      <h2>{m.inviteCustomer}</h2>
      <Field label={m.email} type="email" autoComplete="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} maxLength={254} required />
      {inviteAction.error && (inviteAction.error instanceof ApiError && inviteAction.error.code === 'conflict' ? <Alert danger>{m.inviteConflict}</Alert> : inviteAction.error.message === 'invite_link_missing' ? <Alert danger>{m.inviteLinkMissing}</Alert> : inviteAction.error.message === 'copy_failed' ? null : <ErrorBox error={inviteAction.error} />)}
      {inviteAction.busy && <Alert>{m.saving}</Alert>}
      <Button busy={inviteAction.busy}>{m.inviteCustomer}</Button>
    </form>
    {invitation && <section className="receipt" role="status" tabIndex={-1} ref={inviteReceiptRef}>
      <h2>{m.inviteCreated}</h2>
      {invitation.emailSent && <p>{m.inviteSentByEmail}</p>}
      {!invitation.emailSent && invitation.activationLink && <div className="stack">
        <Alert>{m.inviteManualDelivery}</Alert>
        <p className="mono activation-link" aria-label={m.activationLink}>{invitation.activationLink}</p>
        <div className="actions"><Button className="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(invitation.activationLink!); setInviteCopied(true); }
          catch { inviteAction.setError(new Error('copy_failed')); }
        }}>{m.copyActivationLink}</Button>{inviteCopied && <span role="status">{m.copied}</span>}</div>
        {inviteAction.error?.message === 'copy_failed' && <Alert danger>{m.copyFailed}</Alert>}
      </div>}
    </section>}
    <section className="panel stack" aria-label={m.customerList}>
      <h2>{m.customerList}</h2>
      <Field label={m.customerPrefix} value={username} onChange={event => setUsername(event.target.value)} maxLength={24} autoComplete="off" />
      <div className="actions"><Button type="button" onClick={applyFilter}>{m.search}</Button><Button className="secondary" type="button" disabled={result.isFetching} onClick={() => void result.refetch()}>{m.refresh}</Button></div>
    </section>
    {!selected && customerList}
    {!selected && result.isSuccess && <nav className="pagination" aria-label={m.customerList}>
      {after && <Button className="secondary" disabled={result.isFetching} onClick={() => setParams(prefix ? { prefix } : {})}>{m.first}</Button>}
      {result.data.nextAfter && <Button className="secondary" disabled={result.isFetching} onClick={() => setParams({ ...(prefix ? { prefix } : {}), after: result.data.nextAfter! })}>{m.next}</Button>}
    </nav>}
    {selected && <CustomerDetail key={selected} username={selected} />}
  </>;
}

function CustomerDetail({ username }: { username: string }) {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const activeTab: CustomerTab = isCustomerTab(requestedTab) ? requestedTab : 'summary';
  const panelPrefix = `customer-${encodeURIComponent(username)}`;
  const setTab = (tab: CustomerTab) => { const next = new URLSearchParams(params); next.set('tab', tab); setParams(next); };
  const customer = useResource<Customer>(`/admin/api/customers/${encodeURIComponent(username)}`);
  const action = useAdminAction();
  const statusAction = useAdminAction();
  const adjustmentAction = useAdminAction();
  const [amount, setAmount] = useState(''); const [saleRef, setSaleRef] = useState('');
  const [confirmation, setConfirmation] = useState<Topup | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [financialConfirmation, setFinancialConfirmation] = useState<ActionConfirmation | null>(null);
  const [confirmationReason, setConfirmationReason] = useState('');
  const [adjustmentTokens, setAdjustmentTokens] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentReceipt, setAdjustmentReceipt] = useState<ReceiptData | null>(null);
  const [adjustmentConfirmed, setAdjustmentConfirmed] = useState(false);
  if (customer.isPending) return <Pending />;
  if (customer.error) return <ErrorBox error={customer.error} retry={() => { void customer.refetch(); }} />;
  const value = customer.data;
  const usagePanel = <CustomerUsagePanel username={value.username} />;
  const topupForm = <form className="panel stack" onSubmit={event => {
    event.preventDefault(); action.setError(null); setReceipt(null);
    setConfirmation({ username: value.username, amountTokens: amount, saleRef: saleRef.trim(), idempotencyKey: newIdempotencyKey() });
  }}>
    <h2>{m.topup}</h2>
    <Field label={m.tokens} value={amount} onChange={event => setAmount(event.target.value)} inputMode="numeric" pattern="[1-9][0-9]{0,11}" maxLength={12} required />
    <Field label={m.saleRef} value={saleRef} onChange={event => setSaleRef(event.target.value)} maxLength={200} pattern=".*\S.*" required />
    <div className="actions"><Button busy={action.busy}>{m.topup}</Button></div>
  </form>;
  const adjustmentForm = <form className="panel stack" onSubmit={event => {
    event.preventDefault(); adjustmentAction.setError(null); setAdjustmentReceipt(null);
    const signedTokens = adjustmentTokens.trim();
    if (!/^-?(0|[1-9][0-9]{0,11})([.,][0-9]{1,6})?$/.test(signedTokens)) { adjustmentAction.setError(new ApiError('invalid_request', 400)); return; }
    const magnitudeMicro = creditsToMicro(signedTokens.replace(/^-/, ''));
    if (BigInt(magnitudeMicro) === 0n) { adjustmentAction.setError(new ApiError('invalid_request', 400)); return; }
    const amountMicro = signedTokens.startsWith('-') ? `-${magnitudeMicro}` : magnitudeMicro;
    setAdjustmentConfirmed(true);
    setFinancialConfirmation({ action: 'adjustment', username: value.username, amountMicro, idempotencyKey: newIdempotencyKey(), reason: adjustmentReason.trim() });
    setConfirmationReason(adjustmentReason.trim());
  }}>
    <h2>{m.adjustCustomerBalance}</h2><p>{m.adjustmentHelp}</p>
    <Field label={m.signedTokenAmount} help={m.signedTokenHelp} inputMode="text" value={adjustmentTokens} onChange={event => setAdjustmentTokens(event.target.value)} pattern="-?(0|[1-9][0-9]{0,11})([.,][0-9]{1,6})?" maxLength={20} required />
    <Field label={m.reason} value={adjustmentReason} onChange={event => { setAdjustmentReason(event.target.value); setConfirmationReason(event.target.value); }} minLength={3} maxLength={500} required />
    <Button type="submit" busy={adjustmentAction.busy}>{m.adjustCustomerBalance}</Button>
  </form>;
  const usageTabPanel = <div className="stack">{usagePanel}</div>;
  const ledgerPanel = <section className="panel stack"><h2>{m.ledger}</h2>{value.entries.length === 0 ? <Empty /> : <DataList caption={m.ledger}>{value.entries.map(entry => <article className="data-row" key={entry.id}><dl><dt>{m.transactionId}</dt><dd className="mono">{entry.id}</dd><dt>{m.kind}</dt><dd>{kindText[entry.kind] ?? entry.kind}</dd><dt>{m.amount}</dt><dd className="number">{formatCredits(entry.amount)} {m.credits}</dd><dt>{m.time}</dt><dd>{formatDate(entry.createdAt)}</dd></dl></article>)}</DataList>}</section>;
  const tabContent: Record<CustomerTab, ReactNode> = {
    summary: <section className="panel stack"><div className="actions"><Button className="secondary" busy={customer.isFetching} onClick={() => void customer.refetch()}>{m.refresh}</Button></div><dl className="metrics">{([[m.available, value.availableMicro], [m.posted, value.postedMicro], [m.held, value.heldMicro]] as const).map(([label, micro]) => <div className="metric" key={label}><dt>{label}</dt><dd className="number">{formatCredits(micro)} {m.credits}</dd></div>)}</dl>{value.tenantStatus === 'SUSPENDED' && <Alert danger>{m.suspended}</Alert>}<Button className={value.tenantStatus === 'SUSPENDED' ? 'secondary' : 'danger-button'} onClick={() => { setConfirmationReason(''); setFinancialConfirmation({ action: value.tenantStatus === 'SUSPENDED' ? 'restore' : 'suspend', username: value.username, expectedVersion: value.version, reason: '' }); statusAction.setError(null); }}>{value.tenantStatus === 'SUSPENDED' ? m.restoreCustomer : m.suspendCustomer}</Button></section>,
    balance: <div className="stack">{topupForm}{receipt && <Receipt value={receipt} />}{!confirmation && action.error && <ErrorBox error={action.error} />}{adjustmentForm}{adjustmentReceipt && <Receipt value={adjustmentReceipt} />}</div>,
    usage: usageTabPanel,
    ledger: ledgerPanel,
    keys: <CustomerKeysPanel username={value.username} />,
  };
  return <section className="customer-detail stack" aria-label={m.details}>
    <div className="actions"><Button className="secondary" onClick={() => { const next = new URLSearchParams(params); next.delete('customer'); next.delete('tab'); next.delete('keyAfter'); setParams(next); }}>{m.backToCustomers}</Button></div>
    <header className="customer-detail-heading"><h2>{value.username}</h2><Badge status={value.tenantStatus} /></header>
    <CustomerTabs active={activeTab} onChange={setTab} prefix={panelPrefix} />
    <CustomerTabPanel active={activeTab} prefix={panelPrefix}>{tabContent[activeTab]}</CustomerTabPanel>
    {financialConfirmation && adjustmentConfirmed && financialConfirmation.action === 'adjustment' && <Modal title={m.adjustmentConfirm} busy={adjustmentAction.busy} onClose={() => setFinancialConfirmation(null)}><p>{m.financialConfirm}</p><dl><dt>{m.username}</dt><dd>{financialConfirmation.username}</dd><dt>{m.signedTokenAmount}</dt><dd className="number">{formatCredits(financialConfirmation.amountMicro ?? '0')} {m.credits}</dd><dt>{m.reason}</dt><dd>{financialConfirmation.reason}</dd></dl><div className="actions"><Button className="secondary" autoFocus disabled={adjustmentAction.busy} onClick={() => setFinancialConfirmation(null)}>{m.cancel}</Button><Button busy={adjustmentAction.busy} onClick={() => void adjustmentAction.run(async () => { const result = await post<ReceiptData>('/admin/api/adjustments', { username: financialConfirmation.username, amountMicro: financialConfirmation.amountMicro!, reason: financialConfirmation.reason, idempotencyKey: financialConfirmation.idempotencyKey! }); setFinancialConfirmation(null); setAdjustmentConfirmed(false); setAdjustmentTokens(''); setConfirmationReason(''); setAdjustmentReceipt(result); await customer.refetch(); })}>{m.confirmAdjustment}</Button></div>{adjustmentAction.error && <ErrorBox error={adjustmentAction.error} />}{adjustmentAction.busy && <Alert>{m.saving}</Alert>}</Modal>}
    {financialConfirmation && (financialConfirmation.action === 'suspend' || financialConfirmation.action === 'restore') && <Modal title={financialConfirmation.action === 'suspend' ? m.suspendCustomer : m.restoreCustomer} busy={statusAction.busy} onClose={() => setFinancialConfirmation(null)}><p>{financialConfirmation.action === 'suspend' ? m.suspendImpact : m.restoreImpact}</p><dl><dt>{m.username}</dt><dd>{financialConfirmation.username}</dd><dt>{m.version}</dt><dd>{financialConfirmation.expectedVersion}</dd></dl><Field label={m.reason} value={confirmationReason} onChange={event => setConfirmationReason(event.target.value)} minLength={3} maxLength={500} required />{statusAction.error && <ErrorBox error={statusAction.error} />}{statusAction.busy && <Alert>{m.saving}</Alert>}<div className="actions"><Button type="button" className="secondary" autoFocus disabled={statusAction.busy} onClick={() => setFinancialConfirmation(null)}>{m.cancel}</Button><Button type="button" className={financialConfirmation.action === 'suspend' ? 'danger-button' : ''} busy={statusAction.busy} onClick={() => { if (confirmationReason.trim().length < 3) { statusAction.setError(new ApiError('invalid_request', 400)); return; } const pending = financialConfirmation; void statusAction.run(async () => { await post(`/admin/api/customers/${encodeURIComponent(pending.username)}/${pending.action}`, { expectedVersion: pending.expectedVersion, reason: confirmationReason.trim() }); setFinancialConfirmation(null); setConfirmationReason(''); await customer.refetch(); }); }}>{financialConfirmation.action === 'suspend' ? m.suspendCustomer : m.restoreCustomer}</Button></div></Modal>}
    {confirmation && <Modal title={m.topupConfirm} busy={action.busy} onClose={() => { setConfirmation(null); action.setError(null); }}><p>{m.financialConfirm}</p><dl><dt>{m.username}</dt><dd>{confirmation.username}</dd><dt>{m.tokens}</dt><dd className="number">{formatCredits(creditsToMicro(confirmation.amountTokens))} {m.credits}</dd><dt>{m.saleRef}</dt><dd>{confirmation.saleRef}</dd></dl>{action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}<div className="actions"><Button className="secondary" autoFocus disabled={action.busy} onClick={() => setConfirmation(null)}>{m.cancel}</Button><Button busy={action.busy} onClick={() => { const payload = confirmation; void action.run(async () => { const result = await post<ReceiptData>('/admin/api/topups', payload); setConfirmation(null); setReceipt(result); setAmount(''); setSaleRef(''); await customer.refetch(); }); }}>{m.topup}</Button></div></Modal>}
    {action.dialog}{statusAction.dialog}{adjustmentAction.dialog}
  </section>;
}
