import { test, expect } from '@playwright/test';
import { m } from '../../src/messages.ts';

test('aktivasi mengumumkan submitting sampai server menjawab', async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route('**/api/auth/activate', async route => {
    await responseGate;
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/aktivasi#token=activation-state-fixture');
  await page.getByLabel(m.username, { exact: true }).fill('state_customer');
  await page.getByLabel(m.newPassword, { exact: true }).fill('activation-password-fixture');
  await page.getByRole('button', { name: m.activate, exact: true }).focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('status')).toHaveText(m.saving);
    await expect(page.getByRole('button', { name: m.activate, exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText(m.activated, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    releaseResponse();
  }
  await expect(page.getByRole('status')).toHaveText(m.activated);
  await expect(page.getByText(m.saving, { exact: true })).toHaveCount(0);
});

test('pemulihan akses mengumumkan submitting pada permintaan dan penyelesaian reset', async ({ page }) => {
  const releases: (() => void)[] = [];
  for (const path of ['request', 'complete']) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    releases.push(release);
    await page.route(`**/api/auth/reset/${path}`, async route => {
      await gate;
      await route.fulfill({ json: { ok: true } });
    });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/lupa-password');
  await page.getByLabel(m.email, { exact: true }).fill('reset-state@example.test');
  await page.getByRole('button', { name: m.requestReset, exact: true }).focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('status')).toHaveText(m.saving);
    await expect(page.getByRole('button', { name: m.requestReset, exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText(m.resetSent, { exact: true })).toHaveCount(0);
  } finally {
    releases[0]();
  }
  await expect(page.getByRole('status')).toHaveText(m.resetSent);
  await page.goto('/atur-ulang#token=reset-state-fixture');
  await page.getByLabel(m.newPassword, { exact: true }).fill('reset-password-fixture');
  await page.getByRole('button', { name: m.reset, exact: true }).focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('status')).toHaveText(m.saving);
    await expect(page.getByRole('button', { name: m.reset, exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText(m.resetDone, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    releases[1]();
  }
  await expect(page.getByRole('status')).toHaveText(m.resetDone);
  await expect(page.getByText(m.saving, { exact: true })).toHaveCount(0);
});
