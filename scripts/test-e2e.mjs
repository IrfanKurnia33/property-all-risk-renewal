import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { preview } from 'vite';
const authenticated=process.argv.includes('--authenticated');
const original=process.env.VITE_DEMO_MODE;
if(authenticated && process.env.REKONVIA_RUN_HOSTED_BROWSER_TESTS!=='1')throw new Error('Set REKONVIA_RUN_HOSTED_BROWSER_TESTS=1 to run hosted browser acceptance with temporary fictional QA accounts.');
async function run(args,env=process.env) {
  return new Promise((resolveExit,reject)=>{
    const child=spawn(process.execPath,args,{env,stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('close',code=>resolveExit(code??1));
  });
}
const npm=process.env.npm_execpath??resolve('node_modules/npm/bin/npm-cli.js');
process.env.VITE_DEMO_MODE=authenticated?'false':'true';
let exitCode=await run([npm,'run','build']);
if(!exitCode){
  const server=await preview({preview:{host:'127.0.0.1',port:4173,strictPort:true}});
  try{exitCode=await run([resolve('scripts/playwright.mjs'),'test',...(authenticated?['tests/authenticated.spec.ts','tests/phase4.spec.ts','tests/phase5.spec.ts']:['tests/brand.spec.ts','tests/renewal.spec.ts','tests/i18n.spec.ts']),'--reporter=list']);}
  finally{await server.close();}
}
if(!authenticated && !exitCode){
  // Auth UI uses deterministic local responses and never signs in to a hosted account.
  exitCode=await run([npm,'run','build'],{...process.env,VITE_DEMO_MODE:'false',VITE_SUPABASE_URL:'http://127.0.0.1:54321',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ui_test'});
  if(!exitCode){
    const server=await preview({preview:{host:'127.0.0.1',port:4173,strictPort:true}});
    try{exitCode=await run([resolve('scripts/playwright.mjs'),'test','tests/login-i18n.spec.ts','tests/design-tabs.spec.ts','--reporter=list']);}
    finally{await server.close();}
  }
}
if(original===undefined)delete process.env.VITE_DEMO_MODE;else process.env.VITE_DEMO_MODE=original;
// Leave dist ready for authenticated deployment even after simulation tests fail.
const productionExit=await run([npm,'run','build'],{...process.env,VITE_DEMO_MODE:'false'});
process.exitCode=exitCode||productionExit;
