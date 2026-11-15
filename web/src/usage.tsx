import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { formatCredits, formatDate, grouped } from './credits.ts';
import { useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { Alert, Button, DataList, Empty, ErrorBox, PageTitle, Pending } from './ui.tsx';

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
type RequestRecord = {
  id: string; model: string; protocol: 'CHAT' | 'ANTHROPIC' | 'RESPONSES'; stream: boolean; state: string;
  final: boolean; heldMicro: string; debitMicro: string | null; estimated: boolean; usage: Usage; createdAt: string;
};
type DailySummary = { date: string; requests: number; debitMicro: bigint; heldMicro: bigint };

function requestStatus(value: string): string {
  const states: Record<string, string> = {
    ADMITTED: 'Diterima', DISPATCHED: 'Dikirim ke upstream', STREAMING: 'Mengalir',
    SETTLED: 'Selesai', SETTLED_ESTIMATED: 'Selesai dengan estimasi', UNRESOLVED: 'Belum diputuskan',
    FAILED: 'Gagal', CANCELLED: 'Dibatalkan', RESOLVED: 'Sudah diputuskan',
  };
  return states[value] ?? 'Status belum dikenal';
}

function dayKey(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const year = part('year'); const month = part('month'); const day = part('day');
  if (!year || !month || !day) throw new Error('invalid_request_timestamp');
  return `${year}-${month}-${day}`;
}

function tokenCount(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_usage_count');
  return grouped(String(value));
}

function dailySummaries(requests: RequestRecord[]): DailySummary[] {
  const summaries = new Map<string, DailySummary>();
  for (const request of requests) {
    const date = dayKey(request.createdAt);
    const current = summaries.get(date) ?? { date, requests: 0, debitMicro: 0n, heldMicro: 0n };
    current.requests += 1;
    if (request.debitMicro !== null) current.debitMicro += BigInt(request.debitMicro);
    if (!request.final) current.heldMicro += BigInt(request.heldMicro);
    summaries.set(date, current);
  }
  return [...summaries.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function RequestDetails({ request }: { request: RequestRecord }) {
  const zero = request.usage !== null && request.usage.input === 0 && request.usage.output === 0 && request.usage.cacheRead === 0 && request.usage.cacheWrite === 0;
  return <article className="data-row request-row">
    <div className="request-heading"><h2>{request.model}</h2><span className="badge">{request.protocol}</span><span className="badge">{request.stream ? m.streamYes : m.streamNo}</span></div>
    <dl>
      <dt>{m.requestId}</dt><dd className="mono">{request.id}</dd>
      <dt>{m.time}</dt><dd>{formatDate(request.createdAt)}</dd>
      <dt>{m.status}</dt><dd>{requestStatus(request.state)}{!request.final && <span className="request-finality">{m.notFinal}</span>}</dd>
      {!request.final && <><dt>{m.heldAmount}</dt><dd className="number">{formatCredits(request.heldMicro)} {m.credits}</dd></>}
      {request.final && request.debitMicro !== null && <><dt>{m.requestDebit}</dt><dd className="number">{formatCredits(request.debitMicro)} {m.credits}</dd></>}
    </dl>
    {request.usage === null ? <Alert>{m.noUsage}</Alert> : <section className="usage-detail" aria-label={m.chargedUsage}>
      <h3>{m.chargedUsage}</h3>
      <dl>{([[m.input, request.usage.input], [m.output, request.usage.output], [m.cacheRead, request.usage.cacheRead], [m.cacheWrite, request.usage.cacheWrite]] as const).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd className="number">{tokenCount(amount)}</dd></div>)}</dl>
      {zero && <Alert>{m.zeroUsage}</Alert>}
    </section>}
    {request.state === 'UNRESOLVED' && <Alert>{m.awaitingDecision}</Alert>}
    {request.estimated && <Alert>{m.estimated}</Alert>}
    <details className="request-technical"><summary>{m.details}</summary><dl><dt>{m.requestState}</dt><dd>{request.state}</dd><dt>{m.protocol}</dt><dd>{request.protocol}</dd></dl></details>
  </article>;
}

function PageSummary({ requests }: { requests: RequestRecord[] }) {
  const debit = requests.reduce((total, request) => total + (request.debitMicro === null ? 0n : BigInt(request.debitMicro)), 0n);
  const held = requests.reduce((total, request) => total + (request.final ? 0n : BigInt(request.heldMicro)), 0n);
  const daily = dailySummaries(requests);
  const highestDebit = daily.reduce((maximum, summary) => summary.debitMicro > maximum ? summary.debitMicro : maximum, 0n);
  return <section className="panel stack" aria-label={m.pageDailySummary}>
    <h2>{m.pageDailySummary}</h2>
    <p>{m.pageDebit}: <strong className="number">{formatCredits(debit.toString())} {m.credits}</strong></p>
    <p>{m.pageHeld}: <strong className="number">{formatCredits(held.toString())} {m.credits}</strong></p>
    <small>{m.summaryPageOnly}</small>
    <div className="usage-bars" role="img" aria-label={m.dailyDebitChart}>
      {daily.map(summary => <div className="usage-bar-row" key={summary.date}><span>{summary.date}</span><span className="usage-bar-track" aria-hidden="true"><span style={{ width: highestDebit === 0n ? '0%' : `${summary.debitMicro * 100n / highestDebit}%` }} /></span><strong>{formatCredits(summary.debitMicro.toString())} {m.credits}</strong></div>)}
    </div>
    <DataList caption={m.daily}>{daily.map(summary => <article className="data-row" key={summary.date}>
      <h3>{summary.date}</h3>
      <dl><dt>{m.requestCount}</dt><dd>{grouped(String(summary.requests))}</dd><dt>{m.requestDebit}</dt><dd>{formatCredits(summary.debitMicro.toString())} {m.credits}</dd><dt>{m.heldAmount}</dt><dd>{formatCredits(summary.heldMicro.toString())} {m.credits}</dd></dl>
    </article>)}</DataList>
  </section>;
}

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const before = params.get('before');
  const model = params.get('model') ?? '';
  const protocol = params.get('protocol') ?? '';
  const state = params.get('state') ?? '';
  const query = new URLSearchParams({ limit: '50' });
  if (before) query.set('before', before);
  const result = useResource<{ requests: RequestRecord[]; nextBefore: string | null }>(`/api/requests?${query.toString()}`);
  const options = useMemo(() => {
    if (!result.data) return { models: [], protocols: [], states: [] };
    return {
      models: [...new Set(result.data.requests.map(request => request.model))].sort(),
      protocols: [...new Set(result.data.requests.map(request => request.protocol))].sort(),
      states: [...new Set(result.data.requests.map(request => request.state))].sort(),
    };
  }, [result.data]);
  const filtered = result.data?.requests.filter(request => (!model || request.model === model) && (!protocol || request.protocol === protocol) && (!state || request.state === state)) ?? [];
  const filteredOut = result.data !== undefined && result.data.requests.length > 0 && filtered.length === 0;
  const changeFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete('before');
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };
  return <>
    <PageTitle subtitle={m.requestsSubtitle}>{m.requests}</PageTitle>
    {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => { void result.refetch(); }} /> : result.data.requests.length === 0 ? <Empty title={m.noRequests} /> : <>
      <PageSummary requests={result.data.requests} />
      <section className="panel stack" aria-label={m.filters}>
        <h2>{m.filters}</h2>
        <label>{m.modelFilter}<select value={model} onChange={event => changeFilter('model', event.target.value)}><option value="">{m.allValues}</option>{options.models.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>{m.protocolFilter}<select value={protocol} onChange={event => changeFilter('protocol', event.target.value)}><option value="">{m.allValues}</option>{options.protocols.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>{m.stateFilter}<select value={state} onChange={event => changeFilter('state', event.target.value)}><option value="">{m.allValues}</option>{options.states.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </section>
      {filtered.length === 0 ? <Empty title={filteredOut ? m.noFilterResults : m.noRequests} /> : <DataList caption={m.requests}>{filtered.map(request => <RequestDetails request={request} key={request.id} />)}</DataList>}
    </>}
    {result.isSuccess && result.data.requests.length > 0 && <nav className="pagination" aria-label={m.requests}>
      {before && <Button className="secondary" disabled={result.isFetching} onClick={() => { const next = new URLSearchParams(params); next.delete('before'); setParams(next); }}>{m.first}</Button>}
      {result.data.nextBefore && <Button className="secondary" disabled={result.isFetching} onClick={() => { const next = new URLSearchParams(params); next.set('before', result.data.nextBefore!); setParams(next); }}>{m.next}</Button>}
    </nav>}
  </>;
}
