import { createPool } from './db/pool.ts';
import { loadKey } from './crypto.ts';
import { buildApp } from './http/app.ts';
import { recoverStuck } from './gateway.ts';
import { createMonitor, createTelegram } from './monitor.ts';
import type { Mailer } from './identity.ts';
import { createSmtpMailer, smtpConfigFromEnv } from './mailer.ts';

const need = (n: string) => { const v = process.env[n]; if (!v) { console.error(`${n} is required`); process.exit(1); } return v; };

// MAILER=smtp sends real email (see src/mailer.ts). MAILER=none is an explicit opt-in to sending nothing,
// so invitations and resets cannot silently appear to work.
const mailer: Mailer = (() => {
  if (process.env.MAILER === 'smtp') {
    try { return createSmtpMailer(smtpConfigFromEnv(process.env)); } catch (e) { console.error((e as Error).message); process.exit(1); }
  }
  if (process.env.MAILER !== 'none') { console.error('No mailer is configured. Set MAILER=smtp, or MAILER=none to start without email delivery.'); process.exit(1); }
  const fail = async () => { throw new Error('email delivery is not configured'); };
  return { invite: fail, passwordReset: fail };
})();

const db = createPool(need('DATABASE_URL'));
const app = await buildApp({ db, key: loadKey(need('APP_SECRET_KEY')), mailer, secureCookies: process.env.INSECURE_COOKIES !== '1', logger: true,
  webDist: process.env.WEB_DIST || undefined, publicBaseUrl: process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : undefined, trustProxy: Number.isInteger(Number(process.env.TRUST_PROXY)) ? Number(process.env.TRUST_PROXY) : 0 });
// Requests left open by a crashed process are released or flagged for the admin (see recoverStuck).
setInterval(() => { recoverStuck(db).then(r => { if (r.released || r.unresolved) app.log.warn(r, 'recovered stuck requests'); }).catch(e => app.log.error({ code: e?.code }, 'recovery failed')); }, 5 * 60_000).unref();
// Optional Telegram monitoring: alerts plus the read-only /status command, for one chat only.
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  createMonitor({ db, telegram: createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID }), chatId: process.env.TELEGRAM_CHAT_ID, productName: process.env.PRODUCT_NAME }).start();
} else app.log.warn('Telegram monitoring is not configured (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)');
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 8080) });
