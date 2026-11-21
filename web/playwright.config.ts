import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const webOrigin = `http://127.0.0.1:${Number(process.env.WEB_PORT ?? 5173)}`;
const previewOrigin = `http://127.0.0.1:${Number(process.env.WEB_PREVIEW_PORT ?? 4173)}`;
const cached = '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const devOriginSpecs = [
  '**/admin.spec.ts',
  '**/admin-customers.spec.ts',
  '**/admin-operations.spec.ts',
  '**/guide.spec.ts',
  '**/portal.spec.ts',
  '**/upstreams.spec.ts',
];
const serverReady = (origin: string) => (process.env.CI ? { wait: { stdout: /Local:/ } } : { url: origin, reuseExistingServer: true });
export default defineConfig({
  testDir: './test/e2e', workers: 1, timeout: 30_000,
  use: { baseURL: webOrigin, headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(cached) ? cached : undefined) },
    trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'app-build', testIgnore: devOriginSpecs, use: { baseURL: previewOrigin } },
    { name: 'dev-harness', testMatch: devOriginSpecs, use: { baseURL: webOrigin } },
  ],
  reporter: [['list'], ['json', { outputFile: 'evidence/browser-results.json' }]],
  webServer: [
    { command: 'npm run build && npm run preview', ...serverReady(previewOrigin), timeout: 30_000 },
    { command: 'npm run dev', ...serverReady(webOrigin), timeout: 30_000 },
  ],
});
