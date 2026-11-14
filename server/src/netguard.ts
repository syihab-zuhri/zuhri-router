// CTL-017: an upstream base URL must be HTTPS and must not lead to this host, a private network or cloud metadata.
// The same check runs when the URL is saved and again when the gateway connects, because DNS answers can change.
import net from 'node:net';
import dns from 'node:dns/promises';
import { AppError } from './db/pool.ts';

export type Resolver = (host: string) => Promise<string[]>;
export const systemResolver: Resolver = async host => (await dns.lookup(host, { all: true, verbatim: true })).map(a => a.address);

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) blocked.addSubnet(a, p, 'ipv6');

export function isPublicAddress(ip: string): boolean {
  // IPv4-mapped IPv6 is judged by the IPv4 address it carries. (A mapped subnet in the BlockList would also match plain IPv4.)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicAddress(mapped[1]);
  if (/^::ffff:/i.test(ip)) return false;
  const v = net.isIP(ip);
  return v !== 0 && !blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}
const reject = (reason: string) => new AppError('base_url_rejected', `Base URL rejected: ${reason}`, 400);

/** Returns the normalised URL (origin + path, no trailing slash). Throws base_url_rejected otherwise. */
export async function assertSafeUpstreamUrl(input: unknown, resolve: Resolver): Promise<string> {
  if (typeof input !== 'string' || input.length > 300) throw reject('not a URL');
  let u: URL; try { u = new URL(input); } catch { throw reject('not a URL'); }
  if (u.protocol !== 'https:') throw reject('must use https');
  if (u.username || u.password) throw reject('must not contain credentials');
  if (u.search || u.hash) throw reject('must not contain a query or fragment');
  if (u.port && u.port !== '443') throw reject('only port 443 is allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) throw reject('must be a host name, not an IP address');
  if (!host.includes('.') || /\.(local|internal|localhost|lan|home|corp)$/i.test(host) || host.toLowerCase() === 'localhost') throw reject('must be a public host name');
  let addrs: string[]; try { addrs = await resolve(host); } catch { throw reject('host name does not resolve'); }
  if (!addrs.length || !addrs.every(isPublicAddress)) throw reject('host resolves to a non-public address');
  return u.origin + u.pathname.replace(/\/+$/, '');
}
