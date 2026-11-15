import { useState } from 'react';
import { post } from './api.ts';
import { grouped } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending } from './ui.tsx';

export type Pack = { id: string; name: string; tokens: string; displayPriceIdr: string; isPromo: boolean; active: boolean; version: string };
type PackForm = Pick<Pack, 'name' | 'tokens' | 'displayPriceIdr' | 'isPromo' | 'active'>;
const blank: PackForm = { name: '', tokens: '', displayPriceIdr: '', isPromo: false, active: true };

export function PacksPage() {
  const packs = useResource<{ packs: Pack[] }>('/admin/api/packs');
  const action = useAdminAction();
  const [editing, setEditing] = useState<Pack | 'new' | null>(null);
  const [form, setForm] = useState<PackForm>(blank);
  const [saved, setSaved] = useState(false);
  const close = () => { setEditing(null); action.setError(null); };
  return <>
    <PageTitle subtitle={m.packHelp}>{m.packs}</PageTitle>
    <div className="actions"><Button onClick={() => { setForm(blank); setEditing('new'); setSaved(false); action.setError(null); }}>{m.createPack}</Button><Button className="secondary" busy={packs.isFetching} onClick={() => { void packs.refetch(); }}>{m.refresh}</Button></div>
    {saved && <Alert>{m.success}</Alert>}
    {packs.isPending ? <Pending /> : packs.error ? <ErrorBox error={packs.error} retry={() => { void packs.refetch(); }} /> : packs.data.packs.length === 0 ? <Empty /> : <DataList caption={m.packs}>
      {packs.data.packs.map(pack => <article className="data-row" key={pack.id}>
        <div><h2>{pack.name}</h2><Badge status={pack.active ? 'ACTIVE' : 'RETIRED'} />{pack.isPromo && <span className="badge">{m.promo}</span>}</div>
        <dl><dt>{m.tokens}</dt><dd className="number">{grouped(pack.tokens)} {m.credits}</dd><dt>{m.priceIdr}</dt><dd className="number">{grouped(pack.displayPriceIdr)}</dd><dt>{m.version}</dt><dd>{pack.version}</dd></dl>
        <Button className="secondary" onClick={() => { setForm({ name: pack.name, tokens: pack.tokens, displayPriceIdr: pack.displayPriceIdr, isPromo: pack.isPromo, active: pack.active }); setEditing(pack); setSaved(false); action.setError(null); }}>{m.edit}</Button>
      </article>)}
    </DataList>}
    {editing && <Modal title={editing === 'new' ? m.createPack : m.edit} busy={action.busy} onClose={close}>
      <form className="stack" onSubmit={e => {
        e.preventDefault();
        const path = editing === 'new' ? '/admin/api/packs' : `/admin/api/packs/${encodeURIComponent(editing.id)}`;
        const payload = { ...form, name: form.name.trim(), ...(editing === 'new' ? {} : { expectedVersion: editing.version }) };
        void action.run(async () => { await post<Pack>(path, payload); close(); setSaved(true); await packs.refetch(); });
      }}>
        <Field label={m.packName} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required pattern=".*\S.*" maxLength={80} autoFocus />
        <Field label={m.tokens} value={form.tokens} onChange={e => setForm({ ...form, tokens: e.target.value })} required inputMode="numeric" pattern="[1-9][0-9]{0,11}" maxLength={12} />
        <Field label={m.priceIdr} value={form.displayPriceIdr} onChange={e => setForm({ ...form, displayPriceIdr: e.target.value })} required inputMode="numeric" pattern="0|[1-9][0-9]{0,11}" maxLength={12} />
        <Field label={m.promo} type="checkbox" checked={form.isPromo} onChange={e => setForm({ ...form, isPromo: e.target.checked })} />
        <Field label={m.active} type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
        <p>{m.packHelp}</p>{action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
        <div className="actions"><Button type="button" className="secondary" disabled={action.busy} onClick={close}>{m.cancel}</Button><Button busy={action.busy}>{editing === 'new' ? m.createPack : m.updatePack}</Button></div>
      </form>
    </Modal>}
    {action.dialog}
  </>;
}
