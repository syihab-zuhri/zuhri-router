import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError, api, post } from './api.ts';
import { Alert, Button, ErrorBox, Field, Modal } from './ui.tsx';
import { m } from './messages.ts';

export function useResource<T>(path: string) {
  const navigate = useNavigate(); const cache = useQueryClient();
  const result = useQuery({ queryKey: [path], queryFn: ({ signal }) => api<T>(path, { signal }), retry: false,
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  useEffect(() => {
    if (result.error instanceof ApiError && (result.error.code === 'unauthorized' || result.error.code === 'second_factor_required')) {
      cache.clear(); navigate(path.startsWith('/admin/') ? '/admin/masuk' : '/masuk', { replace: true, state: { expired: true, returnTo: location.pathname + location.search } });
    }
  }, [result.error, navigate, cache, path]);
  return result;
}
export function useAction(admin = false) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Error | null>(null);
  const lock = useRef(false); const navigate = useNavigate(); const cache = useQueryClient();
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (err) {
      setError(err instanceof Error ? err : new Error('action_failed'));
      if (err instanceof ApiError && err.code === 'unauthorized') { cache.clear(); navigate(admin ? '/admin/masuk' : '/masuk', { state: { expired: true, returnTo: location.pathname + location.search } }); }
    } finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, run, setError };
}
export function useAdminAction() {
  const base = useAction(true); const [pending, setPending] = useState<(() => Promise<void>) | null>(null); const [code, setCode] = useState('');
  const run = (action: () => Promise<void>) => base.run(async () => {
    try { await action(); }
    catch (error) {
      if (error instanceof ApiError && (error.code === 'step_up_required' || error.code === 'second_factor_required')) { setPending(() => action); return; }
      throw error;
    }
  });
  const dialog = pending && <Modal title={m.stepUp} busy={base.busy} onClose={() => { setPending(null); setCode(''); base.setError(null); }}><p>{m.stepUpHelp}</p><form onSubmit={e => { e.preventDefault(); void base.run(async () => { await post('/admin/api/second-factor', { code }); setCode(''); const action = pending; setPending(null); await action(); }); }}><Field label={m.code} value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" pattern="(?:[0-9]{6}|[0-9a-fA-F]{20})" maxLength={20} required autoFocus />{base.error && <ErrorBox error={base.error} />}<div className="actions"><Button type="button" className="secondary" disabled={base.busy} onClick={() => { setPending(null); setCode(''); }}>{m.cancel}</Button><Button busy={base.busy}>{m.verify}</Button></div>{base.busy && <Alert>{m.saving}</Alert>}</form></Modal>;
  return { ...base, run, dialog };
}
