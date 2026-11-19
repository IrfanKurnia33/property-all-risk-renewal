import { ApiError, assertKeys, caseIdPattern, uuid } from './api-contract.ts';
import { isBindingComplete, isRenewalCase } from './domain.ts';
import type { LocationValues, RenewalCase, Terms } from './domain.ts';
import { addDecimals, validMoney } from './decimal.ts';

export interface CaseCreation {
  workspaceId: string; caseId: string; clientName: string; periodStart: string; periodEnd: string;
  priorPeriodStart: string; priorPeriodEnd: string;
  clientUserIds: string[]; idempotencyKey: string; historicalLocations: LocationValues[];
}
export interface CaseAssignment { expectedVersion: number; idempotencyKey: string; clientUserIds: string[] }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ApiError(422, 'INVALID_IDENTIFIER');
  return value.toLowerCase();
}
function clients(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new ApiError(422, 'INVALID_CLIENTS');
  const ids=value.map(identifier);
  if (new Set(ids).size!==ids.length) throw new ApiError(422, 'INVALID_CLIENTS');
  return ids.sort();
}
function date(value: unknown): string {
  if (typeof value!=='string' || !/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0,10)!==value) throw new ApiError(422,'INVALID_PERIOD');
  return value;
}
export function parseCaseCreation(input: unknown): CaseCreation {
  assertKeys(input,['workspaceId','caseId','clientName','periodStart','periodEnd','priorPeriodStart','priorPeriodEnd','clientUserIds','idempotencyKey','historicalLocations']);
  if (typeof input.caseId!=='string' || !caseIdPattern.test(input.caseId)
    || typeof input.clientName!=='string' || !input.clientName.trim() || input.clientName.length>200
    || /[\u0000-\u001f\u007f]/.test(input.clientName)) throw new ApiError(422,'INVALID_CASE');
  const periodStart=date(input.periodStart),periodEnd=date(input.periodEnd);
  if (periodStart>periodEnd) throw new ApiError(422,'INVALID_PERIOD');
  const priorPeriodStart=date(input.priorPeriodStart),priorPeriodEnd=date(input.priorPeriodEnd);
  if (priorPeriodStart>priorPeriodEnd || priorPeriodEnd>=periodStart) throw new ApiError(422,'INVALID_PRIOR_PERIOD');
  if (!Array.isArray(input.historicalLocations) || !input.historicalLocations.length || input.historicalLocations.length>100)
    throw new ApiError(422,'INVALID_HISTORICAL_LOCATIONS');
  const historicalLocations=input.historicalLocations.map(value=>{
    assertKeys(value,['name','address','sumInsured']);assertKeys(value.sumInsured,['amount','currency']);
    if (typeof value.name!=='string' || !value.name.trim() || value.name.length>200 || /[\u0000-\u001f\u007f]/.test(value.name)
      || typeof value.address!=='string' || !value.address.trim() || value.address.length>1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.address)
      || !validMoney(value.sumInsured) || value.sumInsured.currency!=='IDR' || !/[1-9]/.test(value.sumInsured.amount))
      throw new ApiError(422,'INVALID_HISTORICAL_LOCATIONS');
    return {name:value.name.trim(),address:value.address.trim(),sumInsured:{amount:value.sumInsured.amount,currency:'IDR'}};
  });
  if (new Set(historicalLocations.map(v=>JSON.stringify(v))).size!==historicalLocations.length)
    throw new ApiError(422,'DUPLICATE_HISTORICAL_LOCATION');
  try { addDecimals(historicalLocations.map(l=>l.sumInsured.amount)); } catch { throw new ApiError(422,'INVALID_HISTORICAL_TOTAL'); }
  return {workspaceId:identifier(input.workspaceId),caseId:input.caseId,clientName:input.clientName.trim(),periodStart,periodEnd,priorPeriodStart,priorPeriodEnd,
    clientUserIds:clients(input.clientUserIds),idempotencyKey:identifier(input.idempotencyKey),historicalLocations};
}
export function parseCaseAssignment(input: unknown): CaseAssignment {
  assertKeys(input,['expectedVersion','idempotencyKey','clientUserIds']);
  if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion)<0) throw new ApiError(422,'INVALID_VERSION');
  return {expectedVersion:Number(input.expectedVersion),idempotencyKey:identifier(input.idempotencyKey),clientUserIds:clients(input.clientUserIds)};
}

/** Explicit starter placeholders, never a copy of a research case or proof of current client data. */
export function createManagedCase(input: CaseCreation, actorId: string, at=new Date().toISOString()): RenewalCase {
  actorId=identifier(actorId);
  const placeholder='CONTOH FIKTIF — ganti dari sumber dan tinjau sebelum digunakan.';
  const terms: Terms={occupation:placeholder,periodStart:input.periodStart,periodEnd:input.periodEnd,currency:'IDR',
    deductible:placeholder,additionalCoverage:placeholder,lossHistory:'Belum diperoleh; tidak berarti nihil klaim.',
    premiumLines:[{id:'par',peril:'PAR',included:true,basis:{amount:addDecimals(input.historicalLocations.map(l=>l.sumInsured.amount)),currency:'IDR'},
      rate:{value:'0',unit:'percent',basis:'sum-insured',peril:'PAR'},recordedPremium:null}]};
  const state: RenewalCase={schemaVersion:2,id:input.caseId,clientName:input.clientName,revision:1,lockVersion:0,insuranceClass:'PAR',fictional:true,
    priorTerms:{...structuredClone(terms),periodStart:input.priorPeriodStart,periodEnd:input.priorPeriodEnd},
    standardTerms:structuredClone(terms),terms:structuredClone(terms),originalClauses:[],
    locations:input.historicalLocations.map((prior,i)=>({id:'location-'+(i+1),prior:structuredClone(prior),
      proposed:null,confirmation:null,review:'unreviewed',reviewNote:''})),documents:[],
    options:[{id:'utama',name:'Opsi utama',terms:structuredClone(terms),materialRevision:1,wordingVersion:1}],selectedOptionId:'utama',
    wordingRevisions:[{optionId:'utama',version:1,revision:1,items:[],at,recordedBy:actorId}],
    termsRevisions:[{optionId:'utama',revision:1,terms:structuredClone(terms),at,recordedBy:actorId,note:placeholder}],
    insurerResponses:[],quoteSnapshots:[],proposals:[],activeProposalId:null,submissions:[],agreements:[],instructions:[],
    checks:{identity:false,period:false,rate:false,deductible:false,clauses:false},checksRevision:1,checksProposalId:null,
    dfsSnapshots:[],bindingRequests:[],bindingAcknowledgments:[],
    activity:[{id:'event-1',at,actor:{id:actorId,role:'broker'},label:'Kasus fiktif dibuat dengan jadwal historis dari broker. Belum ada konfirmasi periode berjalan dari klien.',revision:1,lockVersion:0}],
    notes:'Kasus fiktif baru. Jadwal lokasi historis dicatat oleh broker dan belum dikonfirmasi klien untuk periode berjalan. Terms dan rate 0% adalah placeholder; ganti dan tinjau dari sumber. Belum ada wording, dokumen sumber, persetujuan, atau instruksi.'};
  if (!isRenewalCase(state)) throw new ApiError(422,'INVALID_CASE');
  return state;
}
export function assignmentState(state: RenewalCase, actorId: string, at=new Date().toISOString()): RenewalCase {
  actorId=identifier(actorId);
  if (!isRenewalCase(state)) throw new ApiError(422,'INVALID_CASE');
  if (isBindingComplete(state)) throw new ApiError(422,'BINDING_COMPLETE','Binding selesai. Perubahan akses memerlukan peninjauan pemilik.');
  const next=structuredClone(state);next.lockVersion++;
  next.activity.push({id:'event-'+(next.lockVersion+1),at,actor:{id:actorId,role:'broker'},
    label:'Penugasan akun klien diperbarui; bukti dan keputusan sebelumnya tetap tersimpan.',revision:next.revision,lockVersion:next.lockVersion});
  if (!isRenewalCase(next)) throw new ApiError(422,'INVALID_TRANSITION');
  return next;
}
