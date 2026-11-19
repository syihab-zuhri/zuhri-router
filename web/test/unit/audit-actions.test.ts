import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { m } from '../../src/messages.ts';

// Every audit action the server can write needs an admin-facing label, and its prefix a filter group, so the Audit
// screen never shows a raw name for a known action. Actions are written as `action: 'x.y'` or as a ternary of two.
const serverSrc = new URL('../../../server/src/', import.meta.url).pathname;

function serverActions(): Set<string> {
  const found = new Set<string>();
  const files = readdirSync(serverSrc, { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.ts'));
  for (const file of files) {
    const text = readFileSync(join(serverSrc, file), 'utf8');
    for (const match of text.matchAll(/action: ([^,}\n]+)/g)) {
      for (const literal of match[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)) found.add(literal[1]);
    }
  }
  return found;
}

test('setiap aksi audit server punya label admin dan kelompok filter', () => {
  const actions = serverActions();
  assert.ok(actions.size >= 40, `hanya ${actions.size} aksi ditemukan; pola pencarian mungkin rusak`);
  const unlabelled = [...actions].filter(action => !Object.hasOwn(m.auditActionText, action));
  assert.deepEqual(unlabelled, [], 'aksi audit tanpa label');
  const groups = Object.keys(m.auditActionGroups);
  const ungrouped = [...actions].filter(action => !groups.some(prefix => action.startsWith(prefix)));
  assert.deepEqual(ungrouped, [], 'aksi audit tanpa kelompok filter');
  const emptyGroups = groups.filter(prefix => ![...actions].some(action => action.startsWith(prefix)));
  assert.deepEqual(emptyGroups, [], 'kelompok filter tanpa aksi server');
});
