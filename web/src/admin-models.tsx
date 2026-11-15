import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, post } from './api.ts';
import { formatCredits, formatDate } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending } from './ui.tsx';

type Price = { id: string; seq: number; status: string; inputRateMicro: string; outputRateMicro: string; cacheReadRateMicro: string; cacheWriteRateMicro: string; multiplier: string; rateAsOf: string | null; publishedAt: string | null; retiredAt: string | null };
type Model = { id: string; displayName: string; version: string; archived: boolean; sellable: boolean; published: Price | null; draft: Price | null };
type RateKey = 'inputRateMicro' | 'outputRateMicro' | 'cacheReadRateMicro' | 'cacheWriteRateMicro';
const rates: { key: RateKey; label: string }[] = [{ key: 'inputRateMicro', label: m.inputRate }, { key: 'outputRateMicro', label: m.outputRate }, { key: 'cacheReadRateMicro', label: m.cacheReadRate }, { key: 'cacheWriteRateMicro', label: m.cacheWriteRate }];
const usageFields = [{ key: 'input', label: m.inputTokens }, { key: 'output', label: m.outputTokens }, { key: 'cacheRead', label: m.cacheReadTokens }, { key: 'cacheWrite', label: m.cacheWriteTokens }] as const;
const RATE_SCALE = 1_000_000_000_000n;

function rateToInput(micro: string): string {
  const value = BigInt(micro);
  const fraction = (value % RATE_SCALE).toString().padStart(12, '0').replace(/0+$/, '');
  return `${value / RATE_SCALE}${fraction ? ',' + fraction : ''}`;
}
function inputToRate(value: string): string {
  if (!/^(0|[1-9][0-9]*)([.,][0-9]{1,12})?$/.test(value)) throw new ApiError('invalid_request', 400);
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const micro = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(12, '0'));
  if (micro > 1_000_000_000_000_000n) throw new ApiError('invalid_request', 400);
  return String(micro);
}

export function ModelsPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('id');
  const includeArchived = params.get('includeArchived') === '1';
  const models = useResource<{ models: Model[] }>(`/admin/api/models${includeArchived ? '?includeArchived=1' : ''}`);
  const action = useAdminAction();
  const [creating, setCreating] = useState(false); const [id, setId] = useState(''); const [displayName, setDisplayName] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<Model | null>(null);
  const setArchivedFilter = (checked: boolean) => { const next = new URLSearchParams(params); if (checked) next.set('includeArchived', '1'); else next.delete('includeArchived'); setParams(next); };
  return <>
    <PageTitle subtitle={m.modelHelp}>{m.models}</PageTitle>
    <div className="actions"><Button onClick={() => { setCreating(true); action.setError(null); }}>{m.createModel}</Button><Button className="secondary" busy={models.isFetching} onClick={() => { void models.refetch(); }}>{m.refresh}</Button></div>
    <Field label={m.showArchived} type="checkbox" checked={includeArchived} onChange={event => setArchivedFilter(event.target.checked)} />
    {models.isPending ? <Pending /> : models.error ? <ErrorBox error={models.error} retry={() => { void models.refetch(); }} /> : models.data.models.length === 0 ? <Empty /> : <DataList caption={m.models}>{models.data.models.map(model => <article className="data-row" key={model.id}>
      <div><h2>{model.displayName}</h2><p>{model.id}</p><Badge status={model.archived ? 'RETIRED' : model.published ? 'PUBLISHED' : model.draft ? 'DRAFT' : 'RETIRED'} />{!model.published && !model.draft && <p>{m.noPrice}</p>}</div>
      <dl><dt>{m.version}</dt><dd>{model.version}</dd>{model.published && <><dt>{m.multiplier}</dt><dd>{model.published.multiplier.replace('.', ',')}</dd></>}</dl>
      <div className="actions">{!model.archived && <Button className="secondary" onClick={() => setParams({ id: model.id })}>{m.details}</Button>}<Button className={model.archived ? 'secondary' : 'danger-button'} disabled={!model.archived && Boolean(model.published)} onClick={() => setArchiveTarget(model)}>{model.archived ? m.restoreModel : m.archiveModel}</Button></div>
    </article>)}</DataList>}
    {selected && <ModelDetail key={selected} id={selected} refreshList={async () => { await models.refetch(); }} />}
    {creating && <Modal title={m.createModel} busy={action.busy} onClose={() => { setCreating(false); action.setError(null); }}>
      <form className="stack" onSubmit={event => { event.preventDefault(); const payload = { id, displayName: displayName.trim() }; void action.run(async () => { await post<Model>('/admin/api/models', payload); setCreating(false); setId(''); setDisplayName(''); setParams({ id: payload.id }); await models.refetch(); }); }}>
        <Field label={m.modelId} value={id} onChange={event => setId(event.target.value)} required maxLength={128} autoFocus />
        <Field label={m.modelName} value={displayName} onChange={event => setDisplayName(event.target.value)} required pattern=".*\S.*" maxLength={120} />
        {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
        <div className="actions"><Button type="button" className="secondary" disabled={action.busy} onClick={() => setCreating(false)}>{m.cancel}</Button><Button busy={action.busy}>{m.createModel}</Button></div>
      </form>
    </Modal>}
    {archiveTarget && <Modal title={archiveTarget.archived ? m.restoreModel : m.archiveModel} busy={action.busy} onClose={() => { setArchiveTarget(null); action.setError(null); }}>
      <p>{archiveTarget.id}</p><p>{m.version}: {archiveTarget.version}</p>
      <Alert>{archiveTarget.archived ? m.modelRestoreImpact : m.modelArchiveImpact}</Alert>
      {!archiveTarget.archived && archiveTarget.published && <Alert danger>{m.modelOnSale} <Link to={`/admin/harga?id=${encodeURIComponent(archiveTarget.id)}`}>{m.retirePriceFirst}</Link></Alert>}
      <form className="stack" onSubmit={event => { event.preventDefault(); void action.run(async () => { await post<Model>('/admin/api/models/archive', { id: archiveTarget.id, archived: !archiveTarget.archived, expectedVersion: archiveTarget.version }); setArchiveTarget(null); await models.refetch(); }); }}>
        {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
        <div className="actions"><Button type="button" className="secondary" disabled={action.busy} onClick={() => { setArchiveTarget(null); action.setError(null); }}>{m.cancel}</Button><Button className={archiveTarget.archived ? undefined : 'danger-button'} busy={action.busy}>{archiveTarget.archived ? m.restoreModel : m.archiveModel}</Button></div>
      </form>
    </Modal>}
    {action.dialog}
  </>;
}

function ModelDetail({ id, refreshList }: { id: string; refreshList: () => Promise<void> }) {
  const model = useResource<Model>(`/admin/api/models?id=${encodeURIComponent(id)}`);
  const [saved, setSaved] = useState(false);
  if (model.isPending) return <Pending />;
  if (model.error) return <ErrorBox error={model.error} retry={() => { void model.refetch(); }} />;
  return <section className="panel stack" aria-label={m.details}>
    <div className="actions"><h2>{model.data.displayName}</h2><Button className="secondary" busy={model.isFetching} onClick={() => { void model.refetch(); }}>{m.refresh}</Button></div>
    <p>{model.data.id}</p>
    {model.data.published && <PriceDetails title={m.published} price={model.data.published} />}
    {model.data.draft && <PriceDetails title={m.draftStatus} price={model.data.draft} />}
    {saved && <Alert>{m.success}</Alert>}
    <ModelForms key={`${model.data.id}-${model.data.version}`} model={model.data} refresh={async () => { setSaved(true); await model.refetch(); await refreshList(); }} />
  </section>;
}

function ModelForms({ model, refresh }: { model: Model; refresh: () => Promise<void> }) {
  const action = useAdminAction(); const source = model.draft ?? model.published;
  const [form, setForm] = useState<Record<RateKey, string>>(() => ({ inputRateMicro: source ? rateToInput(source.inputRateMicro) : '1', outputRateMicro: source ? rateToInput(source.outputRateMicro) : '1', cacheReadRateMicro: source ? rateToInput(source.cacheReadRateMicro) : '1', cacheWriteRateMicro: source ? rateToInput(source.cacheWriteRateMicro) : '1' }));
  const [multiplier, setMultiplier] = useState(source?.multiplier.replace('.', ',') ?? '1'); const [rateAsOf, setRateAsOf] = useState(source?.rateAsOf ?? '');
  const [confirmation, setConfirmation] = useState<'publish' | 'retire' | null>(null); const [reason, setReason] = useState('');
  const [which, setWhich] = useState<'draft' | 'published'>(model.draft ? 'draft' : 'published');
  const [usage, setUsage] = useState({ input: '0', output: '0', cacheRead: '0', cacheWrite: '0' });
  const [preview, setPreview] = useState<{ price: Price; debitMicro: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const confirmPrice = confirmation === 'publish' ? model.draft : model.published;
  return <>
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const normalizedMultiplier = multiplier.replace(',', '.');
        if (!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,4})?$/.test(normalizedMultiplier)) throw new ApiError('invalid_request', 400);
        const [whole, fraction = ''] = normalizedMultiplier.split('.'); const e4 = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
        if (e4 < 1_000n || e4 > 1_000_000n) throw new ApiError('invalid_request', 400);
        const price = { inputRateMicro: inputToRate(form.inputRateMicro), outputRateMicro: inputToRate(form.outputRateMicro), cacheReadRateMicro: inputToRate(form.cacheReadRateMicro), cacheWriteRateMicro: inputToRate(form.cacheWriteRateMicro) };
        if (price.inputRateMicro === '0' || price.outputRateMicro === '0') throw new ApiError('invalid_request', 400);
        const payload = { id: model.id, expectedVersion: model.version, ...price, multiplier: normalizedMultiplier, rateAsOf: rateAsOf || null };
        await post<Model>('/admin/api/models/price/draft', payload); setDirty(false); await refresh();
      });
    }}>
      <h3>{m.draftStatus}</h3>
      {rates.map(rate => <Field key={rate.key} label={rate.label} inputMode="decimal" value={form[rate.key]} onChange={event => { setForm({ ...form, [rate.key]: event.target.value }); setDirty(true); setPreview(null); }} pattern="(0|[1-9][0-9]*)([.,][0-9]{1,12})?" required />)}
      <Field label={m.multiplier} help={m.multiplierHelp} inputMode="decimal" value={multiplier} onChange={event => { setMultiplier(event.target.value); setDirty(true); setPreview(null); }} pattern="(0|[1-9][0-9]{0,2})([.,][0-9]{1,4})?" required />
      <Field label={m.updated} type="date" value={rateAsOf} onChange={event => { setRateAsOf(event.target.value); setDirty(true); }} />
      <div className="actions"><Button busy={action.busy}>{m.draft}</Button></div>
    </form>
    {!confirmation && action.error && <ErrorBox error={action.error} />}
    {(model.draft || model.published) && <form className="stack" onSubmit={event => {
      event.preventDefault(); setPreview(null);
      const values = new FormData(event.currentTarget);
      const payload = { id: model.id, which, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
      void action.run(async () => {
        const readCount = (name: string) => {
          const raw = values.get(name);
          if (typeof raw !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(raw)) throw new ApiError('invalid_request', 400);
          const count = Number(raw);
          if (!Number.isSafeInteger(count)) throw new ApiError('invalid_request', 400);
          return count;
        };
        payload.usage = { input: readCount('input'), output: readCount('output'), cacheRead: readCount('cacheRead'), cacheWrite: readCount('cacheWrite') };
        setPreview(await post<{ price: Price; debitMicro: string }>('/admin/api/models/price/preview', payload));
      });
    }}>
      <h3>{m.preview}</h3><p>{m.previewHelp}</p>
      <div className="field"><label htmlFor="preview-price">{m.version}</label><select id="preview-price" value={which} onChange={event => { setWhich(event.target.value === 'draft' ? 'draft' : 'published'); setPreview(null); }}>{model.draft && <option value="draft">{m.draftStatus} {model.draft.seq}</option>}{model.published && <option value="published">{m.published} {model.published.seq}</option>}</select></div>
      {usageFields.map(field => <Field key={field.key} name={field.key} label={field.label} inputMode="numeric" value={usage[field.key]} onChange={event => { setUsage({ ...usage, [field.key]: event.target.value }); setPreview(null); }} pattern="0|[1-9][0-9]{0,15}" required />)}
      <div className="actions"><Button busy={action.busy} disabled={dirty}>{m.preview}</Button></div>
    </form>}
    {preview && <section className="receipt" role="status"><h3>{m.debit}</h3><p className="number">{formatCredits(preview.debitMicro)} {m.credits}</p><p>{m.version}: {preview.price.seq}</p><p>{m.previewHelp}</p></section>}
    <div className="actions">{model.draft && <Button disabled={dirty || action.busy} onClick={() => { setConfirmation('publish'); setReason(''); action.setError(null); }}>{m.publish}</Button>}{model.published && <Button className="danger-button" disabled={action.busy} onClick={() => { setConfirmation('retire'); setReason(''); action.setError(null); }}>{m.retire}</Button>}</div>
    {confirmation && confirmPrice && <Modal title={confirmation === 'publish' ? m.publish : m.retire} busy={action.busy} onClose={() => { setConfirmation(null); action.setError(null); }}>
      <p>{m.financialConfirm}</p><p>{model.id}</p><PriceDetails title={confirmation === 'publish' ? m.publish : m.retire} price={confirmPrice} />
      <form className="stack" onSubmit={event => { event.preventDefault(); const path = `/admin/api/models/price/${confirmation}`; const payload = { id: model.id, expectedVersion: model.version, reason: reason.trim() }; void action.run(async () => { await post<Model>(path, payload); setConfirmation(null); await refresh(); }); }}>
        <Field label={m.reason} help={m.reasonHelp} value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={500} pattern=".*\S.*" />
        {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
        <div className="actions"><Button type="button" className="secondary" disabled={action.busy} autoFocus onClick={() => setConfirmation(null)}>{m.cancel}</Button><Button busy={action.busy} className={confirmation === 'retire' ? 'danger-button' : undefined}>{confirmation === 'publish' ? m.publish : m.retire}</Button></div>
      </form>
    </Modal>}
    {action.dialog}
  </>;
}

function PriceDetails({ title, price }: { title: string; price: Price }) {
  return <section><h3>{title}</h3><Badge status={price.status} /><dl><dt>{m.version}</dt><dd>{price.seq}</dd>{rates.map(rate => <div key={rate.key}><dt>{rate.label}</dt><dd className="number">{rateToInput(price[rate.key])}</dd></div>)}<dt>{m.multiplier}</dt><dd>{price.multiplier.replace('.', ',')}</dd>{price.rateAsOf && <><dt>{m.updated}</dt><dd>{price.rateAsOf}</dd></>}{price.publishedAt && <><dt>{m.time}</dt><dd>{formatDate(price.publishedAt)}</dd></>}</dl></section>;
}
