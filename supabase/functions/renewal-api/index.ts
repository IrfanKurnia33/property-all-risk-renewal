import { createClient } from '@supabase/supabase-js';
import { applyAction, getActiveProposal, getCurrentQuote, getCurrentDfs, isRenewalCase } from '../_shared/domain.ts';
import type { Actor, CaseAction, RenewalCase } from '../_shared/domain.ts';
import { ApiError, assertKeys, caseIdPattern, clientProposal, clientView, commandAction, parseCommand, requiredSourceIds, uuid } from '../_shared/api-contract.ts';
import type { Command } from '../_shared/api-contract.ts';
import { fileType, MAX_FILE, validateUpload } from '../_shared/upload-validation.ts';
import { createQuoteBlob, createRenewalBlob } from '../_shared/documents.ts';

const bucket='renewal-documents';
const origins=new Set(['http://localhost:5173','http://127.0.0.1:5173','http://localhost:4173','http://127.0.0.1:4173','https://property-all-risk-renewal.vercel.app']);
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
function dbError(error: {code?:string;message?:string}|null) {
  if(!error)return;
  if(error.message?.includes('VERSION_CONFLICT')) throw new ApiError(409,'VERSION_CONFLICT','Versi kasus berubah. Muat ulang dan tinjau draf sebelum mencoba lagi.');
  if(error.message?.includes('IDEMPOTENCY_CONFLICT')) throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
  if(error.code==='42501')throw new ApiError(403,'FORBIDDEN');
  if(error.code==='P0002')throw new ApiError(404,'NOT_FOUND');
  if(error.code==='22023')throw new ApiError(422,'INVALID_TRANSITION');
  throw new ApiError(500,'DATABASE_ERROR');
}
async function body(request:Request) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415,'JSON_REQUIRED');
  if(Number(request.headers.get('content-length')??0)>256*1024)throw new ApiError(413,'REQUEST_TOO_LARGE');
  const reader=request.body?.getReader(); if(!reader)throw new ApiError(422,'BODY_REQUIRED');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();throw new ApiError(413,'REQUEST_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(422,'INVALID_JSON');}
}
async function context(caseId:string,userId:string):Promise<{state:RenewalCase;actor:Actor;workspaceId:string}> {
  if(!caseIdPattern.test(caseId))throw new ApiError(404,'NOT_FOUND');
  const {data:c,error}=await service.from('renewal_cases').select('workspace_id,state').eq('id',caseId).maybeSingle();dbError(error);
  if(!c)throw new ApiError(404,'NOT_FOUND');
  const {data:m,error:me}=await service.from('memberships').select('role').eq('workspace_id',c.workspace_id).eq('user_id',userId).maybeSingle();dbError(me);
  if(!m)throw new ApiError(404,'NOT_FOUND');
  if(m.role==='client') {
    const {data:a,error:ae}=await service.from('client_case_assignments').select('case_id').eq('case_id',caseId).eq('user_id',userId).maybeSingle();dbError(ae);
    if(!a)throw new ApiError(404,'NOT_FOUND');
  }
  if(!isRenewalCase(c.state))throw new ApiError(500,'INVALID_STORED_CASE');
  return {state:c.state,actor:{id:userId,role:m.role},workspaceId:c.workspace_id};
}
const view=(state:RenewalCase,actor:Actor)=>actor.role==='broker'?{role:'broker',state}:{role:'client',...clientView(state,actor.id)};
const broker=(actor:Actor)=>{if(actor.role!=='broker')throw new ApiError(403,'BROKER_REQUIRED');};
async function retry(command:Command,actor:Actor) {
  const {data,error}=await service.from('command_receipts').select('request,result').eq('case_id',command.caseId).eq('actor_id',actor.id).eq('idempotency_key',command.idempotencyKey).maybeSingle();dbError(error);
  if(!data)return null;
  const normalized=(x:unknown):unknown=>x && typeof x==='object' ? Array.isArray(x)?x.map(normalized):
    Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalized(v)])):x;
  if(JSON.stringify(normalized(data.request))!==JSON.stringify(normalized(command)))throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
  return data.result;
}
async function proof(state:RenewalCase,action:CaseAction) {
  const ids=requiredSourceIds(state,action); if(!ids.length)return;
  const {data,error}=await service.from('document_versions').select('id,source_version_id,sha256').eq('case_id',state.id).eq('upload_status','finalized').in('source_version_id',ids);dbError(error);
  if(ids.some(id=>!data?.some(row=>row.source_version_id===id && state.documents.find(d=>d.id===id)?.file?.id===row.id && state.documents.find(d=>d.id===id)?.file?.sha256===row.sha256)))
    throw new ApiError(422,'SOURCE_FILE_REQUIRED','Unggah dan finalisasi berkas sumber yang dirujuk sebelum melanjutkan.');
}
async function commit(command:Command,state:RenewalCase,actor:Actor,artifact:unknown=null) {
  const saved=await retry(command,actor);if(saved)return saved;
  if(state.lockVersion!==command.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT');
  const action=commandAction(command);
  let next:RenewalCase;
  try{next=applyAction(state,actor,action,command.expectedVersion);}catch(error){throw new ApiError(422,'WORKFLOW_BLOCKED',error instanceof Error?error.message:'Perintah tidak valid.');}
  await proof(state,action);
  const proposal=action.type==='publishProposal'?clientProposal(getActiveProposal(next)!):null;
  const {data,error}=await service.rpc('commit_case_command',{p_case_id:state.id,p_actor:actor.id,p_expected_version:command.expectedVersion,
    p_idempotency_key:command.idempotencyKey,p_request:command,p_next_state:next,p_client_proposal:proposal,p_artifact:artifact});dbError(error);
  return data;
}
async function download(path:string) {
  const {data,error}=await service.storage.from(bucket).createSignedUrl(path,60);
  if(error || !data)throw new ApiError(500,'DOWNLOAD_UNAVAILABLE');
  return {url:data.signedUrl,expiresIn:60};
}
async function exportLink(artifact:{path:string;id:string;manifest:unknown}) {
  return {...await download(artifact.path),id:artifact.id,manifest:artifact.manifest};
}
async function handle(request:Request,userId:string) {
  const segments=new URL(request.url).pathname.split('/').filter(Boolean);
  const base=segments.indexOf('renewal-api'); const parts=segments.slice(base+1);
  if(parts[0]!=='cases')throw new ApiError(404,'NOT_FOUND');
  if(parts.length===1 && request.method==='GET') {
    // Use the caller's JWT for the list as an additional RLS check.
    const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('authorization')!}},auth:{persistSession:false}});
    const [{data:cases,error},{data:published,error:pe}]=await Promise.all([
      caller.from('renewal_cases').select('id,state,lock_version'),caller.from('published_client_proposals').select('case_id,id,snapshot')]);
    dbError(error);dbError(pe);
    const summaries=cases?.map(c=>({caseId:c.id,clientName:c.state.clientName,lockVersion:c.lock_version,role:'broker'}))??[];
    const known=new Set(summaries.map(c=>c.caseId));
    for(const caseId of new Set((published??[]).map(p=>p.case_id)))if(!known.has(caseId)) {
      const {state,actor}=await context(caseId,userId);
      summaries.push({caseId,clientName:state.clientName,lockVersion:state.lockVersion,role:actor.role});
    }
    return {cases:summaries};
  }
  const caseId=parts[1];const {state,actor,workspaceId}=await context(caseId,userId);
  if(parts.length===2 && request.method==='GET')return view(state,actor);
  if(parts[2]==='commands' && parts.length===3 && request.method==='POST') {
    const command=parseCommand(await body(request));if(command.caseId!==caseId)throw new ApiError(422,'CASE_MISMATCH');
    const result=await commit(command,state,actor);return view(result.state,actor);
  }
  if(parts[2]==='uploads' && parts[3]==='start' && parts.length===4 && request.method==='POST') {
    broker(actor);const input=await body(request);assertKeys(input,['documentVersionId','name','byteSize','mimeType']);
    if(typeof input.documentVersionId!=='string' || !state.documents.some(d=>d.id===input.documentVersionId && !d.file)
      || typeof input.name!=='string' || typeof input.mimeType!=='string' || fileType(input.name)!==input.mimeType
      || !Number.isSafeInteger(input.byteSize) || Number(input.byteSize)<1 || Number(input.byteSize)>MAX_FILE)throw new ApiError(422,'INVALID_UPLOAD');
    const existing=await service.from('document_versions').select('*').eq('case_id',caseId).eq('source_version_id',input.documentVersionId).maybeSingle();dbError(existing.error);
    let row=existing.data;
    if(row && (row.created_by!==actor.id || row.upload_status!=='pending' || row.display_name!==input.name || row.mime_type!==input.mimeType || row.byte_size!==input.byteSize))throw new ApiError(409,'UPLOAD_ALREADY_RESERVED');
    if(row && new Date(row.expires_at).getTime()<Date.now())throw new ApiError(422,'UPLOAD_EXPIRED','Create a new document version for a new upload attempt.');
    if(!row){
      // shortcut: the fictional pilot retains abandoned reservations/objects. Add scheduled cleanup before accepting live documents or repeated long-running pilots.
      const id=crypto.randomUUID(),path=`${workspaceId}/${caseId}/sources/${id}`;
      const {data,error}=await service.from('document_versions').insert({id,case_id:caseId,source_version_id:input.documentVersionId,display_name:input.name,
        object_path:path,mime_type:input.mimeType,byte_size:input.byteSize,created_by:actor.id}).select().single();dbError(error);row=data;
    }
    const {data,error}=await service.storage.from(bucket).createSignedUploadUrl(row.object_path,{upsert:false});
    if(error || !data)throw new ApiError(500,'UPLOAD_UNAVAILABLE');
    return {documentId:row.id,path:row.object_path,token:data.token,signedUrl:data.signedUrl,expiresAt:row.expires_at};
  }
  if(parts[2]==='uploads' && uuid.test(parts[3]??'') && parts[4]==='finalize' && parts.length===5 && request.method==='POST') {
    broker(actor);const input=await body(request);
    assertKeys(input,['expectedVersion','idempotencyKey',...(input && typeof input==='object' && Object.hasOwn(input,'sha256')?['sha256']:[])]);
    if(input.sha256!==undefined && (typeof input.sha256!=='string' || !/^[a-f0-9]{64}$/.test(input.sha256)))throw new ApiError(422,'INVALID_HASH');
    const {data:doc,error}=await service.from('document_versions').select('*').eq('id',parts[3]).eq('case_id',caseId).eq('created_by',actor.id).maybeSingle();dbError(error);
    if(!doc)throw new ApiError(404,'NOT_FOUND');
    if(doc.upload_status==='finalized' && input.sha256!==undefined && doc.sha256!==input.sha256)throw new ApiError(422,'UPLOAD_HASH_MISMATCH');
    const command=parseCommand({caseId,expectedVersion:input.expectedVersion,idempotencyKey:input.idempotencyKey,type:'attachEvidence',payload:{documentVersionId:doc.source_version_id,
      file:{id:doc.id,sha256:doc.sha256??'0'.repeat(64),byteSize:doc.byte_size,mimeType:doc.mime_type}}},true);
    // On retry the finalized immutable hash reconstructs the exact original command.
    if(doc.upload_status==='finalized'){const saved=await retry(command,actor);if(saved)return view(saved.state,actor);throw new ApiError(409,'UPLOAD_ALREADY_FINALIZED');}
    if(new Date(doc.expires_at).getTime()<Date.now())throw new ApiError(422,'UPLOAD_EXPIRED');
    const {data:file,error:de}=await service.storage.from(bucket).download(doc.object_path);
    if(de || !file)throw new ApiError(422,'UPLOAD_INCOMPLETE');
    if(file.size!==doc.byte_size || file.size>MAX_FILE)throw new ApiError(422,'UPLOAD_SIZE_MISMATCH');
    const bytes=new Uint8Array(await file.arrayBuffer());validateUpload(bytes,doc.display_name,doc.mime_type);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(input.sha256!==undefined && input.sha256!==hash)throw new ApiError(422,'UPLOAD_HASH_MISMATCH');
    command.payload.file={id:doc.id,sha256:hash,byteSize:doc.byte_size,mimeType:doc.mime_type};
    const result=await commit(command,state,actor,{kind:'upload',id:doc.id,sha256:hash});return view(result.state,actor);
  }
  if(parts[2]==='documents' && uuid.test(parts[3]??'') && parts.length===5 && request.method==='POST') {
    const {data:doc,error}=await service.from('document_versions').select('*').eq('id',parts[3]).eq('case_id',caseId).eq('upload_status','finalized').maybeSingle();dbError(error);
    if(!doc || (actor.role==='client' && !doc.shared_with_clients))throw new ApiError(404,'NOT_FOUND');
    if(parts[4]==='download')return download(doc.object_path);
    // Sharing is deliberately not implemented as an unversioned table update.
  }
  if(parts[2]==='exports' && parts.length===3 && request.method==='POST') {
    broker(actor);const input=await body(request);assertKeys(input,['kind','expectedVersion','idempotencyKey']);
    if(input.kind!=='QS' && input.kind!=='DFS')throw new ApiError(422,'EXPORT_TEMPLATE_UNAVAILABLE');
    // Reconstruct an old export request before looking at today's current snapshot.
    // A successful identical retry remains valid after a subsequent material edit.
    if(typeof input.idempotencyKey!=='string' || !uuid.test(input.idempotencyKey))throw new ApiError(422,'INVALID_COMMAND');
    input.idempotencyKey=input.idempotencyKey.toLowerCase();
    const prior=await service.from('command_receipts').select('request').eq('case_id',caseId).eq('actor_id',actor.id).eq('idempotency_key',input.idempotencyKey).maybeSingle();dbError(prior.error);
    const snapshot=input.kind==='QS'?getCurrentQuote(state):getCurrentDfs(state);
    if(prior.data) {
      if(prior.data.request.type!=='recordExport')throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
      const priorCommand=parseCommand({caseId,expectedVersion:input.expectedVersion,idempotencyKey:input.idempotencyKey,type:'recordExport',
        payload:{kind:input.kind,snapshotId:prior.data.request.payload.snapshotId}},true);
      const priorResult=await retry(priorCommand,actor);
      return {...view(priorResult.state,actor),artifact:await exportLink(priorResult.artifact)};
    }
    if(!snapshot)throw new ApiError(422,'SNAPSHOT_REQUIRED');
    const command=parseCommand({caseId,expectedVersion:input.expectedVersion,idempotencyKey:input.idempotencyKey,type:'recordExport',payload:{kind:input.kind,snapshotId:snapshot.id}},true);
    const saved=await retry(command,actor);if(saved)return {...view(saved.state,actor),artifact:await exportLink(saved.artifact)};
    if(state.lockVersion!==command.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT');
    await proof(state,commandAction(command));
    try{applyAction(state,actor,commandAction(command),command.expectedVersion);}catch(error){throw new ApiError(422,'WORKFLOW_BLOCKED',error instanceof Error?error.message:'Export blocked.');}
    const blob=await (input.kind==='QS'?createQuoteBlob(state):createRenewalBlob(state));
    const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length>MAX_FILE)throw new ApiError(422,'EXPORT_TOO_LARGE');
    const id=crypto.randomUUID(),path=`${workspaceId}/${caseId}/exports/${id}.docx`;
    const {error}=await service.storage.from(bucket).upload(path,bytes,{contentType:fileType('export.docx'),upsert:false});if(error)throw new ApiError(500,'EXPORT_STORAGE_ERROR');
    const artifact={kind:'export',id,path,manifest:{kind:input.kind,snapshotId:snapshot.id,caseId,lockVersion:state.lockVersion,revision:state.revision,sourceVersionIds:state.documents.filter(d=>d.file).map(d=>({id:d.id,sha256:d.file!.sha256})),fictional:state.fictional}};
    let result;
    try{result=await commit(command,state,actor,artifact);}catch(error){await service.storage.from(bucket).remove([path]);throw error;}
    // A simultaneous identical retry may have committed a different generated path.
    if(result.artifact.path!==path)await service.storage.from(bucket).remove([path]);
    return {...view(result.state,actor),artifact:await exportLink(result.artifact)};
  }
  throw new ApiError(404,'NOT_FOUND');
}
Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  const cors:Record<string,string>={'Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(origin && origins.has(origin)){cors['Access-Control-Allow-Origin']=origin;cors['Access-Control-Allow-Headers']='authorization,apikey,content-type,x-client-info';cors['Access-Control-Allow-Methods']='GET,POST,OPTIONS';}
  const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
  try{
    if(origin && !origins.has(origin))throw new ApiError(403,'ORIGIN_FORBIDDEN');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    const authorization=request.headers.get('authorization');
    if(!authorization?.startsWith('Bearer '))throw new ApiError(401,'AUTH_REQUIRED');
    const {data,error}=await service.auth.getUser(authorization.slice(7));
    if(error || !data.user)throw new ApiError(401,'INVALID_SESSION');
    return respond(await handle(request,data.user.id));
  }catch(error){
    if(error instanceof ApiError)return respond({error:{code:error.code,message:error.message}},error.status);
    console.error('renewal-api unexpected failure',error instanceof Error?error.name:'unknown');
    return respond({error:{code:'INTERNAL_ERROR',message:'Request failed.'}},500);
  }
});
