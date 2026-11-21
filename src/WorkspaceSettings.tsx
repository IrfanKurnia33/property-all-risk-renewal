import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AccountLayout } from './AccountLayout.tsx';
import { Button, Panel } from './App.tsx';
import { t } from './i18n.ts';
import { apiRequest, RequestError } from './server-api.ts';
import { publishableKey, supabase, supabaseUrl } from './supabase.ts';

interface Member {
  userId: string; email: string; role: 'broker' | 'client'; superadmin: boolean; canManageStandardTerms: boolean;
}
interface StandardTermsVersion {
  id: string; version: number; displayName: string; mimeType: string; byteSize: number; sha256: string; createdAt: string; createdBy: string;
}
interface Workspace {
  workspaceId: string; name: string; isSuperadmin: boolean; canManageStandardTerms: boolean; members: Member[]; standardTerms: StandardTermsVersion[];
}
interface Settings { workspaces: Workspace[] }
const MAX_FILE = 10 * 1024 * 1024;
const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Permintaan belum berhasil.'; }
function formatSize(size: number) { return (size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' KiB'; }

export function WorkspaceSettings({ session, onBack, onLogout, onExpired }: {
  session: Session; onBack: () => void; onLogout: () => void; onExpired: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const controller = useMemo(() => new AbortController(), [session.user.id, reload]);
  const selected = settings?.workspaces.find(workspace => workspace.workspaceId === workspaceId);
  const originalMembers = settings?.workspaces.find(workspace => workspace.workspaceId === workspaceId)?.members ?? [];
  const changedMembers = members.filter(member => {
    const original = originalMembers.find(item => item.userId === member.userId);
    return original && (original.role !== member.role || original.superadmin !== member.superadmin
      || original.canManageStandardTerms !== member.canManageStandardTerms);
  });

  async function request<T>(path: string, input?: unknown) {
    const auth = await supabase!.auth.getSession();
    if (!auth.data.session || auth.data.session.user.id !== session.user.id) throw new RequestError(401, 'INVALID_SESSION', 'Sesi berakhir.');
    return apiRequest<T>({ url: supabaseUrl!, publishableKey: publishableKey!, token: auth.data.session.access_token, path, input, signal: controller.signal });
  }
  useEffect(() => {
    setError('');
    void request<Settings>('workspace-settings').then(result => {
      if (controller.signal.aborted) return;
      setSettings(result);
      setWorkspaceId(current => result.workspaces.some(workspace => workspace.workspaceId === current)
        ? current : result.workspaces[0]?.workspaceId ?? '');
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof RequestError && cause.status === 401) onExpired();
      else setError(message(cause));
    });
    return () => controller.abort();
  }, [controller]);
  useEffect(() => { setMembers(selected?.members ?? []); setFile(null); }, [workspaceId, settings]);

  function updateMember(userId: string, update: Partial<Member>) {
    setMembers(current => current.map(member => member.userId !== userId ? member : {
      ...member, ...update,
      ...(update.role === 'client' ? { superadmin: false, canManageStandardTerms: false } : {}),
    }));
    setStatus('');
  }
  async function saveMembers() {
    if (!selected || !changedMembers.length || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await request('workspace-settings/members', {
        workspaceId: selected.workspaceId,
        changes: changedMembers.map(({ userId, role, superadmin, canManageStandardTerms }) => ({ userId, role, superadmin, canManageStandardTerms })),
      });
      setStatus('Perubahan akses anggota tersimpan.');
      setReload(value => value + 1);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 401) onExpired();
      else setError(message(cause));
    } finally { setBusy(false); }
  }
  async function uploadTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !file || !selected.canManageStandardTerms || busy) return;
    const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
    const mimeType = mimeByExtension[extension];
    if (!mimeType || file.size < 1 || file.size > MAX_FILE) {
      setError('Pilih PDF atau DOCX yang tidak kosong dan berukuran maksimum 10 MiB.');
      return;
    }
    setBusy(true); setError(''); setStatus('');
    try {
      const reservation = await request<{ id: string; path: string; version: number; token: string }>('workspace-settings/standard-terms/start', {
        workspaceId: selected.workspaceId, displayName: file.name, byteSize: file.size, mimeType,
      });
      const upload = await supabase!.storage.from('renewal-documents').uploadToSignedUrl(reservation.path, reservation.token, file, {
        contentType: mimeType, upsert: false,
      });
      if (upload.error) throw new RequestError(0, 'UPLOAD_FAILED', 'Unggahan gagal. Buat versi baru untuk mencoba kembali.');
      await request(`workspace-settings/standard-terms/${reservation.id}/finalize`, {});
      setFile(null);
      setStatus(`Standard T&C versi ${reservation.version} telah difinalisasi.`);
      setReload(value => value + 1);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 401) onExpired();
      else setError(message(cause));
    } finally { setBusy(false); }
  }
  async function downloadTerms(version: StandardTermsVersion) {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ url: string }>(`workspace-settings/standard-terms/${version.id}/download`, {});
      const signed = new URL(result.url);
      if (signed.origin !== supabaseUrl) throw new Error('Alamat unduhan tidak valid.');
      const response = await fetch(signed, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Berkas Standard T&C belum dapat diunduh.');
      const blob = await response.blob();
      if (blob.size !== version.byteSize || blob.size > MAX_FILE) throw new Error('Ukuran berkas Standard T&C tidak sesuai.');
      const { downloadBlob } = await import('./downloads.ts');
      if (!controller.signal.aborted) downloadBlob(blob, version.displayName);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 401) onExpired();
      else setError(message(cause));
    } finally { setBusy(false); }
  }

  return <AccountLayout email={session.user.email ?? ''} role="broker" title="Pengaturan workspace" onBack={onBack} onLogout={onLogout}>
    <main id="account-main" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="eyebrow">{t('Workspace renewal Property All Risks')}</p><h1>{t('Pengaturan workspace')}</h1>
          <p className="mt-3 max-w-2xl text-sm text-text-secondary">{t('Kelola sumber Standard T&C dan akses akun yang sudah disiapkan untuk brokerage.')}</p></div>
        <Button onClick={onBack}>{t('Kembali')}</Button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-status-blocked-fg/20 bg-status-blocked-bg p-4 text-sm text-status-blocked-fg">{t(error)}</p>}
      {status && <p role="status" className="rounded-lg border border-status-confirmed-fg/20 bg-status-confirmed-bg p-4 text-sm text-status-confirmed-fg">{t(status)}</p>}
      {!settings ? !error && <p role="status">{t('Memuat pengaturan workspace…')}</p> : !settings.workspaces.length ? <p role="alert">{t('Tidak ada workspace broker yang tersedia untuk akun ini.')}</p> : <>
        {settings.workspaces.length > 1 && <div className="max-w-xl"><label htmlFor="settings-workspace">{t('Workspace brokerage')}</label>
          <select id="settings-workspace" className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base" value={workspaceId}
            onChange={event => setWorkspaceId(event.target.value)}>{settings.workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</option>)}</select></div>}
        {selected && <>
          <Panel title="Standard T&C" description="Sumber brokerage yang tersimpan sebagai versi final dan tidak dapat ditimpa.">
            {selected.canManageStandardTerms && <form className="space-y-4" onSubmit={event => void uploadTerms(event)}>
              <div><label htmlFor="standard-terms-file">{t('Unggah versi Standard T&C')}</label>
                <input id="standard-terms-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></div>
              <p className="text-xs text-text-secondary">{t('PDF atau DOCX · maksimum 10 MiB · setiap unggahan membuat versi baru.')}</p>
              <Button type="submit" primary disabled={busy || !file}>{busy ? t('Menyimpan…') : t('Unggah dan finalisasi')}</Button>
            </form>}
            {!selected.canManageStandardTerms && <p className="text-sm text-text-secondary">{t('Anda dapat mengunduh sumber yang telah difinalisasi. Izin unggah dikelola Superadmin workspace.')}</p>}
            <ol className="divide-y divide-border-subtle border-y border-border-subtle">
              {selected.standardTerms.map(version => <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0"><strong>{t('Versi')} {version.version} · {version.displayName}</strong>
                  <p className="mt-1 break-all text-xs text-text-secondary">{formatSize(version.byteSize)} · SHA-256 {version.sha256}</p></div>
                <Button disabled={busy} onClick={() => void downloadTerms(version)}>{t('Unduh sumber')}</Button>
              </li>)}
              {!selected.standardTerms.length && <li className="py-4 text-sm text-text-secondary">{t('Belum ada Standard T&C yang difinalisasi.')}</li>}
            </ol>
          </Panel>
          {selected.isSuperadmin && <Panel title="Akses anggota" description="Ubah peran broker/klien dan berikan izin Standard T&C kepada akun yang sudah menjadi anggota.">
            <div className="divide-y divide-border-subtle border-y border-border-subtle">
              {members.map(member => <div key={member.userId} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_160px_180px] sm:items-center">
                <div className="min-w-0"><strong className="block break-all">{member.email}</strong><span className="text-xs text-text-secondary">{member.userId}</span></div>
                <label className="text-sm">{t('Peran')}
                  <select className="mt-1 min-h-11 w-full rounded-md border border-border-control bg-surface px-3" value={member.role} disabled={busy || member.userId === session.user.id}
                    onChange={event => updateMember(member.userId, { role: event.target.value as Member['role'] })}>
                    <option value="broker">{t('Broker')}</option><option value="client">{t('Klien')}</option>
                  </select>
                </label>
                <div className="grid gap-2 text-sm">
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={member.superadmin} disabled={busy || member.role !== 'broker' || member.userId === session.user.id}
                    onChange={event => updateMember(member.userId, { superadmin: event.target.checked, ...(event.target.checked ? { canManageStandardTerms: true } : {}) })} />{t('Superadmin')}</label>
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={member.canManageStandardTerms} disabled={busy || member.role !== 'broker' || member.superadmin || member.userId === session.user.id}
                    onChange={event => updateMember(member.userId, { canManageStandardTerms: event.target.checked })} />{t('Kelola Standard T&C')}</label>
                </div>
              </div>)}
            </div>
            <p className="text-xs text-text-secondary">{t('Perubahan peran ditolak jika akun memiliki penugasan atau aktivitas kasus. Minimal satu Superadmin harus tetap aktif. Akun tidak dapat mengubah izinnya sendiri.')}</p>
            <Button primary disabled={busy || !changedMembers.length} onClick={() => void saveMembers()}>{busy ? t('Menyimpan…') : t('Simpan akses anggota')}</Button>
          </Panel>}
        </>}
      </>}
    </main>
  </AccountLayout>;
}
