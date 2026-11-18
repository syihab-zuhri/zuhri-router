import { Link, useLocation } from 'react-router';
import { m } from './messages.ts';
import { PageTitle } from './ui.tsx';

export function NotFoundPage() {
  const admin = useLocation().pathname.startsWith('/admin/');
  return <main className="standalone not-found">
    <PageTitle>{m.notFound}</PageTitle>
    <p>{m.notFoundHelp}</p>
    <Link to={admin ? '/admin/ringkasan' : '/beranda'}>{admin ? m.goAdminHome : m.goHome}</Link>
  </main>;
}
