import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/rekonvia-theme.css';

const Root=lazy(()=>import.meta.env.VITE_DEMO_MODE==='true'?import('./App.tsx'):import('./AuthApp.tsx'));
createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={<main className="p-8 text-text-primary"><p role="status">Memuat Rekonvia…</p></main>}><Root /></Suspense></StrictMode>,
);
