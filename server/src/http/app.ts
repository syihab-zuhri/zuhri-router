import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { AppError, withTx, type Db } from '../db/pool.ts';
import * as identity from '../identity.ts';
import * as admin from '../admin.ts';
import * as ledger from '../ledger.ts';
import * as keys from '../keys.ts';
import * as pricing from '../pricing.ts';
import * as vouchers from '../vouchers.ts';
import * as upstreams from '../upstreams.ts';
import { systemResolver, type Resolver } from '../netguard.ts';
import { creditsToMicro } from '../money.ts';

export type AppDeps = { db: Db; key: Buffer; mailer: identity.Mailer; secureCookies: boolean; logger?: boolean; resolveHost?: Resolver };

const CUSTOMER_COOKIE = 'sid', ADMIN_COOKIE = 'asid';
const str = (v: unknown, max = 500): string => { if (typeof v !== 'string' || v.length > max) throw new AppError('invalid_request', 'Invalid request', 400); return v; };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db, key, mailer } = deps; const resolveHost = deps.resolveHost ?? systemResolver;
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: deps.logger ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] } : false,
  });
  await app.register(cookie);

  const cookieOpts = (path: string, hours: number) => ({ httpOnly: true, sameSite: 'strict' as const, secure: deps.secureCookies, path, maxAge: Math.floor(hours * 3600) });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AppError) {
      if (err.retryAfterSec) reply.header('retry-after', String(err.retryAfterSec));
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err?.validation || err?.statusCode === 400 || err?.statusCode === 413 || err?.statusCode === 415) return reply.code(err.statusCode ?? 400).send({ error: { code: 'invalid_request', message: 'Invalid request' } });
    app.log.error({ code: err?.code, name: err?.name }, 'unhandled error'); // no message or stack to the client
    if (process.env.DEBUG_ERRORS === '1') console.error(err);
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });

  // State-changing requests must carry a custom header. Browsers cannot add it cross-site without a CORS preflight, and no CORS is enabled.
  app.addHook('preHandler', async req => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-router-csrf'] !== '1') throw new AppError('csrf', 'Missing request header', 403);
  });
  app.addHook('onSend', async (_req, reply) => { reply.header('cache-control', 'no-store'); reply.header('x-content-type-options', 'nosniff'); });

  const customer = async (req: FastifyRequest) => {
    const p = await identity.authenticate(db, req.cookies[CUSTOMER_COOKIE], 'CUSTOMER', identity.LIMITS.customerIdleHours);
    if (!p || !p.tenantId) throw new AppError('unauthorized', 'Sign in required', 401);
    return p as identity.Principal & { tenantId: string };
  };
  const adminSession = (req: FastifyRequest) => identity.authenticate(db, req.cookies[ADMIN_COOKIE], 'ADMIN', admin.ADMIN_LIMITS.idleHours);
  const body = (req: FastifyRequest) => (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => { try { await db.query('select 1'); return { ok: true }; } catch { return reply.code(503).send({ ok: false }); } });

  // ---- Customer auth (API-010, API-011, API-012, API-019) ----
  app.post('/api/auth/activate', async (req, reply) => {
    const b = body(req);
    await identity.activateInvite(db, { token: str(b.token), username: str(b.username, 64), password: str(b.password) });
    return reply.code(201).send({ ok: true });
  });
  app.post('/api/auth/login', async (req, reply) => {
    const b = body(req);
    const { token } = await identity.login(db, { identifier: str(b.identifier, 254), password: str(b.password), ip: req.ip });
    reply.setCookie(CUSTOMER_COOKIE, token, cookieOpts('/', identity.LIMITS.customerSessionHours));
    return { ok: true };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const p = await identity.authenticate(db, req.cookies[CUSTOMER_COOKIE], 'CUSTOMER', identity.LIMITS.customerIdleHours);
    if (p) await identity.logout(db, p.sessionId);
    reply.clearCookie(CUSTOMER_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/reset/request', async req => {
    await identity.requestPasswordReset(db, { email: str(body(req).email, 254), ip: req.ip }, mailer);
    return { ok: true }; // identical for known and unknown addresses
  });
  app.post('/api/auth/reset/complete', async req => {
    const b = body(req);
    await identity.completePasswordReset(db, { token: str(b.token), password: str(b.password) });
    return { ok: true };
  });
  app.post('/api/account/password', async req => {
    const p = await customer(req); const b = body(req);
    await identity.changePassword(db, p, { current: str(b.current), next: str(b.next) });
    return { ok: true };
  });
  app.post('/api/account/close', async (req, reply) => {
    const p = await customer(req); const b = body(req);
    await identity.closeAccount(db, p, { currentPassword: str(b.currentPassword, 200), confirmUsername: str(b.confirmUsername, 24), expectedVersion: str(b.expectedVersion, 19) });
    reply.clearCookie(CUSTOMER_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/account/sessions', async req => { const p = await customer(req); return { current: p.sessionId, sessions: await identity.listSessions(db, p.userId) }; });
  app.post('/api/account/sessions/:id/revoke', async req => {
    const p = await customer(req);
    await identity.revokeSession(db, p.userId, (req.params as { id: string }).id);
    return { ok: true };
  });

  app.post('/api/keys', async (req, reply) => {
    const p = await customer(req); const b = body(req);
    return reply.code(201).send(await keys.create(db, p, keys.policy(b), str(b.idempotencyKey, 128)));
  });
  app.get('/api/keys', async req => {
    const p = await customer(req);
    return keys.list(db, p.tenantId, req.query as { after?: string; limit?: string });
  });
  app.get('/api/keys/:id', async req => {
    const p = await customer(req);
    return keys.get(db, p.tenantId, (req.params as { id: string }).id);
  });
  app.post('/api/keys/:id/limits', async req => {
    const p = await customer(req); const b = body(req);
    return keys.update(db, p, (req.params as { id: string }).id, keys.version(b.expectedVersion), keys.policy(b));
  });
  app.post('/api/keys/:id/revoke', async req => {
    const p = await customer(req);
    return keys.revoke(db, p, p.tenantId, (req.params as { id: string }).id, keys.version(body(req).expectedVersion));
  });

  // ---- Token packs and redeem (API-014) ----
  app.get('/api/packs', async req => { await customer(req); return vouchers.listPacks(db, true); });
  app.post('/api/redeem', async req => { const p = await customer(req); return vouchers.redeem(db, p, body(req).code, req.ip); });

  // ---- Customer data (API-013, API-018). Every read is scoped to the session's tenant. ----
  app.get('/api/me', async req => { const p = await customer(req); return { username: p.username, tenantStatus: p.tenantStatus, version: p.tenantVersion }; });
  app.get('/api/balance', async req => {
    const p = await customer(req); const b = await ledger.getBalance(db, p.tenantId);
    return { currency: b.currency, postedMicro: String(b.posted), heldMicro: String(b.held), availableMicro: String(b.available) };
  });
  app.get('/api/ledger', async req => {
    const p = await customer(req); const q = req.query as { before?: string; limit?: string };
    const entries = await ledger.listEntries(db, p.tenantId, { before: q.before, limit: q.limit ? Number(q.limit) : undefined });
    return { entries, nextBefore: entries.length ? entries[entries.length - 1].id : null };
  });

  // ---- Admin (API-030, API-031, API-032, API-038). Second factor always; step-up for money. ----
  app.post('/admin/api/login', async (req, reply) => {
    const b = body(req);
    const { token } = await admin.adminLogin(db, { identifier: str(b.identifier, 254), password: str(b.password), ip: req.ip });
    reply.setCookie(ADMIN_COOKIE, token, cookieOpts('/admin', admin.ADMIN_LIMITS.sessionHours));
    return { ok: true, secondFactorRequired: true };
  });
  app.post('/admin/api/second-factor', async req => {
    const p = await adminSession(req);
    if (!p) throw new AppError('unauthorized', 'Sign in required', 401);
    await admin.verifySecondFactor(db, key, p, str(body(req).code, 32));
    return { ok: true };
  });
  app.post('/admin/api/logout', async (req, reply) => {
    const p = await adminSession(req); if (p) await identity.logout(db, p.sessionId);
    reply.clearCookie(ADMIN_COOKIE, { path: '/admin' });
    return { ok: true };
  });
  app.post('/admin/api/invites', async (req, reply) => {
    const p = admin.requireAdmin(await adminSession(req));
    const r = await identity.createInvite(db, { email: str(body(req).email, 254), adminUser: p.userId }, mailer);
    return reply.code(201).send(r);
  });
  app.post('/admin/api/topups', async (req, reply) => {
    const p = admin.requireAdmin(await adminSession(req), { stepUp: true });
    const b = body(req);
    const target = await identity.findTenantByUsername(db, str(b.username, 64));
    if (!target) throw new AppError('username_not_found', 'No customer with that username', 404);
    const r = await withTx(db, tx => ledger.grantAdminTopup(tx, { tenantId: target.tenantId, amount: creditsSafe(b.amountTokens), saleRef: str(b.saleRef, 200), actorUser: p.userId, idemKey: str(b.idempotencyKey, 128) }));
    return reply.code(r.replayed ? 200 : 201).send({ username: target.username, entryId: r.entryId, amountMicro: r.amount, postedAfterMicro: r.postedAfter, createdAt: r.createdAt ?? null, replayed: r.replayed });
  });
  app.get('/admin/api/customers', async req => {
    admin.requireAdmin(await adminSession(req));
    return identity.listCustomers(db, req.query as { after?: string; prefix?: string; limit?: string });
  });
  app.post('/admin/api/adjustments', async (req, reply) => {
    const p = admin.requireAdmin(await adminSession(req), { stepUp: true });
    const b = body(req);
    const amount = str(b.amountMicro, 20);
    if (!/^-?[1-9][0-9]*$/.test(amount) || BigInt(amount) > 9223372036854775807n || BigInt(amount) < -9223372036854775807n) throw new AppError('invalid_request', 'Amount must be a nonzero integer string in micro-credits', 400);
    const target = await identity.findTenantByUsername(db, str(b.username, 64));
    if (!target) throw new AppError('username_not_found', 'No customer with that username', 404);
    const r = await withTx(db, tx => ledger.adjust(tx, { tenantId: target.tenantId, amount: BigInt(amount), reason: str(b.reason, 500), actorUser: p.userId, idemKey: str(b.idempotencyKey, 128) }));
    return reply.code(r.replayed ? 200 : 201).send({ username: target.username, entryId: r.entryId, amountMicro: r.amount, postedAfterMicro: r.postedAfter, replayed: r.replayed });
  });
  for (const [action, to] of [['suspend', 'SUSPENDED'], ['restore', 'ACTIVE']] as const) {
    app.post(`/admin/api/customers/:username/${action}`, async req => {
      const p = admin.requireAdmin(await adminSession(req), { stepUp: true });
      const b = body(req);
      return identity.changeTenantStatus(db, { username: str((req.params as { username: string }).username, 64), to, expectedVersion: str(b.expectedVersion, 19), reason: str(b.reason, 500), actorUser: p.userId });
    });
  }
  app.get('/admin/api/customers/:username/keys', async req => {
    admin.requireAdmin(await adminSession(req));
    const target = await identity.findTenantByUsername(db, (req.params as { username: string }).username);
    if (!target) throw new AppError('username_not_found', 'No customer with that username', 404);
    return keys.list(db, target.tenantId, req.query as { after?: string; limit?: string });
  });
  app.post('/admin/api/customers/:username/keys/:id/revoke', async req => {
    const p = admin.requireAdmin(await adminSession(req), { stepUp: true });
    const params = req.params as { username: string; id: string };
    const target = await identity.findTenantByUsername(db, params.username);
    if (!target) throw new AppError('username_not_found', 'No customer with that username', 404);
    return keys.revoke(db, p, target.tenantId, params.id, keys.version(body(req).expectedVersion));
  });
  app.get('/admin/api/customers/:username', async req => {
    admin.requireAdmin(await adminSession(req));
    const target = await identity.findTenantWithState(db, (req.params as { username: string }).username);
    if (!target) throw new AppError('username_not_found', 'No customer with that username', 404);
    const b = await ledger.getBalance(db, target.tenantId);
    return { username: target.username, tenantStatus: target.tenantStatus, version: String(target.tenantVersion), currency: b.currency, postedMicro: String(b.posted), heldMicro: String(b.held), availableMicro: String(b.available), entries: await ledger.listEntries(db, target.tenantId, { limit: 20 }) };
  });
  // ---- Pricing (API-033, FR-001). Model ids may contain "/", so they travel in the query string or body, not the path. ----
  const count = (v: unknown) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new AppError('invalid_request', 'Token counts must be non-negative integers', 400); return v; };
  app.get('/admin/api/models', async req => {
    admin.requireAdmin(await adminSession(req));
    const id = (req.query as { id?: string }).id;
    return id === undefined ? pricing.listModels(db) : pricing.getModel(db, pricing.modelId(id));
  });
  app.post('/admin/api/models', async (req, reply) => {
    const p = admin.requireAdmin(await adminSession(req)); const b = body(req);
    return reply.code(201).send(await pricing.createModel(db, { id: pricing.modelId(b.id), displayName: str(b.displayName, 120), actorUser: p.userId }));
  });
  app.post('/admin/api/models/price/draft', async req => {
    const p = admin.requireAdmin(await adminSession(req)); const b = body(req);
    return pricing.saveDraft(db, { id: pricing.modelId(b.id), expectedVersion: pricing.versionOf(b.expectedVersion), price: pricing.priceInput(b), actorUser: p.userId });
  });
  app.post('/admin/api/models/price/preview', async req => {
    admin.requireAdmin(await adminSession(req)); const b = body(req); const u = (b.usage && typeof b.usage === 'object' ? b.usage : {}) as Record<string, unknown>;
    if (b.which !== 'draft' && b.which !== 'published') throw new AppError('invalid_request', 'Invalid request', 400);
    return pricing.preview(db, pricing.modelId(b.id), b.which, { input: count(u.input), output: count(u.output), cacheRead: count(u.cacheRead), cacheWrite: count(u.cacheWrite) });
  });
  for (const action of ['publish', 'retire'] as const) {
    app.post(`/admin/api/models/price/${action}`, async req => {
      const p = admin.requireAdmin(await adminSession(req), { stepUp: true }); const b = body(req);
      return pricing[action](db, { id: pricing.modelId(b.id), expectedVersion: pricing.versionOf(b.expectedVersion), reason: str(b.reason, 500), actorUser: p.userId });
    });
  }
  // ---- Packs and redeem codes (API-034). Issuing and revoking move token liability, so they need step-up. ----
  app.get('/admin/api/packs', async req => { admin.requireAdmin(await adminSession(req)); return vouchers.listPacks(db, false); });
  app.post('/admin/api/packs', async (req, reply) => { const p = admin.requireAdmin(await adminSession(req)); return reply.code(201).send(await vouchers.createPack(db, body(req), p.userId)); });
  app.post('/admin/api/packs/:id', async req => { const p = admin.requireAdmin(await adminSession(req)); return vouchers.updatePack(db, (req.params as { id: string }).id, body(req), p.userId); });
  app.get('/admin/api/vouchers', async req => { admin.requireAdmin(await adminSession(req)); return vouchers.list(db, req.query as { before?: string }); });
  app.post('/admin/api/vouchers', async (req, reply) => {
    const p = admin.requireAdmin(await adminSession(req), { stepUp: true });
    const r = await vouchers.issue(db, body(req), p.userId);
    return reply.code(r.replayed ? 200 : 201).send(r);
  });
  app.post('/admin/api/vouchers/:id/revoke', async req => {
    const p = admin.requireAdmin(await adminSession(req), { stepUp: true });
    return vouchers.revoke(db, (req.params as { id: string }).id, body(req).reason, p.userId);
  });

  // ---- Upstreams and routes (API-035, FR-012). Everything that changes where requests and keys go needs step-up. ----
  app.get('/admin/api/upstreams', async req => { admin.requireAdmin(await adminSession(req)); return upstreams.list(db); });
  app.post('/admin/api/upstreams', async (req, reply) => { const p = admin.requireAdmin(await adminSession(req), { stepUp: true }); return reply.code(201).send(await upstreams.create(db, key, resolveHost, body(req), p.userId)); });
  app.post('/admin/api/upstreams/:id', async req => { const p = admin.requireAdmin(await adminSession(req), { stepUp: true }); return upstreams.update(db, key, resolveHost, (req.params as { id: string }).id, body(req), p.userId); });
  app.post('/admin/api/upstreams/:id/status', async req => { const p = admin.requireAdmin(await adminSession(req), { stepUp: true }); return upstreams.setStatus(db, (req.params as { id: string }).id, body(req), p.userId); });
  app.get('/admin/api/routes', async req => { admin.requireAdmin(await adminSession(req)); const id = (req.query as { modelId?: string }).modelId; return upstreams.listRoutes(db, id === undefined ? undefined : pricing.modelId(id)); });
  app.post('/admin/api/routes', async (req, reply) => { const p = admin.requireAdmin(await adminSession(req), { stepUp: true }); return reply.code(201).send(await upstreams.createRoute(db, body(req), p.userId)); });
  app.post('/admin/api/routes/:id', async req => { const p = admin.requireAdmin(await adminSession(req), { stepUp: true }); return upstreams.updateRoute(db, (req.params as { id: string }).id, body(req), p.userId); });

  // ---- Overrun allowance (CR-013) ----
  app.get('/admin/api/settings/overdraft', async req => {
    admin.requireAdmin(await adminSession(req));
    return { overdraftMicro: String(await ledger.overdraftMicro(db)) };
  });
  app.post('/admin/api/settings/overdraft', async req => {
    const p = admin.requireAdmin(await adminSession(req), { stepUp: true });
    const micro = creditsSafe(body(req).tokens);
    await withTx(db, tx => ledger.setOverdraft(tx, { micro, actorUser: p.userId }));
    return { overdraftMicro: String(micro) };
  });
  app.get('/admin/api/audit', async req => {
    admin.requireAdmin(await adminSession(req));
    const q = req.query as { before?: string };
    const before = q.before && /^[0-9]+$/.test(q.before) ? q.before : null;
    const rows = (await db.query('select id, actor_user, actor_kind, action, target_type, target_id, summary, created_at from audit_event where ($1::bigint is null or id < $1::bigint) order by id desc limit 50', [before])).rows;
    return { events: rows.map(r => ({ id: String(r.id), actorUser: r.actor_user, actorKind: r.actor_kind, action: r.action, targetType: r.target_type, targetId: r.target_id, summary: r.summary, createdAt: r.created_at.toISOString() })) };
  });

  return app;
}

function creditsSafe(v: unknown): bigint {
  try { return creditsToMicro(str(v, 12)); } catch { throw new AppError('invalid_request', 'Amount must be a whole number of token credits given as a string of digits', 400); }
}
