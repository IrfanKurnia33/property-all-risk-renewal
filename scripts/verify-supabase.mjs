import assert from 'node:assert/strict';
import { verifiedAdmin } from './supabase-admin.mjs';
const {ref,admin}=await verifiedAdmin();
const headers={Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'};
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers,body:JSON.stringify({query:`
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')::int as public_tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)::int as rls_tables,
  has_function_privilege('anon','public.commit_case_command(text,uuid,bigint,uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE') as anon_commit,
  has_function_privilege('authenticated','public.commit_case_command(text,uuid,bigint,uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE') as authenticated_commit,
  has_function_privilege('service_role','public.commit_case_command(text,uuid,bigint,uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE') as service_commit,
  (select jsonb_agg(jsonb_build_object('signature',signature,
    'anon',has_function_privilege('anon',signature,'EXECUTE'),
    'authenticated',has_function_privilege('authenticated',signature,'EXECUTE'),
    'service',has_function_privilege('service_role',signature,'EXECUTE')) order by signature)
    from unnest(array['public.broker_case_setup(uuid)','public.broker_case_assignments(text,uuid)',
      'public.create_renewal_case(uuid,jsonb,jsonb)','public.set_case_assignments(text,uuid,bigint,uuid,uuid[],jsonb)',
      'public.create_ai_batch(text,uuid,jsonb)','public.ai_workspace_budget(uuid)',
      'public.reserve_ai_step(text,uuid,uuid,integer,uuid,text)','public.refresh_ai_leases(text,uuid)',
      'public.finish_ai_step(text,uuid,uuid,integer,uuid,jsonb,text)','public.review_ai_step(text,uuid,uuid,integer,jsonb)',
      'public.review_ai_finding(text,uuid,uuid,integer,integer,jsonb)']) signature) as service_rpcs,
  (select count(*) from pg_policies where schemaname='storage' and tablename='objects')::int as storage_policies
`}),signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error('Database verification failed (HTTP '+response.status+').');
const [checks]=await response.json();
assert.equal(checks.public_tables,21);assert.equal(checks.rls_tables,21);
assert.equal(checks.anon_commit,false);assert.equal(checks.authenticated_commit,false);assert.equal(checks.service_commit,true);
assert.equal(checks.service_rpcs.length,11);
for(const rpc of checks.service_rpcs){assert.equal(rpc.anon,false,rpc.signature);assert.equal(rpc.authenticated,false,rpc.signature);assert.equal(rpc.service,true,rpc.signature);}
assert.equal(checks.storage_policies,0,'Review existing Storage policies before claiming isolation.');
const {data,error}=await admin.storage.getBucket('renewal-documents');
if(error)throw new Error('Storage verification failed.');
assert.equal(data.public,false);assert.equal(data.file_size_limit,10485760);
const auth=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`,{headers,signal:AbortSignal.timeout(15000)});
if(!auth.ok)throw new Error('Auth settings verification failed (HTTP '+auth.status+').');
const config=await auth.json();assert.equal(config.disable_signup,true,'Keep public signup disabled for this pilot.');
console.log(JSON.stringify({project:ref,result:'PASS',...checks,privateBucket:true,fileLimit:10485760,publicSignupDisabled:true}));
