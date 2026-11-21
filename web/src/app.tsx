import { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { ApiError, post } from './api.ts';
import { am, m, ov } from './messages.ts';
import { formatCredits } from './credits.ts';
import { useAction, useResource } from './hooks.tsx';
import { Alert, Button, ErrorBox, Modal, PageTitle, Pending } from './ui.tsx';
import { LoginPage, RequestResetPage, TokenPage } from './auth.tsx';
import { HomePage, KeysPage, LedgerPage, RedeemPage } from './customer.tsx';
import type { Balance } from './customer.tsx';
import { GuidePage } from './guide.tsx';
import { UsagePage } from './usage.tsx';
import { CataloguePage } from './catalogue.tsx';
import { CustomerAccountPage } from './account-customer.tsx';
import { CustomersPage } from './admin-customers.tsx';
import { PacksPage } from './admin-packs.tsx';
import { VouchersPage } from './admin-vouchers.tsx';
import { ModelsPage } from './admin-models.tsx';
import { UpstreamsPage } from './admin-upstreams.tsx';
import { AuditPage, OverdraftPage, UnresolvedPage } from './admin-operations.tsx';
import { AdminOverviewPage } from './admin-overview.tsx';
import { AdminAccountPage } from './account-admin.tsx';
import { NotFoundPage } from './not-found.tsx';

const portalLinks = [['/beranda', m.home], ['/isi-saldo', m.redeem], ['/api-key', m.keys], ['/model-harga', m.catalogue], ['/pemakaian', m.requests], ['/panduan', m.guide], ['/transaksi', m.ledger], ['/akun', am.account]];
const adminLinks = [['/admin/ringkasan', ov.overview], ['/admin/pelanggan', m.customers], ['/admin/paket', m.packs], ['/admin/kode', m.vouchers], ['/admin/harga', m.models], ['/admin/upstream', m.upstreams], ['/admin/rekonsiliasi', m.unresolved], ['/admin/batas-lebih-pakai', m.overdraft], ['/admin/audit', m.audit], ['/admin/akun', am.account]];
function Navigation({ admin, close }: { admin: boolean; close?: () => void }) {
  return <nav aria-label={admin ? m.backoffice : m.portal}>{(admin ? adminLinks : portalLinks).map(([path, label]) => <NavLink key={path} to={path} onClick={close}>{label}</NavLink>)}</nav>;
}
function RouteFocus() {
  const location = useLocation();
  useEffect(() => {
    const initialFocus = document.activeElement;
    let timer = 0;
    const focusReadyHeading = () => {
      const active = document.activeElement;
      if (active?.closest('[role="tablist"]')) return true;
      if (active !== initialFocus && active !== document.body && active !== document.documentElement) return true;
      const main = document.querySelector<HTMLElement>('main#main') ?? document.querySelector<HTMLElement>('main');
      const heading = main?.querySelector<HTMLElement>('h1');
      if (!main || !heading || main.getAttribute('aria-busy') === 'true' || main.querySelector('[aria-busy="true"]')) return false;
      heading.focus();
      return document.activeElement === heading;
    };
    const tryFocus = () => {
      timer = requestAnimationFrame(() => {
        if (focusReadyHeading()) observer.disconnect();
      });
    };
    const observer = new MutationObserver(tryFocus);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
    tryFocus();
    return () => { cancelAnimationFrame(timer); observer.disconnect(); };
  }, [location.key]);
  return null;
}
function Shell({ admin = false }: { admin?: boolean }) {
  const [open, setOpen] = useState(false); const action = useAction(admin); const navigate = useNavigate();
  const probe = useResource<unknown>(admin ? '/admin/api/packs' : '/api/me');
  const location = useLocation();
  const previousPath = useRef(location.pathname);
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const routeChanged = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (admin) return;
    if (routeChanged) void probe.refetch();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void probe.refetch();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible);
  }, [admin, location.pathname, probe.refetch]);
  if (probe.isPending) return <main className="standalone"><Pending /></main>;
  if (probe.isError && probe.data === undefined) {
    if (probe.error instanceof ApiError && probe.error.status === 401) return <Navigate to={admin ? '/admin/masuk' : '/masuk'} replace state={{ expired: true, returnTo: location.pathname + location.search }} />;
    return <main className="standalone"><PageTitle>{m.failed}</PageTitle><ErrorBox error={probe.error} retry={() => void probe.refetch()} /></main>;
  }
  const tenant = !admin && probe.data && typeof probe.data === 'object' && 'tenantStatus' in probe.data ? probe.data.tenantStatus : null;
  const servicePaused = !admin && probe.data !== null && typeof probe.data === 'object' && 'servicePaused' in probe.data && probe.data.servicePaused === true;
  return <div className="app-shell"><a className="skip" href="#main">{m.skip}</a><aside className="desktop-nav"><p className="product-name">{m.product}</p><p>{admin ? m.backoffice : m.portal}</p><Navigation admin={admin} /></aside>
    <div className="workspace"><header className="topbar"><Button className="secondary menu-trigger" onClick={() => setOpen(true)}>{m.menu}</Button><span>{admin ? m.backoffice : m.portal}</span>{!admin && <ShellBalance />}<Button className="secondary" busy={action.busy} onClick={() => void action.run(async () => { await post(admin ? '/admin/api/logout' : '/api/auth/logout', {}); navigate(admin ? '/admin/masuk' : '/masuk', { replace: true }); })}>{m.logout}</Button></header>
      <main id="main" tabIndex={-1}>{tenant === 'SUSPENDED' && <Alert>{m.suspended}</Alert>}{servicePaused && <Alert>{m.servicePausedMessage}</Alert>}{action.error !== null && <ErrorBox error={action.error} />}<Outlet /></main>
    </div>{open && <Modal title={m.menu} onClose={() => setOpen(false)}><Button className="secondary" autoFocus onClick={() => setOpen(false)}>{m.closeMenu}</Button><Navigation admin={admin} close={() => setOpen(false)} /></Modal>}</div>;
}
function ShellBalance() {
  const q = useResource<Balance>('/api/balance');
  return <LinkBalance text={q.isSuccess ? formatCredits(q.data.availableMicro) + ' ' + m.credits : q.isError ? m.failed : m.loading} />;
}
function LinkBalance({ text }: { text: string }) { return <NavLink className="shell-balance" to="/isi-saldo">{m.available}: {text}</NavLink>; }
export function App({ takeToken }: { takeToken: () => string | null }) {
  return <><RouteFocus /><Routes><Route path="/masuk" element={<LoginPage />} /><Route path="/admin/masuk" element={<LoginPage admin />} /><Route path="/aktivasi" element={<TokenPage kind="activate" takeToken={takeToken} />} /><Route path="/atur-ulang" element={<TokenPage kind="reset" takeToken={takeToken} />} /><Route path="/lupa-password" element={<RequestResetPage />} />
    <Route element={<Shell />}><Route path="/beranda" element={<HomePage />} /><Route path="/isi-saldo" element={<RedeemPage />} /><Route path="/api-key" element={<KeysPage />} /><Route path="/model-harga" element={<CataloguePage />} /><Route path="/pemakaian" element={<UsagePage />} /><Route path="/panduan" element={<GuidePage />} /><Route path="/transaksi" element={<LedgerPage />} /><Route path="/akun" element={<CustomerAccountPage />} /></Route>
    <Route element={<Shell admin />}><Route path="/admin/ringkasan" element={<AdminOverviewPage />} /><Route path="/admin/pelanggan" element={<CustomersPage />} /><Route path="/admin/paket" element={<PacksPage />} /><Route path="/admin/kode" element={<VouchersPage />} /><Route path="/admin/harga" element={<ModelsPage />} /><Route path="/admin/upstream" element={<UpstreamsPage />} /><Route path="/admin/rekonsiliasi" element={<UnresolvedPage />} /><Route path="/admin/batas-lebih-pakai" element={<OverdraftPage />} /><Route path="/admin/audit" element={<AuditPage />} /><Route path="/admin/akun" element={<AdminAccountPage />} /></Route>
    <Route path="/" element={<Navigate to="/beranda" replace />} /><Route path="/admin" element={<Navigate to="/admin/ringkasan" replace />} /><Route path="*" element={<NotFoundPage />} />
  </Routes></>;
}
