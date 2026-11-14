// SMTP mailer against a local fake SMTP server. No real email is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createSmtpMailer, smtpConfigFromEnv } from '../src/mailer.ts';

function fakeSmtp(): Promise<{ port: number; messages: { from: string; to: string; data: string }[]; close: () => void }> {
  const messages: { from: string; to: string; data: string }[] = [];
  const server = net.createServer(sock => {
    let buf = '', inData = false, cur = { from: '', to: '', data: '' };
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString('utf8');
      for (;;) {
        if (inData) { const i = buf.indexOf('\r\n.\r\n'); if (i < 0) return; cur.data = buf.slice(0, i); buf = buf.slice(i + 5); inData = false; messages.push(cur); cur = { from: '', to: '', data: '' }; sock.write('250 queued\r\n'); continue; }
        const i = buf.indexOf('\r\n'); if (i < 0) return; const line = buf.slice(0, i); buf = buf.slice(i + 2); const u = line.toUpperCase();
        if (u.startsWith('EHLO')) sock.write('250-fake\r\n250 8BITMIME\r\n');
        else if (u.startsWith('MAIL FROM')) { cur.from = line; sock.write('250 ok\r\n'); }
        else if (u.startsWith('RCPT TO')) { cur.to = line; sock.write('250 ok\r\n'); }
        else if (u === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (u === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ port: (server.address() as net.AddressInfo).port, messages, close: () => server.close() })));
}
const decode = (data: string) => data.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

test('invite and reset emails carry the one-time link in the URL fragment', async () => {
  const smtp = await fakeSmtp();
  const mailer = createSmtpMailer({ host: '127.0.0.1', port: smtp.port, secure: false, requireTls: false, from: 'ZRouter <no-reply@example.test>', publicBaseUrl: 'https://zrouter.example.test', productName: 'ZRouter' });
  await mailer.invite('budi@example.test', 'TOKEN-INVITE_123'); await mailer.passwordReset('budi@example.test', 'TOKEN-RESET_456');
  smtp.close();
  assert.equal(smtp.messages.length, 2);
  const [inv, rst] = smtp.messages.map(m => decode(m.data));
  assert.match(smtp.messages[0].to, /budi@example\.test/); assert.match(smtp.messages[0].from, /no-reply@example\.test/);
  assert.ok(inv.includes('https://zrouter.example.test/aktivasi#token=TOKEN-INVITE_123')); assert.match(inv, /Subject: Undangan ZRouter/);
  assert.ok(rst.includes('https://zrouter.example.test/atur-ulang#token=TOKEN-RESET_456'));
  assert.ok(!inv.includes('?token='), 'the token must not be in the query string');
});

test('delivery failure rejects, so the caller can report that the email was not sent', async () => {
  const mailer = createSmtpMailer({ host: '127.0.0.1', port: 1, secure: false, requireTls: false, from: 'a@example.test', publicBaseUrl: 'https://x.example.test', productName: 'X' });
  await assert.rejects(mailer.invite('budi@example.test', 't'));
});

test('configuration from the environment is strict', () => {
  const ok = { PUBLIC_BASE_URL: 'https://zrouter.example.test/', SMTP_HOST: 'smtp.example.test', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'a@example.test' };
  const c = smtpConfigFromEnv(ok);
  assert.deepEqual([c.port, c.secure, c.publicBaseUrl], [465, true, 'https://zrouter.example.test']);
  assert.equal(smtpConfigFromEnv({ ...ok, SMTP_PORT: '587' }).secure, false);
  assert.throws(() => smtpConfigFromEnv({ ...ok, PUBLIC_BASE_URL: 'http://zrouter.example.test' }), /https/);
  for (const k of Object.keys(ok)) assert.throws(() => smtpConfigFromEnv({ ...ok, [k]: '' }), new RegExp(k));
});
