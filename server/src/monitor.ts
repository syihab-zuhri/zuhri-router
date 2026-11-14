// Telegram monitoring bot: pushes alerts and answers read-only status commands from one configured chat.
// It never changes anything, and messages never contain keys, redeem codes or prompt content.
import { EventEmitter } from 'node:events';
import type { Db } from './db/pool.ts';
import { invariantViolations } from './ledger.ts';

/** In-process gateway events that are not in the audit log. */
export const gatewayEvents = new EventEmitter();
export type RouteOpenEvent = { upstreamName: string; status?: number; untilMs: number };

export type Telegram = { send(text: string): Promise<boolean>; getUpdates(offset: number, timeoutSec: number): Promise<{ update_id: number; message?: { chat?: { id?: number | string }; text?: string } }[]> };
export function createTelegram(c: { token: string; chatId: string; apiBase?: string }): Telegram {
  const base = `${c.apiBase ?? 'https://api.telegram.org'}/bot${c.token}`;
  const call = async (method: string, body: object, timeoutMs: number) => {
    const r = await fetch(`${base}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const j: any = await r.json(); if (!j.ok) throw new Error('telegram ' + method + ' failed'); return j.result;
  };
  return {
    // Alerts must never break the server: failures are swallowed and reported as false.
    send: async text => { try { await call('sendMessage', { chat_id: c.chatId, text: text.slice(0, 3900), disable_web_page_preview: true }, 10_000); return true; } catch { return false; } },
    getUpdates: (offset, timeoutSec) => call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message'] }, (timeoutSec + 10) * 1000),
  };
}

const credits = (micro: unknown) => (BigInt(String(micro)) / 1_000_000n).toLocaleString('id-ID') + ' token';
const LABEL: Record<string, (s: any) => string> = {
  'voucher.issue': s => `Kode redeem diterbitkan: ${credits(s.amountMicro)} (${s.kind}), ref "${s.saleRef}"`,
  'voucher.revoke': s => `Kode redeem dicabut. Alasan: ${s.reason}`,
  'ledger.admin_topup': s => `Tambah saldo langsung: ${credits(s.amountMicro)}, ref "${s.saleRef}"`,
  'ledger.adjustment': s => `Koreksi saldo: ${(BigInt(s.amountMicro) / 1_000_000n).toLocaleString('id-ID')} token. Alasan: ${s.reason}`,
  'admin.second_factor': s => `Admin lolos faktor kedua (${s.method})`,
  'admin.bootstrap': () => 'Akun admin dibuat',
  'upstream.create': s => `Upstream baru: ${s.name}`,
  'upstream.update': s => `Upstream diubah${s.urlChanged ? ', base URL berubah' : ''}${s.keyReplaced ? ', API key diganti' : ''}`,
  'upstream.status': s => `Status upstream: ${s.from} -> ${s.to}. Alasan: ${s.reason}`,
  'price.publish': s => `Harga model terbit: ${s.after}`,
  'price.retire': s => `Harga model ditarik. Alasan: ${s.reason}`,
  'setting.overdraft': s => `Batas lebih-pakai diubah: ${credits(s.beforeMicro)} -> ${credits(s.afterMicro)}`,
  'request.mark_unresolved': () => 'Request terputus di tengah stream: MENUNGGU KEPUTUSAN admin',
  'request.recover_release': () => 'Request terputus sebelum jawaban: dana dilepas otomatis',
  'request.resolve': s => `Request diputuskan admin: ${credits(s.debitMicro)}. Alasan: ${s.reason}`,
  'tenant.suspend': s => `Pelanggan ditangguhkan. Alasan: ${s.reason ?? '-'}`, 'tenant.restore': s => `Pelanggan dipulihkan. Alasan: ${s.reason ?? '-'}`,
};

export async function statusReport(db: Db): Promise<string> {
  const q = async (sql: string) => (await db.query(sql)).rows;
  const [r] = await q(`select
    (select count(*) from request where created_at > now() - interval '1 hour') req_1h,
    (select count(*) from request where created_at > now() - interval '1 hour' and state in ('SETTLED','SETTLED_ESTIMATED')) ok_1h,
    (select count(*) from request where created_at > now() - interval '1 hour' and state='FAILED') fail_1h,
    (select coalesce(sum(debit),0) from request where created_at > now() - interval '24 hours') debit_24h,
    (select coalesce(sum(unbilled_input_tokens),0) from request where created_at > now() - interval '24 hours') unbilled_24h,
    (select count(*) from request where created_at > now() - interval '24 hours' and estimated) est_24h,
    (select count(*) from request where state='UNRESOLVED') unresolved,
    (select count(*) from hold where status='ACTIVE') open_holds,
    (select count(*) from tenant where status='ACTIVE') tenants,
    (select count(*) from ledger_account where posted < 0) negative,
    (select coalesce(sum(posted),0) from ledger_account) balances,
    (select coalesce(sum(amount),0) from voucher where status='ACTIVE' and (expires_at is null or expires_at > now())) vouchers`);
  const ups = await q("select name, status, key_enc is not null as key from upstream order by name");
  const bad = (await invariantViolations(db)).length;
  return [
    `Status ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `Request 1 jam: ${r.req_1h} (berhasil ${r.ok_1h}, gagal ${r.fail_1h})`,
    `Tagihan 24 jam: ${credits(r.debit_24h)}; estimasi ${r.est_24h} request; input tidak ditagih ${Number(r.unbilled_24h).toLocaleString('id-ID')} token`,
    `Menunggu keputusan: ${r.unresolved}; dana tertahan aktif: ${r.open_holds} request`,
    `Pelanggan aktif: ${r.tenants}; saldo minus: ${r.negative}`,
    `Total saldo pelanggan: ${credits(r.balances)}; kode belum ditukar: ${credits(r.vouchers)}`,
    `Upstream: ${ups.length ? ups.map(u => `${u.name} ${u.status}${u.key ? '' : ' (tanpa key)'}`).join(', ') : 'belum ada'}`,
    bad ? `PERINGATAN: ${bad} ketidakcocokan saldo terhadap ledger` : 'Saldo cocok dengan ledger',
  ].join('\n');
}

export function createMonitor(o: { db: Db; telegram: Telegram; chatId: string; productName?: string }) {
  const { db, telegram } = o; const name = o.productName ?? 'Router';
  let cursor: bigint | null = null; let offset = 0; let stopped = false;
  const lastSent = new Map<string, number>();
  /** Same alert key at most once per window, so a flapping upstream cannot flood the chat. */
  const alert = async (key: string, text: string, windowMs = 10 * 60_000) => { const now = Date.now(); if ((lastSent.get(key) ?? 0) + windowMs > now) return false; lastSent.set(key, now); return telegram.send(`[${name}] ${text}`); };

  const onRouteOpen = (e: RouteOpenEvent) => { void alert('route:' + e.upstreamName, e.status === 402 ? `Upstream ${e.upstreamName} menjawab 402: saldo atau kuota upstream habis. Rute dijeda.` : e.status === 401 ? `Upstream ${e.upstreamName} menolak API key (401). Rute dijeda.` : `Upstream ${e.upstreamName} gagal berulang${e.status ? ' (' + e.status + ')' : ''}. Rute dijeda sementara.`); };
  const onAllFailed = (e: { model: string }) => { void alert('down:' + e.model, `Semua rute gagal untuk model ${e.model}. Pelanggan menerima "layanan tidak tersedia".`); };

  return {
    /** Forward new audit events of the kinds worth an admin's attention. Starts from "now" on first call. */
    async pollAuditOnce(): Promise<number> {
      if (cursor === null) { cursor = BigInt((await db.query('select coalesce(max(id),0) m from audit_event')).rows[0].m); return 0; }
      const rows = (await db.query('select a.id, a.action, a.summary, u.username from audit_event a left join app_user u on u.id=a.actor_user where a.id > $1 order by a.id limit 50', [String(cursor)])).rows;
      let sent = 0;
      for (const r of rows) { cursor = BigInt(r.id); const f = LABEL[r.action]; if (!f) continue; let line: string; try { line = f(r.summary ?? {}); } catch { line = r.action; } if (await telegram.send(`[${name}] ${line}${r.username ? ` — oleh ${r.username}` : ''}`)) sent++; }
      return sent;
    },
    async checkOnce(): Promise<void> {
      const bad = await invariantViolations(db);
      if (bad.length) await alert('invariant', `PERINGATAN: ${bad.length} saldo tidak cocok dengan ledger. Hentikan penjualan dan periksa.`, 60 * 60_000);
      const u = Number((await db.query("select count(*) n from request where state='UNRESOLVED'")).rows[0].n);
      if (u) await alert('unresolved', `${u} request menunggu keputusan admin (tagih atau lepas).`, 6 * 60 * 60_000);
    },
    /** Read-only commands, answered only in the configured chat. Anything else is ignored silently. */
    async handleUpdate(u: { message?: { chat?: { id?: number | string }; text?: string } }): Promise<boolean> {
      if (String(u.message?.chat?.id ?? '') !== String(o.chatId)) return false;
      const cmd = (u.message?.text ?? '').trim().split(/[\s@]/)[0].toLowerCase();
      if (cmd === '/status') return telegram.send(await statusReport(db).catch(() => 'Status tidak dapat dibaca: database bermasalah.'));
      if (cmd === '/help' || cmd === '/start') return telegram.send('Perintah: /status. Bot ini hanya membaca; semua perubahan dilakukan lewat halaman admin.');
      return false;
    },
    start() {
      gatewayEvents.on('route_open', onRouteOpen); gatewayEvents.on('all_routes_failed', onAllFailed);
      void telegram.send(`[${name}] Server menyala.`);
      const every = (ms: number, f: () => Promise<unknown>) => setInterval(() => { f().catch(() => {}); }, ms).unref();
      every(10_000, () => this.pollAuditOnce()); every(5 * 60_000, () => this.checkOnce());
      void (async () => { while (!stopped) { try { for (const u of await telegram.getUpdates(offset, 25)) { offset = u.update_id + 1; await this.handleUpdate(u).catch(() => {}); } } catch { await new Promise(r => setTimeout(r, 5000).unref()); } } })();
    },
    stop() { stopped = true; gatewayEvents.off('route_open', onRouteOpen); gatewayEvents.off('all_routes_failed', onAllFailed); },
    alert,
  };
}
