import crypto from 'node:crypto';
import { createPool, type Db } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';
import { bootstrapAdmin } from '../src/admin.ts';
import { totpAt, totpStep } from '../src/crypto.ts';
import type { FastifyInstance } from 'fastify';

export const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:spike_local_only@127.0.0.1:55432/router_test';
export const KEY = crypto.randomBytes(32);
export const mail = { invites: [] as { to: string; token: string }[], resets: [] as { to: string; token: string }[] };
export const mailer = { invite: async (to: string, token: string) => { mail.invites.push({ to, token }); }, passwordReset: async (to: string, token: string) => { mail.resets.push({ to, token }); } };

/** Test DNS: *.example.test resolves to a public address; names starting with "internal" resolve to a private one; "mixed" to both. */
export const fakeResolver = async (host: string) => { if (!host.endsWith('.example.test')) throw new Error('ENOTFOUND'); return host.startsWith('internal') ? ['10.0.0.5'] : host.startsWith('mixed') ? ['93.184.216.34', '127.0.0.1'] : host.startsWith('meta') ? ['169.254.169.254'] : ['93.184.216.34']; };

export async function setup(): Promise<{ db: Db; app: FastifyInstance }> {
  const db = createPool(DB_URL, 30);
  await db.query('drop schema public cascade; create schema public;');
  await migrate(db);
  // Existing suites assert strict balance limits, so they run with no overrun allowance. test/overdraft.test.ts covers the allowance.
  await db.query("update system_setting set value=0 where name='overdraft_micro'");
  const app = await buildApp({ db, key: KEY, mailer, secureCookies: false, resolveHost: fakeResolver, gateway: { unsafeAllowAnyUpstreamUrl: true, firstByteTimeoutMs: 800, idleTimeoutMs: 1500 } });
  return { db, app };
}
export async function wipe(db: Db) {
  await db.query('truncate attempt, request, route, upstream, redemption, voucher, token_pack, price_version, public_model, api_key, retired_username, rate_limit, idempotency_record, hold, password_reset, session, invite, admin_recovery_code, admin_credential, membership, ledger_entry, ledger_account, audit_event, tenant, app_user cascade');
  mail.invites.length = 0; mail.resets.length = 0;
}

/** Minimal cookie-carrying client over fastify.inject. */
export class Client {
  cookies: Record<string, string> = {};
  app: FastifyInstance; ip: string;
  constructor(app: FastifyInstance, ip = '10.0.0.1') { this.app = app; this.ip = ip; }
  async req(method: 'GET' | 'POST', url: string, payload?: unknown, opts: { csrf?: boolean } = {}) {
    const res = await this.app.inject({ method, url, payload: payload as any, remoteAddress: this.ip, cookies: this.cookies, headers: { ...(opts.csrf === false ? {} : { 'x-router-csrf': '1' }), ...(payload ? { 'content-type': 'application/json' } : {}) } });
    for (const c of res.cookies as { name: string; value: string }[]) { if (c.value) this.cookies[c.name] = c.value; else delete this.cookies[c.name]; }
    let json: any = null; try { json = res.json(); } catch { /* not json */ }
    return { status: res.statusCode, json, headers: res.headers };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, payload?: unknown, opts?: { csrf?: boolean }) => this.req('POST', url, payload ?? {}, opts);
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function unbase32(s: string): Buffer { let bits = 0, v = 0; const out: number[] = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }

export const ADMIN = { username: 'founder', email: 'founder@example.test', password: 'a-long-admin-password-1' };
/** Creates the admin and returns a code generator. Offsets -1, 0, +1 give three distinct, increasing TOTP steps. */
export async function makeAdmin(db: Db) {
  const r = await bootstrapAdmin(db, KEY, ADMIN); const secret = unbase32(r.totpSecretBase32);
  return { ...r, code: (offset: -1 | 0 | 1) => totpAt(secret, totpStep(Date.now()) + BigInt(offset)) };
}
/** Admin client that is fully signed in (password + second factor). Consumes the -1 TOTP step. */
export async function adminClient(app: FastifyInstance, adm: Awaited<ReturnType<typeof makeAdmin>>) {
  const c = new Client(app, '10.9.9.9');
  await c.post('/admin/api/login', { identifier: ADMIN.username, password: ADMIN.password });
  const r = await c.post('/admin/api/second-factor', { code: adm.code(-1) });
  if (r.status !== 200) throw new Error('admin sign-in failed in test setup: ' + JSON.stringify(r.json));
  return c;
}
/** Invite + activate + log in a customer. Returns the signed-in client. */
export async function makeCustomer(app: FastifyInstance, admin: Client, username: string, password = 'customer-password-1') {
  const email = `${username}@example.test`;
  await admin.post('/admin/api/invites', { email });
  const token = mail.invites.findLast(i => i.to === email)!.token;
  const c = new Client(app, '10.0.1.' + (1 + Math.floor(Math.random() * 200)));
  await c.post('/api/auth/activate', { token, username, password });
  await c.post('/api/auth/login', { identifier: username, password });
  return { client: c, email, password, inviteToken: token };
}
