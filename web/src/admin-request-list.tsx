import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatCredits, formatDate, grouped } from './credits.ts';
import { useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { Button, DataList, Empty, ErrorBox, Field, Pending } from './ui.tsx';

type RequestUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type AdminRequest = {
  id: string; username: string; keyName: string | null; model: string; protocol: string; stream: boolean; state: string;
  outcome: string | null; final: boolean; heldMicro: string; debitMicro: string | null; estimated: boolean;
  usage: RequestUsage | null; createdAt: string;
};
type AdminRequestsResult = { requests: AdminRequest[]; nextBefore: string | null };
type CustomerRequestTabProps = { username?: string };

const requestStates = Object.keys(m.requestStateText) as (keyof typeof m.requestStateText)[];

function requestStateLabel(value: string): string {
  return Object.hasOwn(m.requestStateText, value) ? m.requestStateText[value as keyof typeof m.requestStateText] : m.adminRequestStateUnknown;
}

function requestOutcomeLabel(value: string | null): string {
  if (value === null) return m.adminRequestNoOutcome;
  return Object.hasOwn(m.requestOutcomeText, value) ? m.requestOutcomeText[value as keyof typeof m.requestOutcomeText] : m.adminRequestOutcomeUnknown;
}

/** Shared metadata-only request list. Supplying username fixes tenant scope for the customer detail tab. */
export function AdminRequestList({ username }: CustomerRequestTabProps = {}) {
  const [params, setParams] = useSearchParams();
  const fixedUsername = username !== undefined;
  const beforeKey = fixedUsername ? 'requestBefore' : 'before';
  const before = params.get(beforeKey);
  const [usernameFilter, setUsernameFilter] = useState(params.get('username') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [model, setModel] = useState(params.get('model') ?? '');
  useEffect(() => {
    setUsernameFilter(params.get('username') ?? '');
    setState(params.get('state') ?? '');
    setModel(params.get('model') ?? '');
  }, [params]);

  const query = new URLSearchParams({ limit: '50' });
  if (fixedUsername) query.set('username', username);
  else {
    for (const [key, value] of [['username', params.get('username')], ['state', params.get('state')], ['model', params.get('model')]] as const) {
      if (value) query.set(key, value);
    }
  }
  if (before) query.set('before', before);
  const result = useResource<AdminRequestsResult>(`/admin/api/requests?${query}`);
  const hasFilters = !fixedUsername && Boolean(params.get('username') || params.get('state') || params.get('model'));
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams({ limit: '50' });
    const userFilter = usernameFilter.trim();
    const modelFilter = model.trim();
    if (userFilter) next.set('username', userFilter);
    if (state) next.set('state', state);
    if (modelFilter) next.set('model', modelFilter);
    setParams(next);
  };
  const title = fixedUsername ? m.customerRequests : m.allCustomerRequests;
  const help = fixedUsername ? m.customerRequestsHelp : m.allCustomerRequestsHelp;

  return <section className="panel stack" aria-label={title}>
    <header className="stack"><h2>{title}</h2><p>{help}</p></header>
    {!fixedUsername && <form className="stack" onSubmit={applyFilters}>
      <Field label={m.adminRequestUsername} value={usernameFilter} onChange={event => setUsernameFilter(event.target.value)} maxLength={64} />
      <div className="field"><label htmlFor="admin-request-state">{m.adminRequestState}</label><select id="admin-request-state" value={state} onChange={event => setState(event.target.value)}><option value="">{m.allValues}</option>{requestStates.map(value => <option key={value} value={value}>{m.requestStateText[value]}</option>)}</select></div>
      <Field label={m.adminRequestModel} value={model} onChange={event => setModel(event.target.value)} maxLength={128} />
      <div className="actions"><Button type="submit">{m.search}</Button><Button className="secondary" type="button" disabled={!hasFilters} onClick={() => setParams({ limit: '50' })}>{m.clearFilters}</Button></div>
    </form>}
    {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => { void result.refetch(); }} /> : result.data.requests.length === 0 ? before ? <section className="empty"><h3>{m.noMoreData}</h3><Button className="secondary" onClick={() => { const next = new URLSearchParams(params); next.delete(beforeKey); setParams(next); }}>{m.first}</Button></section> : <Empty title={hasFilters ? m.adminRequestsNoMatches : m.adminRequestsEmpty} /> : <DataList caption={title}>{result.data.requests.map(request => <article className="data-row" key={request.id}>
      <div className="request-heading"><h3>{fixedUsername ? request.username : <Link to={`/admin/pelanggan?customer=${encodeURIComponent(request.username)}&tab=summary`}>{request.username}</Link>}</h3><span className="badge" data-status={Object.hasOwn(m.requestStateText, request.state) ? request.state : 'UNKNOWN'}>{requestStateLabel(request.state)}</span>{request.estimated && <span className="badge" data-status="SETTLED_ESTIMATED">{m.adminRequestEstimate}</span>}</div>
      <dl><dt>{m.time}</dt><dd>{formatDate(request.createdAt)}</dd><dt>{m.requestId}</dt><dd className="mono">{request.id}</dd><dt>{m.adminRequestKey}</dt><dd>{request.keyName ?? m.adminRequestNoKey}</dd><dt>{m.model}</dt><dd className="mono">{request.model}</dd><dt>{m.protocol}</dt><dd>{request.protocol}</dd><dt>{m.stream}</dt><dd>{request.stream ? m.streamYes : m.streamNo}</dd>
        {request.final ? <><dt>{m.adminRequestDebit}</dt><dd className="number">{formatCredits(request.debitMicro ?? '0')} {m.credits}</dd></> : <><dt>{m.adminRequestHeld}</dt><dd className="number">{formatCredits(request.heldMicro)} {m.credits}</dd></>}
      </dl>
      <section className="stack" aria-label={m.adminRequestOutcome}><h4>{m.adminRequestOutcome}</h4><p>{requestOutcomeLabel(request.outcome)}</p></section>
      <details><summary>{m.chargedUsage}</summary>{request.usage === null ? <p>{m.adminRequestNoUsage}</p> : <dl>{([[m.input, request.usage.input], [m.output, request.usage.output], [m.cacheRead, request.usage.cacheRead], [m.cacheWrite, request.usage.cacheWrite]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{grouped(String(count))}</dd></div>)}</dl>}</details>
    </article>)}</DataList>}
    {result.isSuccess && result.data.requests.length > 0 && <nav className="pagination" aria-label={title}>
      {before && <Button className="secondary" disabled={result.isFetching} onClick={() => { const next = new URLSearchParams(params); next.delete(beforeKey); setParams(next); }}>{m.first}</Button>}
      {result.data.nextBefore && <Button className="secondary" disabled={result.isFetching} onClick={() => { const next = new URLSearchParams(params); next.set(beforeKey, result.data.nextBefore!); setParams(next); }}>{m.next}</Button>}
    </nav>}
  </section>;
}
