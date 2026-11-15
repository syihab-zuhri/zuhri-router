import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app.tsx';
import './tokens.css';
import './styles.css';

export function mount(takeToken: () => string | null) {
  const root = document.getElementById('root');
  if (!root) throw new Error('root_missing');
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 }, queries: { retry: false, gcTime: 0 } } });
  createRoot(root).render(<QueryClientProvider client={client}><BrowserRouter><App takeToken={takeToken} /></BrowserRouter></QueryClientProvider>);
}
