import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actor, RenewalCase } from '../_shared/domain.ts';
import { ApiError, assertKeys, uuid } from '../_shared/api-contract.ts';
import { AI_MODEL, aiMessages, parseAiBatch, parseAiReview, validateAiImage, validateAiResult } from '../_shared/ai-contract.ts';
import type { AiBatch, AiBudget, AiReview, AiSection, AiSourceContext, AiStep } from '../_shared/ai-contract.ts';

interface AiContext { service:SupabaseClient; state:RenewalCase; actor:Actor; workspaceId:string }
interface StepRow { batch_id:string; step_index:number; section_ids:string[]; status:AiStep['status']; result:AiStep['result']; error_code:string|null; attempted_at:string|null; attempt_id:string|null }
interface ReviewRow { decision:AiReview['decision']; note:string; reviewed_by:string; created_at:string; batch_id:string; step_index:number }
interface BatchRow { id:string; request:{purpose:AiBatch['purpose']; sections:AiSection[]; unprocessedCount:number}; created_at:string }

function checked<T>(result:{data:T;error:{code?:string;message?:string}|null}):T {
  const error=result.error;if(!error)return result.data;
  if(error.message?.includes('AI_DAILY_LIMIT'))throw new ApiError(429,'AI_DAILY_LIMIT');
  if(error.message?.includes('AI_IN_FLIGHT'))throw new ApiError(409,'AI_IN_FLIGHT');
  if(error.message?.includes('AI_LEASE_EXPIRED'))throw new ApiError(409,'AI_INTERRUPTED');
  if(error.message?.includes('IDEMPOTENCY_CONFLICT'))throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
  if(error.message?.includes('SOURCE_FILE_REQUIRED'))throw new ApiError(422,'SOURCE_FILE_REQUIRED');
  if(error.code==='42501')throw new ApiError(403,'BROKER_REQUIRED');
  if(error.code==='P0002')throw new ApiError(404,'NOT_FOUND');
  if(error.code==='22023')throw new ApiError(422,'INVALID_AI_REQUEST');
  throw new ApiError(500,'AI_DATABASE_ERROR');
}
const review=(r:ReviewRow):AiReview=>({decision:r.decision,note:r.note,reviewedBy:r.reviewed_by,at:r.created_at});
const step=(s:StepRow,r?:ReviewRow):AiStep=>({index:s.step_index,sectionIds:s.section_ids,status:s.status,result:s.result,errorCode:s.error_code,attemptedAt:s.attempted_at,review:r?review(r):null});
async function budget(ctx:AiContext):Promise<AiBudget> {
  return checked(await ctx.service.rpc('ai_workspace_budget',{p_workspace:ctx.workspaceId}));
}
async function batches(ctx:AiContext,batchId?:string):Promise<AiBatch[]> {
  let query=ctx.service.from('ai_batches').select('id,request,created_at').eq('case_id',ctx.state.id).order('created_at',{ascending:false}).limit(50);
  if(batchId)query=query.eq('id',batchId);
  const rows=checked(await query) as BatchRow[];
  if(!rows.length)return [];
  const ids=rows.map(b=>b.id);
  const [steps,reviews]=await Promise.all([
    ctx.service.from('ai_steps').select('*').in('batch_id',ids).order('step_index'),
    ctx.service.from('ai_step_reviews').select('batch_id,step_index,decision,note,reviewed_by,created_at').in('batch_id',ids).order('created_at',{ascending:false}),
  ]);
  const ss=checked(steps) as StepRow[],rr=checked(reviews) as ReviewRow[];
  return rows.map(b=>({id:b.id,purpose:b.request.purpose,sections:b.request.sections,unprocessedCount:b.request.unprocessedCount,createdAt:b.created_at,
    steps:ss.filter(s=>s.batch_id===b.id).map(s=>step(s,rr.find(r=>r.batch_id===b.id && r.step_index===s.step_index)))}));
}
async function boundedJson(response:Response,maxBytes:number):Promise<unknown> {
  const reader=response.body?.getReader();if(!reader)throw new ApiError(422,'AI_INVALID_OUTPUT');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new ApiError(422,'AI_INVALID_OUTPUT');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(422,'AI_INVALID_OUTPUT');}
}
const provider={allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true,max_price:{prompt:0,completion:0,image:0,request:0}};

async function providerResult(sections:AiSection[],purpose:AiBatch['purpose'],sourceContext:AiSourceContext[],image?:string) {
  const key=Deno.env.get('OPENROUTER_API_KEY');if(!key)throw new ApiError(503,'AI_NOT_CONFIGURED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35_000);
  try {
    const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:controller.signal,
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:AI_MODEL,provider,messages:aiMessages(purpose,sections,image,sourceContext),response_format:{type:'json_object'},max_tokens:4096,temperature:0,stream:false})});
    if(!response.ok){
      await response.body?.cancel();
      const code=response.status===400 || response.status===422?'AI_INPUT_UNSUPPORTED':response.status===404?'AI_NO_ELIGIBLE_PROVIDER':response.status===402?'AI_PROVIDER_LIMIT':
        response.status===401 || response.status===403?'AI_PROVIDER_CONFIGURATION':response.status===429?'AI_RATE_LIMIT':'AI_UNAVAILABLE';
      throw new ApiError(503,code);
    }
    const value=await boundedJson(response,128*1024) as {choices?:{finish_reason?:string;message?:{content?:unknown;refusal?:unknown}}[];usage?:{cost?:unknown}};
    if(typeof value.usage?.cost==='number' && value.usage.cost>0)throw new ApiError(422,'AI_PRICE_POLICY');
    const choice=value.choices?.[0];
    if(choice?.finish_reason==='length')throw new ApiError(422,'AI_OUTPUT_TRUNCATED');
    if(choice?.message?.refusal)throw new ApiError(422,'AI_REFUSED');
    if(typeof choice?.message?.content!=='string')throw new ApiError(422,'AI_INVALID_OUTPUT');
    let parsed:unknown;try{parsed=JSON.parse(choice.message.content);}catch{throw new ApiError(422,'AI_INVALID_OUTPUT');}
    try{return validateAiResult(parsed,sections);}catch{throw new ApiError(422,'AI_INVALID_OUTPUT');}
  }catch(error){
    if(controller.signal.aborted)throw new ApiError(504,'AI_TIMEOUT');
    if(error instanceof ApiError)throw error;
    throw new ApiError(503,'AI_UNAVAILABLE');
  }finally{clearTimeout(timer);}
}
async function status() {
  const key=Deno.env.get('OPENROUTER_API_KEY');
  if(!key)return {configured:false,available:false,errorCode:'AI_NOT_CONFIGURED',limits:null};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);
  try {
    const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${key}`},signal:controller.signal});
    if(!response.ok){await response.body?.cancel();return {configured:true,available:false,errorCode:'AI_PROVIDER_CONFIGURATION',limits:null};}
    const raw=await boundedJson(response,32*1024) as {data?:{free_model_daily_requests?:{used?:unknown;limit?:unknown;remaining?:unknown};is_free_tier?:unknown;limit_remaining?:unknown}};
    const daily=raw.data?.free_model_daily_requests;
    const safeNumber=(value:unknown)=>typeof value==='number' && Number.isFinite(value) && value>=0?value:null;
    return {configured:true,available:true,errorCode:null,limits:{dailyUsed:safeNumber(daily?.used),dailyLimit:safeNumber(daily?.limit),dailyRemaining:safeNumber(daily?.remaining),
      isFreeTier:typeof raw.data?.is_free_tier==='boolean'?raw.data.is_free_tier:null,keyLimitRemaining:safeNumber(raw.data?.limit_remaining)}};
  }catch{return {configured:true,available:false,errorCode:controller.signal.aborted?'AI_TIMEOUT':'AI_UNAVAILABLE',limits:null};}
  finally{clearTimeout(timer);}
}

/** Called only after JWT/case authorization; SQL independently rechecks broker membership. */
export async function handleAi(ctx:AiContext,method:string,parts:string[],input?:unknown):Promise<unknown> {
  if(ctx.actor.role!=='broker')throw new ApiError(403,'BROKER_REQUIRED');
  if(method==='GET' && parts.length===0){
    checked(await ctx.service.rpc('refresh_ai_leases',{p_case_id:ctx.state.id,p_actor:ctx.actor.id}));
    return {batches:await batches(ctx),budget:await budget(ctx)};
  }
  if(method==='GET' && parts.length===1 && parts[0]==='provider-status')return status();
  if(method==='POST' && parts.length===1 && parts[0]==='batches') {
    const parsed=parseAiBatch(input);
    if(parsed.sections.some(section=>section.kind==='image' && !['application/pdf','image/jpeg','image/png','image/webp'].includes(
      ctx.state.documents.find(d=>d.id===section.documentVersionId)?.file?.mimeType??'')))throw new ApiError(422,'INVALID_AI_IMAGE_SOURCE');
    const id=checked(await ctx.service.rpc('create_ai_batch',{p_case_id:ctx.state.id,p_actor:ctx.actor.id,p_request:parsed})) as string;
    return {batch:(await batches(ctx,id))[0],budget:await budget(ctx)};
  }
  if(parts[0]!=='batches' || !uuid.test(parts[1]??'') || parts[2]!=='steps' || !/^[0-5]$/.test(parts[3]??''))throw new ApiError(404,'NOT_FOUND');
  const batchId=parts[1],index=Number(parts[3]);
  if(method==='POST' && parts.length===5 && parts[4]==='review') {
    const parsed=parseAiReview(input);
    checked(await ctx.service.rpc('review_ai_step',{p_case_id:ctx.state.id,p_actor:ctx.actor.id,p_batch:batchId,p_step:index,p_request:parsed}));
    const batch=(await batches(ctx,batchId))[0];if(!batch)throw new ApiError(404,'NOT_FOUND');
    return {step:batch.steps.find(s=>s.index===index)};
  }
  if(method!=='POST' || parts.length!==4)throw new ApiError(404,'NOT_FOUND');
  const batch=(await batches(ctx,batchId))[0];if(!batch)throw new ApiError(404,'NOT_FOUND');
  const selected=batch.steps.find(s=>s.index===index);if(!selected)throw new ApiError(404,'NOT_FOUND');
  const sections=batch.sections.filter(s=>selected.sectionIds.includes(s.id)),image=sections.some(s=>s.kind==='image');
  const done=selected.status==='completed' || selected.status==='failed';
  assertKeys(input,image && !done?['idempotencyKey','imageDataUrl']:done && !!input && typeof input==='object' && 'imageDataUrl' in input?['idempotencyKey','imageDataUrl']:['idempotencyKey']);
  if(typeof input.idempotencyKey!=='string' || !uuid.test(input.idempotencyKey))throw new ApiError(422,'INVALID_AI_REQUEST');
  // Completed/failed steps can be read again without re-sending image bytes or invoking the provider.
  if(done)return {step:selected,budget:await budget(ctx)};
  const dataUrl=image?validateAiImage(input.imageDataUrl):undefined;
  const inputBytes=new TextEncoder().encode(JSON.stringify({batchId,index,sections,imageDataUrl:dataUrl}));
  const inputSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',inputBytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const reserved=checked(await ctx.service.rpc('reserve_ai_step',{p_case_id:ctx.state.id,p_actor:ctx.actor.id,p_batch:batchId,p_step:index,p_idempotency_key:input.idempotencyKey.toLowerCase(),p_input_sha256:inputSha256})) as {run:boolean;step:StepRow};
  if(!reserved.run)return {step:step(reserved.step),budget:await budget(ctx)};
  let result:AiStep['result']=null,errorCode:string|null=null;
  const registry=ctx.state.documents.filter(d=>sections.some(s=>s.documentVersionId===d.id)).map(d=>({documentVersionId:d.id,type:d.type,status:d.status,periodStart:d.periodStart,periodEnd:d.periodEnd,optionId:d.optionId}));
  try{result=await providerResult(sections,batch.purpose,registry,dataUrl);}catch(error){errorCode=error instanceof ApiError && /^AI_[A-Z_]+$/.test(error.code)?error.code:'AI_UNAVAILABLE';}
  const finished=checked(await ctx.service.rpc('finish_ai_step',{p_case_id:ctx.state.id,p_actor:ctx.actor.id,p_batch:batchId,p_step:index,p_attempt:reserved.step.attempt_id,p_result:result,p_error:errorCode})) as StepRow;
  return {step:step(finished),budget:await budget(ctx)};
}
