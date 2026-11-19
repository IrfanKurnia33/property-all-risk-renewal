import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Button, Panel } from './App.tsx';
import { apiRequest, RequestError } from './server-api.ts';
import { publishableKey, supabase, supabaseUrl } from './supabase.ts';

interface ClientAccount {userId:string;email:string}
interface Workspace {workspaceId:string;name:string;clients:ClientAccount[]}
interface Assignments {workspaceId:string;lockVersion:number;clients:ClientAccount[];clientUserIds:string[]}
async function request<T>(session:Session,path:string,input?:unknown,signal?:AbortSignal):Promise<T> {
  const auth=await supabase!.auth.getSession();
  if(!auth.data.session || auth.data.session.user.id!==session.user.id)throw new RequestError(401,'INVALID_SESSION','Sesi berakhir.');
  return apiRequest<T>({url:supabaseUrl!,publishableKey:publishableKey!,token:auth.data.session.access_token,path,input,signal});
}
function message(cause:unknown){return cause instanceof Error?cause.message:'Permintaan belum berhasil.';}

export function CaseCreation({session,onCreated,onExpired,onDirtyChange}:{session:Session;onCreated:(id:string)=>void;onExpired:()=>void;onDirtyChange?:(dirty:boolean)=>void}) {
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]),[workspaceId,setWorkspaceId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [locations,setLocations]=useState([crypto.randomUUID()]);
  const [dirty,setDirty]=useState(false);
  const [setupReload,setSetupReload]=useState(0);
  const pending=useRef<Record<string,unknown>|null>(null),inFlight=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const active=new AbortController();controller.current=active;setError('');
    void request<{workspaces:Workspace[]}>(session,'case-setup',undefined,active.signal).then(result=>{
      if(!active.signal.aborted){setWorkspaces(result.workspaces);setWorkspaceId(result.workspaces[0]?.workspaceId??'');}
    }).catch(cause=>{if(active.signal.aborted)return;if(cause instanceof RequestError && cause.status===401)onExpired();else if(!(cause instanceof RequestError && cause.status===403))setError(message(cause));});
    return()=>{active.abort();pending.current=null;};
  },[session.user.id,setupReload]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty)e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  async function save(input:Record<string,unknown>) {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');pending.current=input;
    try{
      const result=await request<{state:{id:string}}>(session,'cases',input,controller.current!.signal);
      if(controller.current!.signal.aborted)return;
      pending.current=null;setUncertain(false);setDirty(false);onDirtyChange?.(false);onCreated(result.state.id);
    }catch(cause){
      if(controller.current?.signal.aborted)return;
      if(cause instanceof RequestError && cause.status===401)onExpired();
      else {setError(message(cause));setUncertain(cause instanceof RequestError && (cause.status===0 || cause.status>=500));}
    }finally{inFlight.current=false;if(!controller.current?.signal.aborted)setBusy(false);}
  }
  if(!workspaces.length)return error?<div className="space-y-3"><p role="alert" className="text-sm text-status-blocked-fg">Formulir kasus belum tersedia: {error}</p><Button onClick={()=>setSetupReload(v=>v+1)}>Muat ulang formulir kasus</Button></div>:null;
  const workspace=workspaces.find(w=>w.workspaceId===workspaceId)!;
  return <details className="rounded-lg border border-border-subtle bg-surface p-5 sm:p-6"><summary className="cursor-pointer py-2 font-heading text-lg font-semibold">Buat kasus renewal fiktif</summary><p className="my-4 text-sm text-text-secondary">Kasus baru memakai isian awal bertanda template. Ganti terms dan wording, lalu unggah sumber sebelum menyiapkan QS. Template tidak menjadi bukti persetujuan atau konfirmasi klien. Akun klien baru tetap dibuat oleh pengelola.</p>
    {error && <p role="alert" className="my-4 rounded-md bg-status-blocked-bg p-4 text-sm text-status-blocked-fg">{error}</p>}
    <form id="create-case" className="space-y-5" onChange={()=>{setDirty(true);onDirtyChange?.(true);}} onSubmit={e=>{
      e.preventDefault();if(uncertain)return;const data=new FormData(e.currentTarget);
      void save({workspaceId,caseId:String(data.get('case-id')).trim(),clientName:String(data.get('client-name')).trim(),periodStart:String(data.get('period-start')),periodEnd:String(data.get('period-end')),priorPeriodStart:String(data.get('prior-period-start')),priorPeriodEnd:String(data.get('prior-period-end')),clientUserIds:data.getAll('client-user').map(String),idempotencyKey:crypto.randomUUID(),historicalLocations:locations.map(id=>({name:String(data.get('location-name-'+id)).trim(),address:String(data.get('location-address-'+id)).trim(),sumInsured:{amount:String(data.get('location-si-'+id)).trim(),currency:'IDR'}}))});
    }}><fieldset disabled={busy || uncertain} className="space-y-5 border-0 p-0">
      <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="case-workspace">Workspace brokerage</label><select id="case-workspace" className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base text-text-primary" value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}>{workspaces.map(w=><option key={w.workspaceId} value={w.workspaceId}>{w.name}</option>)}</select></div><div><label htmlFor="case-id">ID kasus unik</label><input id="case-id" name="case-id" required maxLength={160} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" placeholder="PAR-2027-003" /></div><div className="sm:col-span-2"><label htmlFor="case-client-name">Nama klien fiktif</label><input id="case-client-name" name="client-name" required maxLength={200} placeholder="PT Contoh Renewal (Fiktif)" /></div><div><label htmlFor="case-period-start">Awal periode renewal</label><input id="case-period-start" name="period-start" type="date" required /></div><div><label htmlFor="case-period-end">Akhir periode renewal</label><input id="case-period-end" name="period-end" type="date" required /></div></div>
      <fieldset className="space-y-5 rounded-md border border-border-subtle p-4"><legend className="px-2 text-sm font-semibold">Schedule historis · belum dikonfirmasi klien</legend><p className="text-sm text-text-secondary">Salin data fiktif periode sebelumnya. Pertahankan satu baris per lokasi. Nilai ini dipakai pada QS awal dan harus dikonfirmasi klien untuk periode renewal.</p>{locations.map((id,index)=><div key={id} className="space-y-4 border-t border-border-subtle pt-4"><div><label htmlFor={'location-name-'+id}>Nama lokasi historis {index+1}</label><input id={'location-name-'+id} name={'location-name-'+id} required maxLength={200}/></div><div><label htmlFor={'location-address-'+id}>Alamat historis {index+1}</label><textarea id={'location-address-'+id} name={'location-address-'+id} required maxLength={1000}/></div><div><label htmlFor={'location-si-'+id}>Sum insured historis {index+1} (IDR, desimal titik)</label><input id={'location-si-'+id} name={'location-si-'+id} inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" required maxLength={40}/></div>{locations.length>1 && <Button onClick={()=>setLocations(ids=>ids.filter(i=>i!==id))}>Hapus lokasi historis {index+1}</Button>}</div>)}<Button disabled={locations.length>=100} onClick={()=>setLocations(ids=>[...ids,crypto.randomUUID()])}>Tambah lokasi historis</Button></fieldset>
      <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="case-prior-start">Awal periode sumber historis</label><input id="case-prior-start" name="prior-period-start" type="date" required /></div><div><label htmlFor="case-prior-end">Akhir periode sumber historis</label><input id="case-prior-end" name="prior-period-end" type="date" required /></div></div><p className="text-xs text-text-secondary">Periode historis harus berakhir sebelum periode renewal. Tanggal historis dicatat dari sumber, bukan diasumsikan oleh aplikasi.</p>
      <fieldset key={workspaceId} className="space-y-3 rounded-md border border-border-subtle p-4"><legend className="px-2 text-sm font-semibold">Akses akun klien yang sudah tersedia</legend>{workspace.clients.length?workspace.clients.map(c=><label key={c.userId} className="flex min-h-11 items-center gap-3 py-1"><input type="checkbox" name="client-user" value={c.userId}/><span className="min-w-0 break-all text-sm">{c.email}</span></label>):<p className="text-sm text-text-secondary">Belum ada akun klien di workspace ini. Pengelola perlu menambahkan akun dan membership.</p>}<p className="text-xs text-text-secondary">Penugasan memberi akses setelah proposal dipublikasikan. Satu akun hanya boleh dipilih untuk klien yang tepat.</p></fieldset>
      <Button primary type="submit">Buat kasus</Button>
    </fieldset></form>{uncertain && <div className="mt-4 space-y-3"><p className="text-sm text-text-secondary">Hasil pembuatan belum pasti. Ulangi permintaan yang sama agar tidak membuat kasus ganda.</p><Button disabled={busy} onClick={()=>{if(pending.current)void save(pending.current);}}>Coba ulang pembuatan yang sama</Button></div>}
  </details>;
}

export function CaseAssignments({session,caseId,lockVersion,busy,onSave,onSaved,onExpired}:{session:Session;caseId:string;lockVersion:number;busy:boolean;onSave:(ids:string[])=>Promise<boolean>;onSaved:()=>void;onExpired:()=>void}) {
  const [access,setAccess]=useState<Assignments|null>(null),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[baseVersion,setBaseVersion]=useState(lockVersion),[reload,setReload]=useState(0),[status,setStatus]=useState('');
  useEffect(()=>{
    const active=new AbortController();
    void request<Assignments>(session,`cases/${caseId}/assignments`,undefined,active.signal).then(result=>{
      if(!active.signal.aborted){setAccess(result);setError('');if(!dirty){setSelected(result.clientUserIds);setBaseVersion(result.lockVersion);}}
    }).catch(cause=>{if(active.signal.aborted)return;if(cause instanceof RequestError && cause.status===401)onExpired();else setError(message(cause));});
    return()=>active.abort();
  },[session.user.id,caseId,lockVersion,reload,dirty]);
  const stale=dirty && baseVersion!==lockVersion;
  return <Panel title="Akses klien pada kasus" description="Broker menugaskan akun klien dari workspace yang sama. Klien mulai mengakses setelah proposal dipublikasikan.">
    {error && <p role="alert" className="text-sm text-status-blocked-fg">{error}</p>}{status && <p role="status" className="text-sm">{status}</p>}
    {access?<form id="case-assignments" className="space-y-4" onSubmit={async e=>{e.preventDefault();if(stale)return;if(await onSave(selected)){setDirty(false);setStatus('Akses klien tersimpan.');setReload(v=>v+1);onSaved();}}}><fieldset disabled={busy} className="space-y-3 border-0 p-0"><legend className="sr-only">Akun klien yang ditugaskan</legend>{access.clients.map(c=><label key={c.userId} className="flex min-h-11 items-center gap-3 py-1"><input type="checkbox" checked={selected.includes(c.userId)} onChange={e=>{if(!dirty)setBaseVersion(lockVersion);setDirty(true);setStatus('');setSelected(ids=>e.target.checked?[...ids,c.userId]:ids.filter(id=>id!==c.userId));}}/><span className="min-w-0 break-all text-sm">{c.email}</span></label>)}{!access.clients.length && <p className="text-sm text-text-secondary">Pengelola belum menambahkan akun klien pada workspace ini.</p>}</fieldset>
      <p className="text-xs text-text-secondary">Akun yang sudah memberikan bukti atau keputusan tidak dapat dilepas di sini. Perubahan akses tersebut memerlukan peninjauan pengelola. Akses terkunci setelah binding selesai.</p>
      {stale && <div className="space-y-3 text-sm text-status-pending-fg"><p>Versi kasus berubah. Periksa daftar akses tersimpan sebelum mengirim pilihan Anda.</p><p>Akses tersimpan: {access.clients.filter(c=>access.clientUserIds.includes(c.userId)).map(c=>c.email).join(', ')||'Tidak ada'}</p><Button disabled={busy} onClick={()=>setBaseVersion(lockVersion)}>Saya sudah meninjau akses terbaru</Button></div>}
      <Button type="submit" disabled={busy || !dirty || stale}>Simpan akses klien</Button>
    </form>:error?<Button disabled={busy} onClick={()=>setReload(v=>v+1)}>Muat ulang akses klien</Button>:<p role="status" className="text-sm text-text-secondary">Memuat akun klien…</p>}
  </Panel>;
}
