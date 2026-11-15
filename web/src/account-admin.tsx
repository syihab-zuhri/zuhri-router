import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, post } from './api.ts';
import { useAdminAction } from './hooks.tsx';
import { am, m } from './messages.ts';
import { Alert, Button, errorMessage, Field, Modal, PageTitle, Password } from './ui.tsx';
import { qrPathForText } from './qr.ts';

type RotationStart = { secretBase32: string; otpauthUri: string };
type RotationConfirm = { recoveryCodes: string[] };

function groupedSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function adminAccountErrorText(error: unknown, overrides: Record<string, string>): string {
  if (error instanceof ApiError && error.code in overrides) return overrides[error.code];
  return errorMessage(error);
}

const passwordErrorOverrides: Record<string, string> = {
  invalid_credentials: am.wrongCurrentPassword,
  weak_password: am.weakAdminPassword,
};

const rotationErrorOverrides: Record<string, string> = {
  invalid_code: am.invalidNewTotpCode,
  no_rotation: am.noRotationActive,
};

function RecoveryCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [feedback, setFeedback] = useState('');
  const [discard, setDiscard] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return (
    <Modal title={am.recoveryCodesTitle} onClose={() => setDiscard(true)}>
      <div ref={ref} tabIndex={-1} className="stack">
        <Alert danger>{am.recoveryCodesWarning}</Alert>
        <p>{am.recoveryCodesOldStopped}</p>
        <pre className="secret">{codes.join('\n')}</pre>
        <div className="actions">
          <Button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(codes.join('\n'));
                setFeedback(m.copied);
              } catch {
                setFeedback(m.copyFailed);
              }
            }}
          >
            {am.copyRecoveryCodes}
          </Button>
          <Button type="button" className="secondary" onClick={onClose}>
            {m.copiedDone}
          </Button>
        </div>
        {feedback && <Alert>{feedback}</Alert>}
        {discard && (
          <Alert danger>
            <p>{am.discardRecoveryCodes}</p>
            <div className="actions">
              <Button type="button" className="secondary" onClick={() => setDiscard(false)}>{m.cancel}</Button>
              <Button type="button" className="danger-button" onClick={onClose}>{am.discardRecoveryConfirm}</Button>
            </div>
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export function AdminAccountPage() {
  const pwAction = useAdminAction();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<unknown>(null);
  const [pwNotice, setPwNotice] = useState('');
  const pwNoticeRef = useRef<HTMLDivElement>(null);

  const totpAction = useAdminAction();
  const [pendingRotation, setPendingRotation] = useState<RotationStart | null>(null);
  const [keyCopyFeedback, setKeyCopyFeedback] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [totpError, setTotpError] = useState<unknown>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [rotationDone, setRotationDone] = useState(false);
  const rotationDoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pwNotice) pwNoticeRef.current?.focus();
  }, [pwNotice]);

  useEffect(() => {
    if (rotationDone && !recoveryCodes) rotationDoneRef.current?.focus();
  }, [rotationDone, recoveryCodes]);

  const qr = useMemo(() => (pendingRotation ? qrPathForText(pendingRotation.otpauthUri) : null), [pendingRotation]);

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    setPwNotice('');
    setPwError(null);
    const payload = { current: currentPassword, next: newPassword };
    void pwAction.run(async () => {
      try {
        await post('/admin/api/account/password', payload);
        setCurrentPassword('');
        setNewPassword('');
        setPwError(null);
        setPwNotice(am.adminPasswordChanged);
      } catch (err) {
        if (!(err instanceof ApiError && (err.code === 'step_up_required' || err.code === 'second_factor_required'))) {
          setPwError(err);
        }
        throw err;
      }
    });
  };

  const startRotation = () => {
    setTotpError(null);
    setRotationDone(false);
    setKeyCopyFeedback('');
    void totpAction.run(async () => {
      try {
        const started = await post<RotationStart>('/admin/api/account/authenticator/start', {});
        setPendingRotation(started);
        setConfirmCode('');
        setTotpError(null);
      } catch (err) {
        if (!(err instanceof ApiError && (err.code === 'step_up_required' || err.code === 'second_factor_required'))) {
          setTotpError(err);
        }
        throw err;
      }
    });
  };

  const confirmRotation = (event: React.FormEvent) => {
    event.preventDefault();
    setTotpError(null);
    const payload = { code: confirmCode.trim() };
    void totpAction.run(async () => {
      try {
        const confirmed = await post<RotationConfirm>('/admin/api/account/authenticator/confirm', payload);
        setPendingRotation(null);
        setKeyCopyFeedback('');
        setConfirmCode('');
        setTotpError(null);
        setRecoveryCodes(confirmed.recoveryCodes);
      } catch (err) {
        if (!(err instanceof ApiError && (err.code === 'step_up_required' || err.code === 'second_factor_required'))) {
          setTotpError(err);
          if (err instanceof ApiError && err.code === 'no_rotation') {
            setPendingRotation(null);
            setKeyCopyFeedback('');
            setConfirmCode('');
          }
        }
        throw err;
      }
    });
  };

  const cancelLocalRotation = () => {
    setPendingRotation(null);
    setKeyCopyFeedback('');
    setConfirmCode('');
    setTotpError(null);
  };

  return <>
    <PageTitle subtitle={am.adminAccountSubtitle}>{am.adminAccountTitle}</PageTitle>

    <form className="panel form-width" onSubmit={submitPassword}>
      <h2>{am.changePassword}</h2>
      <p className="muted">{am.changePasswordNote}</p>
      <Password label={am.currentPassword} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} maxLength={200} required />
      <Password label={m.newPassword} help={am.adminPasswordHelp} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={14} maxLength={200} required />
      {pwError !== null && <Alert danger>{adminAccountErrorText(pwError, passwordErrorOverrides)}</Alert>}
      {pwAction.busy && !pwAction.dialog && <Alert>{m.saving}</Alert>}
      {pwNotice && <div ref={pwNoticeRef} tabIndex={-1}><Alert>{pwNotice}</Alert></div>}
      <div className="actions">
        <Button busy={pwAction.busy}>{am.changePassword}</Button>
      </div>
    </form>

    <section className="panel form-width stack" aria-label={am.authenticatorSection}>
      <h2>{am.authenticatorSection}</h2>
      <p className="muted">{am.authenticatorHelp}</p>

      {!pendingRotation ? (
        <div className="actions">
          <Button type="button" busy={totpAction.busy} onClick={startRotation}>
            {am.startRotation}
          </Button>
        </div>
      ) : (
        <div className="stack">
          {qr && (
            <div className="stack">
              <p>{am.qrCaption}</p>
              <div className="qr-box">
                <svg
                  className="qr-svg"
                  viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`}
                  shapeRendering="crispEdges"
                  aria-hidden="true"
                >
                  <path d={qr.path} fill="currentColor" />
                </svg>
              </div>
            </div>
          )}

          <div className="stack">
            <h3>{am.manualKeyLabel}</h3>
            <p className="muted">{am.manualKeyHelp}</p>
            <pre className="secret">{groupedSecret(pendingRotation.secretBase32)}</pre>
            <div className="actions">
              <Button
                type="button"
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(pendingRotation.secretBase32);
                    setKeyCopyFeedback(m.copied);
                  } catch {
                    setKeyCopyFeedback(m.copyFailed);
                  }
                }}
              >
                {am.copyKey}
              </Button>
            </div>
            {keyCopyFeedback && <Alert>{keyCopyFeedback}</Alert>}
          </div>

          <form className="stack" onSubmit={confirmRotation}>
            <Field
              label={am.newAuthenticatorCode}
              help={am.newAuthenticatorCodeHelp}
              value={confirmCode}
              onChange={e => setConfirmCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
            <div className="actions">
              <Button type="button" className="secondary" disabled={totpAction.busy} onClick={cancelLocalRotation}>
                {am.cancelRotation}
              </Button>
              <Button busy={totpAction.busy}>{am.confirmRotation}</Button>
            </div>
          </form>
        </div>
      )}

      {totpError !== null && <Alert danger>{adminAccountErrorText(totpError, rotationErrorOverrides)}</Alert>}
      {totpAction.busy && !totpAction.dialog && <Alert>{m.saving}</Alert>}
      {rotationDone && !recoveryCodes && (
        <div ref={rotationDoneRef} tabIndex={-1}>
          <Alert>{am.rotationDoneAlert}</Alert>
        </div>
      )}
    </section>

    {recoveryCodes && (
      <RecoveryCodesModal
        codes={recoveryCodes}
        onClose={() => {
          setRecoveryCodes(null);
          setRotationDone(true);
        }}
      />
    )}
    {pwAction.dialog}
    {totpAction.dialog}
  </>;
}
