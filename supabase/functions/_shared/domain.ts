import { addDecimals, calculatePremium, isDecimal, validMoney, validPremiumLine, type Money, type PremiumLine } from './decimal.ts'

export type Role = 'broker' | 'client'
export type Stage = 'materials' | 'insurer' | 'proposal' | 'reconciliation' | 'final'
export interface Actor { id: string; role: Role }
export interface Terms {
  occupation: string
  periodStart: string
  periodEnd: string
  currency: string
  deductible: string
  additionalCoverage: string
  lossHistory: string
  premiumLines: PremiumLine[]
}
export interface LocationValues { name: string; address: string; sumInsured: Money }
export interface SourceReference { documentVersionId: string; locator: string; excerpt: string; shareable: boolean }
export type DocumentType = 'prior-slip' | 'schedule' | 'issued-change' | 'standard-wording' | 'QS' | 'insurer-reply' | 'proposal' | 'DFS' | 'client-evidence' | 'binding-evidence'
export interface EvidenceFile { id: string; sha256: string; byteSize: number; mimeType: string }
export interface DocumentVersion {
  id: string; documentId: string; version: number; name: string; type: DocumentType
  insuranceClass: 'PAR'; periodStart: string; periodEnd: string; producer: string
  optionId: string | null; status: 'draft' | 'agreed' | 'issued' | 'received'
  fictional: boolean; createdAt: string; recordedBy: string; note: string
  file?: EvidenceFile
}
export interface WordingItem {
  id: string; title: string; prior: string; outgoing: string; reply: string
  priorSource: SourceReference | null; outgoingSource: SourceReference; replySource: SourceReference | null
  direction: 'retained' | 'enhancement' | 'withdrawal' | 'change'
  disposition: 'unreviewed' | 'retain' | 'accepted' | 'rejected-enhancement' | 'withdrawal-accepted' | 'followup'
  reviewNote: string; question: string
}
export interface WordingRevision { optionId: string; version: number; revision: number; items: WordingItem[]; at: string; recordedBy: string }
export interface TermsRevision { optionId: string; revision: number; terms: Terms; at: string; recordedBy: string; note: string }
export interface QuotationOption { id: string; name: string; terms: Terms; materialRevision: number; wordingVersion: number }
export interface InsurerResponse {
  id: string; optionId: string; materialRevision: number; wordingVersion: number; quoteId: string
  insurerId: string; insurerName: string; externalRespondent: string; responseAt: string
  recordedBy: string; recordedAt: string; position: 'outreach' | 'pending' | 'accepted' | 'declined'
  sharePercent: string; leader: boolean; terms: Terms; conditions: { text: string; required: boolean; resolved: boolean }[]
  evidence: SourceReference; note: string
}
export interface RenewalLocation {
  id: string; prior: LocationValues; proposed: LocationValues | null
  confirmation: { confirmed: boolean; source: string; confirmedBy: string; at: string; submissionId: string } | null
  review: 'unreviewed' | 'matched' | 'followup'; reviewNote: string
}
export interface ClientLocationInput extends LocationValues { locationId: string; confirmed: boolean; evidence: string }
export interface LocationSubmission { id: string; proposalId: string; revision: number; recordedBy: string; at: string; locations: ClientLocationInput[] }
export interface ScheduleRowData {
  locationName: string; address: string; occupancy: string; sumInsured: string; currency: string
  coverage: string; rate: string; rateUnit: string; rateBasis: string; rateApplicability: string
  deductible: string; remarks: string
}
export type ScheduleField = keyof ScheduleRowData
export interface ScheduleRow {
  id: string
  source: { sheetName: string; rowNumber: number; cells: Partial<Record<ScheduleField, string>>; formulaCells: string[]; hidden: boolean; warnings: string[] }
  imported: ScheduleRowData
  values: ScheduleRowData
  warnings: string[]
}
export interface ScheduleVersion {
  id: string; version: number; sourceDocumentVersionId: string; sourceSha256: string
  periodStart: string; periodEnd: string; reviewedAt: string; reviewedBy: string; rows: ScheduleRow[]
}
export interface QuoteSnapshot {
  id: string; optionId: string; materialRevision: number; wordingVersion: number; at: string; recordedBy: string
  terms: Terms; locations: { id: string; values: LocationValues; currentConfirmed: boolean }[]
  schedule?: ScheduleVersion
  wording: WordingItem[]; sourceVersionIds: string[]
}
export interface ProposalSnapshot {
  id: string; version: number; optionId: string; revision: number; materialRevision: number; wordingVersion: number
  at: string; publishedBy: string; terms: Terms; locations: { id: string; values: LocationValues; currentConfirmed: boolean }[]
  wording: WordingItem[]; responses: InsurerResponse[]; sourceVersionIds: string[]
}
export const BROKER_CHECKS = {
  identity: 'Nama, alamat, nilai, dan sumber konfirmasi sesuai', period: 'Periode pertanggungan sudah diperiksa',
  rate: 'Rate dan perhitungan premi sudah diperiksa', deductible: 'Deductible, perluasan, dan kondisi diperiksa',
  clauses: 'Wording asli utuh; perubahan dan sumber ditinjau',
} as const
export type CheckKey = keyof typeof BROKER_CHECKS
export interface VersionDecision { id: string; proposalId: string; revision: number; submissionId: string | null; at: string; recordedBy: string; evidence: string }
export interface DfsSnapshot {
  id: string; revision: number; proposalId: string; optionId: string; at: string; recordedBy: string
  proposal: ProposalSnapshot; locations: { id: string; values: LocationValues; confirmation: NonNullable<RenewalLocation['confirmation']> }[]
  agreementId: string; instructionId: string; checks: Record<CheckKey, boolean>; responseIds: string[]
}
export interface BindingRequest { id: string; revision: number; dfsId: string; proposalId: string; optionId: string; at: string; recordedBy: string; dispatch: { channel: string; reference: string; sentAt: string; recipient: string } }
export interface BindingAcknowledgment { id: string; requestId: string; insurerId: string; revision: number; at: string; recordedBy: string; externalRespondent: string; evidence: SourceReference }
export interface RenewalCase {
  schemaVersion: 2; id: string; clientName: string; revision: number; lockVersion: number
  insuranceClass: 'PAR'; fictional: boolean; scheduleRequired?: boolean; scheduleVersions?: ScheduleVersion[]
  priorTerms: Terms; standardTerms: Terms
  terms: Terms; originalClauses: string[]; locations: RenewalLocation[]; documents: DocumentVersion[]
  options: QuotationOption[]; selectedOptionId: string; wordingRevisions: WordingRevision[]; termsRevisions: TermsRevision[]
  insurerResponses: InsurerResponse[]; quoteSnapshots: QuoteSnapshot[]; proposals: ProposalSnapshot[]; activeProposalId: string | null
  submissions: LocationSubmission[]; agreements: VersionDecision[]; instructions: VersionDecision[]
  checks: Record<CheckKey, boolean>; checksRevision: number; checksProposalId: string | null
  dfsSnapshots: DfsSnapshot[]; bindingRequests: BindingRequest[]; bindingAcknowledgments: BindingAcknowledgment[]
  activity: { id: string; at: string; actor: Actor; label: string; revision: number; lockVersion: number }[]; notes: string
}
export type CaseAction =
  | { type: 'attachEvidence'; documentVersionId: string; file: EvidenceFile }
  | { type: 'addDocument'; document: Omit<DocumentVersion, 'createdAt' | 'recordedBy'> }
  | { type: 'annotateDocument'; documentVersionId: string; note: string }
  | { type: 'reviseTerms'; terms: Terms; note: string }
  | { type: 'reviseWording'; items: WordingItem[]; note: string }
  | { type: 'reviewWording'; itemId: string; disposition: WordingItem['disposition']; note: string; question: string }
  | { type: 'selectOption'; optionId: string }
  | { type: 'saveSchedule'; sourceDocumentVersionId: string; sourceSha256: string; rows: ScheduleRow[] }
  | { type: 'prepareQuote' }
  | { type: 'recordInsurerResponse'; response: Omit<InsurerResponse, 'id' | 'recordedBy' | 'recordedAt'> }
  | { type: 'publishProposal' }
  | { type: 'submitLocations'; proposalId: string; locations: ClientLocationInput[] }
  | { type: 'reviewLocation'; locationId: string; result: 'matched' | 'followup'; note: string }
  | { type: 'setCheck'; check: CheckKey; checked: boolean }
  | { type: 'clientAgree'; proposalId: string; evidence: string }
  | { type: 'clientInstruct'; proposalId: string; evidence: string }
  | { type: 'issueDfs' }
  | { type: 'requestBinding'; dfsId: string; dispatch: BindingRequest['dispatch'] }
  | { type: 'acknowledgeBinding'; requestId: string; insurerId: string; externalRespondent: string; evidence: SourceReference }
  | { type: 'saveNotes'; notes: string }
  | { type: 'recordExport'; kind: 'QS' | 'proposal' | 'DFS'; snapshotId: string }
export interface Blocker { id: string; label: string; stage: Stage; locationId?: string }

const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const txt = (v: unknown): v is string => typeof v === 'string' && v.length <= 40_000
const filled = (v: unknown): v is string => txt(v) && v.trim().length > 0
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 5_000
const unique = (items: { id: string }[]) => new Set(items.map(x => x.id)).size === items.length
const stamp = (v: unknown): v is string => filled(v) && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
const date = (v: unknown): v is string => filled(v) && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const freshChecks = (): Record<CheckKey, boolean> => ({ identity: false, period: false, rate: false, deductible: false, clauses: false })
export const LOCAL_ACTORS: Record<Role, Actor> = { broker: { id: 'broker-demo', role: 'broker' }, client: { id: 'client-demo', role: 'client' } }
const initialAt = '2026-11-19T02:00:00.000Z'
const documentTypes: DocumentType[] = ['prior-slip', 'schedule', 'issued-change', 'standard-wording', 'QS', 'insurer-reply', 'proposal', 'DFS', 'client-evidence', 'binding-evidence']
const dispositions: WordingItem['disposition'][] = ['unreviewed', 'retain', 'accepted', 'rejected-enhancement', 'withdrawal-accepted', 'followup']
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function validActor(v: unknown): v is Actor { return rec(v) && filled(v.id) && (v.role === 'broker' || v.role === 'client') }
function validTerms(v: unknown): v is Terms {
  if (!(rec(v) && filled(v.occupation) && date(v.periodStart) && date(v.periodEnd) && v.periodStart <= v.periodEnd
    && typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency) && filled(v.deductible)
    && filled(v.additionalCoverage) && filled(v.lossHistory) && list(v.premiumLines) && v.premiumLines.length > 0
    && v.premiumLines.every(line => validPremiumLine(line) && line.basis.currency === v.currency) && unique(v.premiumLines as PremiumLine[]))) return false
  try {
    for (const line of v.premiumLines as PremiumLine[]) calculatePremium(line)
    return true
  } catch { return false }
}
function validValues(v: unknown): v is LocationValues {
  return rec(v) && filled(v.name) && txt(v.address) && validMoney(v.sumInsured) && /[1-9]/.test(v.sumInsured.amount)
}
function validDocument(v: unknown): v is DocumentVersion {
  return rec(v) && filled(v.id) && filled(v.documentId) && integer(v.version) && v.version > 0 && filled(v.name)
    && documentTypes.includes(v.type as DocumentType) && v.insuranceClass === 'PAR'
    && date(v.periodStart) && date(v.periodEnd) && v.periodStart <= v.periodEnd && filled(v.producer)
    && (v.optionId === null || filled(v.optionId)) && ['draft', 'agreed', 'issued', 'received'].includes(v.status as string)
    && v.fictional === true && stamp(v.createdAt) && filled(v.recordedBy) && txt(v.note)
    && (v.file === undefined || validEvidenceFile(v.file))
}
const scheduleFields: ScheduleField[] = ['locationName', 'address', 'occupancy', 'sumInsured', 'currency', 'coverage', 'rate', 'rateUnit', 'rateBasis', 'rateApplicability', 'deductible', 'remarks']
export function getScheduleRowIssues(data: ScheduleRowData, currency: string, rateNeedsCorrection = false): string[] {
  const issues: string[] = []
  if (!filled(data.locationName)) issues.push('Location name is required.')
  if (!filled(data.address)) issues.push('Address is required.')
  if (!filled(data.occupancy)) issues.push('Occupancy is required.')
  if (!isDecimal(data.sumInsured) || !/[1-9]/.test(data.sumInsured)) issues.push('Sum insured must be a positive decimal.')
  if (data.currency !== currency) issues.push('Currency must match the terms currency.')
  if (!filled(data.coverage)) issues.push('Coverage or peril is required.')
  if (!isDecimal(data.rate)) issues.push('Rate must be a non-negative decimal.')
  if (rateNeedsCorrection) issues.push('Rate uses Excel percentage formatting; verify the displayed source rate and correct it before saving.')
  if (!['percent', 'per-mille'].includes(data.rateUnit)) issues.push('Select the explicit rate unit.')
  if (!filled(data.rateBasis)) issues.push('Rate basis is required.')
  if (!filled(data.rateApplicability)) issues.push('Rate applicability is required.')
  if (!filled(data.deductible)) issues.push('Deductible is required.')
  return issues
}
function validScheduleData(v: unknown, currency: string, complete: boolean): v is ScheduleRowData {
  if (!rec(v) || !scheduleFields.every(key => txt(v[key]))) return false
  const data = v as unknown as ScheduleRowData
  if (!complete) return true
  return validMoney({ amount: data.sumInsured, currency: data.currency }) && data.currency === currency
    && getScheduleRowIssues(data, currency).length === 0
}
function validScheduleRow(v: unknown, currency: string): v is ScheduleRow {
  if (!rec(v) || !filled(v.id) || !rec(v.source) || !filled(v.source.sheetName)
    || !integer(v.source.rowNumber) || v.source.rowNumber < 1 || !rec(v.source.cells)
    || !Object.entries(v.source.cells).every(([key, cell]) => scheduleFields.includes(key as ScheduleField) && filled(cell))
    || !list(v.source.formulaCells) || !v.source.formulaCells.every(filled) || typeof v.source.hidden !== 'boolean'
    || !list(v.source.warnings) || !v.source.warnings.every(txt) || !validScheduleData(v.imported, currency, false)
    || !validScheduleData(v.values, currency, true) || !list(v.warnings) || !v.warnings.every(txt)) return false
  const percentageFormatted = [...v.source.warnings, ...v.warnings].some(warning => warning.startsWith('Rate cell ') && warning.includes('uses Excel percentage formatting;'))
  return !(percentageFormatted && v.values.rate === v.imported.rate)
}
function validScheduleVersion(v: unknown, state: RenewalCase): v is ScheduleVersion {
  if (!rec(v) || !filled(v.id) || !integer(v.version) || v.version < 1 || !filled(v.sourceDocumentVersionId)
    || typeof v.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceSha256)
    || !date(v.periodStart) || !date(v.periodEnd) || v.periodStart > v.periodEnd
    || !stamp(v.reviewedAt) || !filled(v.reviewedBy) || !list(v.rows) || !v.rows.length || v.rows.length > 200
    || !unique(v.rows as { id: string }[]) || !v.rows.every(row => validScheduleRow(row, state.terms.currency))) return false
  const source = state.documents.find(document => document.id === v.sourceDocumentVersionId)
  return !!source && source.type === 'schedule' && source.status === 'received'
    && source.periodStart === v.periodStart && source.periodEnd === v.periodEnd
    && source.file?.sha256 === v.sourceSha256
    && source.file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}
function validEvidenceFile(v: unknown): v is EvidenceFile {
  return rec(v) && typeof v.id === 'string' && /^[a-f0-9-]{36}$/i.test(v.id)
    && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256)
    && integer(v.byteSize) && v.byteSize > 0 && v.byteSize <= 10 * 1024 * 1024 && filled(v.mimeType)
}
function validRef(v: unknown, state: RenewalCase, types: DocumentType[], optionId?: string, currentPeriod = false): v is SourceReference {
  if (!rec(v) || !filled(v.documentVersionId) || !filled(v.locator) || !txt(v.excerpt) || typeof v.shareable !== 'boolean') return false
  const doc = state.documents.find(d => d.id === v.documentVersionId)
  if (!doc || !types.includes(doc.type) || doc.insuranceClass !== state.insuranceClass) return false
  if (['insurer-reply', 'binding-evidence'].includes(doc.type) && !['received', 'agreed', 'issued'].includes(doc.status)) return false
  if (optionId && doc.optionId !== optionId) return false
  const terms = optionId ? state.options.find(o => o.id === optionId)?.terms : state.terms
  return !currentPeriod || !!terms && doc.periodStart === terms.periodStart && doc.periodEnd === terms.periodEnd
}
function validWording(item: unknown, state: RenewalCase, optionId: string, currentPeriod = true): item is WordingItem {
  if (!rec(item) || !filled(item.id) || !filled(item.title) || !txt(item.prior) || !filled(item.outgoing) || !txt(item.reply)
    || !['retained', 'enhancement', 'withdrawal', 'change'].includes(item.direction as string)
    || !dispositions.includes(item.disposition as WordingItem['disposition']) || !txt(item.reviewNote) || !txt(item.question)) return false
  if (!validRef(item.outgoingSource, state, ['QS'], optionId, currentPeriod) || item.outgoingSource.excerpt !== item.outgoing) return false
  if (item.priorSource !== null && (!validRef(item.priorSource, state, ['prior-slip', 'schedule', 'issued-change']) || item.priorSource.excerpt !== item.prior)) return false
  if ((item.prior !== '') !== (item.priorSource !== null)) return false
  if (item.priorSource) {
    const doc = state.documents.find(d => d.id === (item.priorSource as SourceReference).documentVersionId)!
    const outgoing = state.documents.find(d => d.id === (item.outgoingSource as SourceReference).documentVersionId)!
    if (!['agreed', 'issued'].includes(doc.status) || doc.periodEnd >= outgoing.periodStart) return false
  }
  if (item.replySource !== null && (!validRef(item.replySource, state, ['insurer-reply'], optionId, currentPeriod) || item.replySource.excerpt !== item.reply)) return false
  if (item.replySource === null && item.reply !== '') return false
  if (item.direction === 'enhancement' && item.prior !== '') return false
  if (item.direction === 'withdrawal' && (!item.prior || item.reply !== '' || item.replySource === null)) return false
  if (item.direction === 'retained' && (item.prior !== item.outgoing || item.replySource !== null && item.reply !== item.outgoing)) return false
  if (item.disposition === 'rejected-enhancement' && (item.direction !== 'enhancement' || item.replySource === null || item.reply === item.outgoing)) return false
  if (item.disposition === 'withdrawal-accepted' && item.direction !== 'withdrawal') return false
  if (item.disposition === 'retain' && (item.prior !== item.outgoing || item.replySource !== null && item.reply !== item.outgoing)) return false
  if (item.disposition === 'accepted' && (item.replySource === null || item.reply !== item.outgoing)) return false
  return item.disposition === 'unreviewed' || filled(item.reviewNote)
}
export function getSelectedOption(state: RenewalCase): QuotationOption { return state.options.find(o => o.id === state.selectedOptionId)! }
export function getCurrentWording(state: RenewalCase): WordingRevision {
  const option = getSelectedOption(state)
  return state.wordingRevisions.findLast(w => w.optionId === option.id && w.version === option.wordingVersion)!
}
export function getCurrentQuote(state: RenewalCase): QuoteSnapshot | undefined {
  const option = getSelectedOption(state)
  const quote = state.quoteSnapshots.findLast(q => q.optionId === option.id && q.materialRevision === option.materialRevision && q.wordingVersion === option.wordingVersion)
  return state.scheduleRequired && !quote?.schedule ? undefined : quote
}
export function getCurrentSchedule(state: RenewalCase): ScheduleVersion | undefined {
  return (state.scheduleVersions ?? []).findLast(schedule => {
    const source = state.documents.find(document => document.id === schedule.sourceDocumentVersionId)
    return source?.periodStart === state.terms.periodStart && source.periodEnd === state.terms.periodEnd
  })
}
export function getActiveProposal(state: RenewalCase): ProposalSnapshot | undefined { return state.proposals.find(p => p.id === state.activeProposalId) }
export function isCurrentConfirmation(state: RenewalCase, location: RenewalLocation): boolean {
  if (!location.proposed || !location.confirmation?.confirmed) return false
  const submission = state.submissions.find(s => s.id === location.confirmation!.submissionId)
  const proposal = state.proposals.find(p => p.id === submission?.proposalId)
  const input = submission?.locations.find(l => l.locationId === location.id)
  return !!proposal && proposal.terms.periodStart === state.terms.periodStart && proposal.terms.periodEnd === state.terms.periodEnd
    && !!input?.confirmed && input.name === location.proposed.name && input.address === location.proposed.address
    && equal(input.sumInsured, location.proposed.sumInsured) && input.evidence === location.confirmation.source
    && submission?.recordedBy === location.confirmation.confirmedBy && submission.at === location.confirmation.at
}
export function getCurrentResponses(state: RenewalCase): InsurerResponse[] {
  const option = getSelectedOption(state)
  const latest = new Map<string, InsurerResponse>()
  for (const response of state.insurerResponses) if (response.optionId === option.id && response.materialRevision === option.materialRevision && response.wordingVersion === option.wordingVersion) latest.set(response.insurerId, response)
  return [...latest.values()]
}
export function getCurrentDfs(state: RenewalCase): DfsSnapshot | undefined {
  return state.dfsSnapshots.findLast(d => d.revision === state.revision && d.proposalId === state.activeProposalId
    && d.agreementId === currentDecision(state, state.agreements)?.id && d.instructionId === currentDecision(state, state.instructions)?.id
    && equal(d.checks, state.checks) && state.locations.every(l => l.review === 'matched'
      && d.locations.some(saved => saved.id === l.id && equal(saved.values, l.proposed) && equal(saved.confirmation, l.confirmation))))
}
export function getCurrentBindingRequest(state: RenewalCase): BindingRequest | undefined {
  const dfs = getCurrentDfs(state)
  return state.bindingRequests.findLast(r => r.revision === state.revision && r.dfsId === dfs?.id)
}
export function getQsBlockers(state: RenewalCase): Blocker[] {
  const blockers: Blocker[] = []
  if (state.scheduleRequired && !getCurrentSchedule(state)) blockers.push({ id: 'schedule-required', label: 'Unggah, tinjau, dan simpan schedule XLSX untuk periode renewal ini.', stage: 'materials' })
  const wording = getCurrentWording(state)
  if (!wording?.items.length) blockers.push({ id: 'wording-missing', label: 'Wording QS dan sumbernya belum diidentifikasi.', stage: 'materials' })
  for (const item of wording?.items ?? []) {
    const { id, title } = item
    if (!validWording(item, state, state.selectedOptionId)) blockers.push({ id: 'source-' + id, label: title + ': kelas, periode, versi, atau kutipan sumber belum sesuai.', stage: 'materials' })
    if (['unreviewed', 'followup'].includes(item.disposition) || item.question.trim()) blockers.push({ id: 'wording-' + item.id, label: item.title + ': tinjau wording dan selesaikan pertanyaan QS.', stage: 'materials' })
  }
  return blockers
}
function responseCompatible(state: RenewalCase, response: InsurerResponse): boolean {
  const q = getCurrentQuote(state)
  return response.position === 'accepted' && response.quoteId === q?.id && equal(response.terms, state.terms)
    && validRef(response.evidence, state, ['insurer-reply'], state.selectedOptionId, true)
}
export function getProposalBlockers(state: RenewalCase): Blocker[] {
  const blockers = getQsBlockers(state)
  const quote = getCurrentQuote(state)
  if (!quote) blockers.push({ id: 'quote-current', label: 'Siapkan QS untuk opsi dan versi wording ini.', stage: 'materials' })
  const responses = getCurrentResponses(state)
  const accepted = responses.filter(r => r.position === 'accepted')
  for (const response of accepted) if (!responseCompatible(state, response)) blockers.push({ id: 'incompatible-' + response.id, label: response.insurerName + ': terms atau versi QS berbeda. Jangan gabungkan ke panel ini.', stage: 'insurer' })
  const share = addDecimals(accepted.filter(r => responseCompatible(state, r)).map(r => r.sharePercent))
  if (share !== '100') blockers.push({ id: 'panel-share', label: 'Partisipasi yang sesuai opsi ini ' + share + '%. Diperlukan 100% untuk proposal pilot.', stage: 'insurer' })
  return blockers
}
export function currentDecision(state: RenewalCase, items: VersionDecision[]): VersionDecision | undefined {
  return items.findLast(d => d.revision === state.revision && d.proposalId === state.activeProposalId
    && d.submissionId === (state.submissions.at(-1)?.id ?? null))
}
function riskBlockers(state: RenewalCase): Blocker[] {
  return state.locations.flatMap(location => {
    const blocks: Blocker[] = []
    const add = (id: string, label: string) => blocks.push({ id: id + '-' + location.id, label: location.prior.name + ': ' + label, stage: 'reconciliation', locationId: location.id })
    if (!location.proposed || !location.proposed.address.trim()) add('risk', 'nama, alamat, dan nilai periode berjalan belum lengkap.')
    if (!isCurrentConfirmation(state, location) || !location.confirmation?.source.trim()) add('confirmation', 'menunggu konfirmasi klien untuk periode berjalan, termasuk data yang tetap.')
    if (location.review !== 'matched') add('matching', 'broker belum mencocokkan bukti klien.')
    return blocks
  })
}
export function getExportBlockers(state: RenewalCase): Blocker[] {
  const blockers = [...getProposalBlockers(state), ...riskBlockers(state)]
  const proposal = getActiveProposal(state)
  if (!proposal || proposal.revision !== state.revision) blockers.push({ id: 'proposal-current', label: 'Publikasikan proposal terbaru; keputusan lama tetap tersimpan.', stage: 'proposal' })
  if (!currentDecision(state, state.agreements)) blockers.push({ id: 'client-agreement', label: 'Persetujuan klien atas proposal terbaru belum tersedia.', stage: 'proposal' })
  if (!currentDecision(state, state.instructions)) blockers.push({ id: 'client-instruction', label: 'Instruksi renewal klien untuk proposal terbaru belum tersedia.', stage: 'proposal' })
  for (const response of getCurrentResponses(state).filter(r => responseCompatible(state, r))) {
    response.conditions.forEach((c, i) => { if (c.required && !c.resolved) blockers.push({ id: 'condition-' + response.id + '-' + i, label: response.insurerName + ': kondisi wajib belum selesai: ' + c.text, stage: 'insurer' }) })
  }
  for (const key of Object.keys(BROKER_CHECKS) as CheckKey[]) if (!state.checks[key] || state.checksRevision !== state.revision || state.checksProposalId !== state.activeProposalId) {
    blockers.push({ id: 'check-' + key, label: BROKER_CHECKS[key], stage: 'final' })
  }
  return blockers
}
export function getBindingBlockers(state: RenewalCase): Blocker[] {
  const blockers = getExportBlockers(state)
  if (!getCurrentDfs(state)) blockers.push({ id: 'dfs-current', label: 'Terbitkan DFS versi terkini sebelum mencatat pengiriman binding.', stage: 'final' })
  return blockers
}
export function isBindingComplete(state: RenewalCase): boolean {
  const request = getCurrentBindingRequest(state)
  const members = getCurrentResponses(state).filter(r => responseCompatible(state, r))
  return !!request && members.length > 0 && members.every(r => state.bindingAcknowledgments.some(a => a.requestId === request.id && a.insurerId === r.insurerId))
}
export function getCoverageStatus(state: RenewalCase, now = new Date()): string {
  const request = getCurrentBindingRequest(state)
  if (!request) return 'Belum binding'
  if (!isBindingComplete(state)) return 'Menunggu acknowledgment setiap anggota'
  const start = Date.parse(state.terms.periodStart + 'T00:00:00+07:00')
  const end = Date.parse(state.terms.periodEnd + 'T23:59:59.999+07:00')
  return now.getTime() < start ? 'Terjadwal' : now.getTime() > end ? 'Periode berakhir' : 'Aktif'
}
function materialChange(state: RenewalCase, resetQuote = false) {
  state.revision += 1
  state.checks = freshChecks()
  state.checksRevision = state.revision
  state.checksProposalId = null
  if (resetQuote) getSelectedOption(state).materialRevision = state.revision
}
function refreshPremiumBasis(state: RenewalCase, actor: Actor, at: string) {
  const amount = addDecimals(state.locations.map(l => (l.proposed ?? l.prior).sumInsured.amount))
  for (const option of state.options) {
    option.terms.premiumLines = option.terms.premiumLines.map(line => ({ ...line, basis: { amount, currency: option.terms.currency }, recordedPremium: line.basis.amount === amount ? line.recordedPremium : null }))
    option.materialRevision = state.revision
    state.termsRevisions.push({ optionId: option.id, revision: state.revision, terms: structuredClone(option.terms), at, recordedBy: actor.id, note: 'Basis premi diperbarui mengikuti tanggapan lokasi klien.' })
  }
  state.terms = structuredClone(getSelectedOption(state).terms)
}
function currentRiskSnapshot(state: RenewalCase) {
  return state.locations.map(l => ({ id: l.id, values: structuredClone(l.proposed ?? l.prior), currentConfirmed: isCurrentConfirmation(state, l) }))
}
export function applyAction(state: RenewalCase, actor: Actor, action: CaseAction, expectedVersion: number, at = new Date().toISOString()): RenewalCase {
  ensure(isRenewalCase(state), 'Data kasus tidak valid. Cadangkan data sebelum memulai ulang.')
  ensure(validActor(actor), 'Aktor tidak dikenal. Insurer tidak memiliki peran portal.')
  ensure(expectedVersion === state.lockVersion, 'Versi kasus berubah. Tinjau versi terbaru sebelum menyimpan.')
  ensure(stamp(at), 'Waktu pencatatan tidak valid.')
  ensure(rec(action) && filled(action.type), 'Perintah tidak valid.')
  const clientActions = ['submitLocations', 'clientAgree', 'clientInstruct']
  ensure(clientActions.includes(action.type) ? actor.role === 'client' : actor.role === 'broker', 'Tindakan tidak tersedia untuk peran ini.')
  ensure(!isBindingComplete(state) || ['saveNotes', 'annotateDocument', 'addDocument', 'attachEvidence', 'recordExport'].includes(action.type), 'Binding sudah diakui seluruh anggota panel. Data renewal dikunci; perubahan setelah binding berada di luar pilot ini.')
  const next = structuredClone(state)
  const option = getSelectedOption(next)
  let label = action.type as string
  const decision = (evidence: string): VersionDecision => ({ id: 'decision-' + (state.agreements.length + state.instructions.length + 1), proposalId: state.activeProposalId!, revision: state.revision, submissionId: state.submissions.at(-1)?.id ?? null, recordedBy: actor.id, at, evidence })
  switch (action.type) {
    case 'attachEvidence': {
      const document = next.documents.find(d => d.id === action.documentVersionId)
      ensure(document && !document.file && validEvidenceFile(action.file), 'Berkas bukti tidak valid atau sudah terpasang. Buat versi baru untuk mengganti berkas.')
      document.file = structuredClone(action.file)
      label = 'Berkas bukti terverifikasi dipasang pada versi dokumen.'
      break
    }
    case 'addDocument': {
      const doc = { ...action.document, createdAt: at, recordedBy: actor.id }
      ensure(validDocument(doc) && !state.documents.some(d => d.id === doc.id || d.documentId === doc.documentId && d.version === doc.version), 'Identitas atau versi dokumen tidak valid / sudah tercatat.')
      ensure(doc.optionId === null || state.options.some(o => o.id === doc.optionId), 'Opsi dokumen tidak dikenal.')
      const prior = state.documents.filter(d => d.documentId === doc.documentId)
      ensure(prior.every(d => d.version < doc.version && d.type === doc.type && d.producer === doc.producer), 'Versi baru harus berurutan setelah versi lama dan mempertahankan identitas dokumen.')
      next.documents.push(doc)
      label = 'Broker mencatat versi sumber ' + doc.name + '.'
      break
    }
    case 'saveSchedule': {
      const source = next.documents.find(document => document.id === action.sourceDocumentVersionId)
      ensure(source?.type === 'schedule' && source.status === 'received' && source.file
        && source.file.sha256 === action.sourceSha256
        && source.file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        && !(next.scheduleVersions ?? []).some(schedule => schedule.sourceDocumentVersionId === source.id),
      'Unggah dan finalisasi XLSX schedule baru sebelum meninjau versi ini.')
      const schedule: ScheduleVersion = {
        id: 'schedule-' + ((next.scheduleVersions ?? []).length + 1),
        version: (next.scheduleVersions ?? []).length + 1,
        sourceDocumentVersionId: source.id,
        sourceSha256: action.sourceSha256,
        periodStart: source.periodStart,
        periodEnd: source.periodEnd,
        reviewedAt: at,
        reviewedBy: actor.id,
        rows: structuredClone(action.rows),
      }
      ensure(validScheduleVersion(schedule, next), 'Baris schedule belum lengkap atau tidak valid. Periksa nilai, mata uang, rate, dan unit.')
      next.scheduleVersions = [...(next.scheduleVersions ?? []), schedule]
      materialChange(next, true)
      label = 'Broker meninjau dan menyimpan schedule versi ' + schedule.version + '.'
      break
    }
    case 'annotateDocument': {
      ensure(txt(action.note), 'Catatan dokumen tidak valid.')
      const doc = next.documents.find(d => d.id === action.documentVersionId)
      ensure(doc, 'Versi dokumen tidak ditemukan.')
      doc.note = action.note
      label = 'Metadata catatan sumber diperbarui; versi dan keputusan tetap.'
      break
    }
    case 'saveNotes':
      ensure(txt(action.notes), 'Catatan tidak valid.')
      next.notes = action.notes
      label = 'Catatan sesi disimpan.'
      break
    case 'selectOption':
      ensure(state.options.some(o => o.id === action.optionId) && action.optionId !== state.selectedOptionId, 'Pilih opsi lain yang tersedia.')
      next.selectedOptionId = action.optionId
      next.terms = structuredClone(getSelectedOption(next).terms)
      materialChange(next)
      next.activeProposalId = null
      label = 'Opsi dipilih; proposal sebelumnya disupersesi, riwayat tetap tersedia.'
      break
    case 'reviseTerms':
      ensure(validTerms(action.terms) && filled(action.note) && !equal(action.terms, state.terms), 'Lengkapi perubahan terms dan alasannya.')
      ensure(action.terms.currency === state.terms.currency, 'Perubahan mata uang memerlukan kasus terpisah pada pilot ini.')
      ensure(action.terms.premiumLines.every(l => l.basis.amount === addDecimals(state.locations.map(v => (v.proposed ?? v.prior).sumInsured.amount))), 'Basis premi harus sesuai total sum insured, tanpa mengubah data klien.')
      materialChange(next, true)
      option.terms = structuredClone(action.terms)
      next.terms = structuredClone(action.terms)
      next.termsRevisions.push({ optionId: option.id, revision: next.revision, terms: structuredClone(action.terms), at, recordedBy: actor.id, note: action.note })
      label = 'Terms direvisi: ' + action.note
      break
    case 'reviseWording': {
      ensure(list(action.items) && action.items.length > 0 && unique(action.items) && filled(action.note), 'Isi wording dan alasan perubahan.')
      ensure(action.items.every(i => validWording(i, next, option.id)), 'Wording atau referensi sumber tidak sesuai kelas, periode, opsi, dan kutipan.')
      const old = getCurrentWording(state)
      ensure(old.items.every(i => action.items.some(n => n.id === i.id && n.prior === i.prior && equal(n.priorSource, i.priorSource))), 'Jangan hapus atau ubah wording historis. Catat penarikan sebagai hasil perbandingan.')
      ensure(old.items.every(i => action.items.some(n => n.id === i.id
        && (n.outgoing === i.outgoing || n.outgoingSource.documentVersionId !== i.outgoingSource.documentVersionId)
        && (i.replySource === null || n.reply === i.reply || n.replySource?.documentVersionId !== i.replySource.documentVersionId))), 'Wording sumber berubah: catat versi dokumen baru; jangan menimpa kutipan versi lama.')
      materialChange(next, true)
      option.wordingVersion += 1
      next.wordingRevisions.push({ optionId: option.id, version: option.wordingVersion, revision: next.revision, items: structuredClone(action.items), at, recordedBy: actor.id })
      label = 'Versi wording baru dicatat: ' + action.note
      break
    }
    case 'reviewWording': {
      const current = getCurrentWording(next)
      const items = structuredClone(current.items)
      const item = items.find(i => i.id === action.itemId)
      ensure(item && dispositions.includes(action.disposition) && filled(action.note) && txt(action.question), 'Lengkapi keputusan review dan catatan.')
      Object.assign(item, { disposition: action.disposition, reviewNote: action.note, question: action.question })
      ensure(validWording(item, next, option.id), 'Keputusan tidak cocok dengan arah perubahan atau bukti wording.')
      materialChange(next, true)
      option.wordingVersion += 1
      next.wordingRevisions.push({ optionId: option.id, version: option.wordingVersion, revision: next.revision, items, at, recordedBy: actor.id })
      label = 'Broker meninjau wording ' + item.title + ': ' + action.note
      break
    }
    case 'prepareQuote':
      ensure(!getQsBlockers(state).length, 'QS belum siap: ' + getQsBlockers(state)[0]?.label)
      ensure(!getCurrentQuote(state), 'QS versi ini sudah tersedia. Ekspor snapshot yang sama.')
      const schedule = getCurrentSchedule(state)
      next.quoteSnapshots.push({ id: 'qs-' + (state.quoteSnapshots.length + 1), optionId: option.id, materialRevision: option.materialRevision, wordingVersion: option.wordingVersion, at, recordedBy: actor.id, terms: structuredClone(state.terms), locations: currentRiskSnapshot(state), ...(schedule ? { schedule: structuredClone(schedule) } : {}), wording: structuredClone(getCurrentWording(state).items), sourceVersionIds: [...new Set([...getCurrentWording(state).items.flatMap(i => [i.priorSource?.documentVersionId, i.outgoingSource.documentVersionId, i.replySource?.documentVersionId]), schedule?.sourceDocumentVersionId].filter((s): s is string => !!s))] })
      label = 'QS disiapkan; data historis diberi label belum dikonfirmasi.'
      break
    case 'recordInsurerResponse': {
      ensure(rec(action.response), 'Respons tidak valid.')
      const response: InsurerResponse = { ...action.response, id: 'response-' + (state.insurerResponses.length + 1), recordedBy: actor.id, recordedAt: at }
      ensure(validResponse(response, state), 'Lengkapi insurer, responden eksternal, waktu, share, terms, dan bukti versi QS yang tepat.')
      ensure(response.optionId === option.id && response.materialRevision === option.materialRevision && response.wordingVersion === option.wordingVersion && response.quoteId === getCurrentQuote(state)?.id, 'Respons harus mengacu QS aktif, bukan opsi atau versi terdahulu.')
      const previous = getCurrentResponses(state).find(r => r.insurerId === response.insurerId)
      next.insurerResponses.push(response)
      if (response.position === 'accepted' || previous?.position === 'accepted') materialChange(next)
      label = 'Broker mencatat respons eksternal ' + response.insurerName + ' (' + response.sharePercent + '%).'
      break
    }
    case 'publishProposal': {
      ensure(!getProposalBlockers(state).length, 'Proposal belum siap: ' + getProposalBlockers(state)[0]?.label)
      const proposal: ProposalSnapshot = { id: 'proposal-' + (state.proposals.length + 1), version: state.proposals.length + 1, optionId: option.id, revision: state.revision, materialRevision: option.materialRevision, wordingVersion: option.wordingVersion, at, publishedBy: actor.id, terms: structuredClone(state.terms), locations: currentRiskSnapshot(state), wording: structuredClone(getCurrentWording(state).items), responses: structuredClone(getCurrentResponses(state)), sourceVersionIds: getCurrentQuote(state)!.sourceVersionIds }
      next.proposals.push(structuredClone(proposal))
      next.activeProposalId = proposal.id
      next.checks = freshChecks()
      next.checksProposalId = null
      label = 'Proposal v' + proposal.version + ' dipublikasikan untuk konfirmasi klien.'
      break
    }
    case 'submitLocations': {
      const proposal = getActiveProposal(state)
      ensure(proposal && proposal.id === action.proposalId && proposal.optionId === state.selectedOptionId
        && proposal.terms.periodStart === state.terms.periodStart && proposal.terms.periodEnd === state.terms.periodEnd,
      'Tunggu proposal aktif untuk opsi dan periode berjalan sebelum mengirim data klien.')
      ensure(list(action.locations) && action.locations.length > 0 && new Set(action.locations.map(i => i.locationId)).size === action.locations.length, 'Tanggapan lokasi kosong atau duplikat.')
      const submissionId = 'submission-' + (state.submissions.length + 1)
      let material = false
      for (const input of action.locations) {
        ensure(validValues(input) && typeof input.confirmed === 'boolean' && txt(input.evidence) && input.sumInsured.currency === state.terms.currency, 'Data lokasi atau nilai desimal tidak valid.')
        const location = next.locations.find(l => l.id === input.locationId)
        ensure(location, 'Lokasi tidak dikenal.')
        ensure(!input.confirmed || filled(input.address) && filled(input.evidence), 'Konfirmasi memerlukan alamat lengkap dan sumber klien.')
        const values = { name: input.name, address: input.address, sumInsured: structuredClone(input.sumInsured) }
        material ||= !equal(location.proposed ?? location.prior, values)
        location.proposed = values
        location.confirmation = { confirmed: input.confirmed, source: input.evidence, confirmedBy: actor.id, at, submissionId }
        location.review = 'unreviewed'
        location.reviewNote = ''
      }
      if (material) { materialChange(next, true); refreshPremiumBasis(next, actor, at) }
      else { next.checks = freshChecks(); next.checksProposalId = null }
      next.submissions.push({ id: submissionId, proposalId: action.proposalId, revision: next.revision, recordedBy: actor.id, at, locations: structuredClone(action.locations) })
      label = 'Klien mengirim data lokasi. Persetujuan dan instruksi perlu diberikan setelah tanggapan ini.'
      break
    }
    case 'reviewLocation': {
      ensure(['matched', 'followup'].includes(action.result) && filled(action.note), 'Isi hasil dan catatan pencocokan.')
      const location = next.locations.find(l => l.id === action.locationId)
      ensure(location?.proposed, 'Tunggu data klien.')
      if (action.result === 'matched') ensure(isCurrentConfirmation(state, location) && filled(location.proposed.address) && filled(location.confirmation?.source), 'Tunggu alamat, nilai, dan bukti konfirmasi klien untuk periode berjalan.')
      location.review = action.result
      location.reviewNote = action.note
      next.checks.identity = false
      label = 'Broker mencocokkan lokasi: ' + location.prior.name
      break
    }
    case 'clientAgree':
    case 'clientInstruct': {
      const proposal = getActiveProposal(state)
      ensure(proposal?.id === action.proposalId && proposal.revision === state.revision && filled(action.evidence), 'Tinjau proposal terbaru dan isi bukti keputusan klien.')
      ensure(state.locations.every(l => l.proposed && isCurrentConfirmation(state, l) && filled(l.proposed.address)), 'Konfirmasikan setiap lokasi dan nilai untuk periode berjalan terlebih dahulu.')
      ensure(!getProposalBlockers(state).length, 'Panel dan wording belum sesuai.')
      if (action.type === 'clientInstruct') ensure(currentDecision(state, state.agreements), 'Setujui proposal terbaru sebelum memberi instruksi renewal.')
      next[action.type === 'clientAgree' ? 'agreements' : 'instructions'].push(decision(action.evidence))
      label = action.type === 'clientAgree' ? 'Klien menyetujui proposal aktif.' : 'Klien memberi instruksi renewal proposal aktif.'
      break
    }
    case 'setCheck':
      ensure(Object.hasOwn(BROKER_CHECKS, action.check) && typeof action.checked === 'boolean', 'Pemeriksaan tidak dikenal.')
      if (action.checked) ensure(!getExportBlockers(state).some(b => !b.id.startsWith('check-')), 'Selesaikan data, instruksi, dan kondisi wajib sebelum pemeriksaan akhir.')
      next.checks[action.check] = action.checked
      next.checksRevision = state.revision
      next.checksProposalId = state.activeProposalId
      label = 'Pemeriksaan broker: ' + BROKER_CHECKS[action.check]
      break
    case 'issueDfs': {
      ensure(!getExportBlockers(state).length, 'DFS belum siap: ' + getExportBlockers(state)[0]?.label)
      const proposal = getActiveProposal(state)!
      next.dfsSnapshots.push({ id: 'dfs-' + (state.dfsSnapshots.length + 1), revision: state.revision, proposalId: proposal.id, optionId: option.id, at, recordedBy: actor.id, proposal: structuredClone(proposal), locations: state.locations.map(l => ({ id: l.id, values: structuredClone(l.proposed!), confirmation: structuredClone(l.confirmation!) })), agreementId: currentDecision(state, state.agreements)!.id, instructionId: currentDecision(state, state.instructions)!.id, checks: structuredClone(state.checks), responseIds: getCurrentResponses(state).filter(r => responseCompatible(state, r)).map(r => r.id) })
      label = 'DFS versi terkini disiapkan dari snapshot proposal dan bukti klien.'
      break
    }
    case 'requestBinding':
      ensure(!getBindingBlockers(state).length && action.dfsId === getCurrentDfs(state)?.id, 'Binding memerlukan DFS dan instruksi terkini.')
      ensure(!getCurrentBindingRequest(state), 'Pengiriman binding versi ini sudah tercatat.')
      ensure(rec(action.dispatch) && filled(action.dispatch.channel) && filled(action.dispatch.reference) && filled(action.dispatch.recipient) && stamp(action.dispatch.sentAt), 'Isi kanal, penerima, referensi, dan waktu pengiriman eksternal.')
      next.bindingRequests.push({ id: 'binding-' + (state.bindingRequests.length + 1), revision: state.revision, dfsId: action.dfsId, proposalId: state.activeProposalId!, optionId: option.id, at, recordedBy: actor.id, dispatch: structuredClone(action.dispatch) })
      label = 'Broker mencatat pengiriman binding eksternal: ' + action.dispatch.reference
      break
    case 'acknowledgeBinding': {
      const request = getCurrentBindingRequest(state)
      ensure(request?.id === action.requestId && !getBindingBlockers(state).length, 'Permintaan binding terkini belum tersedia.')
      ensure(getCurrentResponses(state).some(r => r.insurerId === action.insurerId && responseCompatible(state, r)), 'Insurer bukan peserta panel aktif.')
      ensure(filled(action.externalRespondent) && validRef(action.evidence, state, ['binding-evidence'], option.id, true) && filled(action.evidence.excerpt), 'Isi responden eksternal dan bukti acknowledgment binding versi yang tepat.')
      const participant = getCurrentResponses(state).find(r => r.insurerId === action.insurerId)!
      ensure(state.documents.find(d => d.id === action.evidence.documentVersionId)?.producer === participant.insurerName, 'Pembuat bukti acknowledgment harus sesuai insurer anggota ini.')
      ensure(!state.bindingAcknowledgments.some(a => a.requestId === request.id && a.insurerId === action.insurerId), 'Acknowledgment anggota ini sudah tercatat.')
      next.bindingAcknowledgments.push({ id: 'ack-' + (state.bindingAcknowledgments.length + 1), requestId: request.id, insurerId: action.insurerId, revision: state.revision, at, recordedBy: actor.id, externalRespondent: action.externalRespondent, evidence: structuredClone(action.evidence) })
      label = 'Broker mencatat acknowledgment eksternal satu anggota panel.'
      break
    }
    case 'recordExport': {
      ensure(['QS', 'proposal', 'DFS'].includes(action.kind), 'Jenis ekspor tidak dikenal.')
      const snapshot = action.kind === 'QS' ? getCurrentQuote(state) : action.kind === 'proposal' ? getActiveProposal(state) : getCurrentDfs(state)
      const blockers = action.kind === 'QS' ? getQsBlockers(state) : action.kind === 'proposal' ? getProposalBlockers(state) : getExportBlockers(state)
      ensure(snapshot?.id === action.snapshotId && !blockers.length && (action.kind !== 'proposal' || getActiveProposal(state)?.revision === state.revision), 'Snapshot ekspor tidak tersedia atau sudah kedaluwarsa.')
      label = 'Broker mengunduh ' + action.kind + ' ' + action.snapshotId + '.'
      break
    }
    default: throw new Error('Perintah tidak dikenal.')
  }
  next.lockVersion += 1
  next.activity.push({ id: 'event-' + (state.activity.length + 1), at, actor: structuredClone(actor), label, revision: next.revision, lockVersion: next.lockVersion })
  ensure(isRenewalCase(next), 'Perubahan tidak konsisten. Data sebelumnya tetap tersedia.')
  return next
}

function validResponse(v: unknown, state: RenewalCase): v is InsurerResponse {
  if (!rec(v) || !filled(v.id) || !filled(v.insurerId) || !filled(v.insurerName) || !filled(v.externalRespondent)
    || !stamp(v.responseAt) || !filled(v.recordedBy) || !stamp(v.recordedAt) || !integer(v.materialRevision)
    || !integer(v.wordingVersion) || !filled(v.optionId) || !filled(v.quoteId)
    || !['outreach', 'pending', 'accepted', 'declined'].includes(v.position as string)
    || !isDecimal(v.sharePercent) || !validTerms(v.terms) || typeof v.leader !== 'boolean' || !txt(v.note)
    || !list(v.conditions) || !v.conditions.every(c => rec(c) && filled(c.text) && typeof c.required === 'boolean' && typeof c.resolved === 'boolean')
    || !validRef(v.evidence, state, ['insurer-reply'], v.optionId) || !filled(v.evidence.excerpt)) return false
  // Capacity is a percentage; no panel-size or minimum-share rule is inferred.
  const share = v.sharePercent.split('.')
  if (BigInt(share[0]) > 100n || BigInt(share[0]) === 100n && /[1-9]/.test(share[1] ?? '')) return false
  if (v.position === 'accepted' && !/[1-9]/.test(v.sharePercent)) return false
  const quote = state.quoteSnapshots.find(q => q.id === v.quoteId)
  if (!quote || quote.optionId !== v.optionId || quote.materialRevision !== v.materialRevision || quote.wordingVersion !== v.wordingVersion) return false
  const doc = state.documents.find(d => d.id === (v.evidence as SourceReference).documentVersionId)!
  return doc.periodStart === quote.terms.periodStart && doc.periodEnd === quote.terms.periodEnd && doc.producer === v.insurerName
}

/** Pure trust-boundary checks; no browser, Node, or Supabase runtime dependencies. */
export function isRenewalCase(value: unknown): value is RenewalCase {
  try {
    if (!rec(value) || value.schemaVersion !== 2 || !filled(value.id) || !filled(value.clientName) || value.insuranceClass !== 'PAR'
      || value.fictional !== true || !integer(value.revision) || value.revision < 1 || !integer(value.lockVersion)
      || (value.scheduleRequired !== undefined && typeof value.scheduleRequired !== 'boolean')
      || (value.scheduleVersions !== undefined && !list(value.scheduleVersions))
      || !validTerms(value.terms) || !validTerms(value.priorTerms) || !validTerms(value.standardTerms) || !txt(value.notes)
      || !list(value.originalClauses) || !value.originalClauses.every(filled) || !rec(value.checks)
      || !Object.keys(BROKER_CHECKS).every(k => typeof (value.checks as Record<string, unknown>)[k] === 'boolean')
      || !integer(value.checksRevision) || value.checksRevision > value.revision
      || !(value.checksProposalId === null || filled(value.checksProposalId))) return false
    const arrays = ['locations', 'documents', 'options', 'wordingRevisions', 'termsRevisions', 'insurerResponses', 'quoteSnapshots', 'proposals', 'submissions', 'agreements', 'instructions', 'dfsSnapshots', 'bindingRequests', 'bindingAcknowledgments', 'activity']
    if (!arrays.every(k => list(value[k]))) return false
    const state = value as unknown as RenewalCase
    if (!state.locations.length || !state.options.length || !state.wordingRevisions.length || !state.activity.length) return false
    if (![state.locations, state.documents, state.options, state.insurerResponses, state.quoteSnapshots, state.proposals, state.submissions, state.agreements, state.instructions, state.dfsSnapshots, state.bindingRequests, state.bindingAcknowledgments, state.activity].every(a => a.every(x => rec(x) && filled(x.id)) && unique(a))) return false
    const revision = (n: unknown) => integer(n) && n >= 1 && n <= state.revision
    const sourcesExist = (ids: unknown) => list(ids) && ids.every(id => state.documents.some(d => d.id === id))
    if (!state.documents.every(d => validDocument(d) && (d.optionId === null || state.options.some(o => o.id === d.optionId)))) return false
    if (new Set(state.documents.map(d => d.documentId + ':' + d.version)).size !== state.documents.length) return false
    const schedules = state.scheduleVersions ?? []
    if (!schedules.every((schedule, index) => validScheduleVersion(schedule, state)
      && schedule.version === index + 1 && schedule.id === 'schedule-' + (index + 1))
      || new Set(schedules.map(schedule => schedule.sourceDocumentVersionId)).size !== schedules.length) return false
    if (!state.options.every(o => filled(o.id) && filled(o.name) && validTerms(o.terms) && o.terms.currency === state.terms.currency && revision(o.materialRevision) && integer(o.wordingVersion) && o.wordingVersion >= 1)) return false
    const selected = getSelectedOption(state)
    if (!selected || !equal(selected.terms, state.terms)) return false
    if (!state.termsRevisions.every(t => rec(t) && state.options.some(o => o.id === t.optionId) && revision(t.revision)
      && validTerms(t.terms) && stamp(t.at) && filled(t.recordedBy) && filled(t.note))) return false
    if (new Set(state.termsRevisions.map(t => t.optionId + ':' + t.revision)).size !== state.termsRevisions.length
      || !state.options.every(o => equal(state.termsRevisions.findLast(t => t.optionId === o.id)?.terms, o.terms))) return false
    if (!state.wordingRevisions.every(w => rec(w) && state.options.some(o => o.id === w.optionId) && integer(w.version) && w.version > 0 && revision(w.revision) && stamp(w.at) && filled(w.recordedBy)
      && list(w.items) && unique(w.items) && w.items.every(i => validWording(i, state, w.optionId, false)))) return false
    if (new Set(state.wordingRevisions.map(w => w.optionId + ':' + w.version)).size !== state.wordingRevisions.length || !state.options.every(o => state.wordingRevisions.some(w => w.optionId === o.id && w.version === o.wordingVersion))) return false
    if (!state.locations.every(l => validValues(l.prior) && l.prior.sumInsured.currency === state.terms.currency
      && (l.proposed === null || validValues(l.proposed) && l.proposed.sumInsured.currency === state.terms.currency)
      && ['unreviewed', 'matched', 'followup'].includes(l.review) && txt(l.reviewNote)
      && ((l.proposed === null && l.confirmation === null) || l.proposed !== null && rec(l.confirmation)
        && typeof l.confirmation.confirmed === 'boolean' && txt(l.confirmation.source) && filled(l.confirmation.confirmedBy)
        && stamp(l.confirmation.at) && state.submissions.some(s => s.id === l.confirmation!.submissionId
          && s.recordedBy === l.confirmation!.confirmedBy && s.at === l.confirmation!.at
          && s.locations.some(input => input.locationId === l.id && input.confirmed === l.confirmation!.confirmed
            && input.evidence === l.confirmation!.source && input.name === l.proposed?.name && input.address === l.proposed.address
            && equal(input.sumInsured, l.proposed.sumInsured)))
        && (!l.confirmation.confirmed || filled(l.proposed.address) && filled(l.confirmation.source)))
      && (l.review !== 'matched' || l.confirmation?.confirmed) && (l.review !== 'followup' || filled(l.reviewNote)))) return false
    addDecimals(state.locations.map(l => (l.proposed ?? l.prior).sumInsured.amount))
    const locations = (entries: unknown) => list(entries) && entries.length === state.locations.length && entries.every(e => rec(e) && state.locations.some(l => l.id === e.id) && validValues(e.values) && typeof e.currentConfirmed === 'boolean') && new Set(entries.map(e => (e as {id:string}).id)).size === entries.length
    const sourceIds = (wording: WordingItem[]) => [...new Set(wording.flatMap(i => [i.priorSource?.documentVersionId, i.outgoingSource.documentVersionId, i.replySource?.documentVersionId]).filter((id): id is string => !!id))].sort()
    if (!state.quoteSnapshots.every(q => rec(q) && state.options.some(o => o.id === q.optionId) && revision(q.materialRevision) && integer(q.wordingVersion) && q.wordingVersion > 0 && stamp(q.at) && filled(q.recordedBy)
      && validTerms(q.terms) && locations(q.locations) && list(q.wording) && q.wording.length > 0
      && (q.schedule === undefined || validScheduleVersion(q.schedule, state))
      && state.wordingRevisions.some(w => w.optionId === q.optionId && w.version === q.wordingVersion && equal(w.items, q.wording))
      && q.wording.every(i => validWording(i, state, q.optionId, false)) && sourcesExist(q.sourceVersionIds)
      && equal([...q.sourceVersionIds].sort(), [...new Set([...sourceIds(q.wording), q.schedule?.sourceDocumentVersionId].filter((id): id is string => !!id))].sort()))) return false
    if (!state.insurerResponses.every(r => validResponse(r, state))) return false
    if (!state.proposals.every(p => rec(p) && integer(p.version) && p.version > 0 && state.options.some(o => o.id === p.optionId) && revision(p.revision) && revision(p.materialRevision)
      && integer(p.wordingVersion) && p.wordingVersion > 0 && stamp(p.at) && filled(p.publishedBy) && validTerms(p.terms) && locations(p.locations)
      && list(p.wording) && p.wording.length > 0 && p.wording.every(i => validWording(i, state, p.optionId, false)) && sourcesExist(p.sourceVersionIds)
      && equal([...p.sourceVersionIds].sort(), sourceIds(p.wording))
      && state.quoteSnapshots.some(q => q.optionId === p.optionId && q.materialRevision === p.materialRevision && q.wordingVersion === p.wordingVersion
        && equal(q.wording, p.wording) && equal(q.terms, p.terms)
        && q.locations.every(quoted => p.locations.some(proposed => proposed.id === quoted.id && equal(proposed.values, quoted.values)))
        && list(p.responses) && p.responses.every(r => rec(r) && r.quoteId === q.id))
      && list(p.responses) && p.responses.length > 0 && unique(p.responses) && new Set(p.responses.map(r => r.insurerId)).size === p.responses.length
      && p.responses.every(r => validResponse(r, state) && r.optionId === p.optionId && r.materialRevision === p.materialRevision && r.wordingVersion === p.wordingVersion && state.insurerResponses.some(original => equal(original, r)))
      && p.responses.filter(r => r.position === 'accepted').every(r => equal(r.terms, p.terms))
      && addDecimals(p.responses.filter(r => r.position === 'accepted').map(r => r.sharePercent)) === '100')) return false
    if (state.activeProposalId !== null && (!filled(state.activeProposalId) || !state.proposals.some(p => p.id === state.activeProposalId && p.optionId === state.selectedOptionId))) return false
    if (!state.submissions.every(s => rec(s) && filled(s.id) && state.proposals.some(p => p.id === s.proposalId) && revision(s.revision)
      && filled(s.recordedBy) && stamp(s.at) && list(s.locations) && s.locations.length > 0
      && s.locations.every(l => rec(l) && state.locations.some(x => x.id === l.locationId) && validValues(l) && typeof l.confirmed === 'boolean' && txt(l.evidence)))) return false
    if (![...state.agreements, ...state.instructions].every(d => rec(d) && filled(d.id) && revision(d.revision) && stamp(d.at) && filled(d.recordedBy) && filled(d.evidence)
      && state.proposals.some(p => p.id === d.proposalId && p.revision === d.revision) && (d.submissionId === null || state.submissions.some(s => s.id === d.submissionId)))) return false
    if (!state.dfsSnapshots.every(d => rec(d) && revision(d.revision) && stamp(d.at) && filled(d.recordedBy) && state.proposals.some(p => p.id === d.proposalId && equal(p, d.proposal))
      && d.optionId === d.proposal.optionId && d.revision === d.proposal.revision && state.agreements.some(a => a.id === d.agreementId && a.proposalId === d.proposalId)
      && state.instructions.some(a => a.id === d.instructionId && a.proposalId === d.proposalId) && rec(d.checks) && Object.keys(BROKER_CHECKS).every(k => d.checks[k as CheckKey] === true)
      && list(d.locations) && d.locations.length === state.locations.length && unique(d.locations)
      && d.locations.every(l => rec(l) && state.locations.some(current => current.id === l.id) && validValues(l.values)
        && rec(l.confirmation) && l.confirmation.confirmed === true && filled(l.confirmation.source) && filled(l.confirmation.confirmedBy) && stamp(l.confirmation.at)
        && state.submissions.some(s => s.id === l.confirmation.submissionId && s.recordedBy === l.confirmation.confirmedBy && s.at === l.confirmation.at
          && s.locations.some(input => input.locationId === l.id && input.confirmed
          && input.name === l.values.name && input.address === l.values.address && equal(input.sumInsured, l.values.sumInsured) && input.evidence === l.confirmation.source)))
      && list(d.responseIds) && equal([...d.responseIds].sort(), d.proposal.responses.filter(r => r.position === 'accepted').map(r => r.id).sort()))) return false
    if (!state.bindingRequests.every(r => rec(r) && revision(r.revision) && stamp(r.at) && filled(r.recordedBy) && state.dfsSnapshots.some(d => d.id === r.dfsId && d.revision === r.revision && d.optionId === r.optionId && d.proposalId === r.proposalId)
      && rec(r.dispatch) && filled(r.dispatch.channel) && filled(r.dispatch.reference) && filled(r.dispatch.recipient) && stamp(r.dispatch.sentAt))) return false
    if (!state.bindingAcknowledgments.every(a => rec(a) && revision(a.revision) && stamp(a.at) && filled(a.recordedBy) && filled(a.externalRespondent)
      && state.bindingRequests.some(r => r.id === a.requestId && r.revision === a.revision && validRef(a.evidence, state, ['binding-evidence'], r.optionId)
        && state.dfsSnapshots.find(d => d.id === r.dfsId)?.proposal.responses.some(p => p.insurerId === a.insurerId && p.position === 'accepted'
          && state.documents.find(doc => doc.id === a.evidence.documentVersionId)?.producer === p.insurerName
          && state.documents.find(doc => doc.id === a.evidence.documentVersionId)?.periodStart === state.dfsSnapshots.find(d => d.id === r.dfsId)?.proposal.terms.periodStart
          && state.documents.find(doc => doc.id === a.evidence.documentVersionId)?.periodEnd === state.dfsSnapshots.find(d => d.id === r.dfsId)?.proposal.terms.periodEnd)))) return false
    if (!state.activity.every((a, i) => rec(a) && stamp(a.at) && validActor(a.actor) && filled(a.label) && revision(a.revision) && a.lockVersion === i)) return false
    return state.activity.length === state.lockVersion + 1 && state.activity.at(-1)!.revision === state.revision
  } catch { return false }
}

export function createInitialCase(): RenewalCase {
  const money = (amount: string): Money => ({ amount, currency: 'IDR' })
  const terms: Terms = { occupation: 'Pabrik komponen logam dan gudang barang jadi', periodStart: '2027-01-01', periodEnd: '2027-12-31', currency: 'IDR',
    deductible: 'Rp10.000.000 setiap kejadian; banjir 10% dari klaim, minimum Rp25.000.000.',
    additionalCoverage: 'PAR termasuk banjir sesuai wording. Gempa bumi dikecualikan.', lossHistory: 'Nihil klaim 2026 — fiktif.',
    premiumLines: [
      { id: 'par', peril: 'PAR', included: true, basis: money('7000000000'), rate: { value: '0.0483', unit: 'percent', basis: 'sum-insured', peril: 'PAR' }, recordedPremium: money('3400000.00') },
      { id: 'earthquake', peril: 'Gempa bumi', included: false, basis: money('7000000000'), rate: { value: '0.10', unit: 'percent', basis: 'sum-insured', peril: 'Gempa bumi' }, recordedPremium: null },
    ] }
  const priorTerms = { ...structuredClone(terms), periodStart: '2026-01-01', periodEnd: '2026-12-31' }
  const doc = (id: string, name: string, type: DocumentType, producer: string, optionId: string | null, prior = false): DocumentVersion => ({
    id, documentId: id, version: 1, name, type, insuranceClass: 'PAR', periodStart: prior ? '2026-01-01' : terms.periodStart, periodEnd: prior ? '2026-12-31' : terms.periodEnd,
    producer, optionId, status: prior ? 'agreed' : type === 'QS' ? 'draft' : 'received', fictional: true, createdAt: initialAt, recordedBy: 'broker-demo', note: 'Sumber fiktif untuk pengujian manual; belum ada unggahan file.' })
  const clauses = ['Property All Risks wording as per Munich Re standard wording.', 'Automatic Reinstatement of Sum Insured Clause.', '72 Hours Clause.', 'Appraisement Clause — 5% of Total Sum Insured.']
  const ref = (documentVersionId: string, excerpt: string, locator: string): SourceReference => ({ documentVersionId, excerpt, locator, shareable: false })
  const items = (optionId: string): WordingItem[] => clauses.map((text, i) => ({ id: 'clause-' + (i + 1), title: 'Klausul ' + (i + 1), prior: text, outgoing: text, reply: '',
    priorSource: ref('prior-v1', text, 'Klausul ' + (i + 1)), outgoingSource: ref('qs-source-' + optionId, text, 'Klausul ' + (i + 1)), replySource: null,
    direction: 'retained', disposition: 'unreviewed', reviewNote: '', question: '' }))
  return {
    schemaVersion: 2, id: 'PAR-2027-014', clientName: 'PT Arunika Manufaktur Indonesia', revision: 1, lockVersion: 0, insuranceClass: 'PAR', fictional: true, scheduleRequired: false, scheduleVersions: [],
    priorTerms, standardTerms: structuredClone(terms), terms: structuredClone(terms), originalClauses: clauses,
    locations: [
      { id: 'bekasi', prior: { name: 'Pabrik Bekasi', address: 'Jl. Industri Raya No. 18, Bekasi, Jawa Barat', sumInsured: money('3500000000') } },
      { id: 'tangerang', prior: { name: 'Gudang Tangerang', address: 'Jl. Raya Pasar Kemis No. 7, Tangerang, Banten', sumInsured: money('2000000000') } },
      { id: 'cikarang', prior: { name: 'Depo Cikarang', address: 'Jl. Jababeka VI Blok J No. 12, Cikarang, Jawa Barat', sumInsured: money('1500000000') } },
    ].map(l => ({ ...l, proposed: null, confirmation: null, review: 'unreviewed', reviewNote: '' })),
    documents: [doc('prior-v1', 'Final slip 2026', 'prior-slip', 'Asuransi Fiktif A', null, true), doc('standard-v1', 'Standard T&C 2027', 'standard-wording', 'Broker fiktif', null),
      ...['utama', 'alternatif'].flatMap(id => [doc('qs-source-' + id, 'Wording QS — ' + id, 'QS', 'Broker fiktif', id), doc('reply-' + id, 'Email respons — ' + id, 'insurer-reply', 'Asuransi Fiktif A', id), doc('binding-' + id, 'Email binding — ' + id, 'binding-evidence', 'Asuransi Fiktif A', id)])],
    options: ['utama', 'alternatif'].map(id => ({ id, name: id === 'utama' ? 'Opsi utama' : 'Alternatif terpisah', terms: structuredClone(terms), materialRevision: 1, wordingVersion: 1 })),
    selectedOptionId: 'utama', wordingRevisions: ['utama', 'alternatif'].map(optionId => ({ optionId, version: 1, revision: 1, items: items(optionId), at: initialAt, recordedBy: 'broker-demo' })),
    termsRevisions: ['utama', 'alternatif'].map(optionId => ({ optionId, revision: 1, terms: structuredClone(terms), at: initialAt, recordedBy: 'broker-demo', note: 'Terms awal fiktif; belum merupakan keputusan klien atau insurer.' })),
    insurerResponses: [], quoteSnapshots: [], proposals: [], activeProposalId: null, submissions: [], agreements: [], instructions: [],
    checks: freshChecks(), checksRevision: 1, checksProposalId: null, dfsSnapshots: [], bindingRequests: [], bindingAcknowledgments: [],
    activity: [{ id: 'event-1', at: initialAt, actor: LOCAL_ACTORS.broker, label: 'Kasus fiktif disiapkan. Data historis belum dikonfirmasi klien.', revision: 1, lockVersion: 0 }], notes: '',
  }
}
export function sampleClientResponse(state: RenewalCase): ClientLocationInput[] {
  return state.locations.map(l => ({ locationId: l.id, ...structuredClone(l.prior), confirmed: true, evidence: 'Konfirmasi contoh klien: alamat dan nilai tetap untuk periode 2027.' }))
}
export function sampleClientClarification(state: RenewalCase): ClientLocationInput[] {
  return sampleClientResponse(state).filter(l => l.locationId === 'cikarang')
}
