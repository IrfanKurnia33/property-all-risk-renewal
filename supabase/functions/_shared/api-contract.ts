import { currentDecision, getActiveProposal, getSelectedOption, getCurrentWording, getProposalBlockers, isCurrentConfirmation, isBindingComplete } from './domain.ts';
import type { CaseAction, ProposalSnapshot, RenewalCase } from './domain.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message = code) { super(message); this.status=status; this.code=code; }
}
export interface Command { caseId: string; expectedVersion: number; idempotencyKey: string; type: CaseAction['type']; payload: Record<string, unknown> }
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const caseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const payloadKeys: Record<string, string[]> = {
  addDocument: ['document'], annotateDocument: ['documentVersionId','note'], reviseTerms: ['terms','note'],
  reviseWording: ['items','note'], reviewWording: ['itemId','disposition','note','question'], selectOption: ['optionId'],
  prepareQuote: [], recordInsurerResponse: ['response'], publishProposal: [], submitLocations: ['proposalId','locations'],
  reviewLocation: ['locationId','result','note'], setCheck: ['check','checked'], clientAgree: ['proposalId','evidence'],
  clientInstruct: ['proposalId','evidence'], issueDfs: [], requestBinding: ['dfsId','dispatch'],
  acknowledgeBinding: ['requestId','insurerId','externalRespondent','evidence'], saveNotes: ['notes'],
  attachEvidence: ['documentVersionId','file'], recordExport: ['kind','snapshotId'],
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function assertKeys(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!record(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v,k))) throw new ApiError(422,'INVALID_FIELDS');
}
export function parseCommand(value: unknown, internal = false): Command {
  let nodes = 0;
  function bounded(v: unknown, depth = 0) {
    if (++nodes > 20_000 || depth > 20) throw new ApiError(422,'INPUT_TOO_COMPLEX');
    if (typeof v === 'string' && v.length > 40_000) throw new ApiError(422,'INPUT_TOO_LONG');
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (['__proto__','constructor','prototype'].includes(k)) throw new ApiError(422,'INVALID_FIELDS');
      bounded(x,depth+1);
    }
  }
  bounded(value);
  assertKeys(value,['caseId','expectedVersion','idempotencyKey','type','payload']);
  if (typeof value.caseId !== 'string' || !caseIdPattern.test(value.caseId)
    || !Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion)<0
    || typeof value.idempotencyKey !== 'string' || !uuid.test(value.idempotencyKey)
    || typeof value.type !== 'string' || !Object.hasOwn(payloadKeys,value.type)) throw new ApiError(422,'INVALID_COMMAND');
  if (!internal && ['attachEvidence','recordExport'].includes(value.type)) throw new ApiError(422,'USE_ARTIFACT_ENDPOINT');
  assertKeys(value.payload,payloadKeys[value.type]);
  if (value.type==='addDocument' && record(value.payload.document) && Object.hasOwn(value.payload.document,'file')) throw new ApiError(422,'USE_UPLOAD_ENDPOINT');
  return {...value,idempotencyKey:value.idempotencyKey.toLowerCase()} as unknown as Command;
}
export function commandAction(command: Command): CaseAction { return { ...command.payload, type: command.type } as CaseAction; }

// An allowlist, not a copy of the broker snapshot with a few fields removed.
export function clientProposal(proposal: ProposalSnapshot) {
  const t=proposal.terms;
  return {
    id: proposal.id, version: proposal.version, optionId: proposal.optionId, revision: proposal.revision,
    publishedAt: proposal.at, terms: {occupation:t.occupation,periodStart:t.periodStart,periodEnd:t.periodEnd,
      currency:t.currency,deductible:t.deductible,additionalCoverage:t.additionalCoverage,lossHistory:t.lossHistory,
      premiumLines:t.premiumLines.map(l=>({id:l.id,peril:l.peril,included:l.included,
        basis:{amount:l.basis.amount,currency:l.basis.currency},rate:{value:l.rate.value,unit:l.rate.unit,basis:l.rate.basis,peril:l.rate.peril},
        recordedPremium:l.recordedPremium?{amount:l.recordedPremium.amount,currency:l.recordedPremium.currency}:null}))},
    locations:proposal.locations.map(l=>({id:l.id,currentConfirmed:l.currentConfirmed,
      values:{name:l.values.name,address:l.values.address,sumInsured:{amount:l.values.sumInsured.amount,currency:l.values.sumInsured.currency}}})),
    wording: proposal.wording.map(w => ({ id:w.id, title:w.title, direction:w.direction,
      disposition:w.disposition, wording:w.disposition==='rejected-enhancement' || w.disposition==='withdrawal-accepted' ? w.reply : w.outgoing })),
    participants: proposal.responses.filter(r=>r.position==='accepted').map(r=>({ insurerName:r.insurerName,
      sharePercent:r.sharePercent,leader:r.leader,conditions:r.conditions.map(c=>({text:c.text,required:c.required,resolved:c.resolved})) })),
  };
}
export function clientView(state: RenewalCase, actorId: string) {
  const proposal=getActiveProposal(state);
  const current=!!proposal && proposal.optionId===state.selectedOptionId && proposal.revision===state.revision;
  const locked=isBindingComplete(state);
  const confirmed=state.locations.every(l=>l.proposed && isCurrentConfirmation(state,l) && !!l.proposed.address.trim());
  const panelReady=!getProposalBlockers(state).length;
  const canAgree=current && confirmed && panelReady && !locked;
  const canSubmitLocations=!!proposal && proposal.optionId===state.selectedOptionId
    && proposal.terms.periodStart===state.terms.periodStart && proposal.terms.periodEnd===state.terms.periodEnd && !locked;
  return {
    caseId:state.id, clientName:state.clientName, lockVersion:state.lockVersion, fictional:state.fictional,
    proposal:proposal ? clientProposal(proposal) : null, proposalCurrent:current,
    proposalDocumentAvailable:false,
    currentLocations:proposal?.locations.map(published=>{
      const location=state.locations.find(l=>l.id===published.id);
      const own=!!location && isCurrentConfirmation(state,location) && location.confirmation?.confirmedBy===actorId
        && proposal.optionId===state.selectedOptionId && proposal.terms.periodStart===state.terms.periodStart
        && proposal.terms.periodEnd===state.terms.periodEnd;
      return {id:published.id,values:structuredClone(own?location.proposed!:published.values),currentConfirmed:own,
        ownConfirmation:own?{source:location.confirmation!.source,at:location.confirmation!.at,submissionId:location.confirmation!.submissionId}:null};
    })??[],
    submissions:state.submissions.filter(s=>s.recordedBy===actorId),
    agreements:state.agreements.filter(s=>s.recordedBy===actorId), instructions:state.instructions.filter(s=>s.recordedBy===actorId),
    bindingComplete:locked, canSubmitLocations, canAgree,
    canInstruct:canAgree && !!currentDecision(state,state.agreements),
    agreementCurrent:!!currentDecision(state,state.agreements), instructionCurrent:!!currentDecision(state,state.instructions),
    decisionBlockers:[...(!current?['Tunggu proposal terbaru dari broker.']:[]),...(!confirmed?['Konfirmasikan setiap lokasi, alamat, dan nilai periode berjalan.']:[]),
      ...(!panelReady?['Broker perlu meninjau kesiapan panel dan wording.']:[]),...(locked?['Renewal ini telah selesai dan terkunci.']:[])],
  };
}
export function requiredSourceIds(state: RenewalCase, action: CaseAction): string[] {
  const ids=new Set<string>();
  const add=(ref: {documentVersionId:string}|null)=>{ if(ref) ids.add(ref.documentVersionId); };
  if (['prepareQuote','publishProposal','issueDfs','recordExport','requestBinding'].includes(action.type)) {
    for(const w of getCurrentWording(state).items) { add(w.priorSource); add(w.outgoingSource); add(w.replySource); }
  }
  if (['publishProposal','issueDfs','recordExport','requestBinding'].includes(action.type)) {
    const option=getSelectedOption(state);
    for(const r of state.insurerResponses.filter(r=>r.optionId===option.id && r.materialRevision===option.materialRevision && r.wordingVersion===option.wordingVersion)) add(r.evidence);
  }
  if(action.type==='recordInsurerResponse') add(action.response.evidence);
  if(action.type==='acknowledgeBinding') add(action.evidence);
  return [...ids];
}
