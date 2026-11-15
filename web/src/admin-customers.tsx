import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { newIdempotencyKey, post } from './api.ts';
import { creditsToMicro, formatCredits, formatDate } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { kindText, m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending, Receipt } from './ui.tsx';
import type { ReceiptData } from './ui.tsx';

type Customer = {
  username: string; tenantStatus: string; version: string;
  postedMicro: string; heldMicro: string; availableMicro: string;
  entries: { id: string; kind: string; amount: string; createdAt: string }[];
};
type Topup = { username: string; amountTokens: string; saleRef: string; idempotencyKey: string };
type UsageAggregate = { key: string; requests: number; failed: number; estimated: number; debitMicro: string; inputTokens: string; outputTokens: string; unbilledInputTokens: string };
type CustomerUsage = { username: string; days: number; byDay: UsageAggregate[]; byModel: UsageAggregate[]; byKey: UsageAggregate[]; recent: { id: string; model: string; protocol: string; state: string; debitMicro: string | null; estimated: boolean; unbilledInputTokens: string; createdAt: string }[] };

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
  const query = new URLSearchParams({ limit: '50' });
  if (prefix) query.set('prefix', prefix);
  if (after) query.set('after', after);
  const path = `/admin/api/customers?${query.toString()}`;
  const result = useResource<{ customers: { username: string; tenantStatus: string; createdAt: string; postedMicro: string; heldMicro: string }[]; nextAfter: string | null }>(path);
  const [username, setUsername] = useState('');
  const [selected, setSelected] = useState('');
  const applyFilter = () => {
    const nextPrefix = username.trim();
    setSelected('');
    setParams(nextPrefix ? { prefix: nextPrefix } : {});
  };
  return <>
    <PageTitle subtitle={m.customerHelp}>{m.customers}</PageTitle>
    <section className="panel stack">
      <h2>{m.customerList}</h2>
      <Field label={m.customerPrefix} value={username} onChange={event => setUsername(event.target.value)} maxLength={24} autoComplete="off" />
      <div className="actions"><Button type="button" onClick={applyFilter}>{m.search}</Button><Button className="secondary" type="button" disabled={result.isFetching} onClick={() => void result.refetch()}>{m.refresh}</Button></div>
    </section>
    {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => { void result.refetch(); }} /> : result.data.customers.length === 0 ? <Empty title={prefix ? m.customerNoMatches : m.customerListEmpty} /> : <DataList caption={m.customerList}>{result.data.customers.map(customer => <article className="data-row customer-list-row" key={customer.username}>
      <div className="request-heading"><h2>{customer.username}</h2><Badge status={customer.tenantStatus} /></div>
      <dl><dt>{m.createdAt}</dt><dd>{formatDate(customer.createdAt)}</dd><dt>{m.posted}</dt><dd className="number">{formatCredits(customer.postedMicro)} {m.credits}</dd><dt>{m.held}</dt><dd className="number">{formatCredits(customer.heldMicro)} {m.credits}</dd></dl>
      <Button className="secondary" onClick={() => { setUsername(customer.username); setSelected(customer.username); }}>{m.customerDetails}</Button>
    </article>)}</DataList>}
    {result.isSuccess && <nav className="pagination" aria-label={m.customerList}>
      {after && <Button className="secondary" disabled={result.isFetching} onClick={() => setParams(prefix ? { prefix } : {})}>{m.first}</Button>}
      {result.data.nextAfter && <Button className="secondary" disabled={result.isFetching} onClick={() => setParams({ ...(prefix ? { prefix } : {}), after: result.data.nextAfter! })}>{m.next}</Button>}
    </nav>}
    {selected && <CustomerDetail key={selected} username={selected} />}
  </>;
}

function CustomerDetail({ username }: { username: string }) {
  const customer = useResource<Customer>(`/admin/api/customers/${encodeURIComponent(username)}`);
  const action = useAdminAction();
  const [amount, setAmount] = useState(''); const [saleRef, setSaleRef] = useState('');
  const [confirmation, setConfirmation] = useState<Topup | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  if (customer.isPending) return <Pending />;
  if (customer.error) return <ErrorBox error={customer.error} retry={() => { void customer.refetch(); }} />;
  const value = customer.data;
  return <div className="stack">
    <section className="panel stack" aria-label={m.details}>
      <div className="actions"><h2>{value.username}</h2><Badge status={value.tenantStatus} /><Button className="secondary" busy={customer.isFetching} onClick={() => { void customer.refetch(); }}>{m.refresh}</Button></div>
      <dl className="metrics">
        {([[m.available, value.availableMicro], [m.posted, value.postedMicro], [m.held, value.heldMicro]] as const).map(([label, micro]) => <div className="metric" key={label}><dt>{label}</dt><dd className="number">{formatCredits(micro)} {m.credits}</dd></div>)}
      </dl>
      {value.tenantStatus === 'SUSPENDED' && <Alert danger>{m.suspended}</Alert>}
    </section>
    <form className="panel stack" onSubmit={e => {
      e.preventDefault(); action.setError(null); setReceipt(null);
      setConfirmation({ username: value.username, amountTokens: amount, saleRef: saleRef.trim(), idempotencyKey: newIdempotencyKey() });
    }}>
      <h2>{m.topup}</h2>
      <Field label={m.tokens} value={amount} onChange={e => setAmount(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]{0,11}" maxLength={12} required />
      <Field label={m.saleRef} value={saleRef} onChange={e => setSaleRef(e.target.value)} maxLength={200} pattern=".*\S.*" required />
      <div className="actions"><Button busy={action.busy}>{m.topup}</Button></div>
    </form>
    {receipt && <Receipt value={receipt} />}
    {!confirmation && action.error && <ErrorBox error={action.error} />}
    <CustomerUsagePanel username={value.username} />
    <section className="panel stack"><h2>{m.ledger}</h2>
      {value.entries.length === 0 ? <Empty /> : <DataList caption={m.ledger}>{value.entries.map(entry => <article className="data-row" key={entry.id}>
        <dl><dt>{m.transactionId}</dt><dd>{entry.id}</dd><dt>{m.kind}</dt><dd>{kindText[entry.kind] ?? entry.kind}</dd><dt>{m.amount}</dt><dd className="number">{formatCredits(entry.amount)} {m.credits}</dd><dt>{m.time}</dt><dd>{formatDate(entry.createdAt)}</dd></dl>
      </article>)}</DataList>}
    </section>
    {confirmation && <Modal title={m.topupConfirm} busy={action.busy} onClose={() => { setConfirmation(null); action.setError(null); }}>
      <p>{m.financialConfirm}</p><dl><dt>{m.username}</dt><dd>{confirmation.username}</dd><dt>{m.tokens}</dt><dd>{formatCredits(creditsToMicro(confirmation.amountTokens))} {m.credits}</dd><dt>{m.saleRef}</dt><dd>{confirmation.saleRef}</dd></dl>
      {action.error && <ErrorBox error={action.error} />}
      {action.busy && <Alert>{m.saving}</Alert>}
      <div className="actions"><Button className="secondary" autoFocus disabled={action.busy} onClick={() => setConfirmation(null)}>{m.cancel}</Button><Button busy={action.busy} onClick={() => {
        const payload = confirmation;
        void action.run(async () => {
          const result = await post<ReceiptData>('/admin/api/topups', payload);
          setConfirmation(null); setReceipt(result); setAmount(''); setSaleRef('');
          await customer.refetch();
        });
      }}>{m.topup}</Button></div>
    </Modal>}
    {action.dialog}
  </div>;
}
