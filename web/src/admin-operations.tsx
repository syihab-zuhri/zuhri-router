import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { post } from './api.ts';
import { formatCredits, formatDate, grouped } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending } from './ui.tsx';

type Unresolved = { id: string; username: string; model: string; heldMicro: string; maxOutput: number; createdAt: string };
type RequestUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type AdminRequest = {
  id: string; username: string; keyName: string | null; model: string; protocol: string; stream: boolean; state: string;
  outcome: string | null; final: boolean; heldMicro: string; debitMicro: string | null; estimated: boolean;
  usage: RequestUsage | null; createdAt: string;
};
type AdminRequestsResult = { requests: AdminRequest[]; nextBefore: string | null };
type AuditEvent = { id: string; actorUser: string | null; actorKind: string; action: string; targetType: string; targetId: string; summary: unknown; createdAt: string };

const requestStates = Object.keys(m.requestStateText) as (keyof typeof m.requestStateText)[];

function requestOutcomeLabel(value: string | null): string {
  if (value === null) return m.adminRequestNoOutcome;
  return Object.hasOwn(m.requestOutcomeText, value) ? m.requestOutcomeText[value as keyof typeof m.requestOutcomeText] : m.adminRequestOutcomeUnknown;
}

function AdminRequestList() {
  const [params, setParams] = useSearchParams();
  const [username, setUsername] = useState(params.get('username') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [model, setModel] = useState(params.get('model') ?? '');
  useEffect(() => {
    setUsername(params.get('username') ?? '');
    setState(params.get('state') ?? '');
    setModel(params.get('model') ?? '');
  }, [params]);

  const before = params.get('before');
  const query = new URLSearchParams({ limit: '50' });
  for (const [key, value] of [['username', params.get('username')], ['state', params.get('state')], ['model', params.get('model')], ['before', before]] as const) {
    if (value) query.set(key, value);
  }
  const result = useResource<AdminRequestsResult>(`/admin/api/requests?${query}`);
  const hasFilters = Boolean(params.get('username') || params.get('state') || params.get('model'));
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams({ limit: '50' });
    const userFilter = username.trim();
    const modelFilter = model.trim();
    if (userFilter) next.set('username', userFilter);
    if (state) next.set('state', state);
    if (modelFilter) next.set('model', modelFilter);
    setParams(next);
  };

  return <section className="panel stack" aria-label={m.allCustomerRequests}>
    <header className="stack"><h2>{m.allCustomerRequests}</h2><p>{m.allCustomerRequestsHelp}</p></header>
    <form className="stack" onSubmit={applyFilters}>
      <Field label={m.adminRequestUsername} value={username} onChange={event => setUsername(event.target.value)} maxLength={64} />
      <div className="field"><label htmlFor="admin-request-state">{m.adminRequestState}</label><select id="admin-request-state" value={state} onChange={event => setState(event.target.value)}><option value="">{m.allValues}</option>{requestStates.map(value => <option key={value} value={value}>{m.requestStateText[value]}</option>)}</select></div>
      <Field label={m.adminRequestModel} value={model} onChange={event => setModel(event.target.value)} maxLength={128} />
      <div className="actions"><Button type="submit">{m.search}</Button><Button className="secondary" type="button" disabled={!hasFilters} onClick={() => setParams({ limit: '50' })}>{m.clearFilters}</Button></div>
    </form>
    {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => { void result.refetch(); }} /> : result.data.requests.length === 0 ? <Empty title={hasFilters ? m.adminRequestsNoMatches : m.adminRequestsEmpty} /> : <DataList caption={m.allCustomerRequests}>{result.data.requests.map(request => <article className="data-row" key={request.id}>
      <div className="request-heading"><h3><Link to={`/admin/pelanggan?customer=${encodeURIComponent(request.username)}&tab=summary`}>{request.username}</Link></h3><Badge status={request.state} />{request.estimated && <Badge status="SETTLED_ESTIMATED" />}</div>
      <dl><dt>{m.time}</dt><dd>{formatDate(request.createdAt)}</dd><dt>{m.requestId}</dt><dd className="mono">{request.id}</dd><dt>{m.adminRequestKey}</dt><dd>{request.keyName ?? m.adminRequestNoKey}</dd><dt>{m.model}</dt><dd className="mono">{request.model}</dd><dt>{m.protocol}</dt><dd>{request.protocol}</dd><dt>{m.stream}</dt><dd>{request.stream ? m.streamYes : m.streamNo}</dd>
        {request.final ? <><dt>{m.adminRequestDebit}</dt><dd className="number">{formatCredits(request.debitMicro ?? '0')} {m.credits}</dd></> : <><dt>{m.adminRequestHeld}</dt><dd className="number">{formatCredits(request.heldMicro)} {m.credits}</dd></>}
      </dl>
      {request.estimated && <p>{m.adminRequestEstimate}</p>}
      <section className="stack" aria-label={m.adminRequestOutcome}><h4>{m.adminRequestOutcome}</h4><p>{requestOutcomeLabel(request.outcome)}</p></section>
      <details><summary>{m.chargedUsage}</summary>{request.usage === null ? <p>{m.adminRequestNoUsage}</p> : <dl>{([[m.input, request.usage.input], [m.output, request.usage.output], [m.cacheRead, request.usage.cacheRead], [m.cacheWrite, request.usage.cacheWrite]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{grouped(String(count))}</dd></div>)}</dl>}</details>
    </article>)}</DataList>}
    {result.isSuccess && result.data.requests.length > 0 && <nav className="pagination" aria-label={m.allCustomerRequests}>
      {before && <Button className="secondary" onClick={() => { const next = new URLSearchParams(params); next.delete('before'); setParams(next); }}>{m.first}</Button>}
      {result.data.nextBefore && <Button className="secondary" onClick={() => { const next = new URLSearchParams(params); next.set('before', result.data.nextBefore!); setParams(next); }}>{m.next}</Button>}
    </nav>}
  </section>;
}

export function UnresolvedPage() {
  const requests = useResource<{ requests: Unresolved[] }>('/admin/api/requests/unresolved');
  const action = useAdminAction();
  const [selected, setSelected] = useState<Unresolved | null>(null);
  const [debitTokens, setDebitTokens] = useState('0');
  const [reason, setReason] = useState('');
  const close = () => { setSelected(null); setDebitTokens('0'); setReason(''); action.setError(null); };
  return <>
    <PageTitle subtitle={m.unresolvedSubtitle}>{m.unresolved}</PageTitle>
    {requests.isPending ? <Pending /> : requests.isError ? <ErrorBox error={requests.error} retry={() => { void requests.refetch(); }} /> : requests.data.requests.length === 0 ? <Empty title={m.noUnresolved} /> : <DataList caption={m.unresolved}>{requests.data.requests.map(request => <article className="data-row" key={request.id}>
      <h2>{request.username}</h2><dl><dt>{m.model}</dt><dd>{request.model}</dd><dt>{m.heldAmount}</dt><dd className="number">{formatCredits(request.heldMicro)} {m.credits}</dd><dt>{m.maxOutput}</dt><dd>{request.maxOutput}</dd><dt>{m.time}</dt><dd>{formatDate(request.createdAt)}</dd><dt>{m.requestId}</dt><dd className="mono">{request.id}</dd></dl>
      <Button onClick={() => { setSelected(request); setDebitTokens('0'); setReason(''); action.setError(null); }}>{m.resolveRequest}</Button>
    </article>)}</DataList>}
    <AdminRequestList />
    {selected && <Modal title={m.resolveRequest} busy={action.busy} onClose={close}><p>{m.resolveConfirm}</p><dl><dt>{m.username}</dt><dd>{selected.username}</dd><dt>{m.heldAmount}</dt><dd>{formatCredits(selected.heldMicro)} {m.credits}</dd></dl><form className="stack" onSubmit={event => { event.preventDefault(); const payload = { debitTokens, reason: reason.trim() }; void action.run(async () => { await post(`/admin/api/requests/${encodeURIComponent(selected.id)}/resolve`, payload); close(); await requests.refetch(); }); }}>
      <Field label={m.debitTokens} help={m.resolveReleaseHelp} value={debitTokens} onChange={event => setDebitTokens(event.target.value)} inputMode="numeric" pattern="0|[1-9][0-9]{0,11}" maxLength={12} required />
      <Field label={m.reason} help={m.reasonHelp} value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={500} pattern=".*\S.*" required />
      {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
      <div className="actions"><Button type="button" className="secondary" disabled={action.busy} onClick={close}>{m.cancel}</Button><Button busy={action.busy}>{m.resolveRequest}</Button></div>
    </form></Modal>}
    {action.dialog}
  </>;
}

export function OverdraftPage() {
  const setting = useResource<{ overdraftMicro: string }>('/admin/api/settings/overdraft');
  const action = useAdminAction();
  const [tokens, setTokens] = useState('');
  const [confirm, setConfirm] = useState(false);
  const close = () => { setConfirm(false); action.setError(null); };
  const title = <PageTitle subtitle={m.overdraftSubtitle}>{m.overdraft}</PageTitle>;
  if (setting.isPending) return <>{title}<Pending /></>;
  if (setting.isError) return <>{title}<ErrorBox error={setting.error} retry={() => { void setting.refetch(); }} /></>;
  return <>{title}<section className="panel stack"><h2>{m.currentOverdraft}</h2><p className="number">{formatCredits(setting.data.overdraftMicro)} {m.credits}</p><form className="stack" onSubmit={event => { event.preventDefault(); setConfirm(true); action.setError(null); }}>
    <Field label={m.overdraftTokens} help={m.overdraftHelp} value={tokens} onChange={event => setTokens(event.target.value)} inputMode="numeric" pattern="0|[1-9][0-9]{0,11}" maxLength={12} required />
    <Button>{m.save}</Button>
  </form></section>
  {confirm && <Modal title={m.confirmOverdraft} busy={action.busy} onClose={close}><p>{m.financialConfirm}</p><p>{tokens} {m.credits}</p>{action.error && <ErrorBox error={action.error} />}<div className="actions"><Button className="secondary" disabled={action.busy} onClick={close}>{m.cancel}</Button><Button busy={action.busy} onClick={() => { void action.run(async () => { await post('/admin/api/settings/overdraft', { tokens }); close(); setTokens(''); await setting.refetch(); }); }}>{m.save}</Button></div></Modal>}
  {action.dialog}</>;
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const before = params.get('before');
  const result = useResource<{ events: AuditEvent[] }>(`/admin/api/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`);
  return <><PageTitle subtitle={m.auditSubtitle}>{m.audit}</PageTitle>{result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => { void result.refetch(); }} /> : result.data.events.length === 0 ? <Empty title={m.noAudit} /> : <DataList caption={m.audit}>{result.data.events.map(event => <article className="data-row" key={event.id}>
    <div className="request-heading"><h2>{event.action}</h2><Badge status={event.actorKind} /></div><dl><dt>{m.time}</dt><dd>{formatDate(event.createdAt)}</dd><dt>{m.actor}</dt><dd>{event.actorUser ?? m.system}</dd><dt>{m.target}</dt><dd>{event.targetType}: {event.targetId}</dd><dt>{m.auditId}</dt><dd>{event.id}</dd></dl>
  </article>)}</DataList>} {result.isSuccess && result.data.events.length > 0 && <nav className="pagination" aria-label={m.audit}>{before && <Button className="secondary" onClick={() => setParams({})}>{m.first}</Button>}<Button className="secondary" onClick={() => setParams({ before: result.data.events[result.data.events.length - 1].id })}>{m.next}</Button></nav>}</>;
}
