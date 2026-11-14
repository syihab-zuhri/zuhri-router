// All money is BigInt micro-IDR. Rates are micro-IDR per 1,000,000 tokens. Multiplier is scaled by 10,000.
export type Usage = { input: number; output: number; cacheRead: number };
export type Price = { version: number; inputRate: bigint; outputRate: bigint; cacheReadRate: bigint; multiplierE4: bigint };
const Q = 1_000_000n, M = 10_000n;

function roundHalfUpDiv(n: bigint, d: bigint): bigint { return (2n * n + d) / (2n * d); }

export function debitMicro(u: Usage, p: Price): bigint {
  const ref = BigInt(u.input) * p.inputRate + BigInt(u.output) * p.outputRate + BigInt(u.cacheRead) * p.cacheReadRate;
  return roundHalfUpDiv(ref * p.multiplierE4, Q * M); // one rounding, after summing all categories
}
export function holdMicro(maxInput: number, maxOutput: number, p: Price): bigint {
  const top = p.inputRate > p.cacheReadRate ? p.inputRate : p.cacheReadRate;
  const ref = BigInt(maxInput) * top + BigInt(maxOutput) * p.outputRate;
  return (ref * p.multiplierE4 + Q * M - 1n) / (Q * M); // round up: a hold must never be below the bound
}
export function priceToJson(p: Price) { return { version: p.version, inputRate: String(p.inputRate), outputRate: String(p.outputRate), cacheReadRate: String(p.cacheReadRate), multiplierE4: String(p.multiplierE4) }; }
export function priceFromJson(j: any): Price { return { version: j.version, inputRate: BigInt(j.inputRate), outputRate: BigInt(j.outputRate), cacheReadRate: BigInt(j.cacheReadRate), multiplierE4: BigInt(j.multiplierE4) }; }
