import { verifiedAdmin } from './supabase-admin.mjs';
import { createInitialCase } from '../supabase/functions/_shared/domain.ts';

const args=process.argv.slice(2);
const option=name=>args[args.indexOf(name)+1];
const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if(!args.includes('--broker') || !args.includes('--client') || !valid.test(option('--broker')??'') || !valid.test(option('--client')??'')){
  console.error('Usage: node scripts/provision-pilot.mjs --broker AUTH_USER_UUID --client AUTH_USER_UUID');process.exit(1);
}
const broker=option('--broker'),client=option('--client');
const caseId=args.includes('--case')?option('--case'):'PILOT-PAR-2027-001';
if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(caseId??''))throw new Error('Invalid case ID.');
if(broker===client)throw new Error('Use distinct broker and client accounts.');
const {admin,ref}=await verifiedAdmin();
const check=error=>{if(error)throw new Error('Pilot provisioning failed ('+error.code+').');};
for(const id of [broker,client]){const {data,error}=await admin.auth.admin.getUserById(id);if(error || !data.user)throw new Error('Create both users in Supabase Auth first.');}
const workspaceId='58a4e4cf-5e12-4fb9-ace4-e6da184265f1';
const existing=await admin.from('memberships').select('user_id,role').eq('workspace_id',workspaceId).in('user_id',[broker,client]);check(existing.error);
if(existing.data.some(m=>m.role!==(m.user_id===broker?'broker':'client')))throw new Error('An existing membership has a different role; refusing to silently change it.');
check((await admin.from('workspaces').upsert({id:workspaceId,name:'Rekonvia fictional pilot'},{onConflict:'id',ignoreDuplicates:true})).error);
check((await admin.from('memberships').upsert([{workspace_id:workspaceId,user_id:broker,role:'broker'},{workspace_id:workspaceId,user_id:client,role:'client'}],{onConflict:'workspace_id,user_id',ignoreDuplicates:true})).error);
const state=createInitialCase();state.id=caseId;
if(args.includes('--client-name')) {const name=option('--client-name');if(!name?.trim() || name.length>200)throw new Error('Invalid fictional client name.');state.clientName=name;}
check((await admin.from('renewal_cases').upsert({id:state.id,workspace_id:workspaceId,state,lock_version:state.lockVersion},{onConflict:'id',ignoreDuplicates:true})).error);
check((await admin.from('client_case_assignments').upsert({case_id:state.id,workspace_id:workspaceId,user_id:client},{onConflict:'case_id,user_id',ignoreDuplicates:true})).error);
console.log('Provisioned fictional pilot case '+state.id+' on '+ref+'. Existing case state was preserved.');
