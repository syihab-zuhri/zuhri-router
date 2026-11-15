import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, newIdempotencyKey, post } from './api.ts';
import { creditsToMicro, formatCredits, formatDate, grouped } from './credits.ts';
import { m, kindText } from './messages.ts';
import { useAction, useResource } from './hooks.tsx';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, PageTitle, Pending, Receipt, SecretReveal } from './ui.tsx';
import type { ReceiptData } from './ui.tsx';

export type Balance = { currency: string; postedMicro: string; heldMicro: string; availableMicro: string };
type Pack = { id: string; name: string; tokens: string; displayPriceIdr: string; isPromo: boolean };
export type Entry = { id: string; kind: string; amount: string; createdAt: string };
type Key = { id: string; name: string; maskedKey: string; version: string; status: string; spendLimitMicro: string | null; spentMicro: string; heldMicro: string; expiresAt: string | null };

export function BalanceView({ value }: { value: Balance }) {
  return <div className="metrics">{[[m.available, value.availableMicro], [m.posted, value.postedMicro], [m.held, value.heldMicro]].map(([label, amount]) => <section className="metric" key={label}><h2>{label}</h2><p className="number">{formatCredits(amount)}</p><small>{m.credits}</small></section>)}</div>;
}
export function HomePage() {
  const balance = useResource<Balance>('/api/balance'); const packs = useResource<{ packs: Pack[] }>('/api/packs');
  return <><PageTitle subtitle={m.homeSubtitle}>{m.home}</PageTitle>{balance.isPending ? <Pending /> : balance.isError ? <ErrorBox error={balance.error} retry={() => void balance.refetch()} /> : <><BalanceView value={balance.data} /><p className="muted">{m.updated}: {formatDate(new Date(balance.dataUpdatedAt).toISOString())}</p>{BigInt(balance.data.availableMicro) <= 0n && <Alert>{m.zeroBalance} <Link to="/isi-saldo">{m.redeem}</Link></Alert>}</>}
    <section className="panel stack"><h2>{m.packs}</h2><p>{m.packsNote}</p><p className="refund-policy">{m.refundPolicy}</p>{packs.isPending ? <Pending /> : packs.isError ? <ErrorBox error={packs.error} retry={() => void packs.refetch()} /> : !packs.data.packs.length ? <Empty title={m.noPacks} /> : <DataList caption={m.packs}>{packs.data.packs.map(pack => <article key={pack.id} className="data-row"><h3>{pack.name}</h3>{pack.isPromo && <Badge status="PROMO" />}<dl><dt>{m.tokens}</dt><dd>{grouped(pack.tokens)}</dd><dt>{m.priceIdr}</dt><dd>Rp{grouped(pack.displayPriceIdr)}</dd></dl></article>)}</DataList>}</section></>;
}
export function RedeemPage() {
  const [code, setCode] = useState(''); const [receipt, setReceipt] = useState<ReceiptData | null>(null); const action = useAction(); const cache = useQueryClient();
  return <><PageTitle subtitle={m.redeemSubtitle}>{m.redeem}</PageTitle><form className="panel form-width" onSubmit={e => { e.preventDefault(); setReceipt(null); void action.run(async () => { const result = await post<ReceiptData>('/api/redeem', { code }); setCode(''); setReceipt(result); await cache.invalidateQueries({ queryKey: ['/api/balance'] }); }); }}><p className="refund-policy">{m.refundPolicy}</p><Field label={m.redeemCode} autoComplete="off" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} required maxLength={80} /><Button busy={action.busy}>{m.redeemAction}</Button>{action.busy && <Alert>{m.saving}</Alert>}{action.error && <><ErrorBox error={action.error} /><Link to="/transaksi">{m.checkLedger}</Link></>}</form>{receipt && <Receipt value={receipt} />}</>;
}
export function Entries({ entries }: { entries: Entry[] }) {
  return !entries.length ? <Empty /> : <DataList caption={m.ledger}>{entries.map(entry => <article className="data-row" key={entry.id}><dl><dt>{m.kind}</dt><dd>{kindText[entry.kind] ?? entry.kind}</dd><dt>{m.amount}</dt><dd className="number">{formatCredits(entry.amount)} {m.credits}</dd><dt>{m.transactionId}</dt><dd>{entry.id}</dd><dt>{m.time}</dt><dd>{formatDate(entry.createdAt)}</dd></dl></article>)}</DataList>;
}
export function LedgerPage() {
  const [params, setParams] = useSearchParams(); const before = params.get('before');
  const result = useResource<{ entries: Entry[]; nextBefore: string | null }>(`/api/ledger?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`);
  return <><PageTitle subtitle={m.ledgerSubtitle}>{m.ledger}</PageTitle>{result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => void result.refetch()} /> : <><Entries entries={result.data.entries} /><div className="actions">{before && <Button className="secondary" onClick={() => setParams({})}>{m.first}</Button>}{result.data.nextBefore && result.data.entries.length > 0 && <Button className="secondary" onClick={() => setParams({ before: result.data.nextBefore! })}>{m.next}</Button>}</div></>}</>;
}
export function KeysPage() {
  const [params, setParams] = useSearchParams(); const after = params.get('after'); const path = `/api/keys?limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`;
  const result = useResource<{ keys: Key[]; nextAfter: string | null }>(path); const action = useAction(); const cache = useQueryClient();
  const [name, setName] = useState(''); const [limit, setLimit] = useState(''); const [expires, setExpires] = useState(''); const [scope, setScope] = useState('all');
  const [secret, setSecret] = useState<string | null>(null); const [confirm, setConfirm] = useState<string | null>(null); const [notice, setNotice] = useState('');
  const creation = useRef(newIdempotencyKey());
  const refresh = () => cache.invalidateQueries({ queryKey: [path] });
  const create = () => action.run(async () => {
    setNotice('');
    const created = await post<{ key: Key; secret: string }>('/api/keys', { name, allowedModels: scope === 'all' ? null : [], spendLimitMicro: limit === '' ? null : creditsToMicro(limit), expiresAt: expires === '' ? null : new Date(expires).toISOString(), idempotencyKey: creation.current });
    setSecret(created.secret); setName(''); setLimit(''); setExpires(''); creation.current = newIdempotencyKey(); await refresh();
  });
  const unknownCreation = action.error instanceof ApiError && ['network_unknown', 'invalid_response', 'key_already_created'].includes(action.error.code);
  return <><PageTitle subtitle={m.keySubtitle}>{m.keys}</PageTitle><form className="panel form-width" onSubmit={e => { e.preventDefault(); void create(); }}><h2>{m.createKey}</h2><Field label={m.keyName} value={name} onChange={e => { setName(e.target.value); }} required maxLength={80} /><Field label={m.keyLimit} help={m.limitHelp} value={limit} onChange={e => setLimit(e.target.value)} inputMode="decimal" pattern="(0|[1-9][0-9]*)([.,][0-9]{1,6})?" /><Field label={m.expiry} type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} /><label>{m.scope}<select value={scope} onChange={e => setScope(e.target.value)}><option value="all">{m.allModels}</option><option value="none">{m.noModels}</option></select></label><small>{m.modelScopeHelp}</small><Button busy={action.busy}>{m.createKey}</Button>{action.error && <ErrorBox error={action.error} />}{unknownCreation && <Alert danger>{m.unknown}<Button className="secondary" type="button" onClick={() => void refresh()}>{m.refresh}</Button></Alert>}</form>{notice && <Alert>{notice}</Alert>}
    {result.isPending ? <Pending /> : result.isError ? <ErrorBox error={result.error} retry={() => void result.refetch()} /> : !result.data.keys.length ? <Empty title={m.keyEmpty} /> : <><DataList caption={m.keys}>{result.data.keys.map(key => <article className="data-row" key={key.id}><h2>{key.name}</h2><Badge status={key.status} /><p className="mono">{key.maskedKey}</p><dl><dt>{m.keyLimit}</dt><dd>{key.spendLimitMicro === null ? m.unlimited : formatCredits(key.spendLimitMicro) + ' ' + m.credits}</dd><dt>{m.spent}</dt><dd>{formatCredits(key.spentMicro)} {m.credits}</dd><dt>{m.held}</dt><dd>{formatCredits(key.heldMicro)} {m.credits}</dd>{key.expiresAt && <><dt>{m.expiry}</dt><dd>{formatDate(key.expiresAt)}</dd></>}</dl>{key.status === 'ACTIVE' && (confirm !== key.id ? <Button className="secondary" onClick={() => setConfirm(key.id)}>{m.revoke}</Button> : <div className="stack"><p>{m.revokeQuestion}</p><div className="actions"><Button className="secondary" disabled={action.busy} onClick={() => setConfirm(null)}>{m.cancel}</Button><Button className="danger-button" busy={action.busy} onClick={e => { if (e.detail === 0 && e.nativeEvent instanceof KeyboardEvent && e.nativeEvent.repeat) return; void action.run(async () => { await post(`/api/keys/${key.id}/revoke`, { expectedVersion: key.version }); setConfirm(null); setNotice(m.revoked); await refresh(); }); }}>{m.revokeKey}</Button></div></div>)}</article>)}</DataList>{result.data.nextAfter && <Button className="secondary" onClick={() => setParams({ after: result.data.nextAfter! })}>{m.next}</Button>}{after && <Button className="secondary" onClick={() => setParams({})}>{m.first}</Button>}</>}
    {secret && <SecretReveal secret={secret} onClose={() => setSecret(null)} />}</>;
}
