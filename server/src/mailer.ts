// Account email over SMTP (FR-006). Works with any SMTP account, including Gmail with an app password.
// The one-time token travels in the URL fragment, which browsers do not send to servers, so it stays out of access logs.
import nodemailer from 'nodemailer';
import type { Mailer } from './identity.ts';

export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string; publicBaseUrl: string; productName: string; requireTls?: boolean };

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv): SmtpConfig {
  const need = (n: string) => { const v = env[n]; if (!v) throw new Error(`${n} is required when MAILER=smtp`); return v; };
  const base = new URL(need('PUBLIC_BASE_URL'));
  if (base.protocol !== 'https:' && env.INSECURE_COOKIES !== '1') throw new Error('PUBLIC_BASE_URL must use https');
  const port = Number(env.SMTP_PORT ?? 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid');
  return { host: need('SMTP_HOST'), port, secure: port === 465, user: need('SMTP_USER'), pass: need('SMTP_PASS'), from: need('MAIL_FROM'), publicBaseUrl: base.origin, productName: env.PRODUCT_NAME ?? 'Router', requireTls: true };
}

export function createSmtpMailer(c: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure, requireTLS: !c.secure && c.requireTls !== false,
    ...(c.requireTls === false ? { ignoreTLS: true } : {}),
    ...(c.user ? { auth: { user: c.user, pass: c.pass ?? '' } } : {}),
    connectionTimeout: 10_000, socketTimeout: 15_000, logger: false,
  });
  const send = (to: string, subject: string, lines: string[]) =>
    transport.sendMail({ from: c.from, to, subject, text: lines.join('\n'), disableFileAccess: true, disableUrlAccess: true }).then(() => undefined);
  return {
    invite: (to, token) => send(to, `Undangan ${c.productName}`, [
      `Anda diundang untuk memakai ${c.productName}.`, '', 'Buka tautan ini untuk membuat akun:', `${c.publicBaseUrl}/aktivasi#token=${token}`, '',
      'Tautan berlaku 72 jam dan hanya dapat dipakai sekali. Abaikan email ini bila Anda tidak merasa memintanya.']),
    passwordReset: (to, token) => send(to, `Atur ulang password ${c.productName}`, [
      'Kami menerima permintaan untuk mengatur ulang password akun Anda.', '', 'Buka tautan ini untuk membuat password baru:', `${c.publicBaseUrl}/atur-ulang#token=${token}`, '',
      'Tautan berlaku 30 menit dan hanya dapat dipakai sekali. Abaikan email ini bila Anda tidak memintanya; password Anda tidak berubah.']),
  };
}
