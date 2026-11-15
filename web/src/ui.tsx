import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { ApiError } from './api.ts';
import { errorText, m, statusText } from './messages.ts';
import { formatCredits, formatDate } from './credits.ts';

export function Button({ busy, children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} aria-busy={busy || undefined} aria-disabled={busy || props.disabled || undefined} onClick={e => { if (busy) e.preventDefault(); else onClick?.(e); }}>{children}</button>;
}
export function Field({ label, help, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label><input {...props} id={id} aria-describedby={help ? `${id}-help` : undefined} />{help && <small id={`${id}-help`}>{help}</small>}</div>;
}
export function Password({ label = m.password, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; help?: string }) {
  const [shown, setShown] = useState(false);
  return <div><Field {...props} label={label} type={shown ? 'text' : 'password'} /><button type="button" className="text-button" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? m.hidePassword : m.showPassword}</button></div>;
}
export function Alert({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div className={`alert ${danger ? 'danger' : ''}`} role={danger ? 'alert' : 'status'}>{children}</div>;
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return error.retryAfter && /^\d+$/.test(error.retryAfter) ? m.limitedSeconds(error.retryAfter) : m.limited;
    if (error.code === 'unauthorized') return m.sessionExpired;
    if (error.status === 403) return m.forbidden;
    return errorText[error.code] ?? m.failed;
  }
  return m.failed;
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return <Alert danger>{errorMessage(error)}{retry && <Button className="secondary" onClick={retry}>{m.retry}</Button>}</Alert>;
}
export function Pending() { return <p role="status" aria-busy="true">{m.loading}</p>; }
export function Empty({ title = m.empty }: { title?: string }) { return <section className="empty"><span className="geometry" aria-hidden="true" /><h2>{title}</h2><p>{m.emptyHelp}</p></section>; }
export function Badge({ status }: { status: string }) { const label = status in m.stateText ? m.stateText[status as keyof typeof m.stateText] : statusText[status] ?? status; return <span className="badge" data-status={status}>{label}</span>; }
export function Brand() { return <aside className="brand"><p className="eyebrow">{m.brandNote}</p><div className="brand-word" aria-hidden="true">TOKEN</div><span className="geometry" aria-hidden="true" /><p>{m.welcome}</p><small>{m.brandCaption}</small></aside>; }
export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) { return <header className="page-title"><h1 tabIndex={-1}>{children}</h1>{subtitle && <p>{subtitle}</p>}</header>; }
export function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const previous = document.activeElement; const node = ref.current; node?.showModal(); return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><h2 id={titleId}>{title}</h2>{children}</dialog>;
}
export function SecretReveal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [feedback, setFeedback] = useState(''); const [discard, setDiscard] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  return <Modal title={m.secretTitle} onClose={() => setDiscard(true)}><div ref={ref} tabIndex={-1}><Alert>{m.secretWarning}</Alert><pre className="secret">{secret}</pre><div className="actions"><Button onClick={async () => { try { await navigator.clipboard.writeText(secret); setFeedback(m.copied); } catch { setFeedback(m.copyFailed); } }}>{m.copy}</Button><Button className="secondary" onClick={onClose}>{m.copiedDone}</Button></div>{feedback && <Alert>{feedback}</Alert>}{discard && <Alert danger><p>{m.discardSecret}</p><Button className="secondary" onClick={() => setDiscard(false)}>{m.cancel}</Button><Button className="danger-button" onClick={onClose}>{m.discard}</Button></Alert>}</div></Modal>;
}
export type ReceiptData = { amountMicro: string; postedMicro?: string; postedAfterMicro?: string; redemptionId?: string; entryId?: string; redeemedAt?: string; replayed?: boolean };
export function Receipt({ value }: { value: ReceiptData }) {
  const ref = useRef<HTMLElement>(null); useEffect(() => { ref.current?.focus(); }, [value]);
  return <section className="receipt" role="status" tabIndex={-1} ref={ref}><h2>{m.redeemed}</h2><dl><dt>{m.amount}</dt><dd>{formatCredits(value.amountMicro)} {m.credits}</dd><dt>{value.replayed ? m.receiptCurrent : m.balanceAfter}</dt><dd>{formatCredits(value.postedMicro ?? value.postedAfterMicro!)} {m.credits}</dd><dt>{value.entryId ? m.transactionId : m.redemptionId}</dt><dd>{value.entryId ?? value.redemptionId}</dd>{value.redeemedAt && <><dt>{m.time}</dt><dd>{formatDate(value.redeemedAt)}</dd></>}</dl>{value.replayed && <><p>{m.replay}</p><p>{m.receiptReplayBalance}</p></>}</section>;
}
export function DataList({ caption, children }: { caption: string; children: ReactNode }) { return <section aria-label={caption} className="data-list">{children}</section>; }
