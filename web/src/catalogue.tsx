import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { formatDecimal } from './credits.ts';
import { m } from './messages.ts';
import { Empty, ErrorBox, PageTitle, Pending } from './ui.tsx';

export type CustomerModel = {
  id: string; displayName: string; multiplier: string; protocols: ('CHAT' | 'ANTHROPIC' | 'RESPONSES')[];
  creditsPerToken: { input: string; output: string; cacheRead: string; cacheWrite: string };
};
type Catalogue = { models: CustomerModel[] };
const rateEntries = (rates: CustomerModel['creditsPerToken']) => [
  [m.input, rates.input], [m.output, rates.output], [m.cacheRead, rates.cacheRead], [m.cacheWrite, rates.cacheWrite],
] as const;
function isUniform(model: CustomerModel): boolean {
  const values = Object.values(model.creditsPerToken);
  return values.every(value => value === values[0]);
}
function ModelCard({ model }: { model: CustomerModel }) {
  const uniform = isUniform(model);
  return <article className="data-row">
    <header className="request-heading"><div><h2>{model.displayName}</h2><p className="mono">{model.id}</p></div><div className="protocol-list" aria-label={m.protocol}>{model.protocols.map(protocol => <span className="badge" key={protocol}>{protocol}</span>)}</div></header>
    {uniform ? <p className="model-multiplier">x{model.multiplier}</p> : <section className="usage-detail" aria-label={m.pricePerCategory}><h3>{m.pricePerCategory}</h3><dl>{rateEntries(model.creditsPerToken).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="number">{formatDecimal(value)} {m.credits}</dd></div>)}</dl></section>}
  </article>;
}
export function CataloguePage() {
  const catalogue = useQuery({ queryKey: ['/api/models'], queryFn: ({ signal }) => api<Catalogue>('/api/models', { signal }), retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  return <><PageTitle subtitle={m.catalogueSubtitle}>{m.catalogue}</PageTitle>
    {catalogue.isPending ? <Pending /> : catalogue.isError ? <ErrorBox error={catalogue.error} retry={() => { void catalogue.refetch(); }} /> : catalogue.data.models.length === 0 ? <Empty title={m.noModelsForCustomer} /> : <section className="data-list" aria-label={m.catalogue}>{catalogue.data.models.map(model => <ModelCard key={model.id} model={model} />)}</section>}
  </>;
}
