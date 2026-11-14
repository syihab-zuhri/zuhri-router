import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, max = 20): Db {
  return new pg.Pool({ connectionString, max });
}

/** Run fn inside one transaction. The client is always released, on every path (spike finding 1). */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('begin');
    const out = await fn(tx);
    await tx.query('commit');
    return out;
  } catch (e) {
    await tx.query('rollback').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

/** Domain error with a stable code; never carries secrets. */
export class AppError extends Error {
  code: string; status: number; retryAfterSec?: number;
  constructor(code: string, message: string, status = 400, retryAfterSec?: number) {
    super(message); this.code = code; this.status = status; this.retryAfterSec = retryAfterSec;
  }
}
