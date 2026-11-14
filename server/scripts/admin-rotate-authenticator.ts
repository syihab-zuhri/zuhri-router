// Operator helper: replace the admin's authenticator secret on a running deployment, writing the new details to a private file.
// Usage: node scripts/admin-rotate-authenticator.ts <origin> <login-file> <out-file>
// <login-file> must contain "Username: ..", "Password: .." and the current otpauth URI. Nothing secret is printed.
import fs from 'node:fs';
import { totpAt, totpStep } from '../src/crypto.ts';

const [origin, loginFile, outFile] = process.argv.slice(2);
const login = fs.readFileSync(loginFile, 'utf8');
const username = /^Username:\s*(.+)$/m.exec(login)![1].trim(), password = /^Password:\s*(.+)$/m.exec(login)![1].trim();
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const unb32 = (s: string) => { let bits = 0, v = 0; const out: number[] = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const oldSeed = unb32(/secret=([A-Z2-7]+)/.exec(login)![1]);
const jar = new Map<string, string>();
async function post(path: string, body: unknown = {}) {
  const res = await fetch(origin + path, { method: 'POST', headers: { 'x-router-csrf': '1', 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const must = (r: { status: number; json: any }, what: string) => { if (r.status !== 200) { console.error(`${what} failed: ${r.status} ${r.json?.error?.code ?? ''}`); process.exit(1); } return r.json; };
must(await post('/admin/api/login', { identifier: username, password }), 'login');
must(await post('/admin/api/second-factor', { code: totpAt(oldSeed, totpStep(Date.now())) }), 'second factor');
const start = must(await post('/admin/api/account/authenticator/start'), 'start');
const done = must(await post('/admin/api/account/authenticator/confirm', { code: totpAt(unb32(start.secretBase32), totpStep(Date.now())) }), 'confirm');
fs.writeFileSync(outFile, [`Akun admin ${new URL(origin).host}. Autentikator diganti ${new Date().toISOString()}. Kunci dan kode pemulihan lama tidak berlaku lagi.`, `Username: ${username}`, `Password: ${password}`, `Kunci autentikator (ketik manual di aplikasi, jenis: berbasis waktu): ${start.secretBase32}`, `Authenticator URI: ${start.otpauthUri}`, `Recovery codes: ${done.recoveryCodes.join(' ')}`, ''].join('\n'), { mode: 0o600 });
await post('/admin/api/logout');
console.log('authenticator replaced; new details written to', outFile);
