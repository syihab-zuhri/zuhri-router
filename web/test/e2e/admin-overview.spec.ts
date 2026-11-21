import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { errorText, m, ov } from '../../src/messages.ts';

const defaultGateway = {
  paused: false,
  reason: null,
  changedAt: null,
};

const sampleOverview = {
  generatedAt: '2026-11-16T14:30:00.000Z',
  customers: { ACTIVE: 12, SUSPENDED: 2, CLOSED: 1 },
  balances: {
    postedMicro: '15250000',
    heldMicro: '750000',
    positiveMicro: '15500000',
    negativeAccounts: 1,
    negativeMicro: '-250000',
  },
  activeVouchers: { count: 4, amountMicro: '40000000' },
  requests24h: { total: 19, failed: 2, estimated: 3, debitMicro: '1250000' },
  unresolved: { count: 2, heldMicro: '750000' },
  upstreams: { PENDING: 1, ELIGIBLE: 2, BLOCKED: 1 },
  gateway: defaultGateway,
};

const zeroOverview = {
  generatedAt: '2026-11-16T14:31:00.000Z',
  customers: { ACTIVE: 0, SUSPENDED: 0, CLOSED: 0 },
  balances: {
    postedMicro: '0',
    heldMicro: '0',
    positiveMicro: '0',
    negativeAccounts: 0,
    negativeMicro: '0',
  },
  activeVouchers: { count: 0, amountMicro: '0' },
  requests24h: { total: 0, failed: 0, estimated: 0, debitMicro: '0' },
  unresolved: { count: 0, heldMicro: '0' },
  upstreams: { PENDING: 0, ELIGIBLE: 0, BLOCKED: 0 },
  gateway: defaultGateway,
};

const hugeOverview = {
  generatedAt: '2026-11-16T14:32:00.000Z',
  customers: { ACTIVE: 3, SUSPENDED: 1, CLOSED: 0 },
  balances: {
    postedMicro: '9007199254740993000001',
    heldMicro: '9007199254740995000003',
    positiveMicro: '18014398509481987000003',
    negativeAccounts: 1,
    negativeMicro: '-9007199254740994000002',
  },
  activeVouchers: { count: 2, amountMicro: '9007199254740996000004' },
  requests24h: { total: 5, failed: 1, estimated: 1, debitMicro: '9007199254740997000005' },
  unresolved: { count: 1, heldMicro: '9007199254740998000006' },
  upstreams: { PENDING: 0, ELIGIBLE: 1, BLOCKED: 0 },
  gateway: defaultGateway,
};

type GatewayMockResponse = { status?: number; json: unknown };

async function setupAdminMocks(
  page: Page,
  overviewHandler: () => Promise<{ status?: number; json: unknown }>,
  options: {
    gatewayGet?: () => Promise<GatewayMockResponse>;
    gatewayPost?: (body: Record<string, unknown>, headers: Record<string, string>) => Promise<GatewayMockResponse>;
    secondFactor?: (body: Record<string, unknown>) => Promise<GatewayMockResponse>;
  } = {},
) {
  await page.route('**/admin/api/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/admin/api/packs') return route.fulfill({ json: { packs: [] } });
    if (path === '/admin/api/customers') return route.fulfill({ json: { customers: [], nextAfter: null } });
    if (path === '/admin/api/requests/unresolved') return route.fulfill({ json: { requests: [] } });
    if (path === '/admin/api/upstreams') return route.fulfill({ json: { upstreams: [] } });
    if (path === '/admin/api/models') return route.fulfill({ json: { models: [] } });
    if (path === '/admin/api/routes') return route.fulfill({ json: { routes: [] } });
    if (path === '/admin/api/settings/gateway') {
      if (req.method() === 'POST' && options.gatewayPost) {
        const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
        const res = await options.gatewayPost(body, req.headers());
        return route.fulfill({ status: res.status ?? 200, json: res.json });
      }
      if (options.gatewayGet) {
        const res = await options.gatewayGet();
        return route.fulfill({ status: res.status ?? 200, json: res.json });
      }
      return route.fulfill({ json: { ...defaultGateway, changedBy: null } });
    }
    if (path === '/admin/api/second-factor' && req.method() === 'POST' && options.secondFactor) {
      const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
      const res = await options.secondFactor(body);
      return route.fulfill({ status: res.status ?? 200, json: res.json });
    }
    if (path === '/admin/api/overview') {
      const res = await overviewHandler();
      return route.fulfill({ status: res.status ?? 200, json: res.json });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
}

test('rute /admin dan login admin menuju ringkasan operasi', async ({ page }) => {
  await setupAdminMocks(page, async () => ({ json: sampleOverview }));
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/ringkasan$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible({ timeout: 15_000 });
});

test('rute /admin membuka ringkasan operasi dengan metrik, penanda akun minus, dan tautan tujuan', async ({ page }) => {
  let calls = 0;
  await setupAdminMocks(page, async () => {
    calls++;
    if (calls === 1) return { json: sampleOverview };
    return {
      json: {
        ...sampleOverview,
        generatedAt: '2026-11-16T14:35:00.000Z',
        balances: { ...sampleOverview.balances, negativeAccounts: 0, negativeMicro: '0' },
      },
    };
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/ringkasan$/);
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();

  await expect(page.getByText(ov.costUnavailableNote)).toBeVisible();
  await expect(page.getByText(ov.generatedAt, { exact: false })).toBeVisible();
  const gatewayCard = page.getByRole('region', { name: ov.gatewaySection });
  await expect(gatewayCard).toBeVisible();
  await expect(gatewayCard.getByText(ov.gatewayRunning, { exact: true })).toBeVisible();
  await expect(gatewayCard.getByRole('button', { name: ov.pauseGateway, exact: true })).toBeVisible();
  await expect(gatewayCard.getByRole('switch')).toHaveCount(0);

  const customersCard = page.locator('section.metric', { hasText: ov.customersCard });
  await expect(customersCard).toContainText('12');
  await expect(customersCard).toContainText('2');
  await expect(customersCard).toContainText('1');

  const totalCard = page.locator('section.metric', { hasText: ov.totalBalanceCard });
  await expect(totalCard).toContainText('15,25');
  await expect(totalCard).toContainText('15,5');

  const heldCard = page.locator('section.metric', { hasText: ov.heldBalanceCard });
  await expect(heldCard).toContainText('0,75');

  const negativeCard = page.locator('section.metric', { hasText: ov.negativeAccountsCard });
  await expect(negativeCard).toHaveClass(/metric-warning/);
  await expect(negativeCard).toContainText(ov.negativeAccountsAttention);
  await expect(negativeCard).toContainText('1');
  await expect(negativeCard).toContainText('-0,25');

  const vouchersCard = page.locator('section.metric', { hasText: ov.activeVouchersCard });
  await expect(vouchersCard).toContainText('4');
  await expect(vouchersCard).toContainText('40');

  const reqCard = page.locator('section.metric', { hasText: ov.requests24hCard });
  await expect(reqCard).toContainText('1,25');
  await expect(reqCard).toContainText('19');
  await expect(reqCard).toContainText('2');
  await expect(reqCard).toContainText('3');

  const unresolvedCard = page.locator('section.metric', { hasText: ov.unresolvedCard });
  await expect(unresolvedCard).toContainText('2');
  await expect(unresolvedCard).toContainText('0,75');

  const upstreamsCard = page.locator('section.metric', { hasText: ov.upstreamsCard });
  await expect(upstreamsCard).toContainText(m.stateText.PENDING);
  await expect(upstreamsCard).toContainText(m.stateText.ELIGIBLE);
  await expect(upstreamsCard).toContainText(m.stateText.BLOCKED);

  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);

  // Muat ulang memperbarui data dan menghilangkan status peringatan bila akun minus = 0
  await page.getByRole('button', { name: m.refresh, exact: true }).click();
  await expect(negativeCard).not.toHaveClass(/metric-warning/);
  await expect(negativeCard).toContainText(ov.negativeAccountsNone);

  // Tautan menuju /admin/rekonsiliasi dan /admin/upstream bekerja
  await page.getByRole('link', { name: ov.openUnresolved, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/rekonsiliasi$/);
  await expect(page.getByRole('heading', { name: m.unresolved, exact: true })).toBeVisible();
  await expect(page.getByText(m.loading)).toHaveCount(0);

  await page.locator('aside.desktop-nav nav').getByRole('link', { name: ov.overview, exact: true }).click();
  await page.getByRole('link', { name: ov.openUpstreams, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/upstream$/);
  await expect(page.getByRole('heading', { name: m.upstreams, exact: true })).toBeVisible();
  await expect(page.getByText(m.loading)).toHaveCount(0);
});

test('ringkasan operasi menangani keadaan memuat, gagal dengan h1 tetap ada, dan nol', async ({ page }) => {
  let mode: 'delay' | 'error' | 'zero' = 'error';
  await setupAdminMocks(page, async () => {
    if (mode === 'error') return { status: 500, json: { error: { code: 'internal_error' } } };
    if (mode === 'delay') {
      await new Promise(resolve => setTimeout(resolve, 250));
      return { json: zeroOverview };
    }
    return { json: zeroOverview };
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/ringkasan');

  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(errorText.internal_error);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);

  mode = 'delay';
  await page.getByRole('button', { name: m.retry, exact: true }).click();
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();
  await expect(page.getByText(m.loading)).toBeVisible();

  await expect(page.getByText(ov.zeroOverviewNote)).toBeVisible();
  await expect(page.locator('section.metric.metric-warning')).toHaveCount(0);
  await expect(page.locator('section.metric', { hasText: ov.totalBalanceCard })).toContainText('0');
  await expect(page.locator('section.metric', { hasText: ov.negativeAccountsCard })).toContainText(ov.negativeAccountsNone);
});

test('ringkasan operasi memformat angka mikro-kredit di atas 2^53 secara eksak tanpa Number()', async ({ page }) => {
  await setupAdminMocks(page, async () => ({ json: hugeOverview }));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/ringkasan');
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();

  await expect(page.locator('section.metric', { hasText: ov.totalBalanceCard })).toContainText('9.007.199.254.740.993,000001');
  await expect(page.locator('section.metric', { hasText: ov.totalBalanceCard })).toContainText('18.014.398.509.481.987,000003');
  await expect(page.locator('section.metric', { hasText: ov.heldBalanceCard })).toContainText('9.007.199.254.740.995,000003');
  await expect(page.locator('section.metric', { hasText: ov.negativeAccountsCard })).toContainText('-9.007.199.254.740.994,000002');
  await expect(page.locator('section.metric', { hasText: ov.activeVouchersCard })).toContainText('9.007.199.254.740.996,000004');
  await expect(page.locator('section.metric', { hasText: ov.requests24hCard })).toContainText('9.007.199.254.740.997,000005');
  await expect(page.locator('section.metric', { hasText: ov.unresolvedCard })).toContainText('9.007.199.254.740.998,000006');
});

test('ringkasan operasi 360px tanpa gulir horizontal, dapat dipakai keyboard saja, dan menghormati reduced motion', async ({ page }) => {
  await setupAdminMocks(page, async () => ({ json: sampleOverview }));

  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/ringkasan');
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);

  const refreshBtn = page.getByRole('button', { name: m.refresh, exact: true });
  expect(await refreshBtn.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  const runningAnims = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);
  expect(runningAnims).toBe(0);

  // Navigasi keyboard murni ke tombol Muat ulang dan tautan Rekonsiliasi serta Upstream
  const visitedTargets: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const current = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return '';
      return `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim()}`;
    });
    visitedTargets.push(current);
    if (visitedTargets.includes(`button:${m.refresh}`) && visitedTargets.includes(`a:${ov.openUnresolved}`) && visitedTargets.includes(`a:${ov.openUpstreams}`)) {
      break;
    }
  }
  expect(visitedTargets).toContain(`button:${m.refresh}`);
  expect(visitedTargets).toContain(`a:${ov.openUnresolved}`);
  expect(visitedTargets).toContain(`a:${ov.openUpstreams}`);

  const unresolvedLink = page.getByRole('link', { name: ov.openUnresolved, exact: true });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await unresolvedLink.focus();
  await expect(unresolvedLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/rekonsiliasi$/);
  await expect(page.getByRole('heading', { name: m.unresolved, exact: true })).toBeVisible();
  await expect(page.getByText(m.loading)).toHaveCount(0);
});

test('ringkasan operasi menampilkan ErrorBox dengan judul tetap ada saat respons server tidak lengkap atau bertipe salah', async ({ page }) => {
  const { customers: _missingCustomers, ...withoutCustomers } = sampleOverview;
  const malformedPayloads: unknown[] = [
    withoutCustomers,
    {
      ...sampleOverview,
      balances: { ...sampleOverview.balances, negativeAccounts: '1' },
    },
    {
      ...sampleOverview,
      balances: { ...sampleOverview.balances, postedMicro: 15250000 },
    },
    {
      ...sampleOverview,
      generatedAt: 'bukan-tanggal',
    },
    sampleOverview,
  ];
  let callIndex = 0;

  await setupAdminMocks(page, async () => {
    const payload = malformedPayloads[Math.min(callIndex, malformedPayloads.length - 1)];
    callIndex += 1;
    return { json: payload };
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/ringkasan');

  for (let i = 0; i < malformedPayloads.length - 1; i += 1) {
    await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(m.failed);
    await expect(page.getByRole('region', { name: ov.customersCard })).toHaveCount(0);
    await page.getByRole('button', { name: m.retry, exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: ov.customersCard })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('jeda layanan menampilkan status dijeda (layanan-dijeda) dan lulus Axe + 360px', async ({ page }) => {
  const pausedState = {
    paused: true,
    reason: 'Pemeliharaan darurat gateway',
    changedAt: '2026-11-18T10:15:00.000Z',
    changedBy: 'founder',
  };
  await setupAdminMocks(
    page,
    async () => ({
      json: {
        ...sampleOverview,
        gateway: { paused: pausedState.paused, reason: pausedState.reason, changedAt: pausedState.changedAt },
      },
    }),
    { gatewayGet: async () => ({ json: pausedState }) },
  );

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/admin/ringkasan');

  const gatewayCard = page.getByRole('region', { name: ov.gatewaySection });
  await expect(gatewayCard).toHaveClass(/gateway-paused/);
  await expect(gatewayCard.getByText(ov.gatewayPaused, { exact: true })).toBeVisible();
  await expect(gatewayCard.getByRole('alert')).toContainText(ov.gatewayPausedBanner);
  await expect(gatewayCard).toContainText('Pemeliharaan darurat gateway');
  await expect(gatewayCard).toContainText('founder');
  await expect(gatewayCard.getByRole('button', { name: ov.resumeGateway, exact: true })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
});

test('jeda layanan menjeda & melanjutkan lewat konfirmasi, step-up, mengubah-flag, dan tanpa pembaruan optimistis', async ({ page }) => {
  let state: { paused: boolean; reason: string | null; changedAt: string | null; changedBy: string | null } = {
    paused: false,
    reason: null,
    changedAt: null,
    changedBy: null,
  };
  let stepUpFresh = false;
  let postCount = 0;

  await setupAdminMocks(
    page,
    async () => ({
      json: {
        ...sampleOverview,
        gateway: { paused: state.paused, reason: state.reason, changedAt: state.changedAt },
      },
    }),
    {
      gatewayGet: async () => ({ json: state }),
      secondFactor: async body => {
        if (body.code === '123456') {
          stepUpFresh = true;
          return { status: 200, json: { ok: true } };
        }
        return { status: 400, json: { error: { code: 'invalid_code' } } };
      },
      gatewayPost: async (body, headers) => {
        expect(headers['x-router-csrf']).toBe('1');
        postCount += 1;
        if (!stepUpFresh) {
          return { status: 401, json: { error: { code: 'step_up_required' } } };
        }
        await new Promise(resolve => setTimeout(resolve, 120));
        state = body.paused
          ? { paused: true, reason: String(body.reason), changedAt: '2026-11-18T11:00:00.000Z', changedBy: 'founder' }
          : { paused: false, reason: null, changedAt: '2026-11-18T11:05:00.000Z', changedBy: 'founder' };
        return { status: 200, json: state };
      },
    },
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/ringkasan');

  const gatewayCard = page.getByRole('region', { name: ov.gatewaySection });
  await expect(gatewayCard.getByText(ov.gatewayRunning, { exact: true })).toBeVisible();

  // Buka dialog konfirmasi jeda -> wajib alasan tidak boleh spasi saja
  await gatewayCard.getByRole('button', { name: ov.pauseGateway, exact: true }).click();
  const pauseDialog = page.getByRole('dialog', { name: ov.pauseDialogTitle });
  await expect(pauseDialog).toBeVisible();
  await expect(pauseDialog).toContainText(ov.pauseImpact);

  await pauseDialog.getByLabel(m.reason).fill('   ');
  await pauseDialog.getByRole('button', { name: ov.pauseGateway, exact: true }).click();
  await expect(pauseDialog.getByText(ov.pauseReasonInvalid)).toBeVisible();
  expect(postCount).toBe(0);

  // Isi alasan sah -> trigger step-up -> panel di latar tetap Berjalan (tidak optimistis)
  await pauseDialog.getByLabel(m.reason).fill('Insiden upstream utama');
  await pauseDialog.getByRole('button', { name: ov.pauseGateway, exact: true }).click();
  const stepUpDialog = page.getByRole('dialog', { name: m.stepUp });
  await expect(stepUpDialog).toBeVisible();
  await expect(gatewayCard.getByText(ov.gatewayRunning, { exact: true })).toBeVisible();
  await expect(gatewayCard.getByText(ov.gatewayPaused, { exact: true })).toHaveCount(0);

  // Masukkan kode TOTP -> tampil keadaan mengubah-flag -> berubah ke Dijeda setelah server konfirmasi
  await stepUpDialog.getByLabel(m.code).fill('123456');
  await stepUpDialog.getByRole('button', { name: m.verify, exact: true }).click();
  await expect(pauseDialog.getByText(ov.changingFlag)).toBeVisible();

  await expect(pauseDialog).toBeHidden();
  await expect(gatewayCard.getByText(ov.gatewayPaused, { exact: true })).toBeVisible();
  await expect(gatewayCard.getByText(ov.gatewayPausedConfirmed)).toBeVisible();
  await expect(gatewayCard).toContainText('Insiden upstream utama');
  await expect(gatewayCard).toContainText('founder');

  // Lanjutkan layanan juga butuh konfirmasi dan step-up, tanpa perubahan optimistis
  stepUpFresh = false;
  await gatewayCard.getByRole('button', { name: ov.resumeGateway, exact: true }).click();
  const resumeDialog = page.getByRole('dialog', { name: ov.resumeDialogTitle });
  await expect(resumeDialog).toBeVisible();
  await expect(resumeDialog).toContainText(ov.resumeImpact);
  await expect(resumeDialog).toContainText('Insiden upstream utama');

  await resumeDialog.getByRole('button', { name: ov.resumeGateway, exact: true }).click();
  await expect(page.getByRole('dialog', { name: m.stepUp })).toBeVisible();
  await expect(gatewayCard.getByText(ov.gatewayPaused, { exact: true })).toBeVisible();

  await page.getByRole('dialog', { name: m.stepUp }).getByLabel(m.code).fill('123456');
  await page.getByRole('dialog', { name: m.stepUp }).getByRole('button', { name: m.verify, exact: true }).click();

  await expect(resumeDialog).toBeHidden();
  await expect(gatewayCard.getByText(ov.gatewayRunning, { exact: true })).toBeVisible();
  await expect(gatewayCard.getByText(ov.gatewayResumedConfirmed)).toBeVisible();
  await expect(gatewayCard).toContainText('founder');
});

test('jeda layanan tidak mengubah status saat POST gagal dan menolak respons gateway cacat', async ({ page }) => {
  let rejectGatewayGet = true;
  await setupAdminMocks(
    page,
    async () => ({ json: sampleOverview }),
    {
      gatewayGet: async () => (rejectGatewayGet ? { json: { paused: 'ya', reason: null, changedAt: null, changedBy: null } } : { json: { ...defaultGateway, changedBy: null } }),
      gatewayPost: async () => ({ status: 500, json: { error: { code: 'internal_error' } } }),
    },
  );

  await page.goto('/admin/ringkasan');
  await expect(page.getByRole('heading', { name: ov.overviewTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(m.failed);

  rejectGatewayGet = false;
  await page.getByRole('button', { name: m.retry, exact: true }).click();
  const gatewayCard = page.getByRole('region', { name: ov.gatewaySection });
  await expect(gatewayCard.getByText(ov.gatewayRunning, { exact: true })).toBeVisible();

  await gatewayCard.getByRole('button', { name: ov.pauseGateway, exact: true }).click();
  const pauseDialog = page.getByRole('dialog', { name: ov.pauseDialogTitle });
  await pauseDialog.getByLabel(m.reason).fill('Gagal dari server');
  await pauseDialog.getByRole('button', { name: ov.pauseGateway, exact: true }).click();

  await expect(pauseDialog.getByRole('alert').last()).toContainText(errorText.internal_error);
  await expect(gatewayCard.getByText(ov.gatewayRunning, { exact: true })).toBeVisible();
});
