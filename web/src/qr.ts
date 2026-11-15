// ISO/IEC 18004 QR encoder (Byte mode, ECC-M, Versions 1..10) implemented locally with zero dependencies.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  const res = new Uint8Array(data.length + ecCount);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 0; j < poly.length; j++) res[i + j] ^= gfMul(poly[j], factor);
  }
  return res.slice(data.length);
}

type QrSpec = readonly [number, number, number, number, number, number, readonly number[]];
const QR_SPECS_M: readonly QrSpec[] = [
  [1, 10, 1, 16, 0, 0, []],
  [2, 16, 1, 28, 0, 0, [6, 18]],
  [3, 26, 1, 44, 0, 0, [6, 22]],
  [4, 18, 2, 32, 0, 0, [6, 26]],
  [5, 24, 2, 43, 0, 0, [6, 30]],
  [6, 16, 4, 27, 0, 0, [6, 34]],
  [7, 18, 4, 31, 0, 0, [6, 22, 38]],
  [8, 22, 2, 38, 2, 39, [6, 24, 42]],
  [9, 22, 3, 36, 2, 37, [6, 26, 46]],
  [10, 26, 4, 43, 1, 44, [6, 28, 50]],
];

const QR_MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  r => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function bchFormat(mask: number): number {
  let rem = mask << 10;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  return ((mask << 10) | rem) ^ 0x5412;
}

function bchVersion(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  return (version << 12) | rem;
}

function qrPenalty(grid: number[][]): number {
  const n = grid.length;
  let score = 0;
  for (let r = 0; r < n; r++) {
    let runR = 1;
    let runC = 1;
    for (let c = 1; c < n; c++) {
      if (grid[r][c] === grid[r][c - 1]) runR++;
      else { if (runR >= 5) score += runR - 2; runR = 1; }
      if (grid[c][r] === grid[c - 1][r]) runC++;
      else { if (runC >= 5) score += runC - 2; runC = 1; }
    }
    if (runR >= 5) score += runR - 2;
    if (runC >= 5) score += runC - 2;
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  const pA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const match11 = (arr: number[], start: number, pat: number[]) => pat.every((v, idx) => arr[start + idx] === v);
  for (let r = 0; r < n; r++) {
    const col = grid.map(row => row[r]);
    for (let c = 0; c <= n - 11; c++) {
      if (match11(grid[r], c, pA) || match11(grid[r], c, pB)) score += 40;
      if (match11(col, c, pA) || match11(col, c, pB)) score += 40;
    }
  }
  let dark = 0;
  for (const row of grid) for (const v of row) dark += v;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

export function qrPathForText(text: string): { size: number; path: string } | null {
  const bytes = new TextEncoder().encode(text);
  const spec = QR_SPECS_M.find(([v, , g1b, g1d, g2b, g2d]) => Math.ceil((4 + (v >= 10 ? 16 : 8) + bytes.length * 8) / 8) <= g1b * g1d + g2b * g2d);
  if (!spec) return null;
  const [version, ecPerBlock, g1b, g1d, g2b, g2d, align] = spec;
  const totalData = g1b * g1d + g2b * g2d;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  pushBits(0b0100, 4);
  pushBits(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0; bits.length < maxBits; pad++) pushBits(pad % 2 === 0 ? 0xec : 0x11, 8);

  const codewords = new Uint8Array(totalData);
  for (let i = 0; i < totalData; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    codewords[i] = v;
  }

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1b + g2b; i++) {
    const len = i < g1b ? g1d : g2d;
    const block = codewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, ecPerBlock));
  }
  const finalBytes: number[] = [];
  for (let i = 0; i < Math.max(g1d, g2d); i++) for (const b of dataBlocks) if (i < b.length) finalBytes.push(b[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of ecBlocks) finalBytes.push(b[i]);

  const n = version * 4 + 17;
  const grid = Array.from({ length: n }, () => new Int8Array(n).fill(-1));
  const fixed = Array.from({ length: n }, () => new Uint8Array(n));
  const setFunc = (r: number, c: number, v: number) => { grid[r][c] = v; fixed[r][c] = 1; };

  const placeFinder = (tr: number, tc: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = tr + dr;
        const c = tc + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunc(r, c, on ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { setFunc(6, i, i % 2 === 0 ? 1 : 0); setFunc(i, 6, i % 2 === 0 ? 1 : 0); }
  setFunc(n - 8, 8, 1);
  for (const ar of align) {
    for (const ac of align) {
      // Skip only the three positions covered by finder patterns. Centres on the timing lines (versions 7+) must still be drawn.
      const last = align[align.length - 1];
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === last) || (ar === last && ac === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) setFunc(ar + dr, ac + dc, Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0) ? 1 : 0);
    }
  }
  for (let i = 0; i <= 8; i++) { if (!fixed[8][i]) setFunc(8, i, 0); if (!fixed[i][8]) setFunc(i, 8, 0); }
  for (let i = n - 8; i < n; i++) { setFunc(8, i, 0); if (i > n - 8) setFunc(i, 8, 0); }
  if (version >= 7) {
    const ver = bchVersion(version);
    for (let k = 0; k < 18; k++) {
      const bit = (ver >>> k) & 1;
      setFunc(n - 11 + (k % 3), Math.floor(k / 3), bit);
      setFunc(Math.floor(k / 3), n - 11 + (k % 3), bit);
    }
  }

  const allBits: number[] = [];
  for (const byte of finalBytes) for (let b = 7; b >= 0; b--) allBits.push((byte >>> b) & 1);
  let bitIdx = 0;
  let dir = -1;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < n; step++) {
      const r = dir === -1 ? n - 1 - step : step;
      for (const c of [right, right - 1]) if (!fixed[r][c]) grid[r][c] = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
    }
    dir = -dir;
  }

  let bestScore = Infinity;
  let bestGrid: number[][] = [];
  const fmtCoords = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]] as const;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map((row, r) => Array.from(row, (v, c) => (fixed[r][c] ? v : v ^ (QR_MASKS[mask](r, c) ? 1 : 0))));
    const fmt = bchFormat(mask);
    for (let k = 0; k < 15; k++) {
      const bit = (fmt >>> (14 - k)) & 1;
      const [r1, c1] = fmtCoords[k];
      candidate[r1][c1] = bit;
      if (k < 7) candidate[n - 1 - k][8] = bit;
      else candidate[8][n - 15 + k] = bit;
    }
    const score = qrPenalty(candidate);
    if (score < bestScore) { bestScore = score; bestGrid = candidate; }
  }

  let path = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (bestGrid[r][c] !== 1) { c++; continue; }
      const start = c;
      while (c < n && bestGrid[r][c] === 1) c++;
      path += `M${start} ${r}h${c - start}v1h-${c - start}z`;
    }
  }
  return { size: n, path };
}
