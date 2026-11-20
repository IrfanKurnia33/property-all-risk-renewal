import { useSyncExternalStore } from 'react';
import { getLocale, setLocale, subscribeLocale } from './i18n.ts';
import type { Locale } from './i18n.ts';

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
export function LanguageSwitcher() {
  const locale = useLocale();
  return <label className="language-switcher flex max-w-full flex-wrap items-center gap-2 text-sm text-text-secondary">
    <span>{locale === 'en_US' ? 'Language' : 'Bahasa'}</span>
    <select className="min-h-11 max-w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base text-text-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" value={locale} onChange={event => setLocale(event.target.value as Locale)}>
      <option value="en_US" lang="en-US">English (United States)</option>
      <option value="id_ID" lang="id-ID">Bahasa Indonesia</option>
    </select>
  </label>;
}
