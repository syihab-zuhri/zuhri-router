import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';

test('real HTTP key creation and secret headers never write raw keys to application logs', async () => {
  const child = fork(new URL('./fixtures/key-log-worker.ts', import.meta.url), [], { silent: true, execArgv: [] });
  const chunks: string[] = [];
  let secret: string | undefined;
  child.stdout!.on('data', chunk => { chunks.push(chunk.toString()); });
  child.stderr!.on('data', chunk => { chunks.push(chunk.toString()); });
  child.on('message', (message: unknown) => {
    if (message && typeof message === 'object' && 'secret' in message && typeof message.secret === 'string') secret = message.secret;
  });
  const exit = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exit, 0, 'HTTP fixture must complete');
  assert.ok(secret, 'fixture must send its one-time secret through IPC, not logs');
  const output = chunks.join('');
  assert.ok(!output.includes(secret), 'raw key leaked to application logs');
  assert.ok(!/rtr_[A-Za-z0-9_-]{43}/.test(output), 'raw key-shaped token leaked');
  assert.ok(output.includes('request completed'), 'logging must actually be enabled');
});
