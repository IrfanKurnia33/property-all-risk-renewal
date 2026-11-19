import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isRenewalCase } from './domain.ts';
import type { Actor, CaseAction } from './domain.ts';
import { apiRequest, commandEnvelope, RequestError } from './server-api.ts';
import type { CaseView } from './server-api.ts';
import { publishableKey, supabase, supabaseUrl } from './supabase.ts';
import { fileType } from '../supabase/functions/_shared/upload-validation.ts';

export function useServerCase(session:Session,caseId:string,onExpired:()=>void) {
  const [view,setView]=useState<CaseView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[retryAvailable,setRetryAvailable]=useState(false);
  const current=useRef<CaseView|null>(null),controller=useRef<AbortController|null>(null),inFlight=useRef(false);
  const pending=useRef<null|(()=>Promise<void>)>(null);
  function accept(next:CaseView) {
    if(next.role==='broker' && !isRenewalCase(next.state))throw new RequestError(500,'INVALID_CASE','Data kasus tidak dapat dibaca.');
    const version=next.role==='broker'?next.state.lockVersion:next.lockVersion;
    const before=current.current;const previous=before?(before.role==='broker'?before.state.lockVersion:before.lockVersion):-1;
    if(version>=previous){current.current=next;setView(next);}
  }
  async function request<T>(path:string,input?:unknown):Promise<T> {
    const active=controller.current;if(!active || active.signal.aborted)throw new DOMException('Closed session','AbortError');
    const auth=await supabase!.auth.getSession();
    if(!auth.data.session || auth.data.session.user.id!==session.user.id)throw new RequestError(401,'INVALID_SESSION','Sesi berubah. Masuk kembali.');
    const result=await apiRequest<T>({url:supabaseUrl!,publishableKey:publishableKey!,token:auth.data.session.access_token,path,input,signal:active.signal});
    if(active!==controller.current || active.signal.aborted)throw new DOMException('Closed session','AbortError');
    return result;
  }
  function failed(cause:unknown) {
    if(controller.current?.signal.aborted)return;
    if(cause instanceof RequestError && cause.status===401){onExpired();return;}
    setError(cause instanceof Error?cause.message:'Permintaan belum berhasil.');
    setConflict(cause instanceof RequestError && cause.code==='VERSION_CONFLICT');
  }
  async function load() {
    if(inFlight.current || pending.current)return;
    const active=controller.current;
    inFlight.current=true;setBusy(true);
    try{accept(await request<CaseView>(`cases/${caseId}`));setError('');setConflict(false);}
    catch(cause){if(active===controller.current && !active?.signal.aborted)failed(cause);}
    finally{if(active===controller.current){inFlight.current=false;if(!active?.signal.aborted)setBusy(false);}}
  }
  useEffect(()=>{
    const active=new AbortController();controller.current=active;inFlight.current=false;
    void load();
    return ()=>{active.abort();current.current=null;pending.current=null;};
  },[session.user.id,caseId]);
  async function perform(task:()=>Promise<void>,isRetry=false):Promise<boolean> {
    if(inFlight.current || !current.current)return false;
    if(pending.current && !isRetry){setError('Coba ulang tindakan yang belum pasti sebelum memulai tindakan lain.');return false;}
    if(conflict && !isRetry){setError('Muat ulang versi terbaru dan tinjau isian Anda sebelum menyimpan kembali.');return false;}
    inFlight.current=true;setBusy(true);setError('');pending.current=task;
    try{await task();pending.current=null;setRetryAvailable(false);setConflict(false);return true;}
    catch(cause){
      if(cause instanceof RequestError && (cause.status===0 || cause.status>=500))setRetryAvailable(true);
      else{pending.current=null;setRetryAvailable(false);}
      failed(cause);return false;
    } finally{inFlight.current=false;if(!controller.current?.signal.aborted)setBusy(false);}
  }
  const version=()=>{const v=current.current!;return v.role==='broker'?v.state.lockVersion:v.lockVersion;};
  async function dispatch(_actor:Actor,action:CaseAction) {
    if(!current.current)return false;
    const input=commandEnvelope(caseId,version(),action);
    return perform(async()=>accept(await request<CaseView>(`cases/${caseId}/commands`,input)));
  }
  async function exportDocument(kind:'QS'|'DFS') {
    const input={kind,expectedVersion:version(),idempotencyKey:crypto.randomUUID()};
    return perform(async()=>{
      const result=await request<CaseView & {artifact:{url:string}}>(`cases/${caseId}/exports`,input);
      const signed=new URL(result.artifact.url);if(signed.origin!==supabaseUrl)throw new Error('Alamat unduhan tidak valid.');
      let response:Response;
      try{response=await fetch(signed,{signal:controller.current!.signal,cache:'no-store'});}catch{throw new RequestError(0,'NETWORK_ERROR','Unduhan terputus. Coba ulang untuk mengambil dokumen yang sama.');}
      if(!response.ok)throw new RequestError(0,'DOWNLOAD_FAILED','Dokumen belum dapat diunduh. Coba ulang.');
      const blob=await response.blob();if(blob.size>10*1024*1024)throw new Error('Ukuran unduhan melebihi batas.');
      if(controller.current!.signal.aborted)return;
      const {downloadBlob}=await import('./downloads.ts');if(controller.current!.signal.aborted)return;downloadBlob(blob,caseId+'-'+kind+'.docx');accept(result);
    });
  }
  async function upload(sourceId:string,file:File) {
    const input={expectedVersion:version(),idempotencyKey:crypto.randomUUID()};
    let mimeType:string;
    try{mimeType=fileType(file.name);}catch(cause){failed(cause);return false;}
    if(!file.size || file.size>10*1024*1024){setError('Gunakan berkas tidak kosong, maksimum 10 MiB.');return false;}
    let reservation:{documentId:string;path:string;token:string}|undefined,uploaded=false;
    return perform(async()=>{
      if(!reservation)reservation=await request(`cases/${caseId}/uploads/start`,{documentVersionId:sourceId,name:file.name,byteSize:file.size,mimeType});
      const bytes=await file.arrayBuffer();
      const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(!uploaded){
        const result=await supabase!.storage.from('renewal-documents').uploadToSignedUrl(reservation!.path,reservation!.token,file,{contentType:mimeType,upsert:false});
        const code=result.error && 'statusCode' in result.error?Number(result.error.statusCode):0;
        if(result.error && code!==409)throw new RequestError(code,'UPLOAD_FAILED','Unggahan belum selesai. Coba ulang unggahan yang sama.');
        uploaded=true;
      }
      accept(await request<CaseView>(`cases/${caseId}/uploads/${reservation!.documentId}/finalize`,{...input,sha256}));
    });
  }
  async function downloadEvidence(id:string) {
    try{
      const result=await request<{url:string}>(`cases/${caseId}/documents/${id}/download`,{});
      if(controller.current!.signal.aborted)return;
      const signed=new URL(result.url);if(signed.origin!==supabaseUrl)throw new Error('Alamat unduhan tidak valid.');
      const response=await fetch(signed,{signal:controller.current!.signal,cache:'no-store'});if(!response.ok)throw new Error('Berkas belum dapat diunduh.');
      const blob=await response.blob();if(controller.current!.signal.aborted)return;
      const name=current.current?.role==='broker'?current.current.state.documents.find(d=>d.file?.id===id)?.name:'bukti';
      const {downloadBlob}=await import('./downloads.ts');if(!controller.current!.signal.aborted)downloadBlob(blob,name??'bukti');
    }catch(cause){failed(cause);}
  }
  return {view,error,busy,conflict,retryAvailable,dispatch,load,upload,exportDocument,downloadEvidence,
    retry:async()=>pending.current?perform(pending.current,true):false,clearError:()=>setError('')};
}
