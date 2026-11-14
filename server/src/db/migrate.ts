import fs from 'node:fs';
import { createPool, withTx, type Db } from './pool.ts';

export async function migrate(db: Db): Promise<string[]> {
  await db.query('create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())');
  const dir = new URL('../../migrations/', import.meta.url);
  const applied = new Set((await db.query('select name from schema_migration')).rows.map(r => r.name));
  const done: string[] = [];
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(new URL(name, dir), 'utf8');
    await withTx(db, async tx => { await tx.query(sql); await tx.query('insert into schema_migration(name) values($1)', [name]); });
    done.push(name);
  }
  return done;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
  const db = createPool(url);
  const done = await migrate(db);
  console.log(done.length ? `applied: ${done.join(', ')}` : 'no pending migrations');
  await db.end();
}
