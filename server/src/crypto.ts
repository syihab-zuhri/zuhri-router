import crypto from 'node:crypto';
import { promisify } from 'node:util';

/** 256-bit random token, URL safe. Shown once; only its hash is stored. */
export const newToken = () => crypto.randomBytes(32).toString('base64url');
/** Verifier for high-entropy random tokens. Not for passwords. */
export const tokenHash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
export const sha256Hex = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// Passwords: Argon2id from node:crypto (no native add-on). Parameters are stored in the hash string.
const argon2 = promisify(crypto.argon2) as (alg: string, params: object) => Promise<Buffer>;
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 }; // KiB; revisit against current guidance before release

export async function hashPassword(password: string): Promise<string> {
  const nonce = crypto.randomBytes(16);
  const tag = await argon2('argon2id', { message: Buffer.from(password, 'utf8'), nonce, ...ARGON });
  return `argon2id$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${nonce.toString('base64')}$${tag.toString('base64')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^argon2id\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!m) return false;
  const want = Buffer.from(m[5], 'base64');
  const got = await argon2('argon2id', { message: Buffer.from(password, 'utf8'), nonce: Buffer.from(m[4], 'base64'), memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: want.length });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
/** A valid hash of a random password, used to spend equal time when the account does not exist. */
export const DUMMY_HASH: Promise<string> = hashPassword(crypto.randomBytes(24).toString('base64'));

// Secrets at rest (TOTP seeds): AES-256-GCM with a key supplied by the environment, never stored in the database.
export function loadKey(b64: string | undefined): Buffer {
  const k = Buffer.from(b64 ?? '', 'base64');
  if (k.length !== 32) throw new Error('APP_SECRET_KEY must be 32 bytes, base64 encoded');
  return k;
}
export function seal(key: Buffer, plain: Buffer): string {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return ['v1', iv.toString('base64'), ct.toString('base64'), c.getAuthTag().toString('base64')].join('.');
}
export function unseal(key: Buffer, sealed: string): Buffer {
  const [v, iv, ct, tag] = sealed.split('.');
  if (v !== 'v1') throw new Error('unknown sealed format');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]);
}

// TOTP, RFC 6238 with HMAC-SHA1, 30 second step, 6 digits.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function totpAt(secret: Buffer, step: bigint, digits = 6): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(step);
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const totpStep = (nowMs: number) => BigInt(Math.floor(nowMs / 30_000));
/** Returns the matching step within +/- 1 step, or null. The caller must reject steps it has already accepted. */
export function totpMatch(secret: Buffer, code: string, nowMs: number): bigint | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  for (const s of [now, now - 1n, now + 1n]) {
    const want = Buffer.from(totpAt(secret, s)); const got = Buffer.from(code);
    if (crypto.timingSafeEqual(want, got)) return s;
  }
  return null;
}
