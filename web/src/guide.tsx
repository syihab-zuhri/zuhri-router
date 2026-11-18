import { useEffect } from 'react';
import { Link } from 'react-router';
import { useResource } from './hooks.tsx';
import { GUIDE_READ_KEY } from './customer.tsx';
import { m } from './messages.ts';
import { Alert, ErrorBox, PageTitle, Pending } from './ui.tsx';

const errors = [
  ['401 auth_invalid', 'Periksa API key. Secret hanya terlihat saat dibuat; buat key baru bila hilang.'],
  ['401 key_revoked', 'Key sudah dicabut. Buat key pengganti dari halaman API key.'],
  ['403 tenant_suspended', 'Hubungi admin tenant untuk memulihkan akses.'],
  ['403 service_paused', 'Layanan sedang dijeda. Request baru ditolak dan saldo tidak berubah.'],
  ['404 model_not_available', 'Periksa ID model yang tersedia dan scope API key.'],
  ['402 insufficient_balance', 'Tukar kode redeem, lalu periksa saldo.'],
  ['429 limit_exceeded', 'Tunggu selama nilai Retry-After sebelum mengirim request baru.'],
  ['413 request_too_large', 'Kurangi ukuran input, lalu kirim request baru.'],
  ['400 invalid_request', 'Perbaiki request sesuai protokol yang digunakan.'],
] as const;
const testedTools = [
  ['Codex CLI', '0.165.0'], ['Claude Code', '2.1.325'], ['OpenCode', '2.3.0'],
] as const;
const untestedTools = ['Hermes', 'ZCode'] as const;
const commands = [
  { method: 'POST', path: '/v1/chat/completions', label: 'Chat Completions', format: 'OpenAI-compatible' },
  { method: 'POST', path: '/v1/messages', label: 'Anthropic Messages', format: 'Anthropic' },
  { method: 'POST', path: '/v1/responses', label: 'Responses', format: 'OpenAI Responses, stateless' },
  { method: 'GET', path: '/v1/models', label: 'Daftar model', format: 'Daftar model untuk API key' },
] as const;

export function GuidePage() {
  const me = useResource<{ username: string }>('/api/me');
  const keys = useResource<{ keys: { id: string }[] }>('/api/keys?limit=1');
  const baseUrl = `${window.location.origin}/v1`;
  useEffect(() => {
    if (me.isSuccess) window.sessionStorage.setItem(`${GUIDE_READ_KEY}:${me.data.username}`, 'yes');
  }, [me.data?.username, me.isSuccess]);
  return <>
    <PageTitle subtitle={m.guideSubtitle}>{m.guide}</PageTitle>
    {keys.isPending ? <Pending /> : keys.isError ? <ErrorBox error={keys.error} retry={() => { void keys.refetch(); }} /> : keys.data.keys.length === 0 ? <Alert>{m.guideNoKey} <Link to="/api-key">{m.createKey}</Link></Alert> : <Alert>{m.guideKeyReady}</Alert>}
    <section className="panel stack"><h2>{m.baseUrl}</h2><code className="guide-code">{baseUrl}</code><p>{m.guideProtocolNote}</p></section>
    <section className="panel stack"><h2>{m.surfaces}</h2>{commands.map(command => <article className="data-row" key={command.path}><h3>{command.label}</h3><code>{command.method} {command.path}</code><p>{command.format}</p></article>)}
      <Alert>{m.responsesStateless}</Alert>
    </section>
    <section className="panel stack"><h2>{m.authTitle}</h2><p>{m.guideAuthNote}</p><pre className="secret">{`Authorization: Bearer YOUR_API_KEY`}</pre><pre className="secret">{`x-api-key: YOUR_API_KEY`}</pre><p>{m.guideAuthFormat}</p><p>{m.guideNeverShare}</p></section>
    <section className="panel stack"><h2>{m.errorCodes}</h2><div className="data-list">{errors.map(([code, action]) => <article className="data-row" key={code}><h3>{code}</h3><p>{action}</p></article>)}</div></section>
    <section className="panel stack"><h2>{m.toolCompatibility}</h2><p>{m.testedToolVersions}</p><ul>{testedTools.map(([name, version]) => <li key={name}>{name} {version}, diuji 2026-11-14</li>)}</ul><p>{m.untestedToolVersions}: {untestedTools.join(', ')}.</p><p>{m.guideClientRetry}</p></section>
    <div className="actions"><Link className="button secondary guide-key-link" to="/api-key">{m.keys}</Link></div>
  </>;
}
