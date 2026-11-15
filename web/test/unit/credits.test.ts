import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../src/credits.ts').catch(() => null);
test('mikro-kredit ditampilkan eksak termasuk negatif dan di atas batas Number', () => {
  assert.ok(mod, 'formatter mikro-kredit belum ada');
  assert.equal(mod.formatCredits('9223372036854775807'), '9.223.372.036.854,775807');
  assert.equal(mod.formatCredits('-1000001'), '-1,000001');
  assert.equal(mod.formatCredits('0'), '0');
  assert.equal(mod.creditsToMicro('1,000001'), '1000001');
  assert.equal(mod.creditsToMicro('999999999999'), '999999999999000000');
  assert.throws(() => mod.creditsToMicro('1e6'));
  assert.throws(() => mod.creditsToMicro('1.000.000'));
  const unsafe: unknown = 1000000;
  assert.throws(() => mod.formatCredits(unsafe as string));
});
