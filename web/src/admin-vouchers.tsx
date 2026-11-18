import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, newIdempotencyKey, post } from './api.ts';
import { creditsToMicro, formatCredits, formatDate, grouped } from './credits.ts';
import { useAdminAction, useResource } from './hooks.tsx';
import { m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, Field, Modal, PageTitle, Pending, SecretReveal } from './ui.tsx';
import type { Pack } from './admin-packs.tsx';

type Voucher = { id: string; maskedCode: string; amountMicro: string; kind: string; saleRef: string; packId: string | null; priceIdr: string | null; recipientBound: boolean; expiresAt: string | null; status: string; issuedAt: string; closedAt: string | null };
type IssuePayload = { kind: 'SALE' | 'PROMO'; saleRef: string; packId: string | null; tokens?: string; recipientUsername: string | null; expiresAt: string | null; idempotencyKey: string };
type IssueConfirmation = { payload: IssuePayload; amountMicro: string; packName: string | null; priceIdr: string | null };

export function VouchersPage() {
  const [params, setParams] = useSearchParams(); const before = params.get('before');
  const vouchers = useResource<{ vouchers: Voucher[]; nextBefore: string | null; outstandingMicro: string }>(`/admin/api/vouchers${before ? `?before=${encodeURIComponent(before)}` : ''}`);
  const packs = useResource<{ packs: Pack[] }>('/admin/api/packs');
  const action = useAdminAction();
  const [kind, setKind] = useState<'SALE' | 'PROMO'>('SALE'); const [saleRef, setSaleRef] = useState('');
  const [packId, setPackId] = useState(''); const [tokens, setTokens] = useState('');
  const [recipient, setRecipient] = useState(''); const [expires, setExpires] = useState('');
  const [confirmation, setConfirmation] = useState<IssueConfirmation | null>(null);
  const [revoking, setRevoking] = useState<Voucher | null>(null); const [reason, setReason] = useState('');
  const [secret, setSecret] = useState<string | null>(null); const [issued, setIssued] = useState<Voucher | null>(null);
  const [lost, setLost] = useState(false); const [revoked, setRevoked] = useState(false);
  const close = () => { setConfirmation(null); setRevoking(null); action.setError(null); };
  return <>
    <PageTitle subtitle={kind === 'SALE' ? m.voucherHelp : m.voucherPromoHelp}>{m.vouchers}</PageTitle>
    <form className="panel stack" onSubmit={e => {
      e.preventDefault(); action.setError(null); setIssued(null); setLost(false); setRevoked(false);
      const selected = packs.data?.packs.find(pack => pack.id === packId);
      if (packId && (!selected || !selected.active)) { action.setError(new ApiError('pack_unavailable', 409)); return; }
      let expiresAt: string | null = null;
      if (expires) {
        const date = new Date(expires);
        if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) { action.setError(new ApiError('invalid_request', 400)); return; }
        expiresAt = date.toISOString();
      }
      setConfirmation({ payload: { kind, saleRef: saleRef.trim(), packId: packId || null, ...(packId ? {} : { tokens }), recipientUsername: recipient || null, expiresAt, idempotencyKey: newIdempotencyKey() }, amountMicro: creditsToMicro(selected ? selected.tokens : tokens), packName: selected?.name ?? null, priceIdr: selected?.displayPriceIdr ?? null });
    }}>
      <h2>{m.issueVoucher}</h2>
      <div className="field"><label htmlFor="voucher-kind">{m.voucherKind}</label><select id="voucher-kind" value={kind} onChange={e => setKind(e.target.value === 'PROMO' ? 'PROMO' : 'SALE')}><option value="SALE">{m.sale}</option><option value="PROMO">{m.promoReason}</option></select></div>
      <div className="field"><label htmlFor="voucher-pack">{m.pack}</label><select id="voucher-pack" value={packId} onChange={e => setPackId(e.target.value)} disabled={packs.isPending}><option value="">{m.manualAmount}</option>{packs.data?.packs.filter(pack => pack.active).map(pack => <option key={pack.id} value={pack.id}>{pack.name} ({grouped(pack.tokens)} {m.credits})</option>)}</select></div>
      {packs.isPending && <Pending />}{packs.error && <ErrorBox error={packs.error} retry={() => { void packs.refetch(); }} />}
      {!packId && <Field label={m.tokens} inputMode="numeric" value={tokens} onChange={e => setTokens(e.target.value)} pattern="[1-9][0-9]{0,11}" maxLength={12} required />}
      <Field label={kind === 'SALE' ? m.saleRef : m.promoReasonLabel} value={saleRef} onChange={e => setSaleRef(e.target.value)} pattern=".*\S.*" maxLength={200} required />
      <Field label={m.recipient} value={recipient} onChange={e => setRecipient(e.target.value)} pattern="[a-z0-9_]{3,24}" maxLength={24} autoComplete="off" />
      <Field label={m.expiry} type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} />
      <div className="actions"><Button busy={action.busy}>{m.issueVoucher}</Button></div>
    </form>
    {!confirmation && !revoking && action.error && <ErrorBox error={action.error} />}
    {lost && <Alert danger>{m.voucherLost}</Alert>}
    {issued && <section className="receipt" role="status" tabIndex={-1} ref={node => { node?.focus(); }}><h2>{m.success}</h2><VoucherDetails voucher={issued} /></section>}
    {revoked && <Alert>{m.success}</Alert>}
    <div className="actions"><Button className="secondary" busy={vouchers.isFetching} onClick={() => { void vouchers.refetch(); }}>{m.refresh}</Button></div>
    {vouchers.isPending ? <Pending /> : vouchers.error ? <ErrorBox error={vouchers.error} retry={() => { void vouchers.refetch(); }} /> : <>
      <dl className="metrics"><div className="metric"><dt>{m.outstanding}</dt><dd className="number">{formatCredits(vouchers.data.outstandingMicro)} {m.credits}</dd></div></dl>
      {vouchers.data.vouchers.length === 0 ? <Empty /> : <DataList caption={m.vouchers}>{vouchers.data.vouchers.map(voucher => <article className="data-row" key={voucher.id}>
        <div><h2>{voucher.maskedCode}</h2><Badge status={voucher.status} /><Badge status={voucher.kind} /></div>
        <VoucherDetails voucher={voucher} />
        {voucher.status === 'ACTIVE' && <Button className="danger-button" onClick={() => { setRevoking(voucher); setReason(''); setRevoked(false); action.setError(null); }}>{m.revokeVoucher}</Button>}
      </article>)}</DataList>}
      <div className="actions"><Button className="secondary" disabled={!before || action.busy} onClick={() => setParams({})}>{m.first}</Button><Button className="secondary" disabled={!vouchers.data.nextBefore || action.busy} onClick={() => { if (vouchers.data.nextBefore) setParams({ before: vouchers.data.nextBefore }); }}>{m.next}</Button></div>
    </>}
    {confirmation && <Modal title={m.issueVoucher} onClose={close} busy={action.busy}>
      <p>{m.financialConfirm}</p><p>{confirmation.payload.kind === 'SALE' ? m.voucherHelp : m.voucherPromoHelp}</p>
      <dl><dt>{m.voucherKind}</dt><dd>{confirmation.payload.kind === 'SALE' ? m.sale : m.promoReason}</dd><dt>{m.tokens}</dt><dd>{formatCredits(confirmation.amountMicro)} {m.credits}</dd><dt>{confirmation.payload.kind === 'SALE' ? m.saleRef : m.promoReasonLabel}</dt><dd>{confirmation.payload.saleRef}</dd>{confirmation.packName && <><dt>{m.pack}</dt><dd>{confirmation.packName}</dd><dt>{m.priceIdr}</dt><dd>{grouped(confirmation.priceIdr!)}</dd></>}{confirmation.payload.recipientUsername && <><dt>{m.recipient}</dt><dd>{confirmation.payload.recipientUsername}</dd></>}{confirmation.payload.expiresAt && <><dt>{m.expiry}</dt><dd>{formatDate(confirmation.payload.expiresAt)}</dd></>}</dl>
      {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
      <div className="actions"><Button className="secondary" autoFocus disabled={action.busy} onClick={close}>{m.cancel}</Button><Button busy={action.busy} onClick={() => {
        const payload = confirmation.payload;
        void action.run(async () => {
          const result = await post<{ voucher: Voucher; code: string | null; replayed: boolean }>('/admin/api/vouchers', payload);
          setSecret(result.code); setIssued(result.voucher); setLost(result.replayed && !result.code); setConfirmation(null); setSaleRef('');
          await vouchers.refetch();
        });
      }}>{m.issueVoucher}</Button></div>
    </Modal>}
    {revoking && <Modal title={m.revokeVoucher} onClose={close} busy={action.busy}>
      <p>{m.financialConfirm}</p><p>{revoking.maskedCode}</p><VoucherDetails voucher={revoking} />
      <form className="stack" onSubmit={e => { e.preventDefault(); const path = `/admin/api/vouchers/${encodeURIComponent(revoking.id)}/revoke`; const payload = { reason: reason.trim() }; void action.run(async () => { await post<Voucher>(path, payload); setRevoking(null); setRevoked(true); await vouchers.refetch(); }); }}>
        <Field label={m.reason} help={m.reasonHelp} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} pattern=".*\S.*" required />
        {action.error && <ErrorBox error={action.error} />}{action.busy && <Alert>{m.saving}</Alert>}
        <div className="actions"><Button type="button" className="secondary" autoFocus disabled={action.busy} onClick={close}>{m.cancel}</Button><Button className="danger-button" busy={action.busy}>{m.revokeVoucher}</Button></div>
      </form>
    </Modal>}
    {secret && <SecretReveal kind="voucher" secret={secret} onClose={() => setSecret(null)} />}
    {action.dialog}
  </>;
}

function VoucherDetails({ voucher }: { voucher: Voucher }) {
  return <dl><dt>{m.id}</dt><dd>{voucher.id}</dd><dt>{m.tokens}</dt><dd className="number">{formatCredits(voucher.amountMicro)} {m.credits}</dd><dt>{m.saleRef}</dt><dd>{voucher.saleRef}</dd>{voucher.priceIdr !== null && <><dt>{m.priceIdr}</dt><dd>{grouped(voucher.priceIdr)}</dd></>}<dt>{m.time}</dt><dd>{formatDate(voucher.issuedAt)}</dd>{voucher.expiresAt && <><dt>{m.expiry}</dt><dd>{formatDate(voucher.expiresAt)}</dd></>}</dl>;
}
