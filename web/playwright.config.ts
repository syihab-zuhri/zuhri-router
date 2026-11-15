import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const cached = '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
export default defineConfig({
  testDir: './test/e2e', workers: 1, timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(cached) ? cached : undefined) },
    trace: 'off', screenshot: 'off', video: 'off' },
  reporter: [['list'], ['json', { outputFile: 'evidence/browser-results.json' }]],
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
