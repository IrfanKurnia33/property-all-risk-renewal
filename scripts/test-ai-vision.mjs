import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createHostedFixture } from '../tests/authenticated-fixtures.ts';

if(process.env.REKONVIA_RUN_HOSTED_TESTS!=='1' || process.env.REKONVIA_RUN_LIVE_AI_VISION_TEST!=='1')throw new Error('Set REKONVIA_RUN_HOSTED_TESTS=1 and REKONVIA_RUN_LIVE_AI_VISION_TEST=1 for exactly one synthetic image inference.');
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('.cache/ms-playwright');
const browserTemp=resolve('.cache/browser-temp');mkdirSync(browserTemp,{recursive:true});process.env.TMP=browserTemp;process.env.TEMP=browserTemp;
const {chromium}=await import('@playwright/test');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chromium',headless:true});
let imageDataUrl;
try {
  const page=await browser.newPage();
  imageDataUrl=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=650;
    const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#111111';
    const lines=['REKONVIA - FICTIONAL AI VISION TEST','PROPERTY ALL RISKS / PAR','Annual rate: 0.0483% (percent, not per mille)','Sum insured: IDR 1000000000','Prior agreed wording: Flood extension retained.','Renewal period: 01 January - 31 December 2027','Historical values require current client confirmation.'];
    context.font='bold 35px Arial';context.fillText(lines[0],45,65);context.font='31px Arial';
    for(let i=1;i<lines.length;i++)context.fillText(lines[i],45,75+i*74);
    return canvas.toDataURL('image/png');
  });
  const decoded=await page.evaluate(async dataUrl=>{const image=new Image();image.src=dataUrl;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};},imageDataUrl);
  assert.deepEqual(decoded,{width:1200,height:650});
}finally{await browser.close();}
const fixture=await createHostedFixture();
const {url,publicKey,accounts,caseA}=fixture;
async function api(path,input){
  const response=await fetch(url+'/functions/v1/renewal-api/cases/'+caseA+'/'+path,{method:input?'POST':'GET',headers:{apikey:publicKey,Authorization:'Bearer '+accounts[0].token,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(45_000)});
  const result=await response.json();assert.equal(response.status,200,'Synthetic vision API failed: '+(result.error?.code??response.status));return result;
}
try{
  let state=await fixture.read();
  const sourceId=state.documents[0].id,bytes=Buffer.from(imageDataUrl.split(',')[1],'base64'),sha256=createHash('sha256').update(bytes).digest('hex');
  const upload=await api('uploads/start',{documentVersionId:sourceId,name:'fictional-readable-clause.png',byteSize:bytes.length,mimeType:'image/png'});
  const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const written=await client.storage.from('renewal-documents').uploadToSignedUrl(upload.path,upload.token,bytes,{contentType:'image/png'});assert.equal(written.error,null);
  state=(await api('uploads/'+upload.documentId+'/finalize',{expectedVersion:state.lockVersion,idempotencyKey:randomUUID(),sha256})).state;
  const baseline=structuredClone(state);
  const created=await api('ai/batches',{idempotencyKey:randomUUID(),purpose:'extract',sections:[{id:'vision-source-1',documentVersionId:sourceId,sha256,locator:'Synthetic readable clause image 1; orientation 0 degrees',kind:'image'}],unprocessedCount:0});
  const result=await api('ai/batches/'+created.batch.id+'/steps/0',{idempotencyKey:randomUUID(),imageDataUrl});
  assert.ok(['completed','failed'].includes(result.step.status));
  assert.deepEqual(await fixture.read(),baseline);assert.equal(result.budget.attemptsToday,1);
  if(result.step.status==='completed'){
    assert.ok(result.step.result);const findings=result.step.result.findings;
    assert.ok(findings.every(f=>f.sourceIds.every(id=>id==='vision-source-1')));
    console.log(JSON.stringify({status:'completed',findingCount:findings.length,recognisedExactRate:JSON.stringify(result.step.result).includes('0.0483')}));
  }else console.log(JSON.stringify({status:'failed',errorCode:result.step.errorCode}));
  console.log('One actual readable synthetic image request; canonical case unchanged; QA run '+fixture.run+'; all temporary users disabled on cleanup.');
}finally{await fixture.cleanup();}
