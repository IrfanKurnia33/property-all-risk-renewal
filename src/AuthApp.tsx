import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { BrandLockup } from './WorkspaceChrome.tsx';
import { AccountLayout } from './AccountLayout.tsx';
import { t } from './i18n.ts';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Button, RenewalWorkspace } from './App.tsx';
import { ClientWorkspace } from './ClientWorkspace.tsx';
import { apiRequest, RequestError } from './server-api.ts';
import type { CaseSummary } from './server-api.ts';
import { clearAuthStorage, publishableKey, supabase, supabaseUrl } from './supabase.ts';
import { useServerCase } from './useServerCase.ts';
import { CASE_STORAGE_KEY, LEGACY_CASE_STORAGE_KEY, downloadStoredBackup } from './persistence.ts';
import { CaseAssignments, CaseCreation } from './CaseManagement.tsx';
import type { RenewalCase } from './domain.ts';

const AiWorkspace=lazy(()=>import('./AiWorkspace.tsx').then(module=>({default:module.AiWorkspace})));
function AiAssistance({state,server}:{state:RenewalCase;server:ReturnType<typeof useServerCase>}) {
  const [opened,setOpened]=useState(false);
  return <details className="min-w-0 rounded-lg border border-border-subtle bg-surface p-4 sm:p-5" onToggle={e=>{if(e.currentTarget.open)setOpened(true);}}><summary className="min-h-11 cursor-pointer py-2 font-heading text-base font-semibold">{t("Bantuan AI untuk sumber renewal · opsional")}</summary>{opened && <div className="mt-5"><Suspense fallback={<p role="status" className="text-sm text-text-secondary">Memuat alat persiapan dokumen…</p>}><AiWorkspace key={state.id} state={state} request={server.requestAi} loadEvidence={server.readEvidence} busy={server.busy || server.conflict || server.retryAvailable}/></Suspense></div>}</details>;
}

function hasBackup(){try{return !!(localStorage.getItem(CASE_STORAGE_KEY)||localStorage.getItem(LEGACY_CASE_STORAGE_KEY));}catch{return false;}}
function Backup() {
  const [error,setError]=useState('');
  if(!hasBackup())return null;
  return <details className="rounded-lg border border-border-subtle bg-surface p-4 text-sm"><summary className="cursor-pointer py-2 font-medium">{t("Cadangan simulasi lokal")}</summary><p className="my-3 text-text-secondary">{t("Data simulasi lama tetap di browser ini. Data tersebut tidak dimasukkan ke kasus bersama atau dipakai sebagai bukti baru.")}</p><Button onClick={()=>{try{downloadStoredBackup();}catch{setError('Cadangan belum dapat diunduh.');}}}>{t("Unduh cadangan simulasi")}</Button>{error && <p role="alert">{t(error)}</p>}</details>;
}
export default function AuthApp() {
  const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const user=useRef<string|undefined>(undefined),loginAttempt=useRef(0),signedOut=useRef(false);
  user.current=session?.user.id;
  useEffect(()=>{
    if(!supabase){setLoading(false);return;}
    let active=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{if(active && (!signedOut.current || !next)){setSession(next);setLoading(false);}});
    return()=>{active=false;subscription.unsubscribe();};
  },[]);
  async function logout() {
    loginAttempt.current++;signedOut.current=true;setSession(null);setError('');setBusy(true);
    try{await supabase?.auth.signOut({scope:'local'});}finally{clearAuthStorage();setBusy(false);}
  }
  function expire(id:string){if(user.current===id){void logout();setError('Sesi berakhir. Masuk kembali untuk melanjutkan.');}}
  if(loading)return <main className="grid min-h-screen place-items-center bg-canvas p-6 text-text-primary"><p role="status">{t("Memeriksa sesi…")}</p></main>;
  if(session)return <SignedIn key={session.user.id} session={session} onLogout={()=>void logout()} onExpired={()=>expire(session.user.id)} />;
  return <div className="min-h-screen bg-canvas text-text-primary"><header className="topbar flex min-h-19 items-center justify-between gap-4 border-b border-border-subtle bg-surface px-4 sm:px-8"><BrandLockup /><LanguageSwitcher /></header><main className="mx-auto max-w-md space-y-6 px-4 py-10 sm:py-16"><div><p className="eyebrow">{t("Workspace renewal Property All Risks")}</p><h1>{t("Masuk ke Rekonvia")}</h1><p className="mt-3 text-sm text-text-secondary">{t("Lanjutkan persiapan renewal dengan akun broker atau klien yang sudah disiapkan.")}</p></div>
    {error && <p role="alert" className="rounded-lg border border-status-blocked-fg/20 bg-status-blocked-bg p-4 text-sm text-status-blocked-fg">{t(error)}</p>}
    {!supabase?<p role="alert" className="rounded-lg border border-border-subtle bg-surface p-4">{t("Konfigurasi Supabase belum tersedia. Hubungi pengelola untuk melengkapi URL dan publishable key.")}</p>:<form className="space-y-5 rounded-xl border border-border-subtle bg-surface p-6" onSubmit={async e=>{
      e.preventDefault();if(busy)return;const form=e.currentTarget,data=new FormData(form),attempt=++loginAttempt.current;
      setBusy(true);setError('');signedOut.current=false;
      try{const {error}=await supabase!.auth.signInWithPassword({email:String(data.get('email')).trim(),password:String(data.get('password'))});
        if(attempt!==loginAttempt.current)return;
        form.reset();if(error)setError('Email atau kata sandi belum sesuai, atau akun belum aktif. Hubungi pengelola bila perlu.');
      }catch{if(attempt===loginAttempt.current)setError('Belum dapat terhubung. Periksa koneksi dan coba kembali.');}
      finally{if(attempt===loginAttempt.current)setBusy(false);}
    }}><div><label htmlFor="login-email">{t("Email")}</label><input id="login-email" name="email" type="email" autoComplete="username" required disabled={busy} /></div><div><label htmlFor="login-password">{t("Kata sandi")}</label><input id="login-password" name="password" type="password" autoComplete="current-password" required disabled={busy} /></div><Button type="submit" primary disabled={busy}>{busy?t('Memeriksa…'):t('Masuk')}</Button><p className="text-xs text-text-secondary">{t("Akun disiapkan oleh pengelola. Pemulihan akses dibantu pengelola selama pilot.")}</p></form>}
    <Backup /><p className="text-xs text-text-secondary">{t("Pilot menggunakan data fiktif. Komunikasi dengan insurer dicatat oleh broker.")}</p>
  </main></div>;
}
function SignedIn({session,onLogout,onExpired}:{session:Session;onLogout:()=>void;onExpired:()=>void}) {
  const [selected,setSelected]=useState<string|null>(null);
  if(selected)return <OpenCase key={selected} session={session} caseId={selected} onBack={()=>setSelected(null)} onLogout={onLogout} onExpired={onExpired} />;
  return <CaseList session={session} onSelect={setSelected} onLogout={onLogout} onExpired={onExpired} />;
}
function CaseList({session,onSelect,onLogout,onExpired}:{session:Session;onSelect:(id:string)=>void;onLogout:()=>void;onExpired:()=>void}) {
  const [creationDirty,setCreationDirty]=useState(false);
  const [cases,setCases]=useState<CaseSummary[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    const active=new AbortController();setLoading(true);setError('');
    void supabase!.auth.getSession().then(({data})=>{
      if(!data.session || data.session.user.id!==session.user.id)throw new RequestError(401,'INVALID_SESSION','Sesi berakhir.');
      return apiRequest<{cases:CaseSummary[]}>({url:supabaseUrl!,publishableKey:publishableKey!,token:data.session.access_token,path:'cases',signal:active.signal});
    }).then(result=>{if(!active.signal.aborted)setCases(result.cases);}).catch(cause=>{
      if(active.signal.aborted)return;
      if(cause instanceof RequestError && cause.status===401)onExpired();else setError(cause instanceof Error?cause.message:'Daftar kasus belum tersedia.');
    }).finally(()=>{if(!active.signal.aborted)setLoading(false);});
    return()=>active.abort();
  },[session.user.id,reload]);
  return <AccountLayout email={session.user.email??''} role={cases[0]?.role} title="Kasus renewal" onLogout={onLogout}><main id="account-main" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">{t("Property All Risks · pilot fiktif")}</p><h1>{t("Kasus renewal")}</h1><p className="mt-3 text-sm text-text-secondary">{t("Buka kasus yang tersedia untuk akun Anda.")}</p></div><Button onClick={()=>setReload(x=>x+1)} disabled={loading}>{t("Muat ulang daftar")}</Button></div>
    {error && <p role="alert" className="rounded-lg border border-status-blocked-fg/20 bg-status-blocked-bg p-4 text-sm text-status-blocked-fg">{t(error)}</p>}
    {loading?<p role="status">{t("Memuat kasus…")}</p>:cases.length?<div className="grid gap-4 md:grid-cols-2">{cases.map(c=><button type="button" key={c.caseId} className="group min-w-0 rounded-lg border border-border-subtle bg-surface p-6 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none" onClick={()=>{if(!creationDirty || confirm(t("Buang isian kasus baru yang belum disimpan?")))onSelect(c.caseId);}}><span className="block text-sm text-text-secondary">{c.caseId} · {c.role==='broker'?'Broker':t('Klien')}</span><strong className="my-3 block font-heading text-xl">{c.clientName}</strong><span className="text-sm font-medium text-link">{t("Buka kasus →")}</span></button>)}</div>:<div className="rounded-lg border border-border-subtle bg-surface p-6"><h2>{t("Belum ada kasus yang dapat dibuka")}</h2><p className="mt-3 text-sm text-text-secondary">{t("Klien dapat membuka kasus setelah broker memublikasikan proposal. Untuk penugasan akun, hubungi pengelola.")}</p></div>}
    <CaseCreation session={session} onCreated={onSelect} onExpired={onExpired} onDirtyChange={setCreationDirty} /><Backup />
  </main></AccountLayout>;
}
function OpenCase({session,caseId,onBack,onLogout,onExpired}:{session:Session;caseId:string;onBack:()=>void;onLogout:()=>void;onExpired:()=>void}) {
  const server=useServerCase(session,caseId,onExpired),view=server.view;
  const controls={email:session.user.email??'',pending:server.busy,conflict:server.conflict,retryAvailable:server.retryAvailable,onBack,onLogout,onReload:server.load,onRetry:server.retry,onExport:server.exportDocument,onUpload:server.upload,onDownloadDocument:server.downloadEvidence,
    aiPanel:view?.role==='broker'?<AiAssistance state={view.state} server={server}/>:undefined,
    caseAccessPanel:view?.role==='broker'?(onSaved:()=>void)=><CaseAssignments session={session} caseId={caseId} lockVersion={view.state.lockVersion} busy={server.busy || server.conflict || server.retryAvailable} onSave={server.assignClients} onSaved={onSaved} onExpired={onExpired}/>:undefined};
  if(!view)return <AccountLayout email={session.user.email??''} title="Memuat kasus" onBack={onBack} onLogout={onLogout}><main id="account-main" tabIndex={-1} className="space-y-5 p-8"><h1>{t("Memuat kasus")}</h1>{server.error?<p role="alert">{t(server.error)}</p>:<p role="status">{t("Mengambil versi dari server…")}</p>}<Button onClick={()=>void server.load()} disabled={server.busy}>{t("Coba lagi")}</Button></main></AccountLayout>;
  if(view.role==='client')return <ClientWorkspace view={view} email={session.user.email??''} onBack={onBack} onLogout={onLogout} onReload={server.load} onRetry={server.retry} busy={server.busy} error={server.error} conflict={server.conflict} retryAvailable={server.retryAvailable} onCommand={action=>server.dispatch({id:session.user.id,role:'client'},action)} onExportProposal={server.downloadPublishedProposal} />;
  return <RenewalWorkspace account={controls} store={{state:view.state,error:server.error,dispatch:server.dispatch,clearError:server.clearError,storageError:'',recoveryRequired:false,reset:()=>false}} />;
}
