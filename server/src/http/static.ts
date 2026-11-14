// Serves the built web app from the same origin as the API (deploy without a separate web server).
// Files are listed once at start-up and looked up by exact URL path, so a request can never reach outside the folder.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };
const API_PREFIXES = ['/api/', '/admin/api/', '/v1/', '/healthz', '/readyz'];
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

export function registerStatic(app: FastifyInstance, distDir: string) {
  const root = fs.realpathSync(distDir);
  const files = new Map<string, { file: string; type: string }>();
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && TYPES[path.extname(e.name)]) files.set('/' + path.relative(root, p).split(path.sep).join('/'), { file: p, type: TYPES[path.extname(e.name)] }); } };
  walk(root);
  const index = files.get('/index.html');
  if (!index) throw new Error(`WEB_DIST has no index.html: ${distDir}`);
  const indexHtml = fs.readFileSync(index.file);

  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if ((req.method !== 'GET' && req.method !== 'HEAD') || API_PREFIXES.some(p => url === p || url.startsWith(p))) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    reply.header('x-frame-options', 'DENY').header('referrer-policy', 'no-referrer').header('content-security-policy', CSP);
    const hit = files.get(url);
    if (hit && url !== '/index.html') {
      // Vite puts a content hash in asset names, so those can be cached for good; everything else is revalidated.
      reply.header('cache-control', url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return reply.type(hit.type).send(fs.readFileSync(hit.file));
    }
    if (path.extname(url)) return reply.code(404).type('text/plain; charset=utf-8').send('Not found'); // a missing file is not the app shell
    return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml); // client-side route
  });
}
