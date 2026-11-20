import en from './locales/en.ts';
import id from './locales/id.ts';

export const LOCALE_KEY = 'rekonvia.locale.v1';
export const DEFAULT_LOCALE = 'en_US';
export type Locale = 'en_US' | 'id_ID';
export const languageTag = (locale: Locale = getLocale()) => locale === 'id_ID' ? 'id-ID' : 'en-US';

export function readLocale(storage?: Pick<Storage, 'getItem'>): Locale {
  try { return storage?.getItem(LOCALE_KEY) === 'id_ID' ? 'id_ID' : DEFAULT_LOCALE; }
  catch { return DEFAULT_LOCALE; }
}
function browserLocale() {
  try { return readLocale(globalThis.localStorage); } catch { return DEFAULT_LOCALE; }
}
let locale: Locale = browserLocale();
const listeners = new Set<() => void>();
export function getLocale(): Locale { return locale; }
export function setLocale(next: Locale) {
  if (next !== 'en_US' && next !== 'id_ID') return;
  locale = next;
  try { globalThis.localStorage?.setItem(LOCALE_KEY, next); } catch { /* Selection still works for this session. */ }
  listeners.forEach(listener => listener());
}
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  const sync = (event: StorageEvent) => {
    if (event.key === LOCALE_KEY || event.key === null) {
      locale = browserLocale();
      listeners.forEach(notify => notify());
    }
  };
  globalThis.addEventListener?.('storage', sync);
  return () => { listeners.delete(listener); globalThis.removeEventListener?.('storage', sync); };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(en).filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => Number(a.startsWith('{')) - Number(b.startsWith('{'))
    || b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
  .map(([key, value]) => ({
    key, value,
    pattern: new RegExp('^' + key.split(/\{\d+\}/).map(escape).join('([\\s\\S]*?)') + '$'),
  }));

// Translate only application messages at their presentation boundary; case evidence stays verbatim.
export function translate(source: string, selected: Locale, depth = 0): string {
  if (source.endsWith(' Convert to an unencrypted PDF, DOCX, XLSX, JPEG, PNG or WebP (maximum 10 MiB).')) {
    return translate('Berkas tidak didukung atau dilindungi sandi. Konversi ke PDF, DOCX, XLSX, JPEG, PNG atau WebP tanpa enkripsi/makro, maksimum 10 MiB.', selected, depth + 1);
  }
  const dictionary: Record<string, string> = selected === 'en_US' ? en : id;
  if (Object.hasOwn(dictionary, source)) return dictionary[source];
  if (source.trim() !== source && Object.hasOwn(dictionary, source.trim())) return source.replace(source.trim(), dictionary[source.trim()]);
  if (selected === 'id_ID' || depth > 4) return source;
  for (const { key, pattern, value } of patterns) {
    const match = source.match(pattern);
    if (match) return value.replace(/\{(\d+)\}/g, (_, index: string) => {
      const capture = match[Number(index) + 1];
      const nestedMessage = /^(QS belum siap:|Proposal belum siap:|DFS belum siap:|Pemeriksaan broker:)/.test(key)
        || (key === 'Broker meninjau wording {0}: {1}' && index === '1');
      return nestedMessage ? translate(capture, selected, depth + 1) : capture;
    });
  }
  if (source.includes('; ')) return source.split('; ').map(part => translate(part, selected, depth + 1)).join('; ');
  return source;
}
export function t(source: string): string { return translate(source, locale); }

export function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00+07:00' : value);
  return new Intl.DateTimeFormat(languageTag(), { timeZone: 'Asia/Jakarta', ...options }).format(date);
}
export function formatNumber(value: string | number, minFractionDigits = 0): string {
  const raw = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const [integer, fraction = ''] = raw.split('.');
  const grouped = (raw.startsWith('-') && BigInt(integer) === 0n ? '-' : '') + new Intl.NumberFormat(languageTag()).format(BigInt(integer));
  const digits = fraction.padEnd(minFractionDigits, '0');
  return digits ? grouped + (locale === 'id_ID' ? ',' : '.') + digits : grouped;
}
