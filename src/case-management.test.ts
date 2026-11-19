import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentState, createManagedCase, parseCaseAssignment, parseCaseCreation } from '../supabase/functions/_shared/case-management.ts';
import { getQsBlockers, isRenewalCase } from './domain.ts';
import { bindingReadyCase, act } from '../tests/fixtures.ts';

const broker='310fe73b-fd1d-4ca9-9a40-c99e0acb1b34',client='410fe73b-fd1d-4ca9-9a40-c99e0acb1b34';
const input={workspaceId:broker,caseId:'PAR-2028-NEW',clientName:'PT Kasus Baru (Fiktif)',periodStart:'2028-01-01',periodEnd:'2028-12-31',
  priorPeriodStart:'2027-01-01',priorPeriodEnd:'2027-12-31',
  clientUserIds:[client],idempotencyKey:'510fe73b-fd1d-4ca9-9a40-c99e0acb1b34',historicalLocations:[
    {name:'Pabrik historis fiktif',address:'Alamat historis A',sumInsured:{amount:'9007199254740991.12',currency:'IDR'}},
    {name:'Gudang historis fiktif',address:'Alamat historis B',sumInsured:{amount:'0.89',currency:'IDR'}},
  ]};
test('case creation accepts only bounded identifiers, valid periods and explicit existing-client IDs',()=>{
  assert.deepEqual(parseCaseCreation(input),input);
  assert.equal(parseCaseCreation({...input,workspaceId:broker.toUpperCase(),clientUserIds:[client.toUpperCase()]}).clientUserIds[0],client);
  assert.equal(parseCaseCreation({...input,historicalLocations:[{...input.historicalLocations[0],address:'Alamat baris satu\r\nBaris dua'}]}).historicalLocations[0].address,'Alamat baris satu\r\nBaris dua');
  for (const value of [{...input,actor:{id:broker}},{...input,clientUserIds:[client,client.toUpperCase()]},
    {...input,periodStart:'2028-02-30'},{...input,periodStart:'2029-01-01'}, {...input,clientName:'x\nspoof'},
    {...input,caseId:'../../escape'},{...input,clientUserIds:['client@example.com']},
    {...input,priorPeriodStart:'2027-02-30'},{...input,priorPeriodStart:'2028-01-01'},
    {...input,priorPeriodEnd:'2028-01-01'},{...input,priorPeriodEnd:'2028-12-31'}]) assert.throws(()=>parseCaseCreation(value));
});
test('a new case contains explicit placeholders and no fabricated current evidence or prior approval',()=>{
  const state=createManagedCase(parseCaseCreation(input),broker,'2026-11-20T01:00:00.000Z');
  assert.equal(isRenewalCase(state),true);assert.equal(state.id,input.caseId);assert.equal(state.clientName,input.clientName);
  assert.deepEqual(state.documents,[]);assert.deepEqual(state.wordingRevisions[0].items,[]);
  assert.ok(state.locations.every(l=>!l.confirmation && !l.proposed && l.review==='unreviewed'));
  assert.deepEqual([state.proposals,state.quoteSnapshots,state.insurerResponses,state.agreements,state.instructions,state.submissions],Array(6).fill([]));
  assert.equal(state.originalClauses.length,0);assert.ok(getQsBlockers(state).length>0);
  assert.match(state.notes,/placeholder/);assert.doesNotMatch(JSON.stringify(state),/Munich Re|Arunika|broker-demo|Asuransi Fiktif A/);
  assert.equal(state.terms.periodStart,input.periodStart);assert.equal(state.wordingRevisions[0].recordedBy,broker);
  assert.equal(state.priorTerms.periodStart,input.priorPeriodStart);assert.equal(state.priorTerms.periodEnd,input.priorPeriodEnd);
  assert.ok(getQsBlockers(state).some(b=>b.id==='wording-missing'));
  assert.deepEqual(state.locations.map(l=>l.prior),input.historicalLocations);
  assert.equal(state.terms.premiumLines[0].basis.amount,'9007199254740992.01');
});
test('historical schedules reject unsafe fields, currencies, decimals, duplicate rows and overflow',()=>{
  const first=input.historicalLocations[0];
  for (const historicalLocations of [[],Array(101).fill(first),[first,first],[{...first,confirmed:true}],
    [{...first,sumInsured:{amount:'1',currency:'USD'}}],[{...first,sumInsured:{amount:'1',currency:'IDR',confirmed:true}}],
    [{...first,sumInsured:{amount:'0',currency:'IDR'}}],[{...first,sumInsured:{amount:1,currency:'IDR'}}],
    [{...first,sumInsured:{amount:'1e9',currency:'IDR'}}],[{...first,sumInsured:{amount:'-1',currency:'IDR'}}],
    [{...first,address:''}],[{...first,name:'Bad\nname'}],
    [{...first,sumInsured:{amount:'999999999999999999999999',currency:'IDR'}},{...input.historicalLocations[1],sumInsured:{amount:'1',currency:'IDR'}}]])
    assert.throws(()=>parseCaseCreation({...input,historicalLocations}));
});
test('assignment changes preserve material history while advancing the optimistic version and actor audit',()=>{
  const state=createManagedCase(parseCaseCreation(input),broker);
  const next=assignmentState(state,broker);assert.equal(next.lockVersion,1);assert.equal(next.revision,state.revision);
  assert.equal(next.activity.at(-1)?.actor.id,broker);assert.deepEqual(next.terms,state.terms);
  assert.deepEqual(parseCaseAssignment({expectedVersion:0,idempotencyKey:broker,clientUserIds:[]}),{expectedVersion:0,idempotencyKey:broker,clientUserIds:[]});
  for(const value of [{expectedVersion:-1,idempotencyKey:broker,clientUserIds:[]}, {expectedVersion:0,idempotencyKey:broker,clientUserIds:[client,client]},
    {expectedVersion:0,idempotencyKey:broker,clientUserIds:[],role:'broker'}]) assert.throws(()=>parseCaseAssignment(value));
});
test('completed binding blocks assignment changes',()=>{
  let state=bindingReadyCase();const request=state.bindingRequests.at(-1)!;
  for(const response of state.insurerResponses.filter(r=>r.position==='accepted')) state=act(state,{type:'acknowledgeBinding',requestId:request.id,
    insurerId:response.insurerId,externalRespondent:'Fictional underwriter',evidence:{documentVersionId:'binding-utama',locator:'Email',excerpt:'Fictional acknowledgment',shareable:false}});
  assert.throws(()=>assignmentState(state,broker),/Binding selesai/);
});
