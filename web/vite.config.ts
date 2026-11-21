import { defineConfig } from 'vite';
const target = process.env.ROUTER_API_TARGET ?? 'http://127.0.0.1:55480';
// Ports are overridable so two agents can work in separate folders on one machine without testing each other's server.
const webPort = Number(process.env.WEB_PORT ?? 5173);
const previewPort = Number(process.env.WEB_PREVIEW_PORT ?? 4173);
const url = new URL(target);
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('ROUTER_API_TARGET must be loopback HTTP');
export default defineConfig({
  server: { host: '127.0.0.1', port: webPort, strictPort: true,
    warmup: { clientFiles: ['./index.html', './src/main.tsx', './src/hooks.tsx', './src/app.tsx', './src/auth.tsx', './src/admin-*.tsx'] },
    proxy: { '/api/': { target, changeOrigin: true }, '/admin/api/': { target, changeOrigin: true } } },
  preview: { host: '127.0.0.1', port: previewPort, strictPort: true },
  build: { sourcemap: false },
});
