import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, commandEnvelope, RequestError } from './server-api.ts';
import { clientView } from '../supabase/functions/_shared/api-contract.ts';
import { getActiveProposal } from './domain.ts';
import { act, proposalReadyCase } from '../tests/fixtures.ts';
import { clientConfiguration } from './client-config.ts';

test('client configuration requires the project origin and refuses server secrets before bundling',()=>{
  assert.deepEqual(clientConfiguration('https://example.supabase.co/','sb_publishable_test'),{url:'https://example.supabase.co',key:'sb_publishable_test'});
  assert.throws(()=>clientConfiguration('https://example.supabase.co/rest/v1/','sb_publishable_test'),/base URL/);
  assert.throws(()=>clientConfiguration('https://example.supabase.co','sb_secret_test'),/Server secrets/);
  assert.throws(()=>clientConfiguration('https://example.supabase.co','sbp_test'),/Server secrets/);
  assert.throws(()=>clientConfiguration(undefined,'sb_secret_test'),/Server secrets/);
  assert.equal(clientConfiguration(undefined,undefined),null);
});

test('server command envelope contains no simulated actor and preserves exact values',()=>{
  const envelope=commandEnvelope('PAR-EXAMPLE',7,{type:'saveNotes',notes:'Draft'});
  assert.deepEqual(Object.keys(envelope).sort(),['caseId','expectedVersion','idempotencyKey','payload','type']);
  assert.equal(envelope.expectedVersion,7);assert.deepEqual(envelope.payload,{notes:'Draft'});
});
test('ambiguous network failures can replay the same envelope without generating a second key',async()=>{
  const envelope=commandEnvelope('PAR-EXAMPLE',7,{type:'saveNotes',notes:'Draft'}),bodies:string[]=[];
  const fetcher=(async(_url:unknown,options:RequestInit)=>{
    bodies.push(String(options.body));
    if(bodies.length===1)throw new TypeError('Connection interrupted');
    return new Response(JSON.stringify({saved:true}),{status:200});
  }) as typeof fetch;
  const options={url:'https://example.supabase.co',publishableKey:'test-public-key',token:'test-session',path:'cases/PAR-EXAMPLE/commands',input:envelope,fetcher};
  await assert.rejects(apiRequest(options),(e:unknown)=>e instanceof RequestError && e.status===0);
  assert.deepEqual(await apiRequest(options),{saved:true});assert.equal(bodies[0],bodies[1]);
});
test('stale saves and expired sessions retain their status and safe recovery messages',async()=>{
  for(const [status,code] of [[409,'VERSION_CONFLICT'],[401,'INVALID_SESSION'],[503,'INTERNAL_ERROR'],[422,'INVALID_PERIOD']] as const){
    const fetcher=(async()=>new Response(JSON.stringify({error:{code,message:'unsafe backend detail'}}),{status})) as typeof fetch;
    await assert.rejects(apiRequest({url:'https://example.supabase.co',publishableKey:'test',token:'test',path:'cases',fetcher}),
      (error:unknown)=>error instanceof RequestError && error.status===status && error.code===code && !error.message.includes('unsafe backend'));
  }
});
test('client readiness distinguishes confirmation, consent and instruction, including new evidence',()=>{
  let state=proposalReadyCase();const proposalId=getActiveProposal(state)!.id;
  assert.equal(clientView(state,'client-demo').canAgree,false);
  const locations=state.locations.map(l=>({locationId:l.id,...l.prior,confirmed:true,evidence:'Fictional client confirmation'}));
  state=act(state,{type:'submitLocations',proposalId,locations},'client');
  assert.equal(clientView(state,'client-demo').canAgree,true);assert.equal(clientView(state,'client-demo').canInstruct,false);
  state=act(state,{type:'clientAgree',proposalId,evidence:'Fictional version consent'},'client');
  assert.equal(clientView(state,'client-demo').canInstruct,true);
  state=act(state,{type:'submitLocations',proposalId,locations:locations.map(l=>({...l,evidence:'Updated client evidence'}))},'client');
  assert.equal(clientView(state,'client-demo').canInstruct,false);assert.equal(clientView(state,'client-demo').agreementCurrent,false);
});
test('authenticated client actions stay blocked until the proposal is backed by a reviewed schedule',()=>{
  const state=proposalReadyCase();
  state.scheduleRequired=true;
  const view=clientView(state,'client-demo');
  assert.equal(view.proposalCurrent,false);
  assert.equal(view.canSubmitLocations,false);
  assert.equal(view.canAgree,false);
});
