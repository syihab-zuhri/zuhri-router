import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createPool, withTx } from '../../server/src/db/pool.ts';
import { migrate } from '../../server/src/db/migrate.ts';
import { buildApp } from '../../server/src/http/app.ts';
import { bootstrapAdmin } from '../../server/src/admin.ts';
import { activateInvite, changeTenantStatus, createInvite, requestPasswordReset } from '../../server/src/identity.ts';
import * as ledger from '../../server/src/ledger.ts';
import * as pricing from '../../server/src/pricing.ts';
import * as upstreams from '../../server/src/upstreams.ts';
import * as vouchers from '../../server/src/vouchers.ts';
import { totpAt, totpStep } from '../../server/src/crypto.ts';
import { DB_URL } from '../../server/test/helpers.ts';

const apiPort = Number(process.env.VERIFY_API_PORT ?? 55491);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 5185);
const webBase = `http://127.0.0.1:${webPort}`;
const schema = `web_audit_${randomUUID().replaceAll('-', '')}`;
const key = randomBytes(32);
const mail = { invites: [], resets: [] };
const mailer = {
  invite: async (to, token) => { mail.invites.push({ to, token }); },
  passwordReset: async (to, token) => { mail.resets.push({ to, token }); },
};

const offlinePublicResolver = async () => ['93.184.216.34'];
const adminUsername = 'audit_admin';
const adminPassword = 'audit-admin-password-14';
const custUsername = 'audit_user';
const custPassword = 'audit-customer-password-1';
const suspendedUsername = 'audit_suspended';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const evidenceJsonPath = new URL('../evidence/antigravity-audit.json', import.meta.url);
const evidenceTxtPath = new URL('../evidence/antigravity-audit.txt', import.meta.url);

function base32Decode(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of value) {
    const idx = alphabet.indexOf(char);
    if (idx < 0) throw new Error(`Karakter base32 tidak valid: ${char}`);
    buffer = (buffer << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

async function waitFor(url) {
  let last;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(`Server tidak siap: ${url} ${last instanceof Error ? last.message : ''}`);
}

async function safeTotpStep() {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 4_500) await delay(remaining + 300);
  return totpStep(Date.now());
}

async function waitSettled(page) {
  await page.waitForFunction(
    () => (document.getElementById('root')?.childElementCount ?? 0) > 0 && !document.querySelector('[role="status"][aria-busy="true"]'),
    { timeout: 15_000 },
  );
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function ownerAndFile(screen) {
  if (screen.startsWith('/akun')) return { owner: 'Antigravity', file: 'web/src/account-customer.tsx' };
  if (screen.startsWith('/admin/akun')) return { owner: 'Antigravity', file: 'web/src/account-admin.tsx' };
  if (screen.startsWith('/admin/pelanggan')) return { owner: 'Hermes', file: 'web/src/admin-customers.tsx' };
  if (screen.startsWith('/admin/paket')) return { owner: 'Hermes', file: 'web/src/admin-packs.tsx' };
  if (screen.startsWith('/admin/kode')) return { owner: 'Hermes', file: 'web/src/admin-vouchers.tsx' };
  if (screen.startsWith('/admin/harga')) return { owner: 'Hermes', file: 'web/src/admin-models.tsx' };
  if (screen.startsWith('/admin/upstream')) return { owner: 'Hermes', file: 'web/src/admin-upstreams.tsx' };
  if (['/admin/rekonsiliasi', '/admin/batas-lebih-pakai', '/admin/audit'].some(p => screen.startsWith(p))) {
    return { owner: 'Hermes', file: 'web/src/admin-operations.tsx' };
  }
  if (['/masuk', '/admin/masuk', '/aktivasi', '/atur-ulang', '/lupa-password'].some(p => screen.startsWith(p))) {
    return { owner: 'Hermes', file: 'web/src/auth.tsx' };
  }
  if (['/beranda', '/isi-saldo', '/api-key', '/transaksi'].some(p => screen.startsWith(p))) {
    return { owner: 'Hermes', file: 'web/src/customer.tsx' };
  }
  if (screen.startsWith('/model-harga')) return { owner: 'Hermes', file: 'web/src/catalogue.tsx' };
  if (screen.startsWith('/pemakaian')) return { owner: 'Hermes', file: 'web/src/usage.tsx' };
  if (screen.startsWith('/panduan')) return { owner: 'Hermes', file: 'web/src/guide.tsx' };
  return { owner: 'Hermes', file: 'web/src/app.tsx' };
}

const findings = [];
const auditedScreens = [];

function recordFinding({ screen, width, problem, wcag, repro, file, owner, fixSuggestion, details }) {
  findings.push({ screen, width, problem, wcag, repro, file, owner, fixSuggestion, details });
}

async function auditAxeAndLayout(page, screen, width) {
  const { owner, file } = ownerAndFile(screen);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  for (const v of axe.violations) {
    const wcagTags = v.tags.filter(t => /^wcag/.test(t)).join(', ');
    const targets = v.nodes.slice(0, 3).map(n => n.target.join(' ')).join('; ');
    recordFinding({
      screen,
      width,
      problem: `Axe [${v.impact ?? 'unknown'}]: ${v.id} — ${v.help} (${targets})`,
      wcag: wcagTags || v.id,
      repro: `Buka ${screen} pada lebar ${width}px dan jalankan axe-core tag WCAG 2.0–2.2 AA.`,
      file,
      owner,
      fixSuggestion: v.nodes[0]?.failureSummary ?? v.help,
      details: { rule: v.id, impact: v.impact, nodesCount: v.nodes.length, targets },
    });
  }

  const overflow = await page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const innerWidth = window.innerWidth;
    const offenders = [];
    if (scrollWidth > innerWidth) {
      for (const el of document.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= innerWidth + 1) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : '',
          right: Math.round(rect.right),
        });
        if (offenders.length >= 5) break;
      }
    }
    const containerOverflows = [];
    for (const box of document.querySelectorAll('.panel, .data-row, .receipt, .metric')) {
      const bcs = getComputedStyle(box);
      if (bcs.display === 'none' || bcs.visibility === 'hidden') continue;
      if (box.scrollWidth > box.clientWidth + 1) {
        containerOverflows.push({
          tag: box.tagName.toLowerCase(),
          cls: typeof box.className === 'string' ? box.className : '',
          scrollWidth: box.scrollWidth,
          clientWidth: box.clientWidth,
        });
        if (containerOverflows.length >= 5) break;
      }
    }
    return { docOverflow: scrollWidth > innerWidth, scrollWidth, innerWidth, offenders, containerOverflows };
  });
  if (overflow.docOverflow) {
    recordFinding({
      screen,
      width,
      problem: `Terdapat gulir horizontal (scrollWidth ${overflow.scrollWidth}px > innerWidth ${overflow.innerWidth}px).`,
      wcag: 'wcag21aa (1.4.10 Reflow)',
      repro: `Buka ${screen} pada viewport ${width}px lalu periksa document.documentElement.scrollWidth > window.innerWidth.`,
      file,
      owner,
      fixSuggestion: 'Tambahkan min-width: 0, flex-wrap / overflow-wrap: anywhere, atau bungkus elemen yang melebar.',
      details: overflow,
    });
  }
  if (overflow.containerOverflows.length > 0) {
    const sample = overflow.containerOverflows[0];
    recordFinding({
      screen,
      width,
      problem: `Konten melebihi lebar kotak kontainer (${sample.cls || sample.tag}: scrollWidth ${sample.scrollWidth}px > clientWidth ${sample.clientWidth}px).`,
      wcag: 'wcag21aa (1.4.10 Reflow)',
      repro: `Buka ${screen} pada viewport ${width}px lalu periksa elemen berlebih di dalam ${sample.cls || sample.tag}.`,
      file,
      owner,
      fixSuggestion: 'Gunakan tata letak wrap/stack pada viewport sempit atau longgarkan minmax kolom grid agar muat di dalam padding panel.',
      details: overflow.containerOverflows,
    });
  }
}

async function auditHeadingAndRouteFocus(page, screen, width, viaRouteTransition) {
  const { owner, file } = ownerAndFile(screen);
  const headingState = await page.evaluate(() => {
    const h1s = [...document.querySelectorAll('h1')].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    const h1 = h1s[0] ?? null;
    const active = document.activeElement;
    const main = document.querySelector('main');
    const inContent = active ? (active === h1 || (main ? main.contains(active) : false)) : false;
    return {
      h1Count: h1s.length,
      h1Text: h1?.textContent?.trim() ?? '',
      h1TabIndex: h1?.getAttribute('tabindex') ?? null,
      activeTag: active?.tagName?.toLowerCase() ?? 'none',
      activeText: active?.textContent?.trim().slice(0, 60) ?? '',
      inContent,
    };
  });

  if (headingState.h1Count !== 1 || !headingState.h1Text) {
    recordFinding({
      screen,
      width,
      problem: `Struktur h1 tidak valid (ditemukan ${headingState.h1Count} h1 terlihat, teks: "${headingState.h1Text}").`,
      wcag: 'wcag2a (1.3.1 Info and Relationships / 2.4.6 Headings)',
      repro: `Buka ${screen} pada viewport ${width}px dan periksa jumlah <h1>.`,
      file,
      owner,
      fixSuggestion: 'Pastikan halaman selalu merender tepat satu <h1> melalui PageTitle.',
      details: headingState,
    });
  }
  if (viaRouteTransition && !headingState.inContent) {
    recordFinding({
      screen,
      width,
      problem: `Saat pindah rute ke ${screen}, fokus tidak berpindah ke h1/konten melainkan tertinggal di <${headingState.activeTag}> ("${headingState.activeText}").`,
      wcag: 'wcag2a (2.4.3 Focus Order)',
      repro: `Navigasi ke ${screen} melalui menu/sidebar pada lebar ${width}px tanpa reload penuh.`,
      file: owner === 'Antigravity' ? file : 'web/src/app.tsx',
      owner,
      fixSuggestion: 'Pastikan h1 langsung terpasang atau RouteFocus menunggu h1 selesai dimuat (dan tidak kalah oleh cleanup Modal menu mobile).',
      details: headingState,
    });
  }
}

async function auditTabAndFocusVisibility(page, screen, width) {
  const { owner, file } = ownerAndFile(screen);

  const prep = await page.evaluate(() => {
    const isActuallyVisible = el => {
      if (el.getClientRects().length === 0) return false;
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const cs = getComputedStyle(cur);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (cur.hasAttribute('inert') || cur.getAttribute('aria-hidden') === 'true' || cur.hasAttribute('hidden')) return false;
        if (cur.tagName === 'DETAILS' && !cur.hasAttribute('open')) {
          const directSummary = cur.querySelector(':scope > summary');
          if (el !== directSummary) return false;
        }
        cur = cur.parentElement;
      }
      return true;
    };

    const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    const raw = [...document.querySelectorAll(selector)].filter(el => !el.disabled && el.tabIndex >= 0 && isActuallyVisible(el));
    const seenRadioNames = new Set();
    const targets = [];
    for (const el of raw) {
      if (el.tagName === 'INPUT' && el.type === 'radio' && el.name) {
        if (seenRadioNames.has(el.name)) continue;
        seenRadioNames.add(el.name);
      }
      targets.push(el);
    }

    const startAnchor = document.createElement('span');
    startAnchor.tabIndex = -1;
    startAnchor.dataset.auditAnchor = '1';
    document.body.prepend(startAnchor);
    startAnchor.focus({ preventScroll: true });

    window.__auditTabTargets = targets;
    window.__auditVisited = new Set();
    return targets.map(el => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('id') || '').trim().slice(0, 50),
    }));
  });

  const invisibleFocuses = [];
  const clippedFocuses = [];
  let nonDocumentSteps = 0;
  let lastIdx = -1;
  let sameIdxCount = 0;
  let maxIdx = -1;

  for (let step = 0; step < prep.length * 6 + 32; step++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { active: false };
      const idx = window.__auditTabTargets.indexOf(el);
      const alreadyVisited = idx >= 0 && window.__auditVisited.has(idx);
      if (idx >= 0) window.__auditVisited.add(idx);

      const cs = getComputedStyle(el);
      const outlineVisible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && cs.outlineColor !== 'rgba(0, 0, 0, 0)' && cs.outlineColor !== 'transparent';
      const boxShadowVisible = cs.boxShadow !== 'none';
      const r = el.getBoundingClientRect();
      const inViewport = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      return {
        active: true,
        idx,
        alreadyVisited,
        tag: el.tagName.toLowerCase(),
        inputType: el instanceof HTMLInputElement ? el.type : null,
        matchesFocusVisible: el.matches(':focus-visible'),
        matchesFocusWithin: el.matches(':focus-within'),
        text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('id') || '').trim().slice(0, 50),
        outlineVisible,
        boxShadowVisible,
        inViewport,
        outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
      };
    });

    if (!info.active) {
      nonDocumentSteps++;
      lastIdx = -1;
      sameIdxCount = 0;
      if (nonDocumentSteps > 1) break;
      continue;
    }

    if (info.idx === lastIdx) {
      sameIdxCount++;
    } else {
      sameIdxCount = 0;
    }

    const isShadowDatePickerStop =
      info.alreadyVisited &&
      info.idx === lastIdx &&
      info.tag === 'input' &&
      (info.inputType === 'date' || info.inputType === 'datetime-local' || info.inputType === 'time');

    if (!info.outlineVisible && !info.boxShadowVisible && !isShadowDatePickerStop) {
      invisibleFocuses.push({ ...info, isShadowDatePickerStop });
    }
    if (!info.inViewport) {
      clippedFocuses.push(info);
    }
    if (info.idx > maxIdx) maxIdx = info.idx;
    const allDone = await page.evaluate(() => window.__auditVisited.size === window.__auditTabTargets.length);
    if (allDone) break;
    if (sameIdxCount > 15) break;
    if (nonDocumentSteps > 0 && info.alreadyVisited && info.idx < maxIdx) break;
    lastIdx = info.idx;
  }

  const unreachable = await page.evaluate(() => {
    document.querySelector('[data-audit-anchor="1"]')?.remove();
    const out = [];
    window.__auditTabTargets.forEach((el, i) => {
      if (!window.__auditVisited.has(i)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('id') || '').trim().slice(0, 60),
        });
      }
    });
    delete window.__auditTabTargets;
    delete window.__auditVisited;
    return out;
  });

  if (unreachable.length > 0) {
    recordFinding({
      screen,
      width,
      problem: `${unreachable.length} elemen interaktif tidak tercapai lewat Tab (${unreachable.map(u => `${u.tag}:"${u.text}"`).slice(0, 3).join(', ')}).`,
      wcag: 'wcag2a (2.1.1 Keyboard)',
      repro: `Buka ${screen} pada lebar ${width}px lalu tekan Tab berulang kali menelusuri seluruh halaman.`,
      file,
      owner,
      fixSuggestion: 'Pastikan semua kontrol memakai elemen interaktif standar (<button>/<a>/<input>/<summary>) dan tabIndex >= 0.',
      details: unreachable,
    });
  }
  if (invisibleFocuses.length > 0) {
    recordFinding({
      screen,
      width,
      problem: `Indikator fokus tidak terlihat pada ${invisibleFocuses.length} elemen saat Tab (${invisibleFocuses.map(f => `${f.tag}:"${f.text}"`).slice(0, 3).join(', ')}).`,
      wcag: 'wcag2aa (2.4.7 Focus Visible)',
      repro: `Buka ${screen} pada lebar ${width}px dan tekan Tab ke elemen tersebut.`,
      file,
      owner,
      fixSuggestion: 'Pastikan aturan :focus-visible memberikan outline kontras yang tidak tertutup.',
      details: invisibleFocuses,
    });
  }
  if (clippedFocuses.length > 0) {
    recordFinding({
      screen,
      width,
      problem: `${clippedFocuses.length} elemen fokus berada di luar area pandang (${clippedFocuses.map(f => `${f.tag}:"${f.text}"`).slice(0, 3).join(', ')}).`,
      wcag: 'wcag22aa (2.4.11 Focus Not Obscured)',
      repro: `Buka ${screen} pada lebar ${width}px dan telusuri elemen dengan Tab.`,
      file,
      owner,
      fixSuggestion: 'Pastikan elemen terfokus menggulir ke viewport dan tidak tertutup header/container tetap.',
      details: clippedFocuses,
    });
  }
}

async function auditReducedMotion(page, screen, width) {
  const { owner, file } = ownerAndFile(screen);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await delay(250);
  await page.keyboard.press('Tab');
  const motion = await page.evaluate(() => {
    const activeProps = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const hasTrans = cs.transitionDuration.split(',').some(v => parseFloat(v) > 0);
      const hasAnim = cs.animationDuration.split(',').some(v => parseFloat(v) > 0);
      if (hasTrans || hasAnim) {
        activeProps.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : '',
          transitionDuration: cs.transitionDuration,
          animationDuration: cs.animationDuration,
        });
        if (activeProps.length >= 5) break;
      }
    }
    const runningAnims = document
      .getAnimations()
      .filter(a => a.playState === 'running')
      .map(a => ({
        id: a.id,
        animationName: 'animationName' in a ? a.animationName : null,
        transitionProperty: 'transitionProperty' in a ? a.transitionProperty : null,
        targetTag: a.effect && 'target' in a.effect && a.effect.target instanceof Element ? a.effect.target.tagName.toLowerCase() : null,
        targetText: a.effect && 'target' in a.effect && a.effect.target instanceof Element ? (a.effect.target.textContent ?? '').trim().slice(0, 40) : null,
      }));
    return { activeProps, running: runningAnims.length, runningAnims };
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  if (motion.activeProps.length > 0 || motion.running > 0) {
    recordFinding({
      screen,
      width,
      problem: `Animasi atau transisi masih aktif saat prefers-reduced-motion: reduce (running=${motion.running}, non-zero=${motion.activeProps.length}).`,
      wcag: 'wcag21aa (2.3.3 Animation from Interactions)',
      repro: `Aktifkan prefers-reduced-motion: reduce pada ${screen} lebar ${width}px.`,
      file,
      owner,
      fixSuggestion: 'Hormati media query @media (prefers-reduced-motion: reduce) tanpa override durasi.',
      details: motion,
    });
  }
}

async function auditScreen({ page, screen, width, viaRouteTransition = false, emptyData = false }) {
  await waitSettled(page);
  auditedScreens.push({ screen, width, emptyData });
  await auditAxeAndLayout(page, screen, width);
  await auditHeadingAndRouteFocus(page, screen, width, viaRouteTransition);
  await auditTabAndFocusVisibility(page, screen, width);
  await auditReducedMotion(page, screen, width);
}

async function navigateShell(page, path, width) {
  if (width < 1024) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await drawer.waitFor({ state: 'visible', timeout: 5_000 });
    await drawer.locator(`nav a[href="${path}"]`).click();
  } else {
    await page.locator(`aside.desktop-nav nav a[href="${path}"]`).click();
  }
  await page.waitForFunction(expected => location.pathname === expected, path, { timeout: 5_000 });
  await waitSettled(page);
}

async function auditDialogBehavior({ page, screen, width, name, open, triggerLocator, runAxe = true }) {
  const { owner, file } = ownerAndFile(screen);
  await triggerLocator.scrollIntoViewIfNeeded().catch(() => {});
  await open();
  const dialog = page.locator('dialog[open]').last();
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });

  const insideFocus = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    return Boolean(dlg && document.activeElement && dlg.contains(document.activeElement));
  });
  if (!insideFocus) {
    recordFinding({
      screen,
      width,
      problem: `Dialog "${name}" terbuka tanpa memindahkan fokus keyboard ke dalam dialog.`,
      wcag: 'wcag2a (2.4.3 Focus Order)',
      repro: `Buka dialog "${name}" di ${screen} pada lebar ${width}px lalu periksa document.activeElement.`,
      file,
      owner,
      fixSuggestion: 'Pindahkan fokus ke kontrol utama/aman di dalam dialog saat showModal().',
      details: { dialog: name },
    });
  }

  if (runAxe) {
    await auditAxeAndLayout(page, `${screen} [dialog: ${name}]`, width);
  }

  await page.keyboard.press('Escape');
  await delay(100);
  const escapeState = await page.evaluate(() => ({
    openDialogs: document.querySelectorAll('dialog[open]').length,
    activeTag: document.activeElement?.tagName?.toLowerCase() ?? 'none',
    activeText: document.activeElement?.textContent?.trim().slice(0, 60) ?? '',
  }));

  if (escapeState.openDialogs > 0) {
    recordFinding({
      screen,
      width,
      problem: `Dialog "${name}" tidak tertutup saat tombol Escape ditekan.`,
      wcag: 'wcag2a (2.1.1 / 2.1.2 No Keyboard Trap)',
      repro: `Buka dialog "${name}" di ${screen} pada lebar ${width}px lalu tekan Escape.`,
      file,
      owner,
      fixSuggestion: 'Tangani onCancel / Escape pada Modal agar menutup dialog ketika tidak sedang busy.',
      details: { dialog: name, ...escapeState },
    });
    return;
  }

  const returnedToTrigger = await triggerLocator.evaluate(el => el === document.activeElement).catch(() => false);
  if (!returnedToTrigger) {
    recordFinding({
      screen,
      width,
      problem: `Setelah dialog "${name}" ditutup dengan Escape, fokus tidak kembali ke tombol pembuka (fokus jatuh ke <${escapeState.activeTag}> "${escapeState.activeText}").`,
      wcag: 'wcag2a (2.4.3 Focus Order)',
      repro: `Pada ${screen} (${width}px), klik pemicu untuk membuka dialog "${name}" lalu tekan Escape.`,
      file: owner === 'Antigravity' ? file : 'web/src/hooks.tsx',
      owner,
      fixSuggestion: 'Pastikan Modal hanya dibuka dari elemen yang masih terpasang atau kembalikan fokus secara eksplisit saat dialog ditutup.',
      details: { dialog: name, ...escapeState },
    });
  }
}

const databaseUrl = new URL(DB_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname));
assert.ok(databaseUrl.pathname === '/router_test_antigravity' || databaseUrl.pathname === '/router_test');

const root = createPool(databaseUrl.href);
let db;
let app;
let vite;
let browser;

try {
  await root.query(`create schema "${schema}"`);
  databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
  db = createPool(databaseUrl.href);
  await migrate(db);

  // ---- Seed data lewat fungsi server (tanpa jaringan eksternal) ----
  const admin = await bootstrapAdmin(db, key, {
    username: adminUsername,
    email: 'audit-admin@example.test',
    password: adminPassword,
  });
  const seed = base32Decode(admin.totpSecretBase32);

  await createInvite(db, { email: 'audit-user@example.test', adminUser: admin.userId }, mailer);
  const cust1 = await activateInvite(db, { token: mail.invites[0].token, username: custUsername, password: custPassword });

  await createInvite(db, { email: 'audit-suspended@example.test', adminUser: admin.userId }, mailer);
  await activateInvite(db, { token: mail.invites[1].token, username: suspendedUsername, password: custPassword });
  await changeTenantStatus(db, { username: suspendedUsername, to: 'SUSPENDED', expectedVersion: '1', reason: 'Audit status ditangguhkan', actorUser: admin.userId });

  await createInvite(db, { email: 'audit-pending@example.test', adminUser: admin.userId }, mailer);
  const activateToken = mail.invites[2].token;
  await requestPasswordReset(db, { email: 'audit-user@example.test', ip: '127.0.0.1' }, mailer);
  const resetToken = mail.resets[0].token;

  await withTx(db, tx => ledger.grantAdminTopup(tx, {
    tenantId: cust1.tenantId,
    amount: 250_000_000n,
    saleRef: 'AUDIT-TOPUP-001',
    actorUser: admin.userId,
    idemKey: 'audit-topup-001',
  }));

  const packSale = await vouchers.createPack(db, {
    name: 'Paket Audit Reguler',
    tokens: '1000',
    displayPriceIdr: '25000',
    isPromo: false,
    active: true,
  }, admin.userId);
  await vouchers.createPack(db, {
    name: 'Paket Audit Promo',
    tokens: '2500',
    displayPriceIdr: '50000',
    isPromo: true,
    active: true,
  }, admin.userId);

  const issuedForRedeem = await vouchers.issue(db, {
    kind: 'PROMO',
    tokens: '150',
    saleRef: 'AUDIT-PROMO-REDEEMED',
    idempotencyKey: 'audit-voucher-redeemed',
  }, admin.userId);
  await vouchers.redeem(db, {
    sessionId: 'audit-seed-session',
    userId: cust1.userId,
    username: custUsername,
    role: 'CUSTOMER',
    tenantId: cust1.tenantId,
    tenantStatus: 'ACTIVE',
    tenantVersion: '1',
    mfaVerified: false,
    authAt: new Date(),
  }, issuedForRedeem.code, '127.0.0.1');

  await vouchers.issue(db, {
    kind: 'SALE',
    packId: packSale.id,
    saleRef: 'AUDIT-SALE-LIVE',
    idempotencyKey: 'audit-voucher-live',
  }, admin.userId);

  const modelAlpha = await pricing.createModel(db, { id: 'audit/alpha-mini', displayName: 'Audit Alpha Mini', actorUser: admin.userId });
  const draft1 = await pricing.saveDraft(db, {
    id: modelAlpha.id,
    expectedVersion: modelAlpha.version,
    price: pricing.priceInput({ multiplier: '1.5' }),
    actorUser: admin.userId,
  });
  const pub1 = await pricing.publish(db, {
    id: modelAlpha.id,
    expectedVersion: draft1.version,
    reason: 'Harga awal audit alpha',
    actorUser: admin.userId,
  });
  await pricing.saveDraft(db, {
    id: modelAlpha.id,
    expectedVersion: pub1.version,
    price: pricing.priceInput({ multiplier: '2.25' }),
    actorUser: admin.userId,
  });

  const modelBeta = await pricing.createModel(db, { id: 'audit/beta-pro', displayName: 'Audit Beta Pro', actorUser: admin.userId });
  const draft2 = await pricing.saveDraft(db, {
    id: modelBeta.id,
    expectedVersion: modelBeta.version,
    price: pricing.priceInput({
      multiplier: '2',
      inputRateMicro: '3000000',
      outputRateMicro: '15000000',
      cacheReadRateMicro: '300000',
      cacheWriteRateMicro: '3750000',
    }),
    actorUser: admin.userId,
  });
  await pricing.publish(db, {
    id: modelBeta.id,
    expectedVersion: draft2.version,
    reason: 'Harga awal audit beta',
    actorUser: admin.userId,
  });

  // Upstream tetap berstatus PENDING (bukan ELIGIBLE) dan memakai resolver offline
  const up1 = await upstreams.create(db, key, offlinePublicResolver, {
    name: 'Upstream Audit Pending',
    baseUrls: { CHAT: 'https://api.example.com/v1', ANTHROPIC: 'https://api.example.com' },
    apiKey: 'sk-audit-synthetic-0001',
    termsNote: 'Catatan uji audit offline.',
  }, admin.userId);
  await upstreams.createRoute(db, {
    modelId: modelAlpha.id,
    upstreamId: up1.id,
    protocol: 'CHAT',
    upstreamModel: 'alpha-mini-v1',
    priority: 10,
    enabled: true,
  }, admin.userId);

  app = await buildApp({ db, key, mailer, secureCookies: false, resolveHost: offlinePublicResolver });
  await app.listen({ host: '127.0.0.1', port: apiPort });

  const viteErr = [];
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, WEB_PORT: String(webPort), ROUTER_API_TARGET: `http://127.0.0.1:${apiPort}` },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  vite.stderr.on('data', chunk => { viteErr.push(String(chunk)); });
  await waitFor(`${webBase}/`);

  browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    headless: true,
    args: ['--no-proxy-server'],
  });

  // Hangatkan cache pre-bundling Vite sekali sebelum loop audit berjalan
  const warmCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const warmPage = await warmCtx.newPage();
  await warmPage.goto(`${webBase}/masuk`, { waitUntil: 'networkidle' });
  await warmPage.getByRole('heading', { name: 'Masuk', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await warmCtx.close();

  // ---- 1. Layar publik / autentikasi (pada 360 dan 1280) ----
  for (const width of [360, 1280]) {
    const height = width === 360 ? 640 : 800;
    const pubCtx = await browser.newContext({ viewport: { width, height } });
    const pubPage = await pubCtx.newPage();
    pubPage.on('pageerror', err => { process.stderr.write(`pubPage pageerror: ${err.message}\n`); });

    for (const pubRoute of [
      '/masuk',
      '/admin/masuk',
      '/lupa-password',
      '/aktivasi',
      `/aktivasi#token=${encodeURIComponent(activateToken)}`,
      '/atur-ulang',
      `/atur-ulang#token=${encodeURIComponent(resetToken)}`,
      '/halaman-tidak-ditemukan',
    ]) {
      const label = pubRoute.includes('#token=') ? `${pubRoute.split('#')[0]} (dengan token)` : `${pubRoute}${pubRoute === '/aktivasi' || pubRoute === '/atur-ulang' ? ' (tanpa token)' : ''}`;
      await pubPage.goto(`${webBase}${pubRoute}`);
      await auditScreen({ page: pubPage, screen: label, width, viaRouteTransition: false });
    }

    // Langkah ke-2 halaman masuk admin (2FA)
    await pubPage.goto(`${webBase}/admin/masuk`);
    await waitSettled(pubPage);
    await pubPage.getByLabel('Username atau email').fill(adminUsername);
    await pubPage.getByLabel('Password', { exact: true }).fill(adminPassword);
    await pubPage.getByRole('button', { name: 'Masuk', exact: true }).click();
    await pubPage.getByLabel('Kode autentikator', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
    await auditScreen({ page: pubPage, screen: '/admin/masuk (2FA)', width, viaRouteTransition: false });

    await pubCtx.close();
  }

  // ---- 2. Portal pelanggan ----
  // Sesi kedua agar /akun menampilkan Sesi saat ini + Sesi lain
  const custShadowCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custShadowPage = await custShadowCtx.newPage();
  await custShadowPage.goto(`${webBase}/masuk`);
  await custShadowPage.getByLabel('Username atau email').fill(custUsername);
  await custShadowPage.getByLabel('Password', { exact: true }).fill(custPassword);
  await custShadowPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await custShadowPage.getByRole('heading', { name: 'Beranda', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

  const custCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const custPage = await custCtx.newPage();
  await custPage.goto(`${webBase}/masuk`);
  await custPage.getByLabel('Username atau email').fill(custUsername);
  await custPage.getByLabel('Password', { exact: true }).fill(custPassword);
  await custPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await custPage.getByRole('heading', { name: 'Beranda', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

  // Siapkan 1 API key via endpoint server terautentikasi agar /api-key dan /panduan terisi data
  const createdKey = await custPage.request.post(`${webBase}/api/keys`, {
    headers: { 'x-router-csrf': '1' },
    data: { name: 'Key Audit Portal', allowedModels: null, spendLimitMicro: '50000000', expiresAt: null, idempotencyKey: 'audit-portal-key-1' },
  });
  assert.equal(createdKey.status(), 201, 'Gagal membuat API key seed untuk audit');
  const createdKeyJson = await createdKey.json();

  // Seed 3 request realistis (SETTLED, SETTLED_ESTIMATED, UNRESOLVED) langsung lewat primitif ledger tanpa upstream eksternal
  await withTx(db, async tx => {
    const snap = await pricing.snapshotForAdmission(tx, modelAlpha.id);
    assert.ok(snap, 'Snapshot harga modelAlpha tidak ditemukan');
    const snapJson = JSON.stringify({
      seq: snap.price.version,
      inputRate: String(snap.price.inputRate),
      outputRate: String(snap.price.outputRate),
      cacheReadRate: String(snap.price.cacheReadRate),
      cacheWriteRate: String(snap.price.cacheWriteRate),
      multiplierE4: String(snap.price.multiplierE4),
    });

    const reqSettled = `req_${randomUUID()}`;
    const held1 = await ledger.placeKeyHold(tx, { secret: createdKeyJson.secret, requestId: reqSettled, amount: 2_000_000n, model: modelAlpha.id });
    await tx.query(
      `insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, debit, estimated, usage_norm, outcome, created_at, settled_at)
       values($1,$2,$3,$4,'CHAT',false,'SETTLED',$5,$6,2048,4096,'2000000','1250000',false,$7::jsonb,'completed',now(),now())`,
      [reqSettled, held1.tenantId, held1.keyId, modelAlpha.id, snap.priceVersionId, snapJson, JSON.stringify({ input: 1200, output: 450, cacheRead: 100, cacheWrite: 0 })],
    );
    await ledger.settleHold(tx, { tenantId: held1.tenantId, requestId: reqSettled, debit: 1_250_000n, ref: { requestId: reqSettled } });

    const reqEst = `req_${randomUUID()}`;
    const held2 = await ledger.placeKeyHold(tx, { secret: createdKeyJson.secret, requestId: reqEst, amount: 3_000_000n, model: modelBeta.id });
    await tx.query(
      `insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, debit, estimated, usage_norm, outcome, created_at, settled_at)
       values($1,$2,$3,$4,'ANTHROPIC',true,'SETTLED_ESTIMATED',$5,$6,4096,4096,'3000000','2500000',true,null,'usage_missing',now() - interval '1 day',now() - interval '1 day')`,
      [reqEst, held2.tenantId, held2.keyId, modelBeta.id, snap.priceVersionId, snapJson],
    );
    await ledger.settleHold(tx, { tenantId: held2.tenantId, requestId: reqEst, debit: 2_500_000n, ref: { requestId: reqEst } });

    const reqUnresolved = `req_${randomUUID()}`;
    const held3 = await ledger.placeKeyHold(tx, { secret: createdKeyJson.secret, requestId: reqUnresolved, amount: 1_500_000n, model: modelAlpha.id });
    await tx.query(
      `insert into request(id, tenant_id, api_key_id, model_id, protocol, stream, state, price_version_id, price_snapshot, max_input, max_output, hold, estimated, outcome)
       values($1,$2,$3,$4,'RESPONSES',true,'UNRESOLVED',$5,$6,1024,4096,'1500000',false,'process_lost_mid_stream')`,
      [reqUnresolved, held3.tenantId, held3.keyId, modelAlpha.id, snap.priceVersionId, snapJson],
    );
  });
  assert.deepEqual(await ledger.invariantViolations(db), []);

  const portalRoutes = [
    { path: '/isi-saldo', empty: false },
    { path: '/api-key', empty: false },
    { path: '/model-harga', empty: false },
    { path: '/pemakaian', empty: false },
    { path: '/panduan', empty: false },
    { path: '/transaksi', empty: false },
    { path: '/akun', empty: false },
    { path: '/beranda', empty: false },
  ];

  for (const width of [360, 1280]) {
    const height = width === 360 ? 640 : 800;
    await custPage.setViewportSize({ width, height });

    if (width === 360) {
      const menuTrigger = custPage.getByRole('button', { name: 'Menu', exact: true });
      await auditDialogBehavior({
        page: custPage,
        screen: '/beranda',
        width,
        name: 'Menu mobile',
        triggerLocator: menuTrigger,
        open: () => menuTrigger.click(),
      });
    }

    for (const r of portalRoutes) {
      await navigateShell(custPage, r.path, width);
      await auditScreen({ page: custPage, screen: r.path, width, viaRouteTransition: true, emptyData: r.empty });

      if (r.path === '/akun') {
        const revokeTrigger = custPage.getByRole('button', { name: 'Cabut sesi', exact: true }).first();
        await auditDialogBehavior({
          page: custPage,
          screen: '/akun',
          width,
          name: 'Konfirmasi cabut sesi',
          triggerLocator: revokeTrigger,
          open: () => revokeTrigger.click(),
        });
        const closeTrigger = custPage.getByRole('button', { name: 'Tutup akun', exact: true });
        await auditDialogBehavior({
          page: custPage,
          screen: '/akun',
          width,
          name: 'Konfirmasi tutup akun',
          triggerLocator: closeTrigger,
          open: () => closeTrigger.click(),
        });
      }
    }
  }

  await custCtx.close();
  await custShadowCtx.close();

  // ---- 3. Backoffice admin ----
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await adminCtx.newPage();

  const loginStep = await safeTotpStep();
  await adminPage.goto(`${webBase}/admin/masuk`);
  await adminPage.getByLabel('Username atau email').fill(adminUsername);
  await adminPage.getByLabel('Password', { exact: true }).fill(adminPassword);
  await adminPage.getByRole('button', { name: 'Masuk', exact: true }).click();
  await adminPage.getByLabel('Kode autentikator', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await adminPage.getByLabel('Kode autentikator', { exact: true }).fill(totpAt(seed, loginStep - 1n));
  await adminPage.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await adminPage.getByRole('heading', { name: 'Pelanggan', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

  const adminRoutes = [
    { path: '/admin/paket', empty: false },
    { path: '/admin/kode', empty: false },
    { path: '/admin/harga', empty: false },
    { path: '/admin/upstream', empty: false },
    { path: '/admin/rekonsiliasi', empty: false },
    { path: '/admin/batas-lebih-pakai', empty: false },
    { path: '/admin/audit', empty: false },
    { path: '/admin/akun', empty: false },
    { path: '/admin/pelanggan', empty: false },
  ];

  for (const width of [360, 1280]) {
    const height = width === 360 ? 640 : 800;
    await adminPage.setViewportSize({ width, height });

    for (const r of adminRoutes) {
      await navigateShell(adminPage, r.path, width);
      await auditScreen({ page: adminPage, screen: r.path, width, viaRouteTransition: true, emptyData: r.empty });

      if (r.path === '/admin/pelanggan') {
        const custCard = adminPage.locator('.data-row').filter({ hasText: custUsername });
        await custCard.getByRole('button', { name: 'Buka detail pelanggan', exact: true }).click();
        await adminPage.getByRole('heading', { name: custUsername, exact: true }).last().waitFor({ state: 'visible', timeout: 5_000 });
        await auditScreen({ page: adminPage, screen: '/admin/pelanggan (detail)', width, viaRouteTransition: false, emptyData: false });

        await adminPage.getByLabel('Jumlah kredit token').fill('10');
        await adminPage.getByLabel('Referensi penjualan').fill('AUDIT-DLG-TOPUP');
        const topupBtn = adminPage.getByRole('button', { name: 'Tambah saldo', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/pelanggan (detail)',
          width,
          name: 'Konfirmasi tambah saldo',
          triggerLocator: topupBtn,
          open: () => topupBtn.click(),
        });
      }

      if (r.path === '/admin/kode') {
        await adminPage.getByLabel('Jumlah kredit token').fill('100');
        await adminPage.getByLabel('Referensi penjualan').fill('AUDIT-DLG-CODE');
        const issueBtn = adminPage.locator('form').getByRole('button', { name: 'Terbitkan kode', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/kode',
          width,
          name: 'Konfirmasi terbit kode',
          triggerLocator: issueBtn,
          open: () => issueBtn.click(),
        });
      }

      if (r.path === '/admin/harga') {
        await adminPage.locator('.data-row').filter({ hasText: 'Audit Alpha Mini' }).getByRole('button', { name: 'Rincian', exact: true }).click();
        await adminPage.getByLabel('Bobot input', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
        await auditScreen({ page: adminPage, screen: '/admin/harga (detail)', width, viaRouteTransition: false, emptyData: false });

        const publishBtn = adminPage.getByRole('button', { name: 'Terbitkan harga', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/harga (detail)',
          width,
          name: 'Konfirmasi terbit harga',
          triggerLocator: publishBtn,
          open: () => publishBtn.click(),
        });
      }

      if (r.path === '/admin/paket') {
        const createPackBtn = adminPage.getByRole('button', { name: 'Buat paket', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/paket',
          width,
          name: 'Buat paket',
          triggerLocator: createPackBtn,
          open: () => createPackBtn.click(),
        });
      }

      if (r.path === '/admin/upstream') {
        const addUpBtn = adminPage.getByRole('button', { name: 'Tambah upstream', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/upstream',
          width,
          name: 'Tambah upstream',
          triggerLocator: addUpBtn,
          open: () => addUpBtn.click(),
        });
        const addRouteBtn = adminPage.getByRole('button', { name: 'Tambah route', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/upstream',
          width,
          name: 'Tambah route',
          triggerLocator: addRouteBtn,
          open: () => addRouteBtn.click(),
        });
      }

      if (r.path === '/admin/rekonsiliasi') {
        const resolveBtn = adminPage.getByRole('button', { name: 'Selesaikan request', exact: true }).first();
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/rekonsiliasi',
          width,
          name: 'Selesaikan request',
          triggerLocator: resolveBtn,
          open: () => resolveBtn.click(),
        });
      }

      if (r.path === '/admin/batas-lebih-pakai') {
        await adminPage.getByLabel('Batas lebih-pakai dalam token').fill('500000');
        const submitOverdraft = adminPage.locator('main form').getByRole('button', { name: 'Simpan', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/batas-lebih-pakai',
          width,
          name: 'Konfirmasi batas lebih-pakai',
          triggerLocator: submitOverdraft,
          open: () => submitOverdraft.click(),
        });
      }

      if (r.path === '/admin/akun') {
        await db.query("update session set auth_at=clock_timestamp()-interval '10 minutes' where user_id=$1 and kind='ADMIN'", [admin.userId]);
        const startRotBtn = adminPage.getByRole('button', { name: 'Mulai ganti autentikator', exact: true });
        await auditDialogBehavior({
          page: adminPage,
          screen: '/admin/akun',
          width,
          name: 'Step-up autentikator admin',
          triggerLocator: startRotBtn,
          open: () => startRotBtn.click(),
        });

        if (width === 1280) {
          await db.query("update session set auth_at=clock_timestamp() where user_id=$1 and kind='ADMIN'", [admin.userId]);
          await startRotBtn.click();
          await adminPage.locator('.qr-svg').waitFor({ state: 'visible', timeout: 5_000 });
          await auditScreen({ page: adminPage, screen: '/admin/akun (rotasi aktif)', width: 1280, viaRouteTransition: false });
          await adminPage.setViewportSize({ width: 360, height: 640 });
          await auditScreen({ page: adminPage, screen: '/admin/akun (rotasi aktif)', width: 360, viaRouteTransition: false });

          const pendingSecret = (await adminPage.locator('section[aria-label="Autentikator admin"] pre.secret').innerText()).replace(/\s+/g, '');
          const rotStep = await safeTotpStep();
          await adminPage.getByLabel('Kode autentikator baru').fill(totpAt(base32Decode(pendingSecret), rotStep - 1n));
          await adminPage.getByRole('button', { name: 'Konfirmasi autentikator baru', exact: true }).click();
          await adminPage.locator('dialog[open]').last().waitFor({ state: 'visible', timeout: 5_000 });
          await auditAxeAndLayout(adminPage, '/admin/akun [dialog: Kode pemulihan]', 360);
          await adminPage.setViewportSize({ width: 1280, height: 800 });
          await auditAxeAndLayout(adminPage, '/admin/akun [dialog: Kode pemulihan]', 1280);
          await adminPage.getByRole('button', { name: 'Saya sudah menyalin', exact: true }).click();
          await adminPage.locator('dialog[open]').waitFor({ state: 'hidden', timeout: 5_000 });
        }
      }
    }
  }

  await adminCtx.close();

  // Deduplikasi temuan per (screen, width, problem)
  const seen = new Set();
  const uniqueFindings = [];
  for (const f of findings) {
    const k = `${f.screen}|${f.width}|${f.problem}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniqueFindings.push(f);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalScreensAudited: auditedScreens.length,
    totalFindings: uniqueFindings.length,
    auditedScreens,
    findings: uniqueFindings,
  };

  await fs.mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
  await fs.writeFile(evidenceJsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const lines = [
    `a11y-audit summary (${report.generatedAt})`,
    `Audited screen-width combinations: ${report.totalScreensAudited}`,
    `Total unique findings: ${report.totalFindings}`,
    '',
  ];
  for (const [idx, f] of uniqueFindings.entries()) {
    lines.push(`${idx + 1}. [${f.owner}] ${f.screen} (${f.width}px)`);
    lines.push(`   Masalah : ${f.problem}`);
    lines.push(`   WCAG    : ${f.wcag}`);
    lines.push(`   Berkas  : ${f.file}`);
    lines.push(`   Ulang   : ${f.repro}`);
    lines.push(`   Usulan  : ${f.fixSuggestion}`);
  }
  if (uniqueFindings.length === 0) lines.push('a11y-audit: PASS (0 findings)');
  await fs.writeFile(evidenceTxtPath, lines.join('\n') + '\n', 'utf8');

  process.stdout.write(lines.join('\n') + '\n');
  if (uniqueFindings.length > 0) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  vite?.kill();
  await app?.close().catch(() => {});
  await db?.end().catch(() => {});
  if (root) {
    if (/^web_audit_[a-f0-9]{32}$/.test(schema)) await root.query(`drop schema if exists "${schema}" cascade`).catch(() => {});
    await root.end().catch(() => {});
  }
}
