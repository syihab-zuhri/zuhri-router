import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { post } from './api.ts';
import { m } from './messages.ts';
import { Alert, Brand, Button, ErrorBox, Field, PageTitle, Password } from './ui.tsx';
import { useAction } from './hooks.tsx';

export function LoginPage({ admin = false }: { admin?: boolean }) {
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [second, setSecond] = useState(false);
  const { run, busy, error } = useAction(admin); const navigate = useNavigate(); const cache = useQueryClient(); const location = useLocation();
  const returnTo: unknown = location.state?.returnTo;
  const destination = typeof returnTo === 'string' && (admin ? /^\/admin\/(ringkasan|pelanggan|paket|kode|harga|upstream|rekonsiliasi|batas-lebih-pakai|audit|akun)(\?[^#]*)?$/ : /^\/(beranda|isi-saldo|api-key|model-harga|pemakaian|panduan|transaksi|akun)(\?[^#]*)?$/).test(returnTo) ? returnTo : admin ? '/admin/ringkasan' : '/beranda';
  return <div className="auth-layout"><Brand /><main className="auth-form"><PageTitle>{second ? m.secondFactor : admin ? m.adminLogin : m.login}</PageTitle>{location.state?.expired && <Alert>{m.sessionExpired}</Alert>}
    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      if (admin && !second) { await post('/admin/api/login', { identifier, password }); setPassword(''); setSecond(true); return; }
      if (admin) await post('/admin/api/second-factor', { code }); else await post('/api/auth/login', { identifier, password });
      setPassword(''); setCode(''); cache.clear(); navigate(destination, { replace: true });
    }); }}>
      {second ? <Field autoFocus label={m.code} help={m.codeHelp} autoComplete="one-time-code" pattern="(?:[0-9]{6}|[0-9a-fA-F]{20})" maxLength={20} value={code} onChange={e => setCode(e.target.value)} required /> : <><Field label={m.identifier} autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} required maxLength={254} /><Password autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={200} /></>}
      {error && <ErrorBox error={error} />}<Button busy={busy}>{second ? m.verify : m.login}</Button>{busy && <Alert>{m.saving}</Alert>}
    </form>{!admin && <Link to="/lupa-password">{m.forgot}</Link>}</main></div>;
}

export function TokenPage({ kind, takeToken }: { kind: 'activate' | 'reset'; takeToken: () => string | null }) {
  const [token, setToken] = useState(takeToken); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [done, setDone] = useState(false);
  const { run, busy, error } = useAction(); const activate = kind === 'activate';
  return <div className="auth-layout"><Brand /><main className="auth-form"><PageTitle>{activate ? m.activation : m.reset}</PageTitle>
    {done ? <Alert>{activate ? m.activated : m.resetDone}</Alert> : !token ? <><Alert danger>{activate ? m.activationHelpMissing : m.tokenMissing}</Alert></> : <form onSubmit={e => { e.preventDefault(); void run(async () => {
      await post(activate ? '/api/auth/activate' : '/api/auth/reset/complete', activate ? { token, username, password } : { token, password });
      setToken(null); setPassword(''); setDone(true);
    }); }}>
      {activate && <Field label={m.username} help={m.usernameHelp} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" pattern="[a-z0-9_]{3,24}" minLength={3} maxLength={24} required />}
      <Password label={m.newPassword} help={m.passwordHelp} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} maxLength={200} required />
      {error && <ErrorBox error={error} />}<Button busy={busy}>{activate ? m.activate : m.reset}</Button>{busy && <Alert>{m.saving}</Alert>}
    </form>}<Link to="/masuk">{m.backLogin}</Link></main></div>;
}
export function RequestResetPage() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const { run, busy, error } = useAction();
  return <div className="auth-layout"><Brand /><main className="auth-form"><PageTitle>{m.reset}</PageTitle>{done ? <Alert>{m.resetSent}</Alert> : <form onSubmit={e => { e.preventDefault(); void run(async () => { await post('/api/auth/reset/request', { email }); setEmail(''); setDone(true); }); }}><Field label={m.email} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required />{error && <ErrorBox error={error} />}<Button busy={busy}>{m.requestReset}</Button>{busy && <Alert>{m.saving}</Alert>}</form>}<Link to="/masuk">{m.backLogin}</Link></main></div>;
}
