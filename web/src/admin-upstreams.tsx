import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, api, post } from './api.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { formatDate } from './credits.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending } from './ui.tsx';

const protocols = ['CHAT', 'ANTHROPIC', 'RESPONSES'] as const;
type Protocol = typeof protocols[number];
type Upstream = { id: string; name: string; status: 'PENDING' | 'ELIGIBLE' | 'BLOCKED'; archived: boolean; baseUrls: Record<Protocol, string | null>; keySet: boolean; keySetAt: string | null; termsNote: string; version: string };
type Circuit = { open: boolean; openUntil: string | null; reason: 'failures' | 'upstream_auth' | null; failures: number };
type Route = { id: string; modelId: string; upstreamId: string; protocol: Protocol; upstreamModel: string; priority: number; enabled: boolean; maxConcurrency: number | null; version: string; circuit: Circuit };
type Model = { id: string; displayName: string; version: string; sellable: boolean; archived: boolean; published: unknown; draft: unknown };
type UpstreamModelList = { upstreamId: string; protocol: Protocol; models: string[] };
type Urls = Record<Protocol, string>;
type ArchiveTarget = { id: string; name: string; version: string; archived: boolean };
const emptyUrls: Urls = { CHAT: '', ANTHROPIC: '', RESPONSES: '' };

function UpstreamRows({ rows, onEdit, onStatus, onArchive }: { rows: Upstream[]; onEdit: (row: Upstream) => void; onStatus: (row: Upstream, status: Upstream['status']) => void; onArchive: (row: Upstream) => void }) {
  return rows.length === 0 ? <Empty title={m.noUpstreams} /> : <DataList caption={m.upstreams}>{rows.map(row => <article className="data-row upstream-row" key={row.id}>
    <div className="request-heading"><h2>{row.name}</h2><Badge status={row.archived ? 'RETIRED' : row.status} /></div>
    <dl>{protocols.filter(protocol => row.baseUrls[protocol]).map(protocol => <div key={protocol}><dt>{protocol}</dt><dd className="mono">{row.baseUrls[protocol]}</dd></div>)}<dt>{m.apiKeyUpstream}</dt><dd>{row.keySet ? `${m.keyStored}${row.keySetAt ? `, ${row.keySetAt}` : ''}` : m.keyNotStored}</dd>{row.termsNote && <><dt>{m.termsNote}</dt><dd>{row.termsNote}</dd></>}</dl>
    <div className="actions">{!row.archived && <><Button className="secondary" onClick={() => onEdit(row)}>{m.edit}</Button>{row.status !== 'PENDING' && <Button className="secondary" onClick={() => onStatus(row, 'PENDING')}>{m.statusPending}</Button>}{row.status !== 'ELIGIBLE' && <Button onClick={() => onStatus(row, 'ELIGIBLE')}>{m.statusEligible}</Button>}{row.status !== 'BLOCKED' && <Button className="danger-button" onClick={() => onStatus(row, 'BLOCKED')}>{m.statusBlocked}</Button>}</>}<Button className={row.archived ? 'secondary' : 'danger-button'} onClick={() => onArchive(row)}>{row.archived ? m.restoreUpstream : m.archiveUpstream}</Button></div>
  </article>)}</DataList>;
}
function CircuitStatus({ circuit }: { circuit: Circuit }) {
  if (!circuit) return null;
  if (!circuit.open) return circuit.failures > 0 ? <Alert>{m.circuitWarning(String(circuit.failures))}</Alert> : null;
  const reason = circuit.reason === 'failures' ? m.circuitFailures : circuit.reason === 'upstream_auth' ? m.circuitUpstreamAuth : m.circuitReasonUnknown;
  return <Alert><p>{m.circuitOpen}</p><p>{reason}</p>{circuit.openUntil && <p>{m.circuitRetryAt}: <time dateTime={circuit.openUntil}>{formatDate(circuit.openUntil)}</time></p>}</Alert>;
}
function RoutesTable({ rows, upstreams, onEdit }: { rows: Route[]; upstreams: Upstream[]; onEdit: (row: Route) => void }) {
  const names = new Map(upstreams.map(upstream => [upstream.id, upstream.name]));
  return rows.length === 0 ? <Empty title={m.noRoutes} /> : <DataList caption={m.routes}>{rows.map(route => <article className="data-row" key={route.id}>
    <h3>{route.modelId}</h3><dl><dt>{m.upstream}</dt><dd>{names.get(route.upstreamId) ?? route.upstreamId}</dd><dt>{m.protocol}</dt><dd>{route.protocol}</dd><dt>{m.upstreamModel}</dt><dd className="mono">{route.upstreamModel}</dd><dt>{m.priority}</dt><dd>{route.priority}</dd><dt>{m.active}</dt><dd>{route.enabled ? m.active : m.inactive}</dd><dt>{m.concurrency}</dt><dd>{route.maxConcurrency ?? m.unlimited}</dd><dt>{m.version}</dt><dd>{route.version}</dd></dl><CircuitStatus circuit={route.circuit} /><Button className="secondary" onClick={() => onEdit(route)}>{m.edit}</Button>
  </article>)}</DataList>;
}
function ArchiveConfirmation({ target, busy, error, onCancel, onConfirm }: { target: ArchiveTarget; busy: boolean; error: unknown; onCancel: () => void; onConfirm: () => void }) {
  const title = target.archived ? m.restoreUpstream : m.archiveUpstream;
  return <Modal title={title} busy={busy} onClose={onCancel}><p>{target.name}</p><p>{m.version}: {target.version}</p><Alert>{target.archived ? m.upstreamRestoreImpact : m.upstreamArchiveImpact}</Alert><form className="stack" onSubmit={event => { event.preventDefault(); onConfirm(); }}>{error !== null && error !== undefined && <ErrorBox error={error} />}{busy && <Alert>{m.saving}</Alert>}<div className="actions"><Button type="button" className="secondary" disabled={busy} onClick={onCancel}>{m.cancel}</Button><Button className={target.archived ? undefined : 'danger-button'} busy={busy}>{title}</Button></div></form></Modal>;
}
function upstreamModelListPath(upstreamId: string, protocol: Protocol): string {
  return `/admin/api/upstreams/${encodeURIComponent(upstreamId)}/models?protocol=${encodeURIComponent(protocol)}`;
}
export function UpstreamsPage() {
  const [params, setParams] = useSearchParams();
  const modelFilter = params.get('modelId') ?? '';
  const includeArchived = params.get('includeArchived') === '1';
  const upstreams = useResource<{ upstreams: Upstream[] }>(`/admin/api/upstreams${includeArchived ? '?includeArchived=1' : ''}`);
  const models = useResource<{ models: Model[] }>(`/admin/api/models${includeArchived ? '?includeArchived=1' : ''}`);
  const routes = useResource<{ routes: Route[] }>(`/admin/api/routes${modelFilter ? `?modelId=${encodeURIComponent(modelFilter)}` : ''}`);
  const listPending = models.isPending || models.isFetching || upstreams.isPending || upstreams.isFetching;
  const action = useAdminAction();
  const [upForm, setUpForm] = useState<'new' | Upstream | null>(null);
  const [statusForm, setStatusForm] = useState<{ row: Upstream; status: Upstream['status'] } | null>(null);
  const [routeForm, setRouteForm] = useState<'new' | Route | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [saved, setSaved] = useState('');
  const [name, setName] = useState(''); const [urls, setUrls] = useState<Urls>(emptyUrls); const [apiKey, setApiKey] = useState(''); const [terms, setTerms] = useState(''); const [reason, setReason] = useState('');
  const [protocol, setProtocol] = useState<Protocol>('CHAT'); const [modelId, setModelId] = useState(''); const [upstreamId, setUpstreamId] = useState(''); const [upstreamModel, setUpstreamModel] = useState(''); const [priority, setPriority] = useState('100'); const [enabled, setEnabled] = useState(true); const [maxConcurrency, setMaxConcurrency] = useState('');
  const [upstreamModels, setUpstreamModels] = useState<string[]>([]); const [modelsLoading, setModelsLoading] = useState(false); const [modelsError, setModelsError] = useState<string | null>(null);
  const close = () => { setUpForm(null); setStatusForm(null); setRouteForm(null); setApiKey(''); setReason(''); action.setError(null); setModelsError(null); setUpstreamModels([]); };
  const editUpstream = (row: Upstream) => { setName(row.name); setUrls({ CHAT: row.baseUrls.CHAT ?? '', ANTHROPIC: row.baseUrls.ANTHROPIC ?? '', RESPONSES: row.baseUrls.RESPONSES ?? '' }); setTerms(row.termsNote); setApiKey(''); setReason(''); setUpForm(row); action.setError(null); };
  const newUpstream = () => { setName(''); setUrls(emptyUrls); setTerms(''); setApiKey(''); setReason(''); setUpForm('new'); action.setError(null); };
  const editRoute = (route: Route) => { setModelId(route.modelId); setUpstreamId(route.upstreamId); setProtocol(route.protocol); setUpstreamModel(route.upstreamModel); setPriority(String(route.priority)); setEnabled(route.enabled); setMaxConcurrency(route.maxConcurrency === null ? '' : String(route.maxConcurrency)); setRouteForm(route); action.setError(null); setModelsError(null); setUpstreamModels([]); };
  const newRoute = () => { setModelId(''); setUpstreamId(''); setProtocol('CHAT'); setUpstreamModel(''); setPriority('100'); setEnabled(true); setMaxConcurrency(''); setModelsError(null); setUpstreamModels([]); setRouteForm('new'); action.setError(null); };
  const protocolsOffered = (upstream: Upstream) => protocols.filter(item => upstream.baseUrls[item]);
  const setArchivedFilter = (checked: boolean) => { const next = new URLSearchParams(params); if (checked) next.set('includeArchived', '1'); else next.delete('includeArchived'); setParams(next); };
  const loadUpstreamModels = async () => {
    const selected = upstreams.data?.upstreams.find(row => row.id === upstreamId);
    if (!selected || !protocolsOffered(selected).includes(protocol)) return;
    setModelsLoading(true); setModelsError(null); setUpstreamModels([]);
    try {
      const result = await api<UpstreamModelList>(upstreamModelListPath(upstreamId, protocol));
      if (result.upstreamId !== upstreamId || result.protocol !== protocol || !Array.isArray(result.models) || result.models.some(item => typeof item !== 'string')) throw new ApiError('invalid_response', 502);
      setUpstreamModels(result.models);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'protocol_not_offered') setModelsError('protocol_not_offered');
      else if (error instanceof ApiError && error.code === 'upstream_models_unavailable') setModelsError('upstream_models_unavailable');
      else setModelsError('unknown');
    } finally { setModelsLoading(false); }
  };
  const saveArchive = () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    void action.run(async () => { await post(`/admin/api/upstreams/${target.id}/archive`, { archived: !target.archived, expectedVersion: target.version }); setArchiveTarget(null); await upstreams.refetch(); await routes.refetch(); });
  };
  return <>
    <PageTitle subtitle={m.upstreamSubtitle}>{m.upstreams}</PageTitle>
    <div className="actions"><Button onClick={newUpstream}>{m.addUpstream}</Button><Button className="secondary" busy={listPending} disabled={listPending} onClick={() => { void upstreams.refetch(); void models.refetch(); }}>{m.refresh}</Button></div>
    <Field label={m.showArchived} type="checkbox" checked={includeArchived} onChange={event => setArchivedFilter(event.target.checked)} />
    {saved && <Alert>{saved}</Alert>}{upstreams.isPending ? <Pending /> : upstreams.isError ? <ErrorBox error={upstreams.error} retry={() => { void upstreams.refetch(); }} /> : <UpstreamRows rows={upstreams.data.upstreams} onEdit={editUpstream} onStatus={(row, status) => { setStatusForm({ row, status }); setReason(''); action.setError(null); }} onArchive={row => { setArchiveTarget({ id: row.id, name: row.name, version: row.version, archived: row.archived }); action.setError(null); }} />}
    <section className="panel stack"><div className="actions"><h2>{m.routes}</h2><Button onClick={newRoute}>{m.addRoute}</Button></div><p>{m.circuitMemoryNote}</p>
      {models.isPending ? <Pending /> : models.isError ? <ErrorBox error={models.error} retry={() => { void models.refetch(); }} /> : <div className="field"><label htmlFor="route-model-filter">{m.modelFilter}</label><select id="route-model-filter" value={modelFilter} onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set('modelId', event.target.value); else next.delete('modelId'); setParams(next); }}><option value="">{m.allModels}</option>{models.data.models.filter(model => !model.archived).map(model => <option key={model.id} value={model.id}>{model.id} · {model.displayName}</option>)}</select></div>}
      {routes.isPending ? <Pending /> : routes.isError ? <ErrorBox error={routes.error} retry={() => { void routes.refetch(); }} /> : <RoutesTable rows={routes.data.routes} upstreams={upstreams.data?.upstreams ?? []} onEdit={editRoute} />}
    </section>
    {upForm && <Modal title={upForm === 'new' ? m.addUpstream : m.editUpstream} busy={action.busy} onClose={close}><form className="stack" onSubmit={event => { event.preventDefault(); action.setError(null); const body = { name: name.trim(), baseUrls: Object.fromEntries(protocols.map(item => [item, urls[item].trim() || null])), termsNote: terms.trim(), ...(apiKey ? { apiKey } : {}), ...(upForm === 'new' ? {} : { expectedVersion: upForm.version }) }; void action.run(async () => { if (upForm !== 'new' && protocols.some(item => urls[item].trim() !== (upForm.baseUrls[item] ?? '')) && !apiKey) throw new ApiError('api_key_required', 400); await post(upForm === 'new' ? '/admin/api/upstreams' : `/admin/api/upstreams/${upForm.id}`, body); setSaved(m.upstreamSaved); close(); await upstreams.refetch(); }); }}>
      {upForm === 'new' && <Field label={m.upstreamName} value={name} onChange={event => setName(event.target.value)} required maxLength={80} />}
      {upForm !== 'new' && <><p>{name}</p><p>{m.version}: {upForm.version}</p></>}
      {protocols.map(item => <Field key={item} label={`Base URL ${item}`} type="url" value={urls[item]} onChange={event => setUrls({ ...urls, [item]: event.target.value })} required={upForm === 'new' && item === protocol} placeholder="https://provider.example/v1" />)}
      <Field label={typeof upForm === 'string' ? m.apiKeyUpstream : protocols.some(item => urls[item].trim() !== (upForm.baseUrls[item] ?? '')) ? m.apiKeyUpstream : m.replaceApiKey} type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} required={typeof upForm === 'string' || protocols.some(item => urls[item].trim() !== (upForm.baseUrls[item] ?? ''))} maxLength={500} />
      <label className="field">{m.termsNote}<textarea value={terms} onChange={event => setTerms(event.target.value)} maxLength={2000} /></label>
      <Field label={m.reason} help={m.reasonHelp} value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={500} pattern=".*\S.*" required />
      {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
      <div className="actions"><Button type="button" className="secondary" disabled={action.busy} onClick={close}>{m.cancel}</Button><Button busy={action.busy}>{m.save}</Button></div>
    </form></Modal>}
    {statusForm && <Modal title={m.changeUpstreamStatus} busy={action.busy} onClose={close}><p>{statusForm.row.name}</p><p>{m.status}: {statusForm.row.status} → {statusForm.status}</p><form className="stack" onSubmit={event => { event.preventDefault(); const payload = { status: statusForm.status, expectedVersion: statusForm.row.version, reason: reason.trim() }; void action.run(async () => { await post(`/admin/api/upstreams/${statusForm.row.id}/status`, payload); setSaved(m.upstreamSaved); close(); await upstreams.refetch(); }); }}><Field label={m.reason} value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={500} pattern=".*\S.*" />{action.error && <ErrorBox error={action.error} />}<div className="actions"><Button type="button" className="secondary" disabled={action.busy} onClick={close}>{m.cancel}</Button><Button busy={action.busy}>{m.confirm}</Button></div></form></Modal>}
    {routeForm && <Modal title={routeForm === 'new' ? m.addRoute : m.editRoute} busy={action.busy} onClose={close}><form className="stack" onSubmit={event => { event.preventDefault(); const payload = { modelId, upstreamId, protocol, upstreamModel: upstreamModel.trim(), priority: Number(priority), enabled, maxConcurrency: maxConcurrency ? Number(maxConcurrency) : null, ...(routeForm === 'new' ? {} : { expectedVersion: routeForm.version }) }; void action.run(async () => { await post(routeForm === 'new' ? '/admin/api/routes' : `/admin/api/routes/${routeForm.id}`, payload); setSaved(m.routeSaved); close(); await routes.refetch(); }); }}>
      {routeForm === 'new' ? <><div className="field"><label htmlFor="route-model">{m.routeModel}</label><select id="route-model" value={modelId} onChange={event => setModelId(event.target.value)} required><option value="">{m.chooseModel}</option>{(models.data?.models ?? []).filter(model => !model.archived).map(model => <option key={model.id} value={model.id}>{model.id} · {model.displayName}</option>)}</select></div><div className="field"><label htmlFor="route-upstream">{m.upstream}</label><select id="route-upstream" value={upstreamId} onChange={event => { setUpstreamId(event.target.value); setUpstreamModels([]); setModelsError(null); const found = upstreams.data?.upstreams.find(item => item.id === event.target.value); if (found && !found.baseUrls[protocol]) setProtocol(protocolsOffered(found)[0] ?? 'CHAT'); }} required><option value="">{m.chooseUpstream}</option>{(upstreams.data?.upstreams ?? []).filter(row => !row.archived).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div></> : <><p>{routeForm.modelId}</p><p>{m.version}: {routeForm.version}</p><p>{m.protocol}: {routeForm.protocol}</p></>}
      <div className="field"><label htmlFor="route-protocol">{m.protocol}</label><select id="route-protocol" value={protocol} onChange={event => { setProtocol(event.target.value as Protocol); setUpstreamModels([]); setModelsError(null); }}>{protocols.filter(item => upstreams.data?.upstreams.find(row => row.id === upstreamId)?.baseUrls[item]).map(item => <option key={item} value={item}>{item}</option>)}</select></div>
      {routeForm === 'new' && <p>{m.protocolHelp}</p>}
      <Field label={m.upstreamModel} list="route-upstream-model-options" help={m.upstreamModelPickerHelp} value={upstreamModel} onChange={event => setUpstreamModel(event.target.value)} required maxLength={128} pattern="[A-Za-z0-9][A-Za-z0-9_.:\/\[\]\-]{0,127}" />
      <datalist id="route-upstream-model-options">{upstreamModels.map(model => <option key={model} value={model} />)}</datalist>
      <div className="actions"><Button type="button" className="secondary" busy={modelsLoading} disabled={!upstreamId || modelsLoading} onClick={() => void loadUpstreamModels()}>{m.fetchUpstreamModels}</Button><Link to="/admin/harga">{m.modelPriceLink}</Link></div>
      {modelsError && <Alert danger>{modelsError === 'protocol_not_offered' ? m.upstreamProtocolUnavailable : m.upstreamModelsUnavailable}</Alert>}
      {upstreamModels.length > 0 && <p>{m.upstreamModelsCount(String(upstreamModels.length))}</p>}
      <Field label={m.priority} type="number" inputMode="numeric" min={1} max={1000} value={priority} onChange={event => setPriority(event.target.value)} required />
      <Field label={m.concurrency} help={m.concurrencyHelp} type="number" inputMode="numeric" min={1} max={100000} value={maxConcurrency} onChange={event => setMaxConcurrency(event.target.value)} />
      <Field label={m.active} type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
      {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
      <div className="actions"><Button type="button" className="secondary" disabled={action.busy} onClick={close}>{m.cancel}</Button><Button busy={action.busy}>{routeForm === 'new' ? m.addRoute : m.save}</Button></div>
    </form></Modal>}
    {archiveTarget && <ArchiveConfirmation target={archiveTarget} busy={action.busy} error={action.error} onCancel={() => { setArchiveTarget(null); action.setError(null); }} onConfirm={saveArchive} />}
    {action.dialog}
  </>;
}
