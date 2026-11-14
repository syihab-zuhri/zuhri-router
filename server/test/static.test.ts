// Same-origin serving of the built web app, proxy trust, and response headers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DB_URL, KEY, mailer, fakeResolver } from './helpers.ts';
import { createPool, type Db } from '../src/db/pool.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildApp } from '../src/http/app.ts';

let db: Db; let app: any; let dist: string; let outside: string;
before(async () => {
  db = createPool(DB_URL, 5); await db.query('drop schema public cascade; create schema public;'); await migrate(db);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-static-')); dist = path.join(tmp, 'dist'); outside = path.join(tmp, 'secret.txt');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true }); fs.writeFileSync(outside, 'RAHASIA-DI-LUAR');
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title><div id="root"></div>'); fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)'); fs.writeFileSync(path.join(dist, 'notes.exe'), 'x');
  app = await buildApp({ db, key: KEY, mailer, secureCookies: true, resolveHost: fakeResolver, webDist: dist, trustProxy: 1 });
});
after(async () => { await app.close(); await db.end(); });
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers, remoteAddress: '10.0.0.9' });

test('the app shell is served for client-side routes with protective headers; assets are cached; API paths stay JSON', async () => {
  for (const url of ['/', '/masuk', '/admin/pelanggan', '/aktivasi?x=1', '/api-key']) { const r = await get(url); assert.equal(r.statusCode, 200, url); assert.match(r.body, /id="root"/); assert.match(r.headers['content-type'], /text\/html/); assert.equal(r.headers['cache-control'], 'no-cache'); assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/); assert.equal(r.headers['x-frame-options'], 'DENY'); assert.equal(r.headers['referrer-policy'], 'no-referrer'); }
  const asset = await get('/assets/app-abc123.js'); assert.equal(asset.statusCode, 200); assert.match(asset.headers['content-type'], /javascript/); assert.match(asset.headers['cache-control'], /immutable/);
  for (const url of ['/api/tidak-ada', '/admin/api/tidak-ada', '/v1/tidak-ada']) { const r = await get(url); assert.equal(r.statusCode, 404, url); assert.equal(r.json().error.code, 'not_found'); }
  assert.equal((await get('/assets/hilang.js')).statusCode, 404, 'a missing file is not answered with the shell');
  assert.equal((await app.inject({ method: 'POST', url: '/masuk', headers: { 'x-router-csrf': '1' } })).statusCode, 404);
  assert.equal((await get('/healthz')).json().ok, true); assert.equal((await get('/api/me')).statusCode, 401);
});

test('nothing outside the folder or of an unlisted type can be fetched', async () => {
  for (const url of ['/../secret.txt', '/..%2Fsecret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '//secret.txt', '/notes.exe', '/assets/..%5c..%5csecret.txt']) { const r = await get(url); assert.ok(!r.body.includes('RAHASIA-DI-LUAR'), url); assert.notEqual(r.headers['content-type'], 'application/octet-stream'); }
});

test('HSTS is sent on secure deployments and API answers are never cached', async () => {
  const r = await get('/readyz'); assert.equal(r.headers['strict-transport-security'], 'max-age=31536000'); assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('with one trusted proxy the client address comes from X-Forwarded-For, and a client cannot push a fake hop past it', async () => {
  const login = (xff: string) => app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.0.9', headers: { 'x-router-csrf': '1', 'content-type': 'application/json', 'x-forwarded-for': xff }, payload: { identifier: 'nobody', password: 'wrong-password-1' } });
  for (let i = 0; i < 30; i++) await login(`203.0.113.${i}, 198.51.100.7`); // the proxy appends the real client last: all 30 count against 198.51.100.7
  assert.equal((await login('1.2.3.4, 198.51.100.7')).statusCode, 429, 'a spoofed first hop does not escape the per-address limit');
  assert.equal((await login('198.51.100.8')).statusCode, 401, 'another client is unaffected');
});
