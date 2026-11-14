import { AppError, type Db, type Tx } from './db/pool.ts';

/**
 * Fixed-window counter stored in PostgreSQL so every instance shares it.
 * check() throws when the bucket is already over its limit; hit() records one failure.
 * If the store cannot be read the caller's operation fails closed, because the query throws.
 */
export async function check(db: Db | Tx, bucket: string, limit: number, windowSec: number): Promise<void> {
  const r = (await db.query(
    "select count, extract(epoch from (window_start + make_interval(secs => $2) - now())) as left from rate_limit where bucket=$1 and window_start + make_interval(secs => $2) > now()",
    [bucket, windowSec])).rows[0];
  if (r && r.count >= limit) throw new AppError('rate_limited', 'Too many attempts. Try again later.', 429, Math.max(1, Math.ceil(Number(r.left))));
}
export async function hit(db: Db | Tx, bucket: string, windowSec: number): Promise<void> {
  await db.query(
    `insert into rate_limit(bucket, window_start, count) values($1, now(), 1)
     on conflict (bucket) do update set
       count = case when rate_limit.window_start + make_interval(secs => $2) > now() then rate_limit.count + 1 else 1 end,
       window_start = case when rate_limit.window_start + make_interval(secs => $2) > now() then rate_limit.window_start else now() end`,
    [bucket, windowSec]);
}
export async function clear(db: Db | Tx, bucket: string): Promise<void> {
  await db.query('delete from rate_limit where bucket=$1', [bucket]);
}
