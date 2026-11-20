import { useSyncExternalStore } from 'react';
import { getLocale, setLocale, subscribeLocale } from './i18n.ts';

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
export function LanguageSwitcher() {
  const locale = useLocale();
  return <div className="language-switcher" role="group" aria-label={locale === 'en_US' ? 'Language' : 'Bahasa'}>
    <button type="button" lang="en-US" aria-label="English (United States)" title="English (United States)" aria-pressed={locale === 'en_US'} onClick={() => setLocale('en_US')} data-testid="locale-en"><span className="language-flag language-flag-en" aria-hidden="true" /><span>EN</span></button>
    <button type="button" lang="id-ID" aria-label="Bahasa Indonesia" title="Bahasa Indonesia" aria-pressed={locale === 'id_ID'} onClick={() => setLocale('id_ID')} data-testid="locale-id"><span className="language-flag language-flag-id" aria-hidden="true" /><span>ID</span></button>
  </div>;
}
