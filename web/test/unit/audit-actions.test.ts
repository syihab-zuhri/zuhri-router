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

test('setiap kunci summary audit server punya label admin', () => {
  // A summary is an object literal, or a ternary of two; a value may be a template literal holding `${...}`.
  const body = '((?:[^{}`]|`[^`]*`)*)';
  const patterns = [
    new RegExp(`summary:\\s*\\{${body}\\}`, 'g'),
    new RegExp(`summary:\\s*[^?{}\\n]*\\?\\s*\\{${body}\\}\\s*:\\s*\\{${body}\\}`, 'g'),
  ];
  const keys = new Set<string>();
  const files = readdirSync(serverSrc, { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.ts'));
  for (const file of files) {
    // audit.ts declares the field and reads the column back; every other `summary:` is a written summary.
    if (file === 'audit.ts') continue;
    const text = readFileSync(join(serverSrc, file), 'utf8');
    let parsed = 0;
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        parsed += 1;
        for (const object of match.slice(1)) {
          for (const field of (object ?? '').split(',')) {
            const key = /^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(field);
            if (key) keys.add(key[1]);
          }
        }
      }
    }
    // A summary in another shape (a variable, a spread, a helper call) cannot be checked here, so it fails loudly.
    assert.equal(parsed, text.match(/\bsummary:/g)?.length ?? 0, `${file}: ada summary yang bukan objek literal`);
  }
  assert.ok(keys.size >= 38, `hanya ${keys.size} kunci summary ditemukan; pola pencarian mungkin rusak`);
  const operations = readFileSync(new URL('../../src/admin-operations.tsx', import.meta.url), 'utf8');
  const labels = operations.match(/const auditSummaryLabels: Record<string, string> = \{([\s\S]*?)\n\};/);
  assert.ok(labels, 'peta label rincian audit tidak ditemukan');
  const labelled = new Set([...labels[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(match => match[1]));
  assert.deepEqual([...keys].filter(key => !labelled.has(key)).sort(), [], 'kunci summary audit tanpa label');
});
