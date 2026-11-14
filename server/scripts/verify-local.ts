import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DB_URL } from '../test/helpers.ts';

const database = new URL(DB_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname));
assert.equal(database.port, '55432');
assert.equal(database.pathname, '/router_test');

process.env.DATABASE_URL = DB_URL;
process.env.APP_SECRET_KEY = randomBytes(32).toString('base64');
process.env.MAILER = 'none';
process.env.INSECURE_COOKIES = '1';
process.env.HOST = '127.0.0.1';
process.env.PORT ??= '55480';
await import('../src/main.ts');
