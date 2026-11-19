import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { post } from './api.ts';
import { formatCredits, formatDate } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { AdminRequestList } from './admin-request-list.tsx';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending } from './ui.tsx';

type Unresolved = { id: string; username: string; model: string; heldMicro: string; maxOutput: number; createdAt: string };
type AuditEvent = { id: string; actorUser: string | null; actorUsername: string | null; actorKind: string; action: string; targetType: string; targetId: string | null; summary: unknown; createdAt: string };
type AuditResult = { events: AuditEvent[]; nextBefore: string | null };
type AuditFilterName = 'action' | 'actor' | 'targetType' | 'targetId';
const auditActionGroups = Object.keys(m.auditActionGroups) as (keyof typeof m.auditActionGroups)[];

function auditActionLabel(action: string): string {
  return Object.hasOwn(m.auditActionText, action) ? m.auditActionText[action as keyof typeof m.auditActionText] : action;
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const [actionChoice, setActionChoice] = useState(() => {
    const action = params.get('action') ?? '';
    return action === '' || auditActionGroups.some(prefix => prefix === action) ? action : '__custom';
  });
  const [customAction, setCustomAction] = useState(() => {
    const action = params.get('action') ?? '';
    return auditActionGroups.some(prefix => prefix === action) ? '' : action;
  });
  const [actor, setActor] = useState(params.get('actor') ?? '');
  const [targetType, setTargetType] = useState(params.get('targetType') ?? '');
  const [targetId, setTargetId] = useState(params.get('targetId') ?? '');
  const filterSearch = params.toString();
  useEffect(() => {
    const current = new URLSearchParams(filterSearch);
    const action = current.get('action') ?? '';
    setActionChoice(action === '' || auditActionGroups.some(prefix => prefix === action) ? action : '__custom');
    setCustomAction(auditActionGroups.some(prefix => prefix === action) ? '' : action);
    setActor(current.get('actor') ?? '');
    setTargetType(current.get('targetType') ?? '');
    setTargetId(current.get('targetId') ?? '');
  }, [filterSearch]);

  const query = new URLSearchParams();
  const activeFilters = new Map<AuditFilterName, string>();
  for (const key of ['action', 'actor', 'targetType', 'targetId'] as const) {
    const value = params.get(key)?.trim() ?? '';
    if (value) { activeFilters.set(key, value); query.set(key, value); }
  }
  const before = params.get('before');
  if (before) query.set('before', before);
  const result = useResource<AuditResult>(`/admin/api/audit${query.size ? `?${query}` : ''}`);
  const hasFilters = activeFilters.size > 0;
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams();
    const selectedAction = actionChoice === '__custom' ? customAction.trim() : actionChoice;
    if (selectedAction) next.set('action', selectedAction);
    if (actor.trim()) next.set('actor', actor.trim());
    if (targetType.trim()) next.set('targetType', targetType.trim());
    if (targetId.trim()) next.set('targetId', targetId.trim());
    setParams(next);
  };
  const clearFilters = () => setParams({});
  const page = (nextBefore: string | null) => {
    const next = new URLSearchParams(params);
    if (nextBefore) next.set('before', nextBefore);
    else next.delete('before');
    setParams(next);
  };

  return <><PageTitle subtitle={m.auditSubtitle}>{m.audit}</PageTitle>
    <section className="panel stack" aria-label={m.auditFilters}>
      <form className="stack" onSubmit={applyFilters}>
        <div className="field"><label htmlFor="audit-action">{m.auditActionFilter}</label><select id="audit-action" value={actionChoice} onChange={event => setActionChoice(event.target.value)}><option value="">{m.auditActionAll}</option>{auditActionGroups.map(prefix => <option key={prefix} value={prefix}>{m.auditActionGroups[prefix]}</option>)}<option value="__custom">{m.auditActionCustom}</option></select></div>
        {actionChoice === '__custom' && <Field label={m.auditCustomAction} help={m.auditCustomActionHelp} value={customAction} onChange={event => setCustomAction(event.target.value)} maxLength={64} />}
        <Field label={m.auditActorUsername} value={actor} onChange={event => setActor(event.target.value)} maxLength={64} />
        <Field label={m.auditTargetType} value={targetType} onChange={event => setTargetType(event.target.value)} maxLength={64} />
        <Field label={m.auditTargetId} value={targetId} onChange={event => setTargetId(event.target.value)} maxLength={200} />
        <div className="actions"><Button type="submit">{m.search}</Button><Button className="secondary" type="button" disabled={!hasFilters} onClick={clearFilters}>{m.clearFilters}</Button></div>
      </form>
    </section>
    {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => { void result.refetch(); }} /> : result.data.events.length === 0 ? <Empty title={hasFilters ? m.auditNoMatches : m.noAudit} /> : <DataList caption={m.audit}>{result.data.events.map(event => <article className="data-row" key={event.id}>
      <div className="request-heading"><h2>{auditActionLabel(event.action)}</h2><Badge status={event.actorKind} /></div><dl><dt>{m.time}</dt><dd>{formatDate(event.createdAt)}</dd><dt>{m.actor}</dt><dd>{event.actorKind === 'SYSTEM' ? m.system : event.actorUsername ?? m.auditUnknownActor}</dd><dt>{m.target}</dt><dd>{event.targetType}: {event.targetId ?? m.auditUnknownTarget}</dd><dt>{m.auditId}</dt><dd className="mono">{event.id}</dd></dl>
    </article>)}</DataList>}
    {result.isSuccess && (before || result.data.nextBefore || result.data.events.length > 0) && <nav className="pagination" aria-label={m.audit}>
      {before && <Button className="secondary" disabled={result.isFetching} onClick={() => page(null)}>{m.first}</Button>}
      {result.data.nextBefore && <Button className="secondary" disabled={result.isFetching} onClick={() => page(result.data.nextBefore)}>{m.next}</Button>}
      {result.data.events.length > 0 && <small>{m.auditPageSize}</small>}
    </nav>}
  </>;
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
