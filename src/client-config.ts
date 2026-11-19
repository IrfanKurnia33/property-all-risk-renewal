export function clientConfiguration(url:string|undefined,key:string|undefined) {
  let anonymousJwt=false;
  if(key?.startsWith('eyJ'))try{anonymousJwt=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{/* Invalid tokens are rejected below. */}
  if(key && !key.startsWith('sb_publishable_') && !anonymousJwt)throw new Error('Vite requires a publishable or legacy anon key. Server secrets must never enter a browser build.');
  if(!url || !key)return null;
  let parsed:URL;
  try{parsed=new URL(url);}catch{throw new Error('VITE_SUPABASE_URL must be the project base URL.');}
  if((parsed.protocol!=='https:' && !(parsed.protocol==='http:' && ['localhost','127.0.0.1'].includes(parsed.hostname)))
    || parsed.pathname!=='/' || parsed.search || parsed.hash || parsed.username || parsed.password)
    throw new Error('Use the Supabase project base URL without /rest/v1/ or other paths.');
  return {url:parsed.origin,key};
}
