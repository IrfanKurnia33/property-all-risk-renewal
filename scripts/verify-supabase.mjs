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
  (select count(*) from pg_policies where schemaname='storage' and tablename='objects')::int as storage_policies
`}),signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error('Database verification failed (HTTP '+response.status+').');
const [checks]=await response.json();
assert.equal(checks.public_tables,13);assert.equal(checks.rls_tables,13);
assert.equal(checks.anon_commit,false);assert.equal(checks.authenticated_commit,false);assert.equal(checks.service_commit,true);
assert.equal(checks.storage_policies,0,'Review existing Storage policies before claiming isolation.');
const {data,error}=await admin.storage.getBucket('renewal-documents');
if(error)throw new Error('Storage verification failed.');
assert.equal(data.public,false);assert.equal(data.file_size_limit,10485760);
const auth=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`,{headers,signal:AbortSignal.timeout(15000)});
if(!auth.ok)throw new Error('Auth settings verification failed (HTTP '+auth.status+').');
const config=await auth.json();assert.equal(config.disable_signup,true,'Keep public signup disabled for this pilot.');
console.log(JSON.stringify({project:ref,result:'PASS',...checks,privateBucket:true,fileLimit:10485760,publicSignupDisabled:true}));
