import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { languageTag, t } from './i18n.ts';
import { useLocale } from './LanguageSwitcher.tsx';
import './styles/rekonvia-theme.css';

const Root=lazy(()=>import.meta.env.VITE_DEMO_MODE==='true'?import('./App.tsx'):import('./AuthApp.tsx'));
function LocalizedApp() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = languageTag(locale);
    document.title = t('Rekonvia · Workspace renewal');
    const description = t('Rekonvia: workspace renewal Property All Risks untuk broker dan klien.');
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
  }, [locale]);
  return <Suspense fallback={<main className="p-8 text-text-primary"><p role="status">{t('Memuat Rekonvia…')}</p></main>}><Root /></Suspense>;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode><LocalizedApp /></StrictMode>,
);
