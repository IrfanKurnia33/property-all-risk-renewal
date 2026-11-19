import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { strToU8, unzipSync } from 'fflate';
import { verifiedAdmin } from './supabase-admin.mjs';
import { createInitialCase, getCurrentWording, getCurrentQuote, getActiveProposal, sampleClientResponse } from '../supabase/functions/_shared/domain.ts';

if(process.env.REKONVIA_RUN_HOSTED_TESTS!=='1')throw new Error('Set REKONVIA_RUN_HOSTED_TESTS=1 to create clearly fictional QA records and temporary test accounts.');
const {url,admin,publicKey}=await verifiedAdmin();
const run=Date.now().toString(36), workspace=randomUUID(),foreignWorkspace=randomUUID();
const caseA='QA-'+run+'-A',caseB='QA-'+run+'-B',caseForeign='QA-'+run+'-FOREIGN';
const accounts=[];let assertions=0;
function check(error){if(error)throw new Error('Supabase operation failed ('+error.code+').');}
async function api(user,path,method='GET',input,expected=200){
  const response=await fetch(url+'/functions/v1/renewal-api/'+path,{method,headers:{apikey:publicKey,...(user?{Authorization:'Bearer '+user.token}:{}),...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(45000)});
  const data=await response.json();assert.equal(response.status,expected,`API ${method} ${path}: expected ${expected}, got ${response.status} (${data.error?.code??'no code'})`);assertions++;return data;
}
async function command(user,state,type,payload={},expected=200,key=randomUUID()){
  const envelope={caseId:state.id,expectedVersion:state.lockVersion,idempotencyKey:key,type,payload};
  const result=await api(user,`cases/${state.id}/commands`,'POST',envelope,expected);return {result,envelope};
}
async function upload(user,state,sourceId,bytes=strToU8('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF')){
  const start=await api(user,`cases/${state.id}/uploads/start`,'POST',{documentVersionId:sourceId,name:sourceId+'.pdf',byteSize:bytes.length,mimeType:'application/pdf'});
  const {error}=await user.client.storage.from('renewal-documents').uploadToSignedUrl(start.path,start.token,bytes,{contentType:'application/pdf'});check(error);
  const input={expectedVersion:state.lockVersion,idempotencyKey:randomUUID(),sha256:createHash('sha256').update(bytes).digest('hex')};
  await api(user,`cases/${state.id}/uploads/${start.documentId}/finalize`,'POST',{...input,sha256:'0'.repeat(64)},422);
  const result=await api(user,`cases/${state.id}/uploads/${start.documentId}/finalize`,'POST',input);
  const retried=await api(user,`cases/${state.id}/uploads/${start.documentId}/finalize`,'POST',input);assert.equal(retried.state.lockVersion,result.state.lockVersion);assertions++;
  return {state:result.state,documentId:start.documentId,path:start.path};
}
try{
  const noAuth=await api(null,'cases','GET',undefined,401);assert.equal(noAuth.error.code,'AUTH_REQUIRED');
  const bad=await api({token:publicKey},'cases','GET',undefined,401);assert.equal(bad.error.code,'INVALID_SESSION');
  for(let i=0;i<4;i++){
    const email=`rekonvia-qa-${run}-${i}@example.invalid`,password=randomBytes(32).toString('base64url');
    const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{qa_run:run}});check(error);
    const account={id:data.user.id,token:null,client:createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}})};accounts.push(account);
    const auth=await account.client.auth.signInWithPassword({email,password});check(auth.error);account.token=auth.data.session.access_token;
  }
  const [brokerA,brokerB,clientA,clientB]=accounts;
  check((await admin.from('workspaces').insert([{id:workspace,name:'Fictional QA '+run},{id:foreignWorkspace,name:'Fictional foreign QA '+run}])).error);
  check((await admin.from('memberships').insert(accounts.map((a,i)=>({workspace_id:workspace,user_id:a.id,role:i<2?'broker':'client'})))).error);
  for(const [id,w] of [[caseA,workspace],[caseB,workspace],[caseForeign,foreignWorkspace]]){
    const state=createInitialCase();state.id=id;state.notes='PRIVATE-NOTES-'+run;
    check((await admin.from('renewal_cases').insert({id,workspace_id:w,state,lock_version:0})).error);
  }
  check((await admin.from('client_case_assignments').insert([{case_id:caseA,workspace_id:workspace,user_id:clientA.id},{case_id:caseB,workspace_id:workspace,user_id:clientB.id}])).error);
  await api(clientA,`cases/${caseB}`,'GET',undefined,404);await api(brokerA,`cases/${caseForeign}`,'GET',undefined,404);
  const {data:clientCases,error:ce}=await clientA.client.from('renewal_cases').select('*');check(ce);assert.deepEqual(clientCases,[]);assertions++;
  const forbidden=await clientA.client.from('renewal_cases').update({lock_version:999}).eq('id',caseA);assert.ok(forbidden.error);assertions++;
  let state=(await api(brokerA,`cases/${caseA}`)).state;
  const rpc=await brokerA.client.rpc('commit_case_command',{p_case_id:caseA,p_actor:brokerA.id,p_expected_version:state.lockVersion,p_idempotency_key:randomUUID(),
    p_request:{},p_next_state:state,p_client_proposal:null,p_artifact:null});assert.equal(rpc.error?.code,'42501');assertions++;
  for(const kind of ['QS','proposal','DFS',['QS']])await api(brokerA,`cases/${caseA}/exports`,'POST',{kind,expectedVersion:state.lockVersion,idempotencyKey:randomUUID()},422);
  const first=await command(brokerA,state,'saveNotes',{notes:'PRIVATE-BROKER-'+run});
  state=first.result.state;
  await api(brokerA,`cases/${caseA}/exports`,'POST',{kind:'QS',expectedVersion:first.envelope.expectedVersion,idempotencyKey:first.envelope.idempotencyKey},409);
  const retried=await api(brokerA,`cases/${caseA}/commands`,'POST',first.envelope);assert.equal(retried.state.lockVersion,state.lockVersion);assertions++;
  await api(brokerA,`cases/${caseA}/commands`,'POST',{...first.envelope,payload:{notes:'changed'}},409);
  await command(brokerB,{...state,lockVersion:state.lockVersion-1},'saveNotes',{notes:'stale'},409);
  await command(clientA,state,'saveNotes',{notes:'forged'},422);
  await command(brokerA,state,'recordInsurerResponse',{response:null},422);
  const stale=structuredClone(state);
  const race=await Promise.all([brokerA,brokerB].map(async (user,i)=>{
    const response=await fetch(url+`/functions/v1/renewal-api/cases/${caseA}/commands`,{method:'POST',headers:{apikey:publicKey,Authorization:'Bearer '+user.token,'Content-Type':'application/json'},
      body:JSON.stringify({caseId:caseA,expectedVersion:state.lockVersion,idempotencyKey:randomUUID(),type:'saveNotes',payload:{notes:'PRIVATE-RACE-'+i+'-'+run}}),signal:AbortSignal.timeout(45000)});
    return {status:response.status,data:await response.json()};
  }));
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assertions++;
  state=race.find(r=>r.status===200).data.state;
  assert.equal(state.lockVersion,stale.lockVersion+1);assertions++;
  const sources=new Set(getCurrentWording(state).items.flatMap(w=>[w.priorSource?.documentVersionId,w.outgoingSource.documentVersionId]).filter(Boolean));
  const documentIds=[];
  for(const id of sources){const result=await upload(brokerA,state,id);state=result.state;documentIds.push(result.documentId);}
  for(const w of getCurrentWording(state).items)state=(await command(brokerA,state,'reviewWording',{itemId:w.id,disposition:'retain',note:'Fictional QA source reviewed.',question:''})).result.state;
  state=(await command(brokerA,state,'prepareQuote')).result.state;
  const quote=getCurrentQuote(state);
  const exportInput={kind:'QS',expectedVersion:state.lockVersion,idempotencyKey:randomUUID()};
  const exported=await api(brokerA,`cases/${caseA}/exports`,'POST',exportInput);
  assert.equal(exported.artifact.manifest.snapshotId,quote.id);assertions++;
  await api(brokerA,`cases/${caseA}/exports`,'POST',{...exportInput,kind:'DFS'},409);
  const exportRetry=await api(brokerA,`cases/${caseA}/exports`,'POST',exportInput);assert.equal(exportRetry.state.lockVersion,exported.state.lockVersion);assertions++;
  const word=await fetch(exported.artifact.url);assert.equal(word.status,200);const archive=unzipSync(new Uint8Array(await word.arrayBuffer()));
  const xml=new TextDecoder().decode(archive['word/document.xml']);assert.match(xml,/PAR|QS/);assert.ok(xml.includes(state.id));assert.ok(xml.includes(getCurrentWording(state).items[0].outgoing));assertions+=3;
  state=exported.state;
  await api(clientA,`cases/${caseA}/exports`,'POST',exportInput,403);
  const replyId='reply-'+state.selectedOptionId;state=(await upload(brokerA,state,replyId)).state;
  state=(await command(brokerA,state,'recordInsurerResponse',{response:{optionId:state.selectedOptionId,materialRevision:quote.materialRevision,wordingVersion:quote.wordingVersion,quoteId:quote.id,
    insurerId:'qa-insurer',insurerName:'Asuransi Fiktif A',externalRespondent:'PRIVATE-UNDERWRITER-'+run,responseAt:new Date().toISOString(),position:'accepted',sharePercent:'100',leader:true,
    terms:state.terms,conditions:[],evidence:{documentVersionId:replyId,locator:'Synthetic PDF page 1',excerpt:'Fictional response',shareable:false},note:'PRIVATE-INSURER-'+run}})).result.state;
  state=(await command(brokerA,state,'publishProposal')).result.state;
  const publishedId=getActiveProposal(state).id;
  await api(clientA,`cases/${caseA}/proposals/${publishedId}/document`,'POST',{},404);
  await api(clientA,`cases/${caseA}/exports`,'POST',{kind:'proposal',expectedVersion:state.lockVersion,idempotencyKey:randomUUID()},403);
  const proposalInput={kind:'proposal',expectedVersion:state.lockVersion,idempotencyKey:randomUUID()};
  const proposalExport=await api(brokerA,`cases/${caseA}/exports`,'POST',proposalInput);state=proposalExport.state;
  assert.equal(proposalExport.artifact.manifest.snapshotId,publishedId);assert.equal(proposalExport.artifact.manifest.optionId,state.selectedOptionId);assertions+=2;
  const publicProposal=await api(clientA,`cases/${caseA}/proposals/${publishedId}/document`,'POST',{});
  assert.deepEqual(Object.keys(publicProposal).sort(),['expiresIn','proposalId','url']);assertions++;
  const proposalBytes=await fetch(publicProposal.url);assert.equal(proposalBytes.status,200);assertions++;
  const proposalXml=new TextDecoder().decode(unzipSync(new Uint8Array(await proposalBytes.arrayBuffer()))['word/document.xml']);
  assert.ok(proposalXml.includes(state.id));assert.ok(proposalXml.includes('PROPOSAL'));assert.doesNotMatch(proposalXml,/PRIVATE-|externalRespondent|sourceVersionIds/);assertions+=3;
  const proposalRetry=await api(brokerA,`cases/${caseA}/exports`,'POST',proposalInput);assert.equal(proposalRetry.artifact.id,proposalExport.artifact.id);assertions++;
  await api(clientB,`cases/${caseA}/proposals/${publishedId}/document`,'POST',{},404);
  await api(clientA,`cases/${caseA}/proposals/nonexistent/document`,'POST',{},404);
  let client=await api(clientA,`cases/${caseA}`);
  assert.doesNotMatch(JSON.stringify(client),/PRIVATE-|outgoingSource|replySource|externalRespondent|sourceVersionIds/);assertions++;
  const safe=await clientA.client.from('published_client_proposals').select('*');check(safe.error);assert.equal(safe.data.length,1);assertions++;
  const other=await clientB.client.from('published_client_proposals').select('*');check(other.error);assert.equal(other.data.length,0);assertions++;
  const raw=await clientA.client.from('proposal_snapshots').select('*');check(raw.error);assert.equal(raw.data.length,0);assertions++;
  const docs=await clientA.client.from('document_versions').select('*');check(docs.error);assert.equal(docs.data.length,0);assertions++;
  await api(clientA,`cases/${caseA}/documents/${documentIds[0]}/download`,'POST',{},404);
  const submitted=await command(clientA,state,'submitLocations',{proposalId:getActiveProposal(state).id,locations:sampleClientResponse(state)});
  assert.ok(!('state' in submitted.result));assert.equal(submitted.result.submissions[0].recordedBy,clientA.id);assertions++;
  await command(clientA,state,'submitLocations',{proposalId:getActiveProposal(state).id,locations:sampleClientResponse(state)},409);
  const own=await clientB.client.from('client_submissions').select('*');check(own.error);assert.equal(own.data.length,0);assertions++;
  state=(await api(brokerA,`cases/${caseA}`)).state;
  state=(await command(brokerA,state,'reviseTerms',{terms:{...state.terms,deductible:state.terms.deductible+' (fictional revision)'},note:'Synthetic material edit after successful export.'})).result.state;
  const oldExport=await api(brokerA,`cases/${caseA}/exports`,'POST',exportInput);assert.equal(oldExport.state.lockVersion,exported.state.lockVersion);assertions++;
  await api(brokerA,`cases/${caseA}/exports`,'POST',{kind:'proposal',expectedVersion:state.lockVersion,idempotencyKey:randomUUID()},422);
  const oldProposal=await api(brokerA,`cases/${caseA}/exports`,'POST',proposalInput);assert.equal(oldProposal.artifact.id,proposalExport.artifact.id);assertions++;
  const anon=createClient(url,publicKey,{auth:{persistSession:false}});
  const publicObject=await anon.storage.from('renewal-documents').download((await admin.from('document_versions').select('object_path').eq('id',documentIds[0]).single()).data.object_path);
  assert.ok(publicObject.error);assertions++;
  const storedPath=(await admin.from('document_versions').select('object_path').eq('id',documentIds[0]).single()).data.object_path;
  const directClientObject=await clientA.client.storage.from('renewal-documents').download(storedPath);assert.ok(directClientObject.error);assertions++;
  const immutable=await admin.from('proposal_snapshots').update({snapshot:{edited:true}}).eq('case_id',caseA).eq('id',publishedId);
  assert.equal(immutable.error?.code,'42501');assertions++;
  console.log(JSON.stringify({result:'PASS',assertions,run,cases:[caseA,caseB,caseForeign],hostedDocx:true,accounts:'temporary QA accounts will be banned and signed out in cleanup'}));
}finally{
  let failures=0;
  for(const a of accounts){const signedOut=await admin.auth.admin.signOut(a.token??'','global');const banned=await admin.auth.admin.updateUserById(a.id,{ban_duration:'876000h'});if(banned.error || (a.token && signedOut.error))failures++;}
  console.log('QA cleanup: '+accounts.length+' accounts disabled; '+failures+' cleanup errors. Immutable fictional audit records retained.');
}
