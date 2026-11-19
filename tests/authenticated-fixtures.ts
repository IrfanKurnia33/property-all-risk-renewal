import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { createInitialCase, getActiveProposal } from '../src/domain.ts';
import type { RenewalCase } from '../src/domain.ts';
import { clientProposal } from '../supabase/functions/_shared/api-contract.ts';
import { proposalReadyCase } from './fixtures.ts';

export async function createHostedFixture() {
  const {verifiedAdmin}=await import(new URL('../scripts/supabase-admin.mjs',import.meta.url).href) as {verifiedAdmin:()=>Promise<{url:string;publicKey:string;admin:SupabaseClient}>};
  const {url,publicKey,admin}=await verifiedAdmin();
  const run=Date.now().toString(36),workspace=randomUUID();
  const accounts:{id:string;email:string;password:string;token:string}[]=[];
  const caseA='QA-BROWSER-'+run+'-A',caseB='QA-BROWSER-'+run+'-B';
  const check=(error:{code?:string}|null)=>{if(error)throw new Error('Hosted fixture setup failed ('+error.code+').');};
  async function cleanup() {
    let failed=0;
    for(const a of accounts){if(a.token){const r=await admin.auth.admin.signOut(a.token,'global');if(r.error)failed++;}const r=await admin.auth.admin.updateUserById(a.id,{ban_duration:'876000h'});if(r.error)failed++;}
    if(failed)throw new Error('QA account cleanup requires attention ('+failed+' errors).');
  }
  try{
    for(let i=0;i<4;i++) {
      const email=`qa-browser-${run}-${i}@example.invalid`,password=randomBytes(32).toString('base64url');
      const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});check(error);
      const a={id:data.user!.id,email,password,token:''};accounts.push(a);
      const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
      const signed=await client.auth.signInWithPassword({email,password});check(signed.error);a.token=signed.data.session!.access_token;
    }
    check((await admin.from('workspaces').insert({id:workspace,name:'Fictional browser QA '+run})).error);
    check((await admin.from('memberships').insert(accounts.map((a,i)=>({workspace_id:workspace,user_id:a.id,role:i<2?'broker':'client'})))).error);
    const initial=createInitialCase();initial.id=caseA;initial.clientName='PT Lintas Uji (Fiktif)';initial.notes='PRIVATE-BROKER-INITIAL-'+run;
    const other=proposalReadyCase();other.id=caseB;other.clientName='PT Uji Kedua (Fiktif)';other.notes='PRIVATE-OTHER-'+run;
    for(const state of [initial,other])check((await admin.from('renewal_cases').insert({id:state.id,workspace_id:workspace,state,lock_version:state.lockVersion})).error);
    const p=getActiveProposal(other)!;
    check((await admin.from('proposal_snapshots').insert({case_id:caseB,id:p.id,snapshot:p})).error);
    check((await admin.from('published_client_proposals').insert({case_id:caseB,id:p.id,snapshot:clientProposal(p)})).error);
    check((await admin.from('client_case_assignments').insert([{case_id:caseA,workspace_id:workspace,user_id:accounts[2].id},{case_id:caseB,workspace_id:workspace,user_id:accounts[3].id}])).error);
    return {run,url,publicKey,accounts,caseA,caseB,initial,admin,cleanup,
      read:async(id=caseA)=>{const {data,error}=await admin.from('renewal_cases').select('state').eq('id',id).single();check(error);return data!.state as RenewalCase;},
      api:async(index:number,id:string)=>fetch(url+'/functions/v1/renewal-api/cases/'+id,{headers:{apikey:publicKey,Authorization:'Bearer '+accounts[index].token}}),
    };
  }catch(error){await cleanup();throw error;}
}
