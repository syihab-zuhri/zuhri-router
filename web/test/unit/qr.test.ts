import test from 'node:test';
import assert from 'node:assert/strict';
import { qrPathForText } from '../../src/qr.ts';

// Structural checks against ISO/IEC 18004. A full decode was also verified once with an independent decoder (jsQR 1.4.0, outside the repo):
// before the alignment fix every version 7..10 symbol was unreadable, and an authenticator link (about 115 characters) needs version 7 or 8.
const ALIGN: Record<number, number[]> = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const VERSION_INFO: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

function grid(text: string) {
  const qr = qrPathForText(text);
  assert.ok(qr, `no symbol for length ${text.length}`);
  const g = Array.from({ length: qr.size }, () => new Array<number>(qr.size).fill(0));
  for (const m of qr.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let k = 0; k < Number(m[3]); k++) g[Number(m[2])][Number(m[1]) + k] = 1;
  return { g, size: qr.size, version: (qr.size - 17) / 4 };
}

function textForVersion(version: number) {
  for (let len = 1; len < 300; len++) { const t = 'a'.repeat(len); const q = qrPathForText(t); if (q && (q.size - 17) / 4 === version) return t; }
  throw new Error(`no length reaches version ${version}`);
}

test('every alignment pattern is drawn, including those on the timing lines from version 7', () => {
  for (let v = 2; v <= 10; v++) {
    const { g, size, version } = grid(textForVersion(v));
    assert.equal(version, v);
    const pos = ALIGN[v]; const last = pos[pos.length - 1];
    for (const r of pos) for (const c of pos) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const want = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0) ? 1 : 0;
        assert.equal(g[r + dr][c + dc], want, `version ${v} alignment (${r},${c}) offset (${dr},${dc}); size ${size}`);
      }
    }
  }
});

test('version information blocks match the standard table for versions 7 to 10', () => {
  for (let v = 7; v <= 10; v++) {
    const { g, size } = grid(textForVersion(v));
    for (let k = 0; k < 18; k++) {
      const bit = (VERSION_INFO[v] >>> k) & 1;
      assert.equal(g[size - 11 + (k % 3)][Math.floor(k / 3)], bit, `version ${v} lower-left bit ${k}`);
      assert.equal(g[Math.floor(k / 3)][size - 11 + (k % 3)], bit, `version ${v} upper-right bit ${k}`);
    }
  }
});

test('an authenticator link fits and uses a version that has alignment patterns on the timing lines', () => {
  const uri = 'otpauth://totp/Router:operator_satu?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Router&algorithm=SHA1&digits=6&period=30';
  const { version } = grid(uri);
  assert.ok(version >= 7, `version ${version}`);
});
