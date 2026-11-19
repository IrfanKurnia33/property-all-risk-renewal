import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Server-side tooling only. Never import this module into src/ or a Vite entrypoint.
export async function verifiedAdmin() {
  for(const file of ['.env.local','.env.supabase.local'])if(existsSync(file))process.loadEnvFile(file);
  const url=new URL(process.env.VITE_SUPABASE_URL??'');
  if(url.protocol!=='https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname))throw new Error('Invalid project URL.');
  const ref=url.hostname.split('.')[0];
  const headers={Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN};
  const projectResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}`,{headers,signal:AbortSignal.timeout(15000)});
  if(!projectResponse.ok)throw new Error('Cannot verify project (HTTP '+projectResponse.status+').');
  const project=await projectResponse.json();
  if(project.id!==ref || project.name!=='rekonvia-db' || project.region!=='ap-southeast-1')throw new Error('Unexpected project; refusing access.');
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`,{headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Cannot access server credential (HTTP '+response.status+').');
  const keys=await response.json();
  const key=keys.find(k=>k.name==='service_role')?.api_key;
  if(!key)throw new Error('Server tooling requires the project service-role credential. It is not written to disk.');
  return {url:url.origin,ref,admin:createClient(url.origin,key,{auth:{persistSession:false,autoRefreshToken:false}}),
    publicKey:process.env.VITE_SUPABASE_PUBLISHABLE_KEY};
}
