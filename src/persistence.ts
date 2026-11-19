import { useRef, useState } from 'react';
import { applyAction, createInitialCase, isRenewalCase } from './domain.ts';
import type { Actor, CaseAction, RenewalCase } from './domain.ts';

export const CASE_STORAGE_KEY = 'rekonvia.case.v2';
export const LEGACY_CASE_STORAGE_KEY = 'ruang-renewal.case.v1';
type CaseStorage = Pick<Storage, 'getItem' | 'setItem'>;
type LoadedCase = { state: RenewalCase; storageError: string; recoveryRequired: boolean };

function browserStorage(): CaseStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readStoredCase(storage: CaseStorage | null): LoadedCase {
  const initial = createInitialCase();
  if (!storage) return { state: initial, recoveryRequired: false, storageError: 'Penyimpanan browser tidak tersedia. Progres hanya tersimpan selama halaman ini terbuka; unduh ringkasan sebelum menutupnya.' };
  try {
    const raw = storage.getItem(CASE_STORAGE_KEY);
    if (raw === null) {
      const legacy = storage.getItem(LEGACY_CASE_STORAGE_KEY);
      return legacy === null ? { state: initial, storageError: '', recoveryRequired: false }
        : { state: initial, recoveryRequired: true, storageError: 'Data simulasi lama tersedia. Unduh cadangannya, lalu mulai kasus versi baru. Data lama tidak akan diubah atau dipakai sebagai bukti baru.' };
    }
    const value: unknown = JSON.parse(raw);
    if (!isRenewalCase(value)) throw new Error('Invalid saved case');
    return { state: value, storageError: '', recoveryRequired: false };
  } catch {
    return { state: initial, recoveryRequired: true, storageError: 'Progres tersimpan tidak dapat dibaca. Data lama belum ditimpa. Unduh cadangan data lama atau mulai ulang kasus untuk melanjutkan.' };
  }
}

export function writeStoredCase(storage: CaseStorage | null, state: RenewalCase): string {
  try {
    if (!storage) throw new Error('Storage unavailable');
    storage.setItem(CASE_STORAGE_KEY, JSON.stringify(state));
    return '';
  } catch {
    return 'Progres belum berhasil disimpan di browser. Halaman ini tetap bisa dipakai; unduh ringkasan sebelum menutupnya.';
  }
}

export function downloadStoredBackup(): void {
  const storage = browserStorage();
  const raw = storage?.getItem(CASE_STORAGE_KEY) ?? storage?.getItem(LEGACY_CASE_STORAGE_KEY);
  if (!raw) throw new Error('Tidak ada data tersimpan yang dapat dicadangkan.');
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cadangan-renewal.json';
  document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function useRenewalCase() {
  const [loaded, setLoaded] = useState(() => readStoredCase(browserStorage()));
  const [error, setError] = useState('');
  const current = useRef(loaded.state);
  const persistedVersion = useRef(loaded.state.lockVersion);

  function dispatch(actor: Actor, action: CaseAction): boolean {
    if (loaded.recoveryRequired) {
      setError('Mulai ulang kasus setelah mencadangkan data lama untuk mengaktifkan perubahan.');
      return false;
    }
    try {
      const storage = browserStorage();
      // shortcut: browser version checks cannot atomically commit across tabs; replace with server commands at the Phase 3 authenticated cutover.
      const raw = storage?.getItem(CASE_STORAGE_KEY);
      if (raw) {
        const stored: unknown = JSON.parse(raw);
        if (!isRenewalCase(stored) || stored.lockVersion !== persistedVersion.current) {
          throw new Error('Kasus berubah di tab lain. Salin isian yang belum disimpan, lalu muat ulang untuk meninjau versi terbaru.');
        }
      }
      const state = applyAction(current.current, actor, action, current.current.lockVersion);
      const storageError = writeStoredCase(storage, state);
      if (!storageError) persistedVersion.current = state.lockVersion;
      current.current = state;
      setLoaded({ state, storageError, recoveryRequired: false });
      setError('');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Perubahan belum berhasil. Coba kembali.');
      return false;
    }
  }

  function reset(): boolean {
    if (!window.confirm('Mulai ulang kasus contoh? Progres dan catatan kasus ini akan diganti. Status tur tetap disimpan.')) return false;
    const state = createInitialCase();
    const storageError = writeStoredCase(browserStorage(), state);
    if (!storageError) persistedVersion.current = state.lockVersion;
    current.current = state;
    setLoaded({ state, storageError, recoveryRequired: false });
    setError('');
    return true;
  }

  return { ...loaded, error, dispatch, reset, clearError: () => setError('') };
}
