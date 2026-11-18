import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { am, m } from '../../src/messages.ts';

const CURRENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

test('akun pelanggan: ubah password, kelola sesi, dan uji negatif penutupan akun', async ({ page }) => {
  const consoleLines: string[] = [];
  page.on('console', msg => consoleLines.push(msg.text()));

  let meVersion = '1';
  let sessions = [
    { id: CURRENT_ID, createdAt: '2026-11-14T08:00:00.000Z', lastSeenAt: '2026-11-15T09:00:00.000Z' },
    { id: OTHER_ID, createdAt: '2026-11-13T08:00:00.000Z', lastSeenAt: '2026-11-14T10:00:00.000Z' },
  ];
  let passwordCalls = 0;
  let closeCalls = 0;

  await page.route('**/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;

    if (path === '/api/me') {
      return route.fulfill({ json: { username: 'pelanggan_uji', tenantStatus: 'ACTIVE', version: meVersion } });
    }
    if (path === '/api/balance') {
      return route.fulfill({ json: { currency: 'TOKEN', postedMicro: '5000000', heldMicro: '0', availableMicro: '5000000' } });
    }
    if (path === '/api/account/sessions') {
      return route.fulfill({ json: { current: CURRENT_ID, sessions } });
    }
    if (path === '/api/account/password') {
      expect(req.headers()['x-router-csrf']).toBe('1');
      passwordCalls++;
      const body = req.postDataJSON() as { current: string; next: string };
      if (body.current === 'password-lama-salah') {
        return route.fulfill({ status: 401, json: { error: { code: 'invalid_credentials' } } });
      }
      if (body.next === 'lemah-10ch') {
        return route.fulfill({ status: 400, json: { error: { code: 'weak_password' } } });
      }
      sessions = [sessions[0]];
      return route.fulfill({ json: { ok: true } });
    }
    if (path === `/api/account/sessions/${OTHER_ID}/revoke`) {
      expect(req.headers()['x-router-csrf']).toBe('1');
      if (sessions.length === 2) {
        sessions = [sessions[0]];
        return route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/account/close') {
      expect(req.headers()['x-router-csrf']).toBe('1');
      closeCalls++;
      const body = req.postDataJSON() as { currentPassword: string; confirmUsername: string; expectedVersion: string };
      if (body.confirmUsername !== 'pelanggan_uji') {
        return route.fulfill({ status: 400, json: { error: { code: 'invalid_request' } } });
      }
      if (body.expectedVersion === '1') {
        meVersion = '2';
        return route.fulfill({ status: 409, json: { error: { code: 'version_conflict' } } });
      }
      if (body.currentPassword !== 'password-baru-kuat-1') {
        return route.fulfill({ status: 401, json: { error: { code: 'invalid_credentials' } } });
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/beranda');
  await page.getByRole('button', { name: m.menu, exact: true }).click();
  await page.getByRole('dialog', { name: m.menu }).getByRole('link', { name: am.account, exact: true }).click();
  await expect(page).toHaveURL(/\/akun$/);
  await expect(page.getByRole('heading', { name: am.customerAccountTitle, exact: true })).toBeVisible();
  await expect(page.getByText('pelanggan_uji', { exact: true })).toBeVisible();
  await expect(page.getByText(am.currentSession, { exact: true })).toBeVisible();
  await expect(page.getByText(am.otherSession, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();

  // Password lama salah: tidak keluar ke /masuk, menampilkan pesan error
  const pwForm = page.locator('form').filter({ hasText: am.changePassword });
  await pwForm.getByLabel(am.currentPassword).fill('password-lama-salah');
  await pwForm.getByLabel(m.newPassword).fill('password-baru-kuat-1');
  await pwForm.getByRole('button', { name: am.changePassword }).click();
  await expect(page).toHaveURL(/\/akun$/);
  await expect(pwForm.getByRole('alert')).toContainText(am.wrongCurrentPassword);

  // Server menolak password lemah
  await pwForm.getByLabel(am.currentPassword).fill('password-benar-lama');
  await pwForm.getByLabel(m.newPassword).fill('lemah-10ch');
  await pwForm.getByRole('button', { name: am.changePassword }).click();
  await expect(pwForm.getByRole('alert')).toContainText(am.weakCustomerPassword);

  // Ubah password berhasil, sesi lain diperbarui dari server
  await pwForm.getByLabel(am.currentPassword).fill('password-benar-lama');
  await pwForm.getByLabel(m.newPassword).fill('password-baru-kuat-1');
  await pwForm.getByRole('button', { name: am.changePassword }).click();
  await expect(pwForm.getByRole('status')).toContainText(am.passwordChanged);
  await expect(page.getByText(am.otherSession, { exact: true })).toHaveCount(0);
  expect(passwordCalls).toBe(3);

  // Reset daftar sesi 2 baris untuk menguji penolakan server saat cabut sesi lain
  sessions = [
    { id: CURRENT_ID, createdAt: '2026-11-14T08:00:00.000Z', lastSeenAt: '2026-11-15T09:00:00.000Z' },
    { id: OTHER_ID, createdAt: '2026-11-13T08:00:00.000Z', lastSeenAt: '2026-11-14T10:00:00.000Z' },
  ];
  await page.getByRole('button', { name: m.refresh, exact: true }).click();
  const otherCard = page.locator('.data-row').filter({ hasText: OTHER_ID });
  await expect(otherCard).toBeVisible();
  await otherCard.getByRole('button', { name: am.revokeSession }).click();
  const revokeDialog = page.getByRole('dialog', { name: am.revokeOtherSessionTitle });
  await expect(revokeDialog.getByRole('button', { name: m.cancel })).toBeFocused();
  await revokeDialog.getByRole('button', { name: am.revokeSession }).click();
  // Percobaan pertama ditolak 500 oleh mock: dialog tetap terbuka menampilkan error
  await expect(revokeDialog.getByRole('alert')).toBeVisible();
  // Percobaan kedua berhasil
  await revokeDialog.getByRole('button', { name: am.revokeSession }).click();
  await expect(revokeDialog).toHaveCount(0);
  await expect(page.getByText(am.sessionRevoked)).toBeVisible();
  await expect(page.getByText(OTHER_ID)).toHaveCount(0);

  // Tutup akun: batal dengan Escape tidak mengirim POST
  const closeTrigger = page.getByRole('button', { name: am.closeAccount, exact: true });
  await closeTrigger.click();
  const closeDialog = page.getByRole('dialog', { name: am.closeAccountDialogTitle });
  await expect(closeDialog).toContainText(am.closeConsequenceKeys);
  await expect(closeDialog).toContainText(am.closeConsequenceAccess);
  await expect(closeDialog).toContainText(am.closeConsequenceBalance);
  await expect(closeDialog).toContainText('Sisa saldo token hangus dan tidak dapat dikembalikan atau diuangkan. Riwayat transaksi tetap tersimpan.');
  await expect(closeDialog.getByLabel(am.confirmUsername)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(closeDialog).toHaveCount(0);
  await expect(closeTrigger).toBeFocused();
  expect(closeCalls).toBe(0);

  // Buka lagi dialog tutup akun, uji konflik versi -> muat ulang -> password salah -> berhasil ke /masuk
  await closeTrigger.click();
  await closeDialog.getByLabel(am.confirmUsername).fill('pelanggan_uji');
  await closeDialog.getByLabel(am.currentPassword).fill('password-baru-kuat-1');
  await closeDialog.getByRole('button', { name: am.closeAccountConfirmAction }).click();
  await expect(closeDialog.getByRole('alert')).toContainText(m.stale);
  await closeDialog.getByRole('button', { name: am.reloadAccount }).click();
  await expect(closeDialog.getByText('2', { exact: true })).toBeVisible();

  await closeDialog.getByLabel(am.currentPassword).fill('salah');
  await closeDialog.getByRole('button', { name: am.closeAccountConfirmAction }).click();
  await expect(closeDialog.getByRole('alert')).toContainText(am.wrongCurrentPassword);
  await expect(page).toHaveURL(/\/akun$/);

  // Audit aksesibilitas saat dialog terbuka
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await closeDialog.getByLabel(am.currentPassword).fill('password-baru-kuat-1');
  await closeDialog.getByRole('button', { name: am.closeAccountConfirmAction }).click();
  await expect(page).toHaveURL(/\/masuk$/);

  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(consoleLines.join('\n')).not.toContain('password-baru-kuat-1');
});

test('cabut sesi saat ini mengarahkan ke masuk; loading/error, keyboard, 360px, reduced motion, dan axe', async ({ page }) => {
  let failSessions = true;
  let revokedCurrent = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') return route.fulfill({ json: { username: 'uji_keyboard', tenantStatus: 'SUSPENDED', version: '3' } });
    if (path === '/api/balance') return route.fulfill({ json: { currency: 'TOKEN', postedMicro: '0', heldMicro: '0', availableMicro: '0' } });
    if (path === '/api/account/sessions') {
      if (failSessions) return route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
      return route.fulfill({ json: { current: CURRENT_ID, sessions: [{ id: CURRENT_ID, createdAt: '2026-11-15T01:00:00.000Z', lastSeenAt: '2026-11-15T02:00:00.000Z' }] } });
    }
    if (path === `/api/account/sessions/${CURRENT_ID}/revoke`) {
      revokedCurrent = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });

  await page.setViewportSize({ width: 360, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/akun');
  await expect(page.getByRole('heading', { name: am.customerAccountTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Server belum dapat' })).toBeVisible();
  failSessions = false;
  await page.getByRole('button', { name: m.retry }).click();
  await expect(page.getByText(CURRENT_ID)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(await page.getByRole('button', { name: am.revokeSession }).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Alur keyboard saja: fokus tombol cabut sesi -> Enter -> Tab ke tombol cabut -> Enter -> keluar ke /masuk
  const revokeBtn = page.getByRole('button', { name: am.revokeSession });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await revokeBtn.focus();
  await expect(revokeBtn).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: am.revokeCurrentSessionTitle });
  await expect(dialog.getByRole('button', { name: m.cancel })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: am.revokeSession })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/masuk$/);
  expect(revokedCurrent).toBe(true);
});
