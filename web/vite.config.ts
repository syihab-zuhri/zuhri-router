import { defineConfig } from 'vite';
const target = process.env.ROUTER_API_TARGET ?? 'http://127.0.0.1:55480';
const url = new URL(target);
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('ROUTER_API_TARGET must be loopback HTTP');
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api/': { target, changeOrigin: true }, '/admin/api/': { target, changeOrigin: true } } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { sourcemap: false },
});
