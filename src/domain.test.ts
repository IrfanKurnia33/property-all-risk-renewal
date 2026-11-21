import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAction, createInitialCase, getActiveProposal, getBindingBlockers, getCoverageStatus,
  getCurrentBindingRequest, getCurrentDfs, getCurrentQuote, getCurrentResponses, getCurrentWording,
  getExportBlockers, getProposalBlockers, getQsBlockers, getSelectedOption, isBindingComplete, isCurrentConfirmation, isRenewalCase,
  LOCAL_ACTORS, sampleClientClarification, sampleClientResponse,
} from './domain.ts'
import type { Actor, CaseAction, DocumentVersion, InsurerResponse, RenewalCase, ScheduleRow, SourceReference } from './domain.ts'
import {
  act, bindingReadyCase, clientConfirmedCase, dfsReadyCase, exportReadyCase,
  partialResponseCase, proposalReadyCase, quoteReadyCase, recordResponse, TEST_AT,
} from '../tests/fixtures.ts'

const clone = <T>(value: T): T => structuredClone(value)
const reference = (documentVersionId: string, excerpt: string): SourceReference => ({ documentVersionId, locator: 'Halaman/email contoh 1', excerpt, shareable: false })
function responsePayload(state: RenewalCase, overrides: Partial<InsurerResponse> = {}): Extract<CaseAction, {type:'recordInsurerResponse'}> {
  const option = getSelectedOption(state)
  return { type: 'recordInsurerResponse', response: {
    optionId: option.id, materialRevision: option.materialRevision, wordingVersion: option.wordingVersion, quoteId: getCurrentQuote(state)!.id,
    insurerId: 'insurer-a', insurerName: 'Asuransi Fiktif A', externalRespondent: 'Underwriter eksternal fiktif', responseAt: TEST_AT,
    sharePercent: '100', position: 'accepted', leader: true, terms: clone(state.terms), conditions: [],
    evidence: reference('reply-' + option.id, 'Setuju terms QS dan partisipasi yang tercatat (fiktif).'), note: '', ...overrides,
  } }
}
function addSource(state: RenewalCase, overrides: Partial<DocumentVersion>): RenewalCase {
  const document: DocumentVersion = {
    id: 'reply-b', documentId: 'reply-b', version: 1, name: 'Email insurer B (fiktif)', type: 'insurer-reply', insuranceClass: 'PAR',
    periodStart: state.terms.periodStart, periodEnd: state.terms.periodEnd, producer: 'Asuransi Fiktif B', optionId: state.selectedOptionId,
    status: 'received', fictional: true, createdAt: TEST_AT, recordedBy: LOCAL_ACTORS.broker.id, note: '', ...overrides,
  }
  return act(state, { type: 'addDocument', document })
}
function panelProposal(): RenewalCase {
  let state = recordResponse(quoteReadyCase(), { sharePercent: '60' })
  state = addSource(state, {})
  state = recordResponse(state, { insurerId: 'insurer-b', insurerName: 'Asuransi Fiktif B', externalRespondent: 'Underwriter fiktif B', sharePercent: '40', leader: false, evidence: reference('reply-b', 'Setuju QS dan partisipasi 40% (fiktif).') })
  return act(state, { type: 'publishProposal' })
}

test('historical materials allow an early reviewed QS without claiming current client confirmation', () => {
  const original = createInitialCase()
  const baseline = clone(original)
  assert.equal(original.schemaVersion, 2)
  assert.ok(getQsBlockers(original).some(b => b.id.startsWith('wording-')))
  assert.throws(() => act(original, { type: 'prepareQuote' }), /QS/)
  const state = quoteReadyCase(original)
  assert.deepEqual(original, baseline)
  assert.deepEqual(getQsBlockers(state), [])
  assert.ok(getCurrentQuote(state))
  assert.equal(state.locations.every(l => l.proposed === null && l.confirmation === null), true)
  assert.equal(getCurrentQuote(state)!.locations.every(l => !l.currentConfirmed), true)
  assert.equal(getCurrentQuote(state)!.terms.premiumLines[0].rate.value, '0.0483')
  assert.ok(getExportBlockers(state).some(b => b.id.startsWith('confirmation-')))
  const exported = act(state, { type: 'recordExport', kind: 'QS', snapshotId: getCurrentQuote(state)!.id })
  assert.equal(exported.revision, state.revision)
  assert.equal(exported.lockVersion, state.lockVersion + 1)
  assert.equal(isRenewalCase(JSON.parse(JSON.stringify(exported))), true)
})

test('authenticated QS requires a finalized reviewed XLSX and snapshots its row provenance', () => {
  let state = createInitialCase()
  state.scheduleRequired = true
  assert.ok(getQsBlockers(state).some(blocker => blocker.id === 'schedule-required'))
  const document = {
    id: 'schedule-source', documentId: 'schedule-doc', version: 1, name: 'Current schedule.xlsx', type: 'schedule' as const,
    insuranceClass: 'PAR' as const, periodStart: state.terms.periodStart, periodEnd: state.terms.periodEnd,
    producer: 'Broker-uploaded schedule', optionId: null, status: 'received' as const, fictional: true,
    note: 'Broker upload; values require review.',
  }
  state = act(state, { type: 'addDocument', document })
  const row: ScheduleRow = {
    id: 'row-1',
    source: {
      sheetName: 'Schedule', rowNumber: 2,
      cells: Object.fromEntries(['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2', 'L2']
        .map((cell, index) => [['locationName', 'address', 'occupancy', 'sumInsured', 'currency', 'coverage', 'rate', 'rateUnit', 'rateBasis', 'rateApplicability', 'deductible', 'remarks'][index], cell])),
      formulaCells: [], hidden: false,
      warnings: ['Rate cell G2 uses Excel percentage formatting; verify the displayed source rate and correct it before saving.'],
    },
    imported: {
      locationName: 'Factory A', address: 'District road', occupancy: 'Manufacturing', sumInsured: '3500000000',
      currency: 'IDR', coverage: 'Property All Risks', rate: '0.0483', rateUnit: 'percent', rateBasis: 'sum-insured',
      rateApplicability: 'As stated in insurer quote', deductible: 'IDR 10,000,000 each occurrence', remarks: '',
    },
    values: {
      locationName: 'Factory A', address: 'District road', occupancy: 'Manufacturing', sumInsured: '3500000000',
      currency: 'IDR', coverage: 'Property All Risks', rate: '0.0483', rateUnit: 'percent', rateBasis: 'sum-insured',
      rateApplicability: 'As stated in insurer quote', deductible: 'IDR 10,000,000 each occurrence', remarks: '',
    },
    warnings: ['Rate cell G2 uses Excel percentage formatting; verify the displayed source rate and correct it before saving.'],
  }
  assert.throws(() => act(state, { type: 'saveSchedule', sourceDocumentVersionId: document.id, sourceSha256: 'a'.repeat(64), rows: [row] }), /finalisasi XLSX/)
  state = act(state, { type: 'attachEvidence', documentVersionId: document.id, file: {
    id: '00000000-0000-4000-8000-000000000001', sha256: 'a'.repeat(64), byteSize: 1024,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } })
  assert.throws(() => act(state, { type: 'saveSchedule', sourceDocumentVersionId: document.id, sourceSha256: 'a'.repeat(64), rows: [row] }), /Baris schedule belum lengkap/)
  const reviewedRow = { ...row, values: { ...row.values, rate: '4.83' } }
  state = act(state, { type: 'saveSchedule', sourceDocumentVersionId: document.id, sourceSha256: 'a'.repeat(64), rows: [reviewedRow] })
  assert.equal(getQsBlockers(state).some(blocker => blocker.id === 'schedule-required'), false)
  state = quoteReadyCase(state)
  assert.equal(getCurrentQuote(state)?.schedule?.rows[0]?.values.locationName, 'Factory A')
  assert.equal(getCurrentQuote(state)?.schedule?.rows[0]?.imported.rate, '0.0483')
  assert.equal(getCurrentQuote(state)?.schedule?.rows[0]?.values.rate, '4.83')
  assert.ok(getCurrentQuote(state)?.sourceVersionIds.includes(document.id))
})

test('portal authority has only broker and client actors; stale writes never overwrite canonical state', () => {
  const state = quoteReadyCase()
  const baseline = clone(state)
  const action: CaseAction = { type: 'saveNotes', notes: 'A valid broker note.' }
  assert.throws(() => applyAction(state, { id: 'fake-insurer', role: 'insurer' } as unknown as Actor, action, state.lockVersion, TEST_AT), /Aktor/)
  assert.throws(() => applyAction(state, { id: '', role: 'broker' }, action, state.lockVersion, TEST_AT), /Aktor/)
  assert.throws(() => applyAction(state, LOCAL_ACTORS.broker, action, state.lockVersion - 1, TEST_AT), /Versi kasus/)
  assert.throws(() => applyAction(state, LOCAL_ACTORS.broker, action, state.lockVersion, 'not-a-timestamp'), /Waktu/)
  assert.throws(() => act(state, { type: 'publishProposal' }, 'client'), /peran/)
  assert.throws(() => act(state, { type: 'submitLocations', proposalId: 'none', locations: sampleClientResponse(state) }), /peran/)
  assert.throws(() => act(state, { type: 'submitLocations', proposalId: 'none', locations: sampleClientResponse(state) }, 'client'), /proposal/)
  assert.deepEqual(state, baseline)
})

test('notes and evidence annotations increment only the optimistic lock; source identities remain immutable', () => {
  let state = exportReadyCase()
  const materialRevision = state.revision
  const quote = clone(getCurrentQuote(state))
  const proposal = clone(getActiveProposal(state))
  const dfs = clone(getCurrentDfs(state))
  const doc = clone(state.documents[0])
  const lock = state.lockVersion
  state = act(state, { type: 'saveNotes', notes: 'Follow-up note without a risk change.' })
  state = act(state, { type: 'annotateDocument', documentVersionId: doc.id, note: 'Page numbers checked.' })
  assert.equal(state.revision, materialRevision)
  assert.equal(state.lockVersion, lock + 2)
  assert.deepEqual(getCurrentQuote(state), quote)
  assert.deepEqual(getActiveProposal(state), proposal)
  assert.deepEqual(getCurrentDfs(state), dfs)
  assert.deepEqual({ ...state.documents[0], note: doc.note }, doc)
  assert.deepEqual(getExportBlockers(state), [])
  assert.throws(() => act(state, { type: 'addDocument', document: doc }), /versi dokumen/)
  assert.throws(() => addSource(state, { ...doc, id: 'replacement', version: 2, producer: 'Changed original producer' }), /identitas dokumen/)
})

test('external insurer identity, recorder, source version, quotation and wording are all attributed', () => {
  const state = quoteReadyCase()
  const recorded = recordResponse(state)
  const response = recorded.insurerResponses[0]
  assert.equal(response.recordedBy, LOCAL_ACTORS.broker.id)
  assert.equal(response.externalRespondent, 'Underwriter fiktif A')
  assert.equal(response.quoteId, getCurrentQuote(state)!.id)
  assert.equal(response.materialRevision, getSelectedOption(state).materialRevision)
  assert.equal(response.wordingVersion, getCurrentWording(state).version)
  assert.equal(recorded.revision, state.revision + 1)
  assert.deepEqual(getProposalBlockers(recorded), [])
  for (const overrides of [
    { externalRespondent: '' }, { responseAt: 'invalid' }, { insurerName: 'Unmatched insurer' },
    { quoteId: 'missing-version' }, { wordingVersion: response.wordingVersion + 1 },
    { sharePercent: '100.0001' }, { sharePercent: '-1' }, { sharePercent: '0' },
    { evidence: reference('no-such-version', 'Evidence') },
    { evidence: reference('prior-v1', 'Wrong document type') },
    { evidence: reference('reply-alternatif', 'Wrong option') },
  ]) assert.throws(() => act(state, responsePayload(state, overrides)), JSON.stringify(overrides))
})

test('wrong class and period evidence cannot establish insurer acceptance', () => {
  let state = quoteReadyCase()
  assert.throws(() => addSource(state, { insuranceClass: 'Public Liability' as 'PAR' }), /dokumen/)
  state = addSource(state, { id: 'reply-old', documentId: 'reply-old', periodStart: '2026-01-01', periodEnd: '2026-12-31', producer: 'Asuransi Fiktif A' })
  assert.throws(() => act(state, responsePayload(state, { evidence: reference('reply-old', 'Wrong renewal period') })))
  const corrupted = clone(state)
  corrupted.documents[0].insuranceClass = 'Motor' as 'PAR'
  assert.equal(isRenewalCase(corrupted), false)
})

test('outreach, a leader response and a complete panel are distinct facts', () => {
  let state = recordResponse(quoteReadyCase(), { position: 'outreach', sharePercent: '100' })
  assert.ok(getProposalBlockers(state).some(b => b.id === 'panel-share'))
  state = recordResponse(state, { position: 'pending', sharePercent: '100' })
  assert.ok(getProposalBlockers(state).some(b => b.id === 'panel-share'))
  state = recordResponse(state, { sharePercent: '60', leader: true })
  assert.ok(getProposalBlockers(state).some(b => b.id === 'panel-share' && b.label.includes('60%')))
  assert.throws(() => act(state, { type: 'publishProposal' }), /Proposal/)
  state = addSource(state, {})
  state = recordResponse(state, { insurerId: 'insurer-b', insurerName: 'Asuransi Fiktif B', leader: false, sharePercent: '40', evidence: reference('reply-b', '40% acceptance') })
  assert.deepEqual(getProposalBlockers(state), [])
  assert.equal(getCurrentResponses(state).length, 2)
  assert.equal(state.insurerResponses.length, 4, 'replacement positions retain earlier correspondence')
})

test('two alternative 100% quotations never become a 200% panel or a mixed proposal', () => {
  let state = proposalReadyCase()
  const first = clone(getActiveProposal(state))
  const firstResponses = clone(state.insurerResponses)
  state = act(state, { type: 'selectOption', optionId: 'alternatif' })
  assert.equal(getActiveProposal(state), undefined)
  assert.equal(state.proposals.length, 1)
  assert.deepEqual(state.proposals[0], first)
  assert.deepEqual(state.insurerResponses, firstResponses)
  assert.equal(getCurrentResponses(state).length, 0)
  state = quoteReadyCase(state)
  state = recordResponse(state)
  assert.deepEqual(getProposalBlockers(state), [])
  state = act(state, { type: 'publishProposal' })
  assert.equal(state.proposals.length, 2)
  assert.equal(getActiveProposal(state)!.optionId, 'alternatif')
  assert.deepEqual(getActiveProposal(state)!.responses.map(r => r.sharePercent), ['100'])
  assert.equal(getCurrentResponses(state).length, 1)
})

test('matching shares with different terms or wording cannot be combined', () => {
  let state = recordResponse(quoteReadyCase(), { sharePercent: '60' })
  state = addSource(state, {})
  const different = clone(state.terms)
  different.deductible = 'Deductible counter-offer not accepted by the other member.'
  state = recordResponse(state, { insurerId: 'insurer-b', insurerName: 'Asuransi Fiktif B', sharePercent: '40', terms: different, evidence: reference('reply-b', '40% with different terms') })
  assert.ok(getProposalBlockers(state).some(b => b.id.startsWith('incompatible-')))
  assert.ok(getProposalBlockers(state).some(b => b.id === 'panel-share'))
  assert.throws(() => act(state, { type: 'publishProposal' }))
  assert.throws(() => act(state, responsePayload(state, { wordingVersion: getSelectedOption(state).wordingVersion - 1 })))
})

test('proposal conditions remain visible and required unresolved conditions block DFS release', () => {
  let state = act(recordResponse(quoteReadyCase(), { conditions: [{ text: 'Survey report required before release.', required: true, resolved: false }] }), { type: 'publishProposal' })
  assert.equal(getActiveProposal(state)!.responses[0].conditions[0].resolved, false)
  state = clientConfirmedCase(state)
  const proposalId = getActiveProposal(state)!.id
  state = act(state, { type: 'clientAgree', proposalId, evidence: 'Client agrees disclosed terms.' }, 'client')
  state = act(state, { type: 'clientInstruct', proposalId, evidence: 'Client instructs renewal.' }, 'client')
  assert.ok(getExportBlockers(state).some(b => b.id.startsWith('condition-')))
  assert.throws(() => act(state, { type: 'setCheck', check: 'period', checked: true }))
  assert.throws(() => act(state, { type: 'issueDfs' }))
  assert.throws(() => act(state, { type: 'recordExport', kind: 'DFS', snapshotId: 'dfs-fabricated' }))
})

test('rejected new enhancements differ from withdrawing an agreed clause; historical words cannot be edited away', () => {
  let state = quoteReadyCase()
  const original = clone(getCurrentWording(state))
  const items = clone(original.items)
  const rejected = {
    id: 'enhancement', title: 'New enhancement', prior: '', outgoing: 'New additional coverage requested.', reply: '', priorSource: null,
    outgoingSource: reference('qs-source-utama', 'New additional coverage requested.'), replySource: reference('reply-utama', ''),
    direction: 'enhancement' as const, disposition: 'rejected-enhancement' as const, reviewNote: 'Insurer declined the new enhancement.', question: '',
  }
  items.push(rejected)
  items[0] = { ...items[0], reply: '', replySource: reference('reply-utama', ''), direction: 'withdrawal', disposition: 'withdrawal-accepted', reviewNote: 'Withdrawal of previously agreed wording explicitly reviewed.' }
  state = act(state, { type: 'reviseWording', items, note: 'Record three-way comparison and distinct insurer treatments.' })
  assert.deepEqual(state.wordingRevisions.find(w => w.optionId === original.optionId && w.version === original.version), original)
  assert.equal(getCurrentWording(state).items[0].direction, 'withdrawal')
  assert.equal(getCurrentWording(state).items.at(-1)!.disposition, 'rejected-enhancement')
  assert.deepEqual(state.originalClauses, createInitialCase().originalClauses)
  assert.throws(() => act(state, { type: 'reviewWording', itemId: 'clause-1', disposition: 'rejected-enhancement', note: 'Wrongly label existing cover as a new enhancement.', question: '' }))
  assert.throws(() => act(state, { type: 'reviewWording', itemId: 'enhancement', disposition: 'withdrawal-accepted', note: 'Wrongly label rejected enhancement as withdrawn existing cover.', question: '' }))
  const deleted = getCurrentWording(state).items.slice(1)
  assert.throws(() => act(state, { type: 'reviseWording', items: deleted, note: 'Delete historical clause.' }), /historis/)
  const changed = clone(getCurrentWording(state).items)
  changed[0].prior = 'Rewritten agreed words'
  changed[0].priorSource!.excerpt = changed[0].prior
  assert.throws(() => act(state, { type: 'reviseWording', items: changed, note: 'Rewrite the historical source.' }), /historis/)
})

test('unresolved wording questions and incorrect source quotations block QS', () => {
  let state = quoteReadyCase()
  state = act(state, { type: 'reviewWording', itemId: 'clause-1', disposition: 'followup', note: 'Ask insurer to clarify.', question: 'Was the original wording withdrawn?' })
  assert.ok(getQsBlockers(state).some(b => b.id === 'wording-clause-1'))
  assert.equal(getCurrentQuote(state), undefined)
  assert.throws(() => act(state, { type: 'prepareQuote' }))
  const items = clone(getCurrentWording(state).items)
  items[0].outgoingSource.excerpt = 'Mismatched source quote'
  assert.throws(() => act(state, { type: 'reviseWording', items, note: 'Wrong source quotation.' }))
})

test('client must confirm all current-period values including unchanged historical sums insured', () => {
  let state = proposalReadyCase()
  const proposalId = getActiveProposal(state)!.id
  assert.throws(() => act(state, { type: 'clientAgree', proposalId, evidence: 'Agree without confirmation.' }, 'client'), /Konfirmasikan/)
  const inputs = sampleClientResponse(state)
  state = act(state, { type: 'submitLocations', proposalId, locations: [inputs[0]] }, 'client')
  assert.equal(state.locations[1].proposed, null)
  assert.ok(getExportBlockers(state).some(b => b.id === 'confirmation-tangerang'))
  assert.throws(() => act(state, { type: 'clientAgree', proposalId, evidence: 'Agree after only one location.' }, 'client'), /Konfirmasikan/)
  state = act(state, { type: 'submitLocations', proposalId, locations: inputs.slice(1) }, 'client')
  assert.equal(state.locations.every(l => l.confirmation?.confirmed), true)
  assert.ok(getExportBlockers(state).some(b => b.id === 'matching-bekasi'))
  assert.equal(state.locations[1].prior.sumInsured.amount, state.locations[1].proposed!.sumInsured.amount)
  assert.equal(state.locations[1].confirmation!.confirmedBy, LOCAL_ACTORS.client.id)
})

test('invalid dates, rates, money, duplicate locations and unsupported currency leave the case intact', () => {
  const state = proposalReadyCase()
  const baseline = clone(state)
  const proposalId = getActiveProposal(state)!.id
  const sample = sampleClientResponse(state)[0]
  for (const amount of ['0', '-1', 'NaN', '1e9', '01', '1.123456789']) {
    assert.throws(() => act(state, { type: 'submitLocations', proposalId, locations: [{ ...sample, sumInsured: { ...sample.sumInsured, amount } }] }, 'client'))
  }
  for (const locations of [
    [{ ...sample, address: '' }], [{ ...sample, evidence: '' }], [sample, sample], [{ ...sample, locationId: 'not-a-location' }],
    [{ ...sample, sumInsured: { amount: '100', currency: 'SGD' } }],
  ]) assert.throws(() => act(state, { type: 'submitLocations', proposalId, locations }, 'client'))
  for (const terms of [
    { ...state.terms, periodStart: '2027-02-30' }, { ...state.terms, periodEnd: '2026-01-01' },
    { ...state.terms, occupation: '' }, { ...state.terms, currency: 'SGD' },
  ]) assert.throws(() => act(state, { type: 'reviseTerms', terms, note: 'Bad terms.' }))
  assert.deepEqual(state, baseline)
})

test('client agreement, renewal instruction, broker matching and DFS are separate requirements', () => {
  let state = clientConfirmedCase()
  const proposalId = getActiveProposal(state)!.id
  assert.ok(getExportBlockers(state).some(b => b.id === 'client-agreement'))
  assert.ok(getExportBlockers(state).some(b => b.id === 'client-instruction'))
  assert.throws(() => act(state, { type: 'clientInstruct', proposalId, evidence: 'Premature instruction.' }, 'client'))
  state = act(state, { type: 'clientAgree', proposalId, evidence: 'Client agrees current proposal.' }, 'client')
  assert.ok(getExportBlockers(state).some(b => b.id === 'client-instruction'))
  assert.throws(() => act(state, { type: 'issueDfs' }))
  state = dfsReadyCase(state)
  assert.deepEqual(getExportBlockers(state), [])
  assert.ok(getBindingBlockers(state).some(b => b.id === 'dfs-current'))
  const before = clone(getActiveProposal(state))
  state = act(state, { type: 'issueDfs' })
  assert.deepEqual(getBindingBlockers(state), [])
  assert.deepEqual(getCurrentDfs(state)!.proposal, before)
  assert.equal(getCurrentDfs(state)!.locations.every(l => l.confirmation.confirmed), true)
  assert.equal(isRenewalCase(JSON.parse(JSON.stringify(state))), true)
})

test('material changes retain immutable QS/proposal/consent/DFS/dispatch history and stale its readiness', () => {
  let state = bindingReadyCase()
  const old = clone({ quotes: state.quoteSnapshots, proposals: state.proposals, agreements: state.agreements, instructions: state.instructions, dfs: state.dfsSnapshots, requests: state.bindingRequests })
  const revision = state.revision
  const terms = clone(state.terms)
  terms.deductible = 'New negotiated deductible requiring fresh insurer and client decisions.'
  state = act(state, { type: 'reviseTerms', terms, note: 'Record new terms.' })
  assert.equal(state.revision, revision + 1)
  assert.equal(getCurrentQuote(state), undefined)
  assert.equal(getCurrentDfs(state), undefined)
  assert.equal(getCurrentBindingRequest(state), undefined)
  assert.equal(getCoverageStatus(state), 'Belum binding')
  assert.deepEqual(state.quoteSnapshots, old.quotes)
  assert.deepEqual(state.proposals, old.proposals)
  assert.deepEqual(state.agreements, old.agreements)
  assert.deepEqual(state.instructions, old.instructions)
  assert.deepEqual(state.dfsSnapshots, old.dfs)
  assert.deepEqual(state.bindingRequests, old.requests)
  assert.ok(getExportBlockers(state).some(b => b.id === 'proposal-current'))
  assert.throws(() => act(state, { type: 'clientAgree', proposalId: old.proposals.at(-1)!.id, evidence: 'Stale consent.' }, 'client'))
  assert.throws(() => act(state, { type: 'recordExport', kind: 'DFS', snapshotId: old.dfs[0].id }))
  assert.equal(isRenewalCase(state), true)
})

test('client risk changes stale insurer evidence and proposals without overwriting historical or quoted values', () => {
  const original = proposalReadyCase()
  const baseline = clone(original)
  const response = sampleClientResponse(original)[0]
  response.sumInsured.amount = '3500000000.25'
  const state = act(original, { type: 'submitLocations', proposalId: getActiveProposal(original)!.id, locations: [response] }, 'client')
  assert.equal(state.revision, original.revision + 1)
  assert.deepEqual(original, baseline)
  assert.equal(state.locations[0].prior.sumInsured.amount, '3500000000')
  assert.equal(state.locations[0].proposed!.sumInsured.amount, '3500000000.25')
  assert.equal(state.terms.premiumLines[0].basis.amount, '7000000000.25')
  assert.equal(state.terms.premiumLines[0].recordedPremium, null, 'an insurer premium for the old risk basis must not appear current')
  assert.equal(state.termsRevisions[0].terms.premiumLines[0].recordedPremium!.amount, '3400000.00')
  assert.equal(getCurrentResponses(state).length, 0)
  assert.equal(state.insurerResponses.length, original.insurerResponses.length)
  assert.deepEqual(state.proposals, original.proposals)
  assert.ok(getExportBlockers(state).some(b => b.id === 'proposal-current'))
})

test('new evidence or withdrawn confirmation reopens consent and checks without advancing unchanged risk revision', () => {
  let state = exportReadyCase()
  const revision = state.revision
  const oldDfs = clone(getCurrentDfs(state))
  const input = sampleClientResponse(state)[0]
  state = act(state, { type: 'submitLocations', proposalId: getActiveProposal(state)!.id, locations: [{ ...input, confirmed: false, evidence: 'Client withdraws current confirmation.' }] }, 'client')
  assert.equal(state.revision, revision)
  assert.equal(state.agreements.length, 1)
  assert.equal(state.instructions.length, 1)
  assert.deepEqual(state.dfsSnapshots[0], oldDfs)
  assert.equal(getCurrentDfs(state), undefined)
  assert.equal(getCurrentBindingRequest(state), undefined)
  assert.ok(getExportBlockers(state).some(b => b.id === 'client-agreement'))
  assert.ok(getExportBlockers(state).some(b => b.id === 'client-instruction'))
  assert.ok(getExportBlockers(state).some(b => b.id === 'confirmation-bekasi'))
  assert.throws(() => act(state, { type: 'recordExport', kind: 'DFS', snapshotId: oldDfs!.id }))
  assert.throws(() => act(state, { type: 'requestBinding', dfsId: oldDfs!.id, dispatch: { channel: 'Email', recipient: 'example.invalid', reference: 'stale', sentAt: TEST_AT } }))
})

test('unchanged-value evidence resubmission requires a new DFS after renewed consent', () => {
  let state = exportReadyCase()
  const previous = clone(getCurrentDfs(state))!
  const revision = state.revision
  const response = sampleClientResponse(state)[0]
  response.evidence = 'A newer email reconfirms the same address and insured value.'
  state = act(state, { type: 'submitLocations', proposalId: getActiveProposal(state)!.id, locations: [response] }, 'client')
  assert.equal(state.revision, revision)
  assert.equal(getCurrentDfs(state), undefined)
  state = act(state, { type: 'reviewLocation', locationId: response.locationId, result: 'matched', note: 'New evidence matched.' })
  state = dfsReadyCase(state)
  assert.deepEqual(getExportBlockers(state), [])
  assert.equal(getCurrentDfs(state), undefined, 'renewed decisions cannot revive a DFS bearing the old decision/evidence IDs')
  assert.throws(() => act(state, { type: 'recordExport', kind: 'DFS', snapshotId: previous.id }))
  state = act(state, { type: 'issueDfs' })
  assert.notEqual(getCurrentDfs(state)!.id, previous.id)
  assert.deepEqual(state.dfsSnapshots[0], previous)
  assert.equal(getCurrentDfs(state)!.locations[0].confirmation.source, response.evidence)
})

test('client confirmation from another policy period cannot satisfy current risk or consent', () => {
  let state = clientConfirmedCase()
  const oldSubmissions = clone(state.submissions)
  assert.equal(state.locations.every(l => isCurrentConfirmation(state, l)), true)
  const terms = { ...clone(state.terms), periodStart: '2027-02-01', periodEnd: '2028-01-31' }
  state = act(state, { type: 'reviseTerms', terms, note: 'Period changed; current-period evidence must be obtained again.' })
  assert.equal(state.locations.every(l => isCurrentConfirmation(state, l)), false)
  assert.equal(getExportBlockers(state).filter(b => b.id.startsWith('confirmation-')).length, 3)
  state = addSource(state, { id: 'qs-period-v2', documentId: 'qs-source-utama', version: 2, name: 'QS for changed period', type: 'QS', status: 'draft', producer: 'Broker fiktif' })
  const items = clone(getCurrentWording(state).items)
  for (const item of items) item.outgoingSource.documentVersionId = 'qs-period-v2'
  state = act(state, { type: 'reviseWording', items, note: 'Use immutable source version for the changed period.' })
  state = quoteReadyCase(state)
  assert.equal(getCurrentQuote(state)!.locations.every(l => !l.currentConfirmed), true)
  state = addSource(state, { id: 'reply-period-v2', documentId: 'reply-utama', version: 2, producer: 'Asuransi Fiktif A' })
  state = recordResponse(state, { evidence: reference('reply-period-v2', 'Insurer accepts the new policy period.') })
  state = act(state, { type: 'publishProposal' })
  assert.throws(() => act(state, { type: 'clientAgree', proposalId: getActiveProposal(state)!.id, evidence: 'Do not reuse a previous period confirmation.' }, 'client'), /periode berjalan/)
  assert.deepEqual(state.submissions, oldSubmissions)
  state = clientConfirmedCase(state)
  assert.equal(state.locations.every(l => isCurrentConfirmation(state, l)), true)
  state = dfsReadyCase(state)
  assert.deepEqual(getExportBlockers(state), [])
})

test('terms outside the supported exact-arithmetic range are rejected before they can break rendering', () => {
  const state = quoteReadyCase()
  const terms = clone(state.terms)
  terms.premiumLines[0].rate.value = '9'.repeat(24)
  assert.throws(() => act(state, { type: 'reviseTerms', terms, note: 'Arithmetic overflow is not a valid terms revision.' }))
  const corrupt = clone(state)
  corrupt.options[0].terms = clone(terms)
  corrupt.terms = clone(terms)
  assert.equal(isRenewalCase(corrupt), false)
})

test('binding requires explicit manual dispatch; leader acknowledgment covers only its own panel membership', () => {
  let state = act(dfsReadyCase(clientConfirmedCase(panelProposal())), { type: 'issueDfs' })
  const dfsId = getCurrentDfs(state)!.id
  assert.equal(getCoverageStatus(state), 'Belum binding')
  assert.throws(() => act(state, { type: 'requestBinding', dfsId, dispatch: { channel: 'Email', recipient: '', reference: '', sentAt: TEST_AT } }))
  state = bindingReadyCase(state)
  const request = getCurrentBindingRequest(state)!
  assert.equal(request.dispatch.reference, 'FIKTIF-DISPATCH-001')
  assert.equal(getCoverageStatus(state), 'Menunggu acknowledgment setiap anggota')
  assert.throws(() => act(state, { type: 'acknowledgeBinding', requestId: request.id, insurerId: 'not-a-member', externalRespondent: 'Someone', evidence: reference('binding-utama', 'Binding') }))
  state = act(state, { type: 'acknowledgeBinding', requestId: request.id, insurerId: 'insurer-a', externalRespondent: 'Underwriter A', evidence: reference('binding-utama', 'A acknowledges its own 60% participation (fictitious).') })
  assert.equal(getCoverageStatus(state), 'Menunggu acknowledgment setiap anggota')
  assert.throws(() => act(state, { type: 'acknowledgeBinding', requestId: request.id, insurerId: 'insurer-a', externalRespondent: 'Underwriter A', evidence: reference('binding-utama', 'Duplicate.') }))
  state = addSource(state, { id: 'binding-b', documentId: 'binding-b', type: 'binding-evidence', name: 'Binding B (fictitious)' })
  state = act(state, { type: 'acknowledgeBinding', requestId: request.id, insurerId: 'insurer-b', externalRespondent: 'Underwriter B', evidence: reference('binding-b', 'B acknowledges its own 40% participation (fictitious).') })
  assert.equal(state.bindingAcknowledgments.length, 2)
  assert.equal(getCoverageStatus(state, new Date('2026-12-31T16:59:59.999Z')), 'Terjadwal')
  assert.equal(getCoverageStatus(state, new Date('2026-12-31T17:00:00.000Z')), 'Aktif')
  assert.equal(getCoverageStatus(state, new Date('2027-12-31T16:59:59.999Z')), 'Aktif')
  assert.equal(getCoverageStatus(state, new Date('2027-12-31T17:00:00.000Z')), 'Periode berakhir')
  assert.equal(isRenewalCase(JSON.parse(JSON.stringify(state))), true)
})

test('runtime validator is generic across fictional cases but rejects damaged nested data and broken references', () => {
  const ready = exportReadyCase()
  const another = clone(ready)
  another.id = 'PAR-2028-999'
  another.clientName = 'A different fictional client'
  another.locations[0].prior.name = 'Another historical factory'
  assert.equal(isRenewalCase(another), true)
  for (const value of [null, [], {}, 'case', { ...ready, schemaVersion: 1 }]) assert.equal(isRenewalCase(value), false)
  const corruptions: ((state: RenewalCase) => void)[] = [
    s => { s.locations[0].proposed!.sumInsured.amount = '-1' },
    s => { s.locations[0].confirmation!.source = '' },
    s => { s.locations[0].confirmation!.submissionId = 'missing-submission' },
    s => { s.terms.periodStart = '2027-02-30' },
    s => { s.documents[0].producer = '' },
    s => { s.documents.push(clone(s.documents[0])) },
    s => { s.wordingRevisions[0].items[0].outgoingSource.documentVersionId = 'missing-source' },
    s => { s.insurerResponses[0].quoteId = 'missing-quote' },
    s => { s.proposals[0].responses[0].terms.deductible = 'Forged snapshot insurer terms.' },
    s => { s.agreements[0].proposalId = 'missing-proposal' },
    s => { s.dfsSnapshots[0].instructionId = 'missing-instruction' },
    s => { s.activity[0].actor.role = 'insurer' as Actor['role'] },
    s => { s.lockVersion += 1 },
  ]
  for (const corrupt of corruptions) {
    const state = clone(ready)
    corrupt(state)
    assert.equal(isRenewalCase(state), false, corrupt.toString())
  }
})

test('immutable snapshots require complete wording, cited source versions and a coherent accepted panel', () => {
  const ready = exportReadyCase()
  const corruptions: ((state: RenewalCase) => void)[] = [
    s => { s.quoteSnapshots[0].wording = [] },
    s => { s.quoteSnapshots[0].sourceVersionIds = [] },
    s => { s.quoteSnapshots[0].wordingVersion += 1 },
    s => { s.proposals[0].wording = [] },
    s => { s.proposals[0].sourceVersionIds = [] },
    s => { s.proposals[0].responses = [] },
    s => { s.proposals[0].locations[0].values.sumInsured.amount = '123' },
    s => { s.dfsSnapshots[0].responseIds = [] },
    s => { s.dfsSnapshots[0].locations[1] = clone(s.dfsSnapshots[0].locations[0]) },
  ]
  for (const corrupt of corruptions) {
    const state = clone(ready)
    corrupt(state)
    assert.equal(isRenewalCase(state), false, corrupt.toString())
  }
})

test('a panel member acknowledgment must use that insurer’s evidence for the applicable period', () => {
  let state = act(dfsReadyCase(clientConfirmedCase(panelProposal())), { type: 'issueDfs' })
  state = bindingReadyCase(state)
  const request = getCurrentBindingRequest(state)!
  assert.throws(() => act(state, { type: 'acknowledgeBinding', requestId: request.id, insurerId: 'insurer-b', externalRespondent: 'Underwriter B', evidence: reference('binding-utama', 'A’s response cannot acknowledge B.') }))
  state = addSource(state, { id: 'binding-old-b', documentId: 'binding-old-b', type: 'binding-evidence', periodStart: '2026-01-01', periodEnd: '2026-12-31' })
  assert.throws(() => act(state, { type: 'acknowledgeBinding', requestId: request.id, insurerId: 'insurer-b', externalRespondent: 'Underwriter B', evidence: reference('binding-old-b', 'Wrong period.') }))
})

test('current and DFS confirmation attribution must match the immutable client submission', () => {
  const ready = exportReadyCase()
  for (const target of ['current', 'DFS']) for (const change of ['missing-actor', 'wrong-actor', 'bad-time', 'wrong-time']) {
    const state = clone(ready)
    const confirmation = target === 'current' ? state.locations[0].confirmation! : state.dfsSnapshots[0].locations[0].confirmation
    if (change === 'missing-actor') delete (confirmation as Partial<typeof confirmation>).confirmedBy
    if (change === 'wrong-actor') confirmation.confirmedBy = 'some-other-client'
    if (change === 'bad-time') confirmation.at = 'invalid'
    if (change === 'wrong-time') confirmation.at = '2026-11-19T06:00:00.000Z'
    assert.equal(isRenewalCase(state), false, target + ': ' + change)
  }
})

test('completed binding locks the renewal while preserving metadata, evidence inventory and exports', () => {
  let state = bindingReadyCase()
  assert.equal(isBindingComplete(state), false)
  state = act(state, { type: 'acknowledgeBinding', requestId: getCurrentBindingRequest(state)!.id, insurerId: 'insurer-a', externalRespondent: 'Underwriter A', evidence: reference('binding-utama', 'Acknowledgment for A’s 100% participation.') })
  assert.equal(isBindingComplete(state), true)
  const locked = clone(state)
  const terms = { ...clone(state.terms), deductible: 'A later change requires separate administration.' }
  for (const action of [
    { type: 'reviseTerms', terms, note: 'Late material revision.' }, { type: 'publishProposal' }, { type: 'issueDfs' },
    { type: 'selectOption', optionId: 'alternatif' }, { type: 'setCheck', check: 'identity', checked: false },
  ] satisfies CaseAction[]) assert.throws(() => act(state, action), /dikunci/)
  assert.throws(() => act(state, { type: 'submitLocations', proposalId: getActiveProposal(state)!.id, locations: sampleClientResponse(state) }, 'client'), /dikunci/)
  assert.deepEqual(state, locked)
  state = act(state, { type: 'saveNotes', notes: 'A later administrative note.' })
  state = act(state, { type: 'annotateDocument', documentVersionId: 'prior-v1', note: 'Source metadata corrected.' })
  state = addSource(state, { id: 'post-binding-note', documentId: 'post-binding-note', name: 'Additional evidence inventory entry.' })
  state = act(state, { type: 'recordExport', kind: 'DFS', snapshotId: getCurrentDfs(state)!.id })
  assert.equal(state.revision, locked.revision)
  assert.equal(state.lockVersion, locked.lockVersion + 4)
  assert.equal(isBindingComplete(state), true)
  assert.equal(getCoverageStatus(state, new Date('2027-06-01T00:00:00.000Z')), 'Aktif')
  assert.deepEqual(state.bindingAcknowledgments, locked.bindingAcknowledgments)
})

test('unprepared manual terms revisions retain exact rates and actor-attributed reasons', () => {
  let state = createInitialCase()
  const initial = clone(state.termsRevisions)
  const first = clone(state.terms)
  first.premiumLines[0].rate.value = '0.04835'
  state = act(state, { type: 'reviseTerms', terms: first, note: 'First negotiation before preparing a QS.' })
  const firstSaved = clone(state.termsRevisions.at(-1))
  const second = clone(state.terms)
  second.premiumLines[0].rate.value = '0.04725'
  state = act(state, { type: 'reviseTerms', terms: second, note: 'Second negotiation before preparing a QS.' })
  assert.equal(state.quoteSnapshots.length, 0)
  assert.deepEqual(state.termsRevisions.slice(0, 2), initial)
  assert.deepEqual(state.termsRevisions[2], firstSaved)
  assert.equal(state.termsRevisions[2].terms.premiumLines[0].rate.value, '0.04835')
  assert.equal(state.termsRevisions[3].terms.premiumLines[0].rate.value, '0.04725')
  assert.equal(state.termsRevisions[3].recordedBy, LOCAL_ACTORS.broker.id)
  assert.match(state.termsRevisions[3].note, /Second negotiation/)
  assert.equal(isRenewalCase(JSON.parse(JSON.stringify(state))), true)
  const corrupted = clone(state)
  corrupted.termsRevisions.at(-1)!.terms.premiumLines[0].rate.value = '0.10'
  assert.equal(isRenewalCase(corrupted), false)
})

test('non-participating outreach only advances the lock; withdrawing an accepted share advances material revision', () => {
  let state = exportReadyCase()
  const revision = state.revision
  const dfs = clone(getCurrentDfs(state))
  state = addSource(state, {})
  const beforeOutreach = state.lockVersion
  state = recordResponse(state, { insurerId: 'insurer-b', insurerName: 'Asuransi Fiktif B', position: 'outreach', sharePercent: '0', leader: false, evidence: reference('reply-b', 'Outreach acknowledgment only; no accepted participation.') })
  assert.equal(state.revision, revision)
  assert.equal(state.lockVersion, beforeOutreach + 1)
  assert.deepEqual(getCurrentDfs(state), dfs)
  assert.deepEqual(getExportBlockers(state), [])
  state = recordResponse(state, { insurerId: 'insurer-b', insurerName: 'Asuransi Fiktif B', position: 'pending', sharePercent: '40', leader: false, evidence: reference('reply-b', 'Capacity discussed but no acceptance.') })
  assert.equal(state.revision, revision)
  assert.deepEqual(getCurrentDfs(state), dfs)
  state = recordResponse(state, { position: 'pending', sharePercent: '0', evidence: reference('reply-utama', 'A withdraws its earlier accepted position pending review.') })
  assert.equal(state.revision, revision + 1)
  assert.equal(getCurrentDfs(state), undefined)
  assert.ok(getProposalBlockers(state).some(b => b.id === 'panel-share'))
})

test('client can clarify incomplete risk data after its own material update, before another proposal is published', () => {
  let state = partialResponseCase()
  const originalProposal = clone(getActiveProposal(state))!
  assert.notEqual(originalProposal.revision, state.revision)
  assert.equal(state.locations.find(l => l.id === 'cikarang')!.proposed!.address, '')
  state = act(state, { type: 'reviewLocation', locationId: 'cikarang', result: 'followup', note: 'Please confirm the full address.' })
  state = act(state, { type: 'submitLocations', proposalId: originalProposal.id, locations: sampleClientClarification(state) }, 'client')
  assert.equal(state.locations.find(l => l.id === 'cikarang')!.confirmation!.confirmed, true)
  assert.equal(state.locations.find(l => l.id === 'cikarang')!.proposed!.address, state.locations.find(l => l.id === 'cikarang')!.prior.address)
  assert.deepEqual(state.proposals, [originalProposal])
  assert.equal(state.submissions.length, 2)
  assert.ok(getExportBlockers(state).some(b => b.id === 'proposal-current'))
  assert.ok(getExportBlockers(state).some(b => b.id === 'client-agreement'))
  assert.throws(() => act(state, { type: 'clientAgree', proposalId: originalProposal.id, evidence: 'An old proposal cannot be agreed after risk changed.' }, 'client'))
  assert.throws(() => act(state, { type: 'issueDfs' }))
  state = act(recordResponse(quoteReadyCase(state)), { type: 'publishProposal' })
  assert.notEqual(getActiveProposal(state)!.id, originalProposal.id)
  assert.ok(getExportBlockers(state).some(b => b.id === 'client-agreement'))
  assert.equal(isRenewalCase(state), true)
  const changedPeriod = { ...clone(state.terms), periodStart: '2027-02-01', periodEnd: '2028-01-31' }
  state = act(state, { type: 'reviseTerms', terms: changedPeriod, note: 'A different policy period needs a new published proposal first.' })
  assert.throws(() => act(state, { type: 'submitLocations', proposalId: getActiveProposal(state)!.id, locations: sampleClientResponse(state) }, 'client'), /periode berjalan/)
})
