import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const webOrigin = `http://127.0.0.1:${Number(process.env.WEB_PORT ?? 5173)}`;
const cached = '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
export default defineConfig({
  testDir: './test/e2e', workers: 1, timeout: 30_000,
  use: { baseURL: webOrigin, headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(cached) ? cached : undefined) },
    trace: 'off', screenshot: 'off', video: 'off' },
  reporter: [['list'], ['json', { outputFile: 'evidence/browser-results.json' }]],
  webServer: { command: 'npm run dev', url: webOrigin, reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
