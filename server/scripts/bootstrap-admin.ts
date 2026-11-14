// Operator-only: create the admin account. Prints the TOTP seed and recovery codes ONCE to this terminal.
// Usage: DATABASE_URL=... APP_SECRET_KEY=... ADMIN_PASSWORD=... node scripts/bootstrap-admin.ts <username> <email>
import { createPool } from '../src/db/pool.ts';
import { loadKey } from '../src/crypto.ts';
import { bootstrapAdmin } from '../src/admin.ts';

const [username, email] = process.argv.slice(2);
if (!username || !email || !process.env.ADMIN_PASSWORD || !process.env.DATABASE_URL) { console.error('usage: see the comment at the top of this file'); process.exit(1); }
const db = createPool(process.env.DATABASE_URL);
const r = await bootstrapAdmin(db, loadKey(process.env.APP_SECRET_KEY), { username, email, password: process.env.ADMIN_PASSWORD });
console.log('Admin created. Store these now; they are not shown again.');
console.log('Authenticator URI:', r.otpauthUri);
console.log('Recovery codes:', r.recoveryCodes.join(' '));
await db.end();
