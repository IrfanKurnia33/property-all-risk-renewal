import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifiedAdmin } from './supabase-admin.mjs';
import { assignmentState,createManagedCase,parseCaseCreation } from '../supabase/functions/_shared/case-management.ts';
import { applyAction,sampleClientResponse } from '../supabase/functions/_shared/domain.ts';
import { proposalReadyCase,bindingReadyCase,act } from '../tests/fixtures.ts';

if(process.env.REKONVIA_RUN_HOSTED_TESTS!=='1') throw new Error('Set REKONVIA_RUN_HOSTED_TESTS=1 to create fictional case-management QA accounts and records.');
const {admin,url,publicKey}=await verifiedAdmin();
const run=Date.now().toString(36),workspace=randomUUID(),foreignWorkspace=randomUUID(),accounts=[];
let assertions=0;
const check=error=>{if(error)throw new Error('Case management QA failed ('+error.code+').');};
async function rpc(name,input,errorMessage){
  const result=await admin.rpc(name,input);
  if(errorMessage) assert.ok(result.error?.message.includes(errorMessage),`${name}: expected ${errorMessage}, got ${result.error?.message??'success'}`);
  else check(result.error);
  assertions++;return result.data;
}
const assign=(state,actor,clientUserIds,key=randomUUID())=>({p_case_id:state.id,p_actor:actor,p_expected_version:state.lockVersion,
  p_idempotency_key:key,p_client_user_ids:clientUserIds,p_next_state:assignmentState(state,actor)});
try {
  for(let i=0;i<6;i++) {
    const email=`rekonvia-case-qa-${run}-${i}@example.invalid`,password=randomBytes(32).toString('base64url');
    const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{qa_run:run}});check(error);
    accounts.push({id:data.user.id,email,password});
  }
  const [broker,secondBroker,client,secondClient,foreignClient,foreignBroker]=accounts;
  check((await admin.from('workspaces').insert([{id:workspace,name:'Fictional case QA '+run},{id:foreignWorkspace,name:'Foreign case QA '+run}])).error);
  check((await admin.from('memberships').insert(accounts.map((a,i)=>({workspace_id:i<4?workspace:foreignWorkspace,user_id:a.id,
    role:[0,1,5].includes(i)?'broker':'client'})))).error);
  const setup=await rpc('broker_case_setup',{p_actor:broker.id});
  assert.equal(setup.workspaces.length,1);assert.deepEqual(setup.workspaces[0].clients.map(c=>c.userId).sort(),[client.id,secondClient.id].sort());assertions+=2;
  assert.doesNotMatch(JSON.stringify(setup),new RegExp(foreignClient.id+'|'+foreignBroker.email));assertions++;
  await rpc('broker_case_setup',{p_actor:client.id},'FORBIDDEN');
  const request=parseCaseCreation({workspaceId:workspace,caseId:'QA-CASE-'+run,clientName:'PT Kasus QA (Fiktif)',periodStart:'2028-01-01',periodEnd:'2028-12-31',
    priorPeriodStart:'2027-01-01',priorPeriodEnd:'2027-12-31',
    clientUserIds:[client.id],idempotencyKey:randomUUID(),historicalLocations:[{name:'Historical QA location',address:'Fictional historical address',sumInsured:{amount:'1000000.25',currency:'IDR'}}]});
  let state=createManagedCase(request,broker.id);
  await rpc('create_renewal_case',{p_actor:client.id,p_request:request,p_state:state},'FORBIDDEN');
  await rpc('create_renewal_case',{p_actor:broker.id,p_request:{...request,clientUserIds:[foreignClient.id]},p_state:state},'INVALID_CLIENT_ASSIGNMENT');
  await rpc('create_renewal_case',{p_actor:broker.id,p_request:{...request,clientUserIds:[broker.id]},p_state:state},'INVALID_CLIENT_ASSIGNMENT');
  const forgedHistory=structuredClone(state);forgedHistory.locations[0].prior.sumInsured.amount='2';
  await rpc('create_renewal_case',{p_actor:broker.id,p_request:request,p_state:forgedHistory},'INVALID_CASE');
  const forgedPeriod=structuredClone(state);forgedPeriod.priorTerms.periodStart=request.periodStart;
  await rpc('create_renewal_case',{p_actor:broker.id,p_request:request,p_state:forgedPeriod},'INVALID_CASE');
  const overlappingPeriod=structuredClone(state);overlappingPeriod.priorTerms.periodEnd=request.periodStart;
  await rpc('create_renewal_case',{p_actor:broker.id,p_request:{...request,priorPeriodEnd:request.periodStart},p_state:overlappingPeriod},'INVALID_CASE');
  const created=await rpc('create_renewal_case',{p_actor:broker.id,p_request:request,p_state:state});
  const retried=await rpc('create_renewal_case',{p_actor:broker.id,p_request:request,p_state:state});assert.deepEqual(retried,created);assertions++;
  await rpc('create_renewal_case',{p_actor:broker.id,p_request:{...request,clientName:'Changed'},p_state:{...state,clientName:'Changed'}},'IDEMPOTENCY_CONFLICT');
  await rpc('create_renewal_case',{p_actor:secondBroker.id,p_request:{...request,idempotencyKey:randomUUID()},p_state:createManagedCase(request,secondBroker.id)},'CASE_EXISTS');
  await rpc('broker_case_assignments',{p_case_id:state.id,p_actor:client.id},'FORBIDDEN');
  await rpc('broker_case_assignments',{p_case_id:state.id,p_actor:foreignBroker.id},'FORBIDDEN');
  await rpc('set_case_assignments',assign(state,client.id,[client.id]),'FORBIDDEN');
  await rpc('set_case_assignments',assign(state,broker.id,[foreignClient.id]),'INVALID_CLIENT_ASSIGNMENT');
  const change=assign(state,broker.id,[secondClient.id]);
  const changed=await rpc('set_case_assignments',change);state=changed.state;
  assert.deepEqual(changed.clientUserIds,[secondClient.id]);assert.equal(state.lockVersion,1);assertions+=2;
  assert.deepEqual(await rpc('set_case_assignments',change),changed);assertions++;
  await rpc('set_case_assignments',{...change,p_client_user_ids:[client.id]},'IDEMPOTENCY_CONFLICT');
  await rpc('set_case_assignments',{...change,p_idempotency_key:randomUUID()},'VERSION_CONFLICT');
  const races=await Promise.all([broker,secondBroker].map(actor=>admin.rpc('set_case_assignments',assign(state,actor.id,[client.id,secondClient.id]))));
  assert.equal(races.filter(r=>!r.error).length,1);assert.equal(races.filter(r=>r.error?.message.includes('VERSION_CONFLICT')).length,1);assertions+=2;
  const authed=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await authed.auth.signInWithPassword({email:broker.email,password:broker.password});check(login.error);broker.token=login.data.session.access_token;
  for(const name of ['broker_case_setup','broker_case_assignments','create_renewal_case','set_case_assignments']) {
    const args=name==='broker_case_setup'?{p_actor:broker.id}:name==='broker_case_assignments'?{p_case_id:state.id,p_actor:broker.id}:
      name==='create_renewal_case'?{p_actor:broker.id,p_request:request,p_state:state}:assign(state,broker.id,[client.id]);
    assert.equal((await authed.rpc(name,args)).error?.code,'42501');assertions++;
  }
  let contributor=proposalReadyCase();contributor.id='QA-CASE-CONTRIBUTOR-'+run;
  contributor=applyAction(contributor,{id:client.id,role:'client'},{type:'submitLocations',proposalId:contributor.activeProposalId,locations:sampleClientResponse(contributor)},contributor.lockVersion);
  check((await admin.from('renewal_cases').insert({id:contributor.id,workspace_id:workspace,state:contributor,lock_version:contributor.lockVersion})).error);
  check((await admin.from('client_case_assignments').insert({case_id:contributor.id,workspace_id:workspace,user_id:client.id})).error);
  await rpc('set_case_assignments',assign(contributor,broker.id,[]),'CONTRIBUTING_CLIENT_LOCKED');
  let bound=bindingReadyCase();bound.id='QA-CASE-BOUND-'+run;
  const bindingRequest=bound.bindingRequests.at(-1);
  for(const response of bound.insurerResponses.filter(r=>r.position==='accepted')) bound=act(bound,{type:'acknowledgeBinding',requestId:bindingRequest.id,
    insurerId:response.insurerId,externalRespondent:'Fictional underwriter',evidence:{documentVersionId:'binding-utama',locator:'Email',excerpt:'Fictional acknowledgment',shareable:false}});
  check((await admin.from('renewal_cases').insert({id:bound.id,workspace_id:workspace,state:bound,lock_version:bound.lockVersion})).error);
  // Deliberately call SQL directly with an otherwise valid lock/activity transition to test its independent binding guard.
  const next=structuredClone(bound);next.lockVersion++;next.activity.push({...next.activity.at(-1),id:'event-'+(next.lockVersion+1),lockVersion:next.lockVersion,actor:{id:broker.id,role:'broker'}});
  await rpc('set_case_assignments',{p_case_id:bound.id,p_actor:broker.id,p_expected_version:bound.lockVersion,p_idempotency_key:randomUUID(),p_client_user_ids:[client.id],p_next_state:next},'BINDING_COMPLETE');
  const audit=await admin.from('audit_events').select('command_type,lock_version').eq('case_id',state.id).order('lock_version');check(audit.error);
  assert.deepEqual(audit.data.map(e=>e.command_type),['createCase','setCaseAssignments','setCaseAssignments']);assertions++;
  console.log(JSON.stringify({run,result:'PASS',assertions,scope:'Workspace directory, creation, assignment, idempotency, races, contributor protection, binding lock and RPC grants.'}));
} finally {
  let cleanupErrors=0;
  for(const account of accounts) {
    if(account.token){const signed=await admin.auth.admin.signOut(account.token,'global');if(signed.error)cleanupErrors++;}
    const banned=await admin.auth.admin.updateUserById(account.id,{ban_duration:'876000h'});if(banned.error)cleanupErrors++;
  }
  console.log(JSON.stringify({run,temporaryAccountsBanned:accounts.length,cleanupErrors,immutableFictionalQaRecordsRetained:true}));
  if(cleanupErrors) process.exitCode=1;
}
