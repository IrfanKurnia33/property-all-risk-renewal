import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAction, BROKER_CHECKS, createInitialCase, getBindingBlockers, getCoverageStatus,
  getExportBlockers, isRenewalCase, sampleClientClarification, sampleClientResponse,
} from './domain.ts'
import type { CaseAction, CheckKey, RenewalCase, Role } from './domain.ts'

const at = '2026-11-11T08:00:00.000Z'
const act = (state: RenewalCase, role: Role, action: CaseAction) => {
  const next = applyAction(state, role, action, at)
  assert.equal(isRenewalCase(next), true, `valid output after ${role} ${action.type}`)
  assert.equal(isRenewalCase(JSON.parse(JSON.stringify(next))), true, `storage round-trip after ${role} ${action.type}`)
  return next
}

function firstProposal(): RenewalCase {
  let state = createInitialCase()
  state = act(state, 'broker', { type: 'sendQuote' })
  state = act(state, 'insurer', { type: 'insurerAgree', note: 'Setuju T&C quotation awal, sumber: email contoh.' })
  return act(state, 'broker', { type: 'sendProposal' })
}

function exportReady(): RenewalCase {
  let state = firstProposal()
  state = act(state, 'client', { type: 'submitLocations', locations: sampleClientResponse(state) })
  state = act(state, 'client', { type: 'submitLocations', locations: sampleClientClarification(state) })
  state = act(state, 'broker', { type: 'sendQuote' })
  state = act(state, 'insurer', { type: 'insurerAgree', note: 'Setuju dengan seluruh lokasi dan nilai terbaru.' })
  for (const location of state.locations) state = act(state, 'broker', { type: 'reviewLocation', locationId: location.id, result: 'matched', note: 'Cocok dengan konfirmasi klien.' })
  for (const check of Object.keys(BROKER_CHECKS) as CheckKey[]) state = act(state, 'broker', { type: 'setCheck', check, checked: true })
  return state
}

function bindingReady(): RenewalCase {
  let state = exportReady()
  state = act(state, 'broker', { type: 'sendProposal' })
  return act(state, 'client', { type: 'clientAgree', evidence: 'Email contoh: setuju proposal terbaru untuk renewal 2027.' })
}

test('fictional baseline is inspectable, immutable through actions, and initially blocked', () => {
  const state = createInitialCase()
  assert.equal(state.id, 'PAR-2027-014')
  assert.deepEqual(state.locations.map((location) => location.prior.sumInsured), [3_500_000_000, 2_000_000_000, 1_500_000_000])
  assert.equal(state.priorTerms.periodStart, '2026-01-01')
  assert.equal(state.terms.periodStart, '2027-01-01')
  assert.equal(state.locations.every((location) => location.proposed === null), true)
  assert.equal(getExportBlockers(state).length > 0, true)
  assert.equal(isRenewalCase(state), true)
  const copy = structuredClone(state)
  const next = act(state, 'broker', { type: 'sendQuote' })
  assert.deepEqual(state, copy)
  assert.equal(next.quoteRevision, 1)
  assert.equal(next.activity.length, state.activity.length + 1)
})

test('only clients provide locations, insurers agree, and brokers review or transmit', () => {
  const state = firstProposal()
  const wrongRoles: [Role, CaseAction][] = [
    ['broker', { type: 'submitLocations', locations: sampleClientResponse(state) }],
    ['insurer', { type: 'submitLocations', locations: sampleClientResponse(state) }],
    ['broker', { type: 'insurerAgree', note: 'Broker cannot approve.' }],
    ['broker', { type: 'clientAgree', evidence: 'Broker cannot agree for client.' }],
    ['client', { type: 'sendProposal' }],
    ['insurer', { type: 'reviewLocation', locationId: 'bekasi', result: 'matched', note: '' }],
    ['client', { type: 'setCheck', check: 'identity', checked: true }],
  ]
  for (const [role, action] of wrongRoles) assert.throws(() => act(state, role, action), /hanya tersedia/)
  assert.throws(() => act(createInitialCase(), 'client', { type: 'submitLocations', locations: sampleClientResponse(state) }), /setelah proposal/)
  assert.throws(() => act(createInitialCase(), 'insurer', { type: 'insurerAgree', note: 'Setuju.' }), /quotation/)
  assert.throws(() => act(createInitialCase(), 'broker', { type: 'sendProposal' }), /kesepakatan asuransi/)
})

test('counter terms and broker replies form a repeatable negotiation, without formal broker approval', () => {
  let state = createInitialCase()
  assert.throws(() => act(state, 'insurer', { type: 'reviseTerms', terms: { ...state.terms, rateBps: 14 }, note: 'Counter.' }), /Quotation/)
  state = act(state, 'broker', { type: 'sendQuote', note: 'Gunakan final slip sebelumnya.' })
  state = act(state, 'insurer', { type: 'reviseTerms', terms: { ...state.terms, rateBps: 14 }, note: 'Penyesuaian eksposur.' })
  assert.equal(state.revision, 2)
  assert.equal(state.quoteRevision, 2)
  state = act(state, 'broker', { type: 'reviseTerms', terms: { ...state.terms, rateBps: 11 }, note: 'Negosiasi mengikuti nihil klaim.' })
  assert.equal(state.quoteRevision, null)
  assert.throws(() => act(state, 'insurer', { type: 'insurerAgree', note: 'Setuju.' }), /terbaru/)
  state = act(state, 'broker', { type: 'sendQuote' })
  state = act(state, 'insurer', { type: 'insurerAgree', note: 'Setuju rate 11 bps.' })
  assert.equal(state.insurerAgreement?.revision, 3)
  assert.equal(state.termsRevisions.length, 3)
  assert.equal(state.termsRevisions[1].author, 'insurer')
  assert.equal(isRenewalCase(state), true)
})

test('invalid money, dates, rate, and client confirmation are rejected without mutation', () => {
  const state = firstProposal()
  const baseline = structuredClone(state)
  const sample = sampleClientResponse(state)[0]
  for (const sumInsured of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => act(state, 'client', { type: 'submitLocations', locations: [{ ...sample, sumInsured }] }), /nilai/)
  }
  for (const terms of [
    { ...state.terms, rateBps: 0 },
    { ...state.terms, rateBps: 1.5 },
    { ...state.terms, rateBps: 10_001 },
    { ...state.terms, periodStart: '2027-02-30' },
    { ...state.terms, periodEnd: '2026-12-31' },
    { ...state.terms, occupation: ' ' },
  ]) assert.throws(() => act(state, 'broker', { type: 'reviseTerms', terms, note: 'Perubahan.' }), /Lengkapi/)
  assert.throws(() => act(state, 'client', { type: 'submitLocations', locations: [{ ...sample, evidence: '' }] }), /sumber/)
  assert.throws(() => act(state, 'client', { type: 'submitLocations', locations: [{ ...sample, address: '' }] }), /alamat/)
  assert.throws(() => act(state, 'client', { type: 'submitLocations', locations: [sample, sample] }), /dua kali/)
  assert.throws(() => act(state, 'client', { type: 'submitLocations', locations: [{ ...sample, locationId: 'unknown' }] }), /tidak ditemukan/)
  assert.throws(() => act(state, 'client', { type: 'submitLocations', locations: [{ ...sample, sumInsured: Number.MAX_SAFE_INTEGER }] }), /Total/)
  assert.deepEqual(state, baseline)
})

test('partial client updates preserve the prior baseline and require explicit unchanged-value confirmation', () => {
  let state = firstProposal()
  const onlyBekasi = sampleClientResponse(state).filter((input) => input.locationId === 'bekasi')
  state = act(state, 'client', { type: 'submitLocations', locations: onlyBekasi })
  assert.equal(state.locations[0].prior.sumInsured, 3_500_000_000)
  assert.equal(state.locations[0].proposed?.sumInsured, 4_200_000_000)
  assert.equal(state.locations[1].proposed, null)
  assert.equal(getExportBlockers(state).some((blocker) => blocker.id === 'confirmation-tangerang'), true)
  assert.equal(state.insurerAgreement, null)
  assert.equal(state.quoteRevision, null)
  const before = state.revision
  const tangerang = sampleClientResponse(state).filter((input) => input.locationId === 'tangerang')
  state = act(state, 'client', { type: 'submitLocations', locations: tangerang })
  assert.equal(state.revision, before, 'unchanged insured values do not change underwriting revision')
  assert.equal(state.locations[1].confirmation?.confirmed, true)
  assert.equal(getExportBlockers(state).some((blocker) => blocker.id === 'confirmation-tangerang'), false)
  assert.equal(getExportBlockers(state).some((blocker) => blocker.id === 'matching-tangerang'), true)
})

test('unclear addresses cannot be matched, and follow-up returns to client clarification', () => {
  let state = firstProposal()
  state = act(state, 'client', { type: 'submitLocations', locations: sampleClientResponse(state) })
  assert.equal(state.locations[2].prior.sumInsured, 1_500_000_000)
  assert.equal(state.locations[2].proposed?.sumInsured, 1_800_000_000)
  assert.equal(state.locations[2].proposed?.address, '')
  assert.throws(() => act(state, 'broker', { type: 'reviewLocation', locationId: 'cikarang', result: 'matched', note: '' }), /dikonfirmasi klien/)
  assert.throws(() => act(state, 'broker', { type: 'reviewLocation', locationId: 'cikarang', result: 'followup', note: ' ' }), /klarifikasi/)
  state = act(state, 'broker', { type: 'reviewLocation', locationId: 'cikarang', result: 'followup', note: 'Mohon alamat lengkap gudang.' })
  assert.equal(state.locations[2].review, 'followup')
  assert.equal(getExportBlockers(state).some((blocker) => blocker.locationId === 'cikarang' && blocker.stage === 'proposal'), true)
  const revision = state.revision
  const inputs = sampleClientClarification(state)
  assert.equal(state.locations[2].review, 'followup', 'sample helper only prepares form inputs')
  state = act(state, 'client', { type: 'submitLocations', locations: inputs })
  assert.equal(state.revision, revision + 1)
  assert.equal(state.locations[2].review, 'unreviewed')
  assert.equal(state.locations[2].confirmation?.confirmed, true)
  state = act(state, 'broker', { type: 'reviewLocation', locationId: 'cikarang', result: 'matched', note: 'Alamat sama dengan lokasi lama.' })
  assert.equal(state.locations[2].review, 'matched')
  assert.equal(isRenewalCase(state), true)
})

test('original clauses stay verbatim while amendments are negotiated separately', () => {
  let state = firstProposal()
  const clauses = [...state.originalClauses]
  state = act(state, 'broker', { type: 'proposeAmendment', text: 'Appraisement limit diperluas menjadi 10% TSI.' })
  assert.deepEqual(state.originalClauses, clauses)
  assert.equal(state.amendments[0].status, 'pending')
  assert.equal(state.insurerAgreement, null)
  assert.equal(getExportBlockers(state).some((blocker) => blocker.id.startsWith('amendment-')), true)
  state = act(state, 'broker', { type: 'sendQuote' })
  assert.throws(() => act(state, 'insurer', { type: 'insurerAgree', note: 'Setuju.' }), /amandemen/)
  assert.throws(() => act(state, 'broker', { type: 'resolveAmendment', amendmentId: 'amendment-1', status: 'accepted', note: 'Tidak berwenang.' }), /Asuransi/)
  state = act(state, 'insurer', { type: 'resolveAmendment', amendmentId: 'amendment-1', status: 'accepted', note: 'Disetujui sesuai email contoh.' })
  assert.deepEqual(state.originalClauses, clauses)
  assert.equal(state.amendments[0].status, 'accepted')
  assert.equal(state.quoteRevision, null)
  state = act(state, 'broker', { type: 'sendQuote' })
  state = act(state, 'insurer', { type: 'insurerAgree', note: 'Setuju quotation beserta amandemen terpisah.' })
  state = act(state, 'client', { type: 'proposeAmendment', text: 'Usulan tambahan ditolak dalam contoh ini.' })
  assert.throws(() => act(state, 'insurer', { type: 'resolveAmendment', amendmentId: 'amendment-2', status: 'rejected', note: 'Belum menerima quotation terbaru.' }), /quotation/)
  state = act(state, 'broker', { type: 'sendQuote' })
  state = act(state, 'insurer', { type: 'resolveAmendment', amendmentId: 'amendment-2', status: 'rejected', note: 'Di luar ketentuan renewal.' })
  assert.equal(state.amendments[1].status, 'rejected')
  assert.deepEqual(state.originalClauses, clauses)
  assert.equal(isRenewalCase(state), true)
})

test('export requires complete broker checks but not client agreement; binding adds current proposal agreement', () => {
  const state = exportReady()
  assert.deepEqual(getExportBlockers(state), [])
  assert.equal(state.clientAgreement, null)
  assert.equal(getBindingBlockers(state).some((blocker) => blocker.id === 'client-agreement'), true)
  assert.equal(getBindingBlockers(state).some((blocker) => blocker.id === 'proposal-current'), true)
  assert.throws(() => act(state, 'broker', { type: 'requestBinding' }), /Binding belum siap/)
  assert.throws(() => act(state, 'client', { type: 'clientAgree', evidence: 'Setuju.' }), /proposal terbaru/)
  assert.equal(act(state, 'broker', { type: 'recordExport' }).activity.at(-1)?.label.includes('Word'), true)
  assert.throws(() => act(firstProposal(), 'broker', { type: 'recordExport' }), /penghambat/)
  assert.throws(() => act(firstProposal(), 'broker', { type: 'setCheck', check: 'identity', checked: true }), /Selesaikan data/)
})

test('client changes invalidate all affected agreements, checks, and pending binding', () => {
  let state = bindingReady()
  state = act(state, 'broker', { type: 'requestBinding' })
  assert.equal(state.bindingRequest?.revision, state.revision)
  const before = state.revision
  const location = state.locations[0]
  state = act(state, 'client', { type: 'submitLocations', locations: [{ locationId: location.id, ...location.proposed!, sumInsured: 4_500_000_000, confirmed: true, evidence: 'Email contoh pembaruan Rp4,5 miliar.' }] })
  assert.equal(state.revision, before + 1)
  assert.equal(state.quoteRevision, null)
  assert.equal(state.insurerAgreement, null)
  assert.equal(state.clientAgreement, null)
  assert.equal(state.bindingRequest, null)
  assert.equal(Object.values(state.checks).every((checked) => checked === false), true)
  assert.equal(state.locations[0].review, 'unreviewed')
  assert.equal(state.proposals.length, 2)
  assert.throws(() => act(state, 'insurer', { type: 'acknowledgeBinding', reference: 'Stale request.' }), /belum meneruskan/)
  assert.equal(isRenewalCase(state), true)
})

test('terms changes and sending another proposal invalidate client agreement for the current proposal', () => {
  let state = bindingReady()
  state = act(state, 'broker', { type: 'sendProposal', note: 'Versi cetak ulang yang perlu disetujui klien.' })
  assert.equal(state.clientAgreement, null)
  state = act(state, 'client', { type: 'clientAgree', evidence: 'Setuju versi cetak ulang.' })
  state = act(state, 'client', { type: 'reviseTerms', terms: { ...state.terms, occupation: 'Pabrik komponen logam, gudang, dan kantor' }, note: 'Tambahan penggunaan kantor dikonfirmasi klien.' })
  assert.equal(state.insurerAgreement, null)
  assert.equal(state.clientAgreement, null)
  assert.equal(state.checks.period, false)
  assert.equal(isRenewalCase(state), true)
})

test('full journey records insurer acknowledgment separately and coverage follows Jakarta period boundaries', () => {
  let state = bindingReady()
  assert.deepEqual(getBindingBlockers(state), [])
  state = act(state, 'broker', { type: 'requestBinding' })
  assert.equal(getCoverageStatus(state), 'Menunggu konfirmasi binding')
  assert.equal(state.bindingAcknowledgment, null)
  assert.throws(() => act(state, 'broker', { type: 'acknowledgeBinding', reference: 'Tidak berwenang.' }), /Asuransi/)
  state = act(state, 'insurer', { type: 'acknowledgeBinding', reference: 'SIM-BIND-2027-014' })
  assert.equal(isRenewalCase(state), true)
  assert.equal(getCoverageStatus(state, new Date('2026-12-31T16:59:59.999Z')), 'Terjadwal')
  assert.equal(getCoverageStatus(state, new Date('2026-12-31T17:00:00.000Z')), 'Aktif')
  assert.equal(getCoverageStatus(state, new Date('2027-12-31T16:59:59.999Z')), 'Aktif')
  assert.equal(getCoverageStatus(state, new Date('2027-12-31T17:00:00.000Z')), 'Periode berakhir')
  assert.throws(() => act(state, 'broker', { type: 'reviseTerms', terms: { ...state.terms, rateBps: 11 }, note: 'Terlambat.' }), /dikunci/)
  assert.throws(() => act(state, 'client', { type: 'submitLocations', locations: sampleClientResponse(state) }), /dikunci/)
  state = act(state, 'client', { type: 'saveNotes', notes: 'Falih: alur binding jelas.' })
  assert.equal(state.notes, 'Falih: alur binding jelas.')
  assert.equal(isRenewalCase(state), true)
})

test('evidence-only resubmission requires matching again without reopening unchanged policy terms', () => {
  let state = bindingReady()
  const before = state.revision
  const bekasi = state.locations[0]
  state = act(state, 'client', { type: 'submitLocations', locations: [{ locationId: bekasi.id, ...bekasi.proposed!, confirmed: true, evidence: 'Email konfirmasi tambahan untuk nilai dan alamat yang sama.' }] })
  assert.equal(state.revision, before)
  assert.equal(state.insurerAgreement?.revision, before)
  assert.equal(state.checks.identity, false)
  assert.equal(state.locations[0].review, 'unreviewed')
  assert.equal(state.checks.rate, true)
  assert.equal(isRenewalCase(state), true)
})

test('withdrawing confirmation clears consent and permits a valid reconfirmation and renewed consent', () => {
  let state = bindingReady()
  state = act(state, 'broker', { type: 'requestBinding' })
  const revision = state.revision
  const proposalVersion = state.proposals.at(-1)!.version
  const bekasi = state.locations[0]
  const input = { locationId: bekasi.id, ...bekasi.proposed!, evidence: bekasi.confirmation!.source }
  state = act(state, 'client', { type: 'submitLocations', locations: [{ ...input, confirmed: false }] })
  assert.equal(state.revision, revision, 'withdrawing confirmation does not change policy values')
  assert.equal(state.insurerAgreement?.revision, revision)
  assert.equal(state.clientAgreement, null)
  assert.equal(state.bindingRequest, null)
  assert.equal(state.checks.identity, false)
  assert.equal(state.checks.rate, true)
  assert.equal(state.locations[0].review, 'unreviewed')
  assert.equal(state.locations[1].review, 'matched')
  assert.throws(() => act(state, 'client', { type: 'clientAgree', evidence: 'Premature renewed consent.' }), /Konfirmasikan/)
  state = act(state, 'client', { type: 'submitLocations', locations: [{ ...input, confirmed: true }] })
  state = act(state, 'broker', { type: 'reviewLocation', locationId: bekasi.id, result: 'matched', note: 'Konfirmasi terbaru sudah dicocokkan.' })
  state = act(state, 'broker', { type: 'setCheck', check: 'identity', checked: true })
  assert.deepEqual(getExportBlockers(state), [])
  assert.equal(state.clientAgreement, null)
  state = act(state, 'client', { type: 'clientAgree', evidence: 'Setuju kembali setelah konfirmasi dilengkapi.' })
  assert.equal(state.clientAgreement?.revision, revision)
  assert.equal(state.clientAgreement?.proposalVersion, proposalVersion)
  assert.deepEqual(getBindingBlockers(state), [])
  state = act(state, 'broker', { type: 'requestBinding' })
  assert.equal(state.bindingRequest?.revision, revision)
})

test('saved state validation rejects malformed nested data and impossible workflow states', () => {
  const ready = bindingReady()
  assert.equal(isRenewalCase(JSON.parse(JSON.stringify(ready))), true)
  for (const value of [null, [], 1, 'case', {}, { schemaVersion: 1 }, { ...ready, schemaVersion: 2 }]) assert.equal(isRenewalCase(value), false)
  const corruptions: ((state: RenewalCase) => void)[] = [
    (state) => { state.locations[0].prior.sumInsured = 1 },
    (state) => { state.locations[0].proposed!.sumInsured = -1 },
    (state) => { state.locations[0].confirmation!.source = '' },
    (state) => { state.locations[0].confirmation!.confirmed = false },
    (state) => { state.originalClauses[0] = 'Changed original text.' },
    (state) => { state.standardTerms.rateBps = 1 },
    (state) => { state.terms.periodEnd = '2027-02-30' },
    (state) => { state.termsRevisions = [] },
    (state) => { state.termsRevisions[0].terms.rateBps = 15 },
    (state) => { state.activity[0].role = 'outsider' as Role },
    (state) => { state.activity[0].at = 'not-a-date' },
    (state) => { state.checks.identity = 'yes' as unknown as boolean },
    (state) => { state.proposals[0].version = 15 },
    (state) => { state.insurerAgreement!.revision -= 1 },
    (state) => { state.clientAgreement!.proposalVersion = 99 },
    (state) => { state.bindingAcknowledgment = { revision: state.revision, at, reference: 'Without request.' } },
    (state) => { state.bindingRequest = { revision: state.revision - 1, at } },
  ]
  for (const corrupt of corruptions) {
    const state = structuredClone(ready)
    corrupt(state)
    assert.equal(isRenewalCase(state), false, `rejected ${corrupt.toString()}`)
  }
  const pending = act(ready, 'broker', { type: 'proposeAmendment', text: 'New amendment.' })
  pending.insurerAgreement = { revision: pending.revision, at, note: 'Impossible agreement with pending amendment.' }
  pending.quoteRevision = pending.revision
  assert.equal(isRenewalCase(pending), false)
  const incomplete = firstProposal()
  incomplete.bindingRequest = { revision: incomplete.revision, at }
  assert.equal(isRenewalCase(incomplete), false)
})
