import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { post } from './api.ts';
import { formatCredits, formatDate } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending } from './ui.tsx';

type Unresolved = { id: string; username: string; model: string; heldMicro: string; maxOutput: number; createdAt: string };
type AuditEvent = { id: string; actorUser: string | null; actorKind: string; action: string; targetType: string; targetId: string; summary: unknown; createdAt: string };

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
  if (setting.isPending) return <Pending />;
  if (setting.isError) return <ErrorBox error={setting.error} retry={() => { void setting.refetch(); }} />;
  return <><PageTitle subtitle={m.overdraftSubtitle}>{m.overdraft}</PageTitle><section className="panel stack"><h2>{m.currentOverdraft}</h2><p className="number">{formatCredits(setting.data.overdraftMicro)} {m.credits}</p><form className="stack" onSubmit={event => { event.preventDefault(); setConfirm(true); action.setError(null); }}>
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
