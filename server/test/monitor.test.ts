// Telegram monitoring against a fake Telegram API. No real message is sent.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, wipe, makeAdmin, adminClient, makeCustomer, Client } from './helpers.ts';
import { createMonitor, createTelegram, gatewayEvents, statusReport } from '../src/monitor.ts';
import type { Db } from '../src/db/pool.ts';

let db: Db; let app: any; let server: http.Server; let apiBase: string; let fail = false;
const sent: { chat_id: string; text: string }[] = []; const TOKEN = '123456:TEST-bot-token-RAHASIA'; const CHAT = '777001';
before(async () => {
  ({ db, app } = await setup());
  server = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; res.setHeader('content-type', 'application/json');
    if (fail || !req.url!.startsWith(`/bot${TOKEN}/`)) { res.statusCode = 500; return res.end('{"ok":false}'); }
    if (req.url!.endsWith('/sendMessage')) { sent.push(JSON.parse(b)); return res.end('{"ok":true,"result":{}}'); }
    res.end('{"ok":true,"result":[]}'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r())); apiBase = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { server.close(); await app.close(); await db.end(); });
beforeEach(async () => { await wipe(db); sent.length = 0; fail = false; gatewayEvents.removeAllListeners(); });
const mk = () => createMonitor({ db, telegram: createTelegram({ token: TOKEN, chatId: CHAT, apiBase }), chatId: CHAT, productName: 'ZRouter' });

test('admin actions reach the chat once each, with amounts in tokens and never a code or key', async () => {
  const adm = await makeAdmin(db); const admin = await adminClient(app, adm); await makeCustomer(app, admin, 'budi'); const m = mk();
  assert.equal(await m.pollAuditOnce(), 0, 'the first poll only sets the starting point: history is not replayed');
  const v = (await admin.post('/admin/api/vouchers', { tokens: '100000000', saleRef: 'INV-9', idempotencyKey: 'issue-mon-0001' })).json;
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '5000', saleRef: 'INV-10', idempotencyKey: 'topup-mon-0001' });
  await admin.post('/admin/api/upstreams', { name: 'DeepSeek', baseUrls: { CHAT: 'https://api.example.test' }, apiKey: 'sk-upstream-monitor-secret-1' });
  assert.equal(await m.pollAuditOnce(), 3); assert.equal(await m.pollAuditOnce(), 0, 'nothing is sent twice');
  const all = sent.map(s => s.text).join('\n');
  assert.match(all, /\[ZRouter\] Kode redeem diterbitkan: 100\.000\.000 token \(SALE\), ref "INV-9" — oleh founder/); assert.match(all, /Tambah saldo langsung: 5\.000 token/); assert.match(all, /Upstream baru: DeepSeek/);
  assert.ok(sent.every(s => s.chat_id === CHAT)); for (const secret of [v.code, v.code.slice(9), 'sk-upstream-monitor-secret-1', TOKEN]) assert.ok(!all.includes(secret));
});

test('upstream trouble is alerted once per window, with a clear reason for 402', async () => {
  const until = async (n: number) => { for (let i = 0; i < 100 && sent.length < n; i++) await new Promise(r => setTimeout(r, 20)); };
  const m = mk(); m.start(); await until(1); assert.match(sent[0].text, /Server menyala/); sent.length = 0; // wait for the start-up message instead of sleeping
  for (let i = 0; i < 5; i++) gatewayEvents.emit('route_open', { upstreamName: 'Dahono', status: 402, untilMs: Date.now() + 1 });
  gatewayEvents.emit('route_open', { upstreamName: 'DeepSeek', status: 503, untilMs: Date.now() + 1 }); gatewayEvents.emit('all_routes_failed', { model: 'gpt/sol' });
  await until(3); await new Promise(r => setTimeout(r, 150)); m.stop(); // then give any duplicate a chance to show up
  assert.equal(sent.length, 3); const texts = sent.map(s => s.text).join('\n'); assert.match(texts, /Dahono menjawab 402: saldo atau kuota upstream habis/); assert.match(texts, /DeepSeek gagal berulang \(503\)/); assert.match(texts, /Semua rute gagal untuk model gpt\/sol/);
});

test('/status answers only in the configured chat and reports balances, requests and ledger consistency', async () => {
  const adm = await makeAdmin(db); const admin = await adminClient(app, adm); await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '250000', saleRef: 'INV-1', idempotencyKey: 'topup-mon-0002' });
  const m = mk();
  assert.equal(await m.handleUpdate({ message: { chat: { id: 999 }, text: '/status' } }), false, 'a stranger gets no answer'); assert.equal(sent.length, 0);
  assert.equal(await m.handleUpdate({ message: { chat: { id: Number(CHAT) }, text: '/status@zrouter_bot' } }), true);
  assert.match(sent[0].text, /Pelanggan aktif: 1; saldo minus: 0/); assert.match(sent[0].text, /Total saldo pelanggan: 250\.000 token/); assert.match(sent[0].text, /Saldo cocok dengan ledger/); assert.match(sent[0].text, /Upstream: belum ada/);
  assert.equal(await m.handleUpdate({ message: { chat: { id: CHAT }, text: '/hapus semua' } }), false, 'there are no commands that change anything');
  assert.match(await statusReport(db), /Request 1 jam: 0/);
});

test('a ledger mismatch and waiting requests raise alerts; a dead Telegram never breaks the server', async () => {
  const adm = await makeAdmin(db); const admin = await adminClient(app, adm); await makeCustomer(app, admin, 'budi');
  await admin.post('/admin/api/topups', { username: 'budi', amountTokens: '10', saleRef: 'INV-1', idempotencyKey: 'topup-mon-0003' });
  const m = mk(); await m.checkOnce(); assert.equal(sent.length, 0, 'quiet when everything is consistent');
  await db.query('update ledger_account set posted = posted + 1'); await m.checkOnce(); await m.checkOnce();
  assert.equal(sent.length, 1); assert.match(sent[0].text, /PERINGATAN: 1 saldo tidak cocok dengan ledger/);
  fail = true; assert.equal(await m.alert('x', 'uji'), false); assert.equal(await m.handleUpdate({ message: { chat: { id: CHAT }, text: '/status' } }), false);
  assert.equal((await new Client(app).get('/healthz')).status, 200);
});
