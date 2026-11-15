import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { am, m } from '../../src/messages.ts';

const SYNTHETIC_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SYNTHETIC_URI = `otpauth://totp/Router:founder?secret=${SYNTHETIC_SECRET}&issuer=Router&algorithm=SHA1&digits=6&period=30`;
const SYNTHETIC_CODES = Array.from({ length: 8 }, (_, idx) => `aaaa0000bbbb1111cc0${idx}`);

test('akun admin: ganti password dan ganti autentikator dengan step-up, uji negatif, dan pembuangan memori', async ({ page }) => {
  await page.addInitScript(() => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          if ((window as unknown as { __denyCopy?: boolean }).__denyCopy) throw new Error('denied');
          copied = text;
          (window as unknown as { __copiedText?: string }).__copiedText = copied;
        },
      },
    });
  });

  const consoleLines: string[] = [];
  page.on('console', msg => consoleLines.push(msg.text()));

  let stepUpNeeded = true;
  let pwCalls = 0;
  let startCalls = 0;
  let confirmCalls = 0;

  await page.route('**/admin/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;

    if (path === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/admin/api/audit') return route.fulfill({ json: { events: [] } });
    if (path === '/admin/api/second-factor') {
      expect(req.headers()['x-router-csrf']).toBe('1');
      const body = req.postDataJSON() as { code: string };
      if (body.code === '000000') return route.fulfill({ status: 401, json: { error: { code: 'invalid_code' } } });
      stepUpNeeded = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/admin/api/account/password') {
      expect(req.headers()['x-router-csrf']).toBe('1');
      pwCalls++;
      if (stepUpNeeded) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
      const body = req.postDataJSON() as { current: string; next: string };
      if (body.current === 'password-admin-salah') return route.fulfill({ status: 401, json: { error: { code: 'invalid_credentials' } } });
      if (body.next === 'lemah-14-karakter') return route.fulfill({ status: 400, json: { error: { code: 'weak_password' } } });
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/admin/api/account/authenticator/start') {
      expect(req.headers()['x-router-csrf']).toBe('1');
      startCalls++;
      if (stepUpNeeded) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
      return route.fulfill({ json: { secretBase32: SYNTHETIC_SECRET, otpauthUri: SYNTHETIC_URI } });
    }
    if (path === '/admin/api/account/authenticator/confirm') {
      expect(req.headers()['x-router-csrf']).toBe('1');
      confirmCalls++;
      if (stepUpNeeded) return route.fulfill({ status: 401, json: { error: { code: 'step_up_required' } } });
      const body = req.postDataJSON() as { code: string };
      if (body.code === '000000') return route.fulfill({ status: 401, json: { error: { code: 'invalid_code' } } });
      if (body.code === '999999') return route.fulfill({ status: 409, json: { error: { code: 'no_rotation' } } });
      return route.fulfill({ json: { recoveryCodes: SYNTHETIC_CODES } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });

  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto('/admin/audit');
  await page.getByRole('button', { name: m.menu, exact: true }).click();
  await page.getByRole('dialog', { name: m.menu }).getByRole('link', { name: am.account, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/akun$/);
  await expect(page.getByRole('heading', { name: am.adminAccountTitle, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // 1. Ganti password: step-up dibatalkan tidak mengirim ulang mutasi dan tidak membocorkan error
  const pwForm = page.locator('form').filter({ hasText: am.changePassword });
  await pwForm.getByLabel(am.currentPassword).fill('password-admin-salah');
  await pwForm.getByLabel(m.newPassword).fill('password-admin-baru-14');
  await pwForm.getByRole('button', { name: am.changePassword }).click();
  const stepUpDialog = page.getByRole('dialog', { name: m.stepUp });
  await expect(stepUpDialog).toBeVisible();
  await stepUpDialog.getByLabel(m.code).fill('000000');
  await stepUpDialog.getByRole('button', { name: m.verify }).click();
  await expect(stepUpDialog.getByRole('alert')).toBeVisible();
  await stepUpDialog.getByRole('button', { name: m.cancel }).click();
  await expect(stepUpDialog).toHaveCount(0);
  await expect(pwForm.getByRole('alert')).toHaveCount(0);
  expect(pwCalls).toBe(1);

  // Step-up berhasil -> server menolak password lama salah (tetap di halaman, tidak keluar)
  await pwForm.getByRole('button', { name: am.changePassword }).click();
  await stepUpDialog.getByLabel(m.code).fill('123456');
  await stepUpDialog.getByRole('button', { name: m.verify }).click();
  await expect(pwForm.getByRole('alert')).toContainText(am.wrongCurrentPassword);
  await expect(page).toHaveURL(/\/admin\/akun$/);

  // Server menolak weak_password
  await pwForm.getByLabel(am.currentPassword).fill('password-admin-benar');
  await pwForm.getByLabel(m.newPassword).fill('lemah-14-karakter');
  await pwForm.getByRole('button', { name: am.changePassword }).click();
  await expect(pwForm.getByRole('alert')).toContainText(am.weakAdminPassword);

  // Password admin berhasil diubah
  await pwForm.getByLabel(m.newPassword).fill('password-admin-baru-14');
  await pwForm.getByRole('button', { name: am.changePassword }).click();
  await expect(pwForm.getByRole('status')).toContainText(am.adminPasswordChanged);

  // 2. Ganti autentikator langkah 1: butuh step-up lagi
  stepUpNeeded = true;
  await page.getByRole('button', { name: am.startRotation }).click();
  await expect(stepUpDialog).toBeVisible();
  await stepUpDialog.getByLabel(m.code).fill('123456');
  await stepUpDialog.getByRole('button', { name: m.verify }).click();

  // Tampil QR SVG lokal + kunci dalam kelompok 4 karakter; tidak ada tautan otpauth://
  await expect(page.locator('.qr-svg')).toBeVisible();
  await expect(page.locator('a[href^="otpauth:"]')).toHaveCount(0);
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Uji salin sukses dan salin ditolak browser
  await page.getByRole('button', { name: am.copyKey }).click();
  await expect(page.getByText(m.copied)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __copiedText?: string }).__copiedText)).toBe(SYNTHETIC_SECRET);
  await page.evaluate(() => { (window as unknown as { __denyCopy?: boolean }).__denyCopy = true; });
  await page.getByRole('button', { name: am.copyKey }).click();
  await expect(page.getByText(m.copyFailed)).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __denyCopy?: boolean }).__denyCopy = false; });

  // Uji meninggalkan layar membuang kunci dari memori komponen
  await page.getByRole('button', { name: m.menu, exact: true }).click();
  await page.getByRole('dialog', { name: m.menu }).getByRole('link', { name: m.audit, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await page.getByRole('button', { name: m.menu, exact: true }).click();
  await page.getByRole('dialog', { name: m.menu }).getByRole('link', { name: am.account, exact: true }).click();
  await expect(page.getByText('JBSW Y3DP')).toHaveCount(0);

  // Mulai lagi lalu uji kode salah dan no_rotation
  await page.getByRole('button', { name: am.startRotation }).click();
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();

  await page.getByLabel(am.newAuthenticatorCode).fill('000000');
  await page.getByRole('button', { name: am.confirmRotation }).click();
  await expect(page.getByRole('alert')).toContainText(am.invalidNewTotpCode);
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();

  await page.getByLabel(am.newAuthenticatorCode).fill('999999');
  await page.getByRole('button', { name: am.confirmRotation }).click();
  await expect(page.getByRole('alert')).toContainText(am.noRotationActive);
  await expect(page.getByRole('button', { name: am.startRotation })).toBeVisible();

  // Mulai lagi, konfirmasi sukses (memicu CMP-022 kode pemulihan tampil sekali)
  await page.getByRole('button', { name: am.startRotation }).click();
  await page.getByLabel(am.newAuthenticatorCode).fill('654321');
  await page.getByRole('button', { name: am.confirmRotation }).click();

  const recoveryModal = page.getByRole('dialog', { name: am.recoveryCodesTitle });
  await expect(recoveryModal).toBeVisible();
  await expect(recoveryModal).toContainText(am.recoveryCodesWarning);
  for (const code of SYNTHETIC_CODES) await expect(recoveryModal).toContainText(code);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await recoveryModal.getByRole('button', { name: am.copyRecoveryCodes }).click();
  await expect(recoveryModal.getByText(m.copied)).toBeVisible();

  // Tekan Escape meminta konfirmasi sebelum membuang kode pemulihan
  await page.keyboard.press('Escape');
  await expect(recoveryModal.getByText(am.discardRecoveryCodes)).toBeVisible();
  await recoveryModal.getByRole('button', { name: m.cancel }).click();
  await expect(recoveryModal.getByText(am.discardRecoveryCodes)).toHaveCount(0);

  await recoveryModal.getByRole('button', { name: m.copiedDone }).click();
  await expect(recoveryModal).toHaveCount(0);
  await expect(page.getByText(SYNTHETIC_CODES[0])).toHaveCount(0);
  await expect(page.getByText(am.rotationDoneAlert)).toBeVisible();

  // Pastikan secret/password/kode pemulihan tidak bocor ke URL, storage, atau console
  expect(page.url()).not.toContain(SYNTHETIC_SECRET);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  const logs = consoleLines.join('\n');
  expect(logs).not.toContain(SYNTHETIC_SECRET);
  expect(logs).not.toContain(SYNTHETIC_CODES[0]);
  expect(logs).not.toContain('password-admin-baru-14');
  expect(startCalls).toBe(4);
  expect(confirmCalls).toBe(3);
});

test('akun admin: keyboard, reduced motion, dan 360px tanpa gulir horizontal', async ({ page }) => {
  await page.route('**/admin/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/admin/api/account/authenticator/start') {
      return route.fulfill({ json: { secretBase32: SYNTHETIC_SECRET, otpauthUri: SYNTHETIC_URI } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });

  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/akun');
  await expect(page.getByRole('heading', { name: am.adminAccountTitle, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();

  const startBtn = page.getByRole('button', { name: am.startRotation });
  expect(await startBtn.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await startBtn.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
