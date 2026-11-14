// The balance unit is the token credit (CR-013). Amounts are BigInt micro-credits (one millionth of a token credit),
// so decimal model multipliers stay exact. No floating point anywhere near balances.
export const MICRO_PER_CREDIT = 1_000_000n;
/** Rate that charges exactly one token credit per token: micro-credits per 1,000,000 tokens. */
export const RATE_ONE_CREDIT_PER_TOKEN = 1_000_000n * MICRO_PER_CREDIT;

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type Price = { version: number; inputRate: bigint; outputRate: bigint; cacheReadRate: bigint; cacheWriteRate: bigint; multiplierE4: bigint };

const TOKENS_PER_RATE_UNIT = 1_000_000n; // rates are micro-credits per 1,000,000 tokens
const MULTIPLIER_SCALE = 10_000n;

function assertCount(n: number, name: string) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
}

/** Customer debit: sum every category exactly, apply the model multiplier, round half up once. */
export function debitMicro(u: Usage, p: Price): bigint {
  assertCount(u.input, 'input'); assertCount(u.output, 'output'); assertCount(u.cacheRead, 'cacheRead'); assertCount(u.cacheWrite, 'cacheWrite');
  if (p.multiplierE4 <= 0n) throw new RangeError('multiplier must be positive');
  const ref = BigInt(u.input) * p.inputRate + BigInt(u.output) * p.outputRate + BigInt(u.cacheRead) * p.cacheReadRate + BigInt(u.cacheWrite) * p.cacheWriteRate;
  const d = TOKENS_PER_RATE_UNIT * MULTIPLIER_SCALE;
  return (2n * ref * p.multiplierE4 + d) / (2n * d);
}

/** Admission hold: upper bound, rounded up, using the most expensive input category. */
export function holdMicro(maxInput: number, maxOutput: number, p: Price): bigint {
  assertCount(maxInput, 'maxInput'); assertCount(maxOutput, 'maxOutput');
  const top = [p.inputRate, p.cacheReadRate, p.cacheWriteRate].reduce((a, b) => (a > b ? a : b));
  const ref = BigInt(maxInput) * top + BigInt(maxOutput) * p.outputRate;
  const d = TOKENS_PER_RATE_UNIT * MULTIPLIER_SCALE;
  return (ref * p.multiplierE4 + d - 1n) / d;
}

/** Parse a whole number of token credits given as a decimal string of digits. Rejects signs, decimals, exponents. */
export function creditsToMicro(credits: string): bigint {
  if (!/^[0-9]{1,12}$/.test(credits)) throw new RangeError('amount must be 1 to 12 digits');
  return BigInt(credits) * MICRO_PER_CREDIT;
}
