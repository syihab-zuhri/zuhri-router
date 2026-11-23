// In-memory route health for the gateway (one process; a second instance would need a shared store).
// A route opens after three failures in a row for 30 s. A 401 or 402 from the upstream needs the admin, so it opens at once
// for five minutes. A success closes it. Nothing here probes an upstream: the state comes from real requests only.
import { gatewayEvents } from './monitor.ts';

type Health = { fails: number; openUntil: number; reason: CircuitReason | null };
export type CircuitReason = 'failures' | 'upstream_auth';
/** What the admin sees per route. `failures` counts failures in a row since the last success. */
export type Circuit = { open: boolean; openUntil: string | null; reason: CircuitReason | null; failures: number };

const health = new Map<string, Health>();

export const routeOpen = (id: string) => (health.get(id)?.openUntil ?? 0) > Date.now();

export function routeFailed(id: string, upstreamName: string, status?: number) {
  const h = health.get(id) ?? { fails: 0, openUntil: 0, reason: null }; h.fails++;
  const before = h.openUntil;
  if (status === 401 || status === 402) { h.openUntil = Date.now() + 5 * 60_000; h.reason = 'upstream_auth'; }
  else if (h.fails >= 3) { h.openUntil = Date.now() + 30_000; h.reason = 'failures'; }
  health.set(id, h);
  if (h.openUntil > Date.now() && h.openUntil !== before) gatewayEvents.emit('route_open', { upstreamName, status, untilMs: h.openUntil });
}

export const routeSucceeded = (id: string) => { health.delete(id); };
export const clearRouteHealth = () => { health.clear(); };

export function routeCircuit(id: string): Circuit {
  const h = health.get(id);
  if (!h || h.openUntil <= Date.now()) return { open: false, openUntil: null, reason: null, failures: h?.fails ?? 0 };
  return { open: true, openUntil: new Date(h.openUntil).toISOString(), reason: h.reason, failures: h.fails };
}
