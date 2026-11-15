import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, post } from './api.ts';
import { useAdminAction } from './hooks.tsx';
import { am, m } from './messages.ts';
import { Alert, Button, errorMessage, Field, Modal, PageTitle, Password } from './ui.tsx';

type RotationStart = { secretBase32: string; otpauthUri: string };
type RotationConfirm = { recoveryCodes: string[] };

// ISO/IEC 18004 QR encoder (Byte mode, ECC-M, Versions 1..10) implemented locally with zero dependencies.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  const res = new Uint8Array(data.length + ecCount);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 0; j < poly.length; j++) res[i + j] ^= gfMul(poly[j], factor);
  }
  return res.slice(data.length);
}

type QrSpec = readonly [number, number, number, number, number, number, readonly number[]];
const QR_SPECS_M: readonly QrSpec[] = [
  [1, 10, 1, 16, 0, 0, []],
  [2, 16, 1, 28, 0, 0, [6, 18]],
  [3, 26, 1, 44, 0, 0, [6, 22]],
  [4, 18, 2, 32, 0, 0, [6, 26]],
  [5, 24, 2, 43, 0, 0, [6, 30]],
  [6, 16, 4, 27, 0, 0, [6, 34]],
  [7, 18, 4, 31, 0, 0, [6, 22, 38]],
  [8, 22, 2, 38, 2, 39, [6, 24, 42]],
  [9, 22, 3, 36, 2, 37, [6, 26, 46]],
  [10, 26, 4, 43, 1, 44, [6, 28, 50]],
];

const QR_MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  r => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function bchFormat(mask: number): number {
  let rem = mask << 10;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  return ((mask << 10) | rem) ^ 0x5412;
}

function bchVersion(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  return (version << 12) | rem;
}

function qrPenalty(grid: number[][]): number {
  const n = grid.length;
  let score = 0;
  for (let r = 0; r < n; r++) {
    let runR = 1;
    let runC = 1;
    for (let c = 1; c < n; c++) {
      if (grid[r][c] === grid[r][c - 1]) runR++;
      else { if (runR >= 5) score += runR - 2; runR = 1; }
      if (grid[c][r] === grid[c - 1][r]) runC++;
      else { if (runC >= 5) score += runC - 2; runC = 1; }
    }
    if (runR >= 5) score += runR - 2;
    if (runC >= 5) score += runC - 2;
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  const pA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const match11 = (arr: number[], start: number, pat: number[]) => pat.every((v, idx) => arr[start + idx] === v);
  for (let r = 0; r < n; r++) {
    const col = grid.map(row => row[r]);
    for (let c = 0; c <= n - 11; c++) {
      if (match11(grid[r], c, pA) || match11(grid[r], c, pB)) score += 40;
      if (match11(col, c, pA) || match11(col, c, pB)) score += 40;
    }
  }
  let dark = 0;
  for (const row of grid) for (const v of row) dark += v;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

function qrPathForText(text: string): { size: number; path: string } | null {
  const bytes = new TextEncoder().encode(text);
  const spec = QR_SPECS_M.find(([v, , g1b, g1d, g2b, g2d]) => Math.ceil((4 + (v >= 10 ? 16 : 8) + bytes.length * 8) / 8) <= g1b * g1d + g2b * g2d);
  if (!spec) return null;
  const [version, ecPerBlock, g1b, g1d, g2b, g2d, align] = spec;
  const totalData = g1b * g1d + g2b * g2d;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  pushBits(0b0100, 4);
  pushBits(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0; bits.length < maxBits; pad++) pushBits(pad % 2 === 0 ? 0xec : 0x11, 8);

  const codewords = new Uint8Array(totalData);
  for (let i = 0; i < totalData; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    codewords[i] = v;
  }

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1b + g2b; i++) {
    const len = i < g1b ? g1d : g2d;
    const block = codewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, ecPerBlock));
  }
  const finalBytes: number[] = [];
  for (let i = 0; i < Math.max(g1d, g2d); i++) for (const b of dataBlocks) if (i < b.length) finalBytes.push(b[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of ecBlocks) finalBytes.push(b[i]);

  const n = version * 4 + 17;
  const grid = Array.from({ length: n }, () => new Int8Array(n).fill(-1));
  const fixed = Array.from({ length: n }, () => new Uint8Array(n));
  const setFunc = (r: number, c: number, v: number) => { grid[r][c] = v; fixed[r][c] = 1; };

  const placeFinder = (tr: number, tc: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = tr + dr;
        const c = tc + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunc(r, c, on ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { setFunc(6, i, i % 2 === 0 ? 1 : 0); setFunc(i, 6, i % 2 === 0 ? 1 : 0); }
  setFunc(n - 8, 8, 1);
  for (const ar of align) {
    for (const ac of align) {
      if (fixed[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) setFunc(ar + dr, ac + dc, Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0) ? 1 : 0);
    }
  }
  for (let i = 0; i <= 8; i++) { if (!fixed[8][i]) setFunc(8, i, 0); if (!fixed[i][8]) setFunc(i, 8, 0); }
  for (let i = n - 8; i < n; i++) { setFunc(8, i, 0); if (i > n - 8) setFunc(i, 8, 0); }
  if (version >= 7) {
    const ver = bchVersion(version);
    for (let k = 0; k < 18; k++) {
      const bit = (ver >>> k) & 1;
      setFunc(n - 11 + (k % 3), Math.floor(k / 3), bit);
      setFunc(Math.floor(k / 3), n - 11 + (k % 3), bit);
    }
  }

  const allBits: number[] = [];
  for (const byte of finalBytes) for (let b = 7; b >= 0; b--) allBits.push((byte >>> b) & 1);
  let bitIdx = 0;
  let dir = -1;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < n; step++) {
      const r = dir === -1 ? n - 1 - step : step;
      for (const c of [right, right - 1]) if (!fixed[r][c]) grid[r][c] = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
    }
    dir = -dir;
  }

  let bestScore = Infinity;
  let bestGrid: number[][] = [];
  const fmtCoords = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]] as const;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map((row, r) => Array.from(row, (v, c) => (fixed[r][c] ? v : v ^ (QR_MASKS[mask](r, c) ? 1 : 0))));
    const fmt = bchFormat(mask);
    for (let k = 0; k < 15; k++) {
      const bit = (fmt >>> (14 - k)) & 1;
      const [r1, c1] = fmtCoords[k];
      candidate[r1][c1] = bit;
      if (k < 7) candidate[n - 1 - k][8] = bit;
      else candidate[8][n - 15 + k] = bit;
    }
    const score = qrPenalty(candidate);
    if (score < bestScore) { bestScore = score; bestGrid = candidate; }
  }

  let path = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (bestGrid[r][c] !== 1) { c++; continue; }
      const start = c;
      while (c < n && bestGrid[r][c] === 1) c++;
      path += `M${start} ${r}h${c - start}v1h-${c - start}z`;
    }
  }
  return { size: n, path };
}

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
