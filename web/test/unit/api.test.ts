import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../src/api.ts').catch(() => null);
test('mutasi membawa CSRF dan cookie, tanpa retry atau menyimpan secret', async () => {
  assert.ok(mod, 'klien API belum ada');
  let calls = 0;
  const fake: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(new Headers(init?.headers).get('x-router-csrf'), '1');
    return new Response(JSON.stringify({ error: { code: 'step_up_required', message: 'ignored' } }), { status: 401 });
  };
  await assert.rejects(() => mod.api('/admin/api/topups', { method: 'POST', body: { amountTokens: '1' } }, fake), (e: unknown) => e instanceof mod.ApiError && e.code === 'step_up_required');
  assert.equal(calls, 1);
  await assert.rejects(() => mod.api('https://outside.test/api', {}, fake));
});
