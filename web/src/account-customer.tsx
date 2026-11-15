import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, post } from './api.ts';
import { formatDate } from './credits.ts';
import { useAction, useResource } from './hooks.tsx';
import { am, m } from './messages.ts';
import { Alert, Badge, Button, DataList, Empty, ErrorBox, errorMessage, Field, Modal, PageTitle, Password, Pending } from './ui.tsx';

type Me = { username: string; tenantStatus: string; version: string };
type RawSession = { id: string; createdAt?: string; lastSeenAt?: string; created_at?: string; last_seen_at?: string };
type SessionsResponse = { current: string; sessions: RawSession[] };

function accountErrorText(error: unknown, overrides: Record<string, string>): string {
  if (error instanceof ApiError && error.code in overrides) return overrides[error.code];
  return errorMessage(error);
}

const passwordErrorOverrides: Record<string, string> = {
  invalid_credentials: am.wrongCurrentPassword,
  weak_password: am.weakCustomerPassword,
};

const closeErrorOverrides: Record<string, string> = {
  invalid_credentials: am.wrongCurrentPassword,
  invalid_request: am.invalidConfirmationUsername,
};

export function CustomerAccountPage() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const me = useResource<Me>('/api/me');
  const sessions = useResource<SessionsResponse>('/api/account/sessions');

  const pwAction = useAction();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwNotice, setPwNotice] = useState('');
  const pwNoticeRef = useRef<HTMLDivElement>(null);

  const revokeAction = useAction();
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState('');
  const sessionNoticeRef = useRef<HTMLDivElement>(null);

  const closeAction = useAction();
  const [closeOpen, setCloseOpen] = useState(false);
  const [confirmUsername, setConfirmUsername] = useState('');
  const [closePassword, setClosePassword] = useState('');

  useEffect(() => {
    if (pwNotice) pwNoticeRef.current?.focus();
  }, [pwNotice]);

  useEffect(() => {
    if (sessionNotice) sessionNoticeRef.current?.focus();
  }, [sessionNotice]);

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    setPwNotice('');
    const payload = { current: currentPassword, next: newPassword };
    void pwAction.run(async () => {
      await post('/api/account/password', payload);
      setCurrentPassword('');
      setNewPassword('');
      setPwNotice(am.passwordChanged);
      void sessions.refetch();
    });
  };

  const confirmRevoke = () => {
    if (!revokeTarget) return;
    const targetId = revokeTarget;
    const isCurrent = targetId === sessions.data?.current;
    setSessionNotice('');
    void revokeAction.run(async () => {
      await post(`/api/account/sessions/${encodeURIComponent(targetId)}/revoke`, {});
      setRevokeTarget(null);
      if (isCurrent) {
        cache.clear();
        navigate('/masuk', { replace: true, state: { sessionRevoked: true } });
        return;
      }
      setSessionNotice(am.sessionRevoked);
      void sessions.refetch();
    });
  };

  const closeCancel = () => {
    setCloseOpen(false);
    setConfirmUsername('');
    setClosePassword('');
    closeAction.setError(null);
  };

  const submitClose = (event: React.FormEvent) => {
    event.preventDefault();
    if (!me.data) return;
    const payload = { currentPassword: closePassword, confirmUsername, expectedVersion: me.data.version };
    void closeAction.run(async () => {
      await post('/api/account/close', payload);
      setConfirmUsername('');
      setClosePassword('');
      setCloseOpen(false);
      cache.clear();
      navigate('/masuk', { replace: true, state: { accountClosed: true } });
    });
  };

  const closeConflict = closeAction.error instanceof ApiError && closeAction.error.code === 'version_conflict';
  const revokeIsCurrent = revokeTarget !== null && revokeTarget === sessions.data?.current;

  return <>
    <PageTitle subtitle={am.customerAccountSubtitle}>{am.customerAccountTitle}</PageTitle>

    {me.isPending ? <Pending /> : me.isError ? <ErrorBox error={me.error} retry={() => { void me.refetch(); }} /> : <>
      <section className="panel stack" aria-label={am.accountSummary}>
        <div className="request-heading">
          <h2>{am.accountSummary}</h2>
          <Badge status={me.data.tenantStatus} />
        </div>
        <dl>
          <dt>{m.username}</dt>
          <dd>{me.data.username}</dd>
          <dt>{m.version}</dt>
          <dd className="number">{me.data.version}</dd>
        </dl>
      </section>

      <form className="panel form-width" onSubmit={submitPassword}>
        <h2>{am.changePassword}</h2>
        <p className="muted">{am.changePasswordNote}</p>
        <Password label={am.currentPassword} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} maxLength={200} required />
        <Password label={m.newPassword} help={m.passwordHelp} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={10} maxLength={200} required />
        {pwAction.error && <Alert danger>{accountErrorText(pwAction.error, passwordErrorOverrides)}</Alert>}
        {pwAction.busy && <Alert>{m.saving}</Alert>}
        {!pwAction.busy && pwNotice && <div ref={pwNoticeRef} tabIndex={-1}><Alert>{pwNotice}</Alert></div>}
        <div className="actions">
          <Button busy={pwAction.busy}>{am.changePassword}</Button>
        </div>
      </form>

      <section className="panel stack">
        <div className="actions">
          <h2>{am.sessions}</h2>
          <Button type="button" className="secondary" busy={sessions.isFetching} onClick={() => { void sessions.refetch(); }}>{m.refresh}</Button>
        </div>
        <p className="muted">{am.sessionsNote}</p>
        {sessionNotice && <div ref={sessionNoticeRef} tabIndex={-1}><Alert>{sessionNotice}</Alert></div>}
        {sessions.isPending ? <Pending /> : sessions.isError ? <ErrorBox error={sessions.error} retry={() => { void sessions.refetch(); }} /> : sessions.data.sessions.length === 0 ? <Empty title={am.noSessions} /> : (
          <DataList caption={am.sessions}>
            {sessions.data.sessions.map(session => {
              const isCurrent = session.id === sessions.data.current;
              const created = session.createdAt ?? session.created_at ?? '';
              const lastSeen = session.lastSeenAt ?? session.last_seen_at ?? '';
              return (
                <article className="data-row" key={session.id}>
                  <div className="request-heading">
                    <h3>{am.sessionLabel}</h3>
                    <span className="badge" data-status={isCurrent ? 'ACTIVE' : 'NEUTRAL'}>
                      {isCurrent ? am.currentSession : am.otherSession}
                    </span>
                  </div>
                  <dl>
                    <dt>{am.sessionId}</dt>
                    <dd className="mono">{session.id}</dd>
                    <dt>{m.createdAt}</dt>
                    <dd>{created ? formatDate(created) : '-'}</dd>
                    <dt>{am.lastSeenAt}</dt>
                    <dd>{lastSeen ? formatDate(lastSeen) : '-'}</dd>
                  </dl>
                  <div className="actions">
                    <Button type="button" className="secondary" onClick={() => { setSessionNotice(''); revokeAction.setError(null); setRevokeTarget(session.id); }}>
                      {am.revokeSession}
                    </Button>
                  </div>
                </article>
              );
            })}
          </DataList>
        )}
      </section>

      <section className="panel danger-panel form-width stack" aria-label={am.closeAccount}>
        <h2>{am.closeAccount}</h2>
        <p>{am.closeAccountNote}</p>
        <p className="muted">{am.closeConsequenceTitle}</p>
        <ul className="consequence-list">
          <li>{am.closeConsequenceKeys}</li>
          <li>{am.closeConsequenceAccess}</li>
          <li>{am.closeConsequenceBalance}</li>
        </ul>
        <div className="actions">
          <Button type="button" className="danger-button" onClick={() => { closeAction.setError(null); setConfirmUsername(''); setClosePassword(''); setCloseOpen(true); }}>
            {am.closeAccount}
          </Button>
        </div>
      </section>
    </>}

    {revokeTarget !== null && (
      <Modal
        title={revokeIsCurrent ? am.revokeCurrentSessionTitle : am.revokeOtherSessionTitle}
        busy={revokeAction.busy}
        onClose={() => { setRevokeTarget(null); revokeAction.setError(null); }}
      >
        <p>{revokeIsCurrent ? am.revokeCurrentSessionWarning : am.revokeOtherSessionWarning}</p>
        <dl>
          <dt>{am.sessionId}</dt>
          <dd className="mono">{revokeTarget}</dd>
        </dl>
        {revokeAction.error && <ErrorBox error={revokeAction.error} />}
        {revokeAction.busy && <Alert>{m.saving}</Alert>}
        <div className="actions">
          <Button type="button" className="secondary" autoFocus disabled={revokeAction.busy} onClick={() => { setRevokeTarget(null); revokeAction.setError(null); }}>
            {m.cancel}
          </Button>
          <Button type="button" className="danger-button" busy={revokeAction.busy} onClick={confirmRevoke}>
            {am.revokeSession}
          </Button>
        </div>
      </Modal>
    )}

    {closeOpen && me.data && (
      <Modal title={am.closeAccountDialogTitle} busy={closeAction.busy} onClose={closeCancel}>
        <p>{am.closeAccountConfirmHelp(me.data.username)}</p>
        <dl>
          <dt>{m.username}</dt>
          <dd>{me.data.username}</dd>
          <dt>{m.version}</dt>
          <dd className="number">{me.data.version}</dd>
        </dl>
        <ul className="consequence-list">
          <li>{am.closeConsequenceKeys}</li>
          <li>{am.closeConsequenceAccess}</li>
          <li>{am.closeConsequenceBalance}</li>
        </ul>
        <form className="stack" onSubmit={submitClose}>
          <Field
            label={am.confirmUsername}
            help={am.confirmUsernameHelp(me.data.username)}
            value={confirmUsername}
            onChange={e => setConfirmUsername(e.target.value)}
            autoComplete="off"
            maxLength={24}
            required
            autoFocus
          />
          <Password
            label={am.currentPassword}
            autoComplete="current-password"
            value={closePassword}
            onChange={e => setClosePassword(e.target.value)}
            maxLength={200}
            required
          />
          {closeAction.error && <Alert danger>{accountErrorText(closeAction.error, closeErrorOverrides)}</Alert>}
          {closeConflict && (
            <div className="actions">
              <Button type="button" className="secondary" onClick={() => { closeAction.setError(null); void me.refetch(); }}>
                {am.reloadAccount}
              </Button>
            </div>
          )}
          {closeAction.busy && <Alert>{m.saving}</Alert>}
          <div className="actions">
            <Button type="button" className="secondary" disabled={closeAction.busy} onClick={closeCancel}>
              {m.cancel}
            </Button>
            <Button className="danger-button" busy={closeAction.busy}>
              {am.closeAccountConfirmAction}
            </Button>
          </div>
        </form>
      </Modal>
    )}
  </>;
}
