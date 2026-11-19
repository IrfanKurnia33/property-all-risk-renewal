import {
  applyAction, BROKER_CHECKS, createInitialCase, getActiveProposal, getCurrentDfs,
  getCurrentQuote, getCurrentWording, getSelectedOption, LOCAL_ACTORS, sampleClientResponse,
} from '../src/domain.ts'
import type { CaseAction, CheckKey, InsurerResponse, RenewalCase, Role } from '../src/domain.ts'

export const TEST_AT = '2026-11-19T05:00:00.000Z'
export function act(state: RenewalCase, action: CaseAction, role: Role = 'broker'): RenewalCase {
  return applyAction(state, LOCAL_ACTORS[role], action, state.lockVersion, TEST_AT)
}

export function quoteReadyCase(input = createInitialCase()): RenewalCase {
  let state = input
  for (const item of getCurrentWording(state).items) if (item.disposition === 'unreviewed') {
    state = act(state, { type: 'reviewWording', itemId: item.id, disposition: 'retain', note: 'Wording historis dan QS sama; sumber fiktif diperiksa.', question: '' })
  }
  return getCurrentQuote(state) ? state : act(state, { type: 'prepareQuote' })
}

export function recordResponse(input: RenewalCase, overrides: Partial<InsurerResponse> = {}): RenewalCase {
  const quote = getCurrentQuote(input)!
  const option = getSelectedOption(input)
  return act(input, { type: 'recordInsurerResponse', response: {
    optionId: option.id, materialRevision: option.materialRevision, wordingVersion: option.wordingVersion, quoteId: quote.id,
    insurerId: 'insurer-a', insurerName: 'Asuransi Fiktif A', externalRespondent: 'Underwriter fiktif A', responseAt: TEST_AT,
    position: 'accepted', sharePercent: '100', leader: true, terms: structuredClone(option.terms), conditions: [],
    evidence: { documentVersionId: 'reply-' + option.id, locator: 'Email contoh, paragraf 2', excerpt: 'Setuju terms QS dan share yang dicatat (fiktif).', shareable: false },
    note: 'Catatan broker atas respons eksternal; tidak mengirim email.', ...overrides,
  } })
}

export function proposalReadyCase(input = quoteReadyCase()): RenewalCase {
  return act(recordResponse(input), { type: 'publishProposal' })
}

export function partialResponseCase(): RenewalCase {
  const state = proposalReadyCase()
  const locations = sampleClientResponse(state)
  locations[2] = { ...locations[2], address: '', confirmed: false, evidence: 'Klien masih memeriksa alamat Cikarang (fiktif).' }
  return act(state, { type: 'submitLocations', proposalId: getActiveProposal(state)!.id, locations }, 'client')
}

export function clientConfirmedCase(input = proposalReadyCase()): RenewalCase {
  let state = act(input, { type: 'submitLocations', proposalId: getActiveProposal(input)!.id, locations: sampleClientResponse(input) }, 'client')
  for (const location of state.locations) {
    state = act(state, { type: 'reviewLocation', locationId: location.id, result: 'matched', note: 'Broker mencocokkan konfirmasi contoh klien.' })
  }
  return state
}

export function dfsReadyCase(input = clientConfirmedCase()): RenewalCase {
  const proposalId = getActiveProposal(input)!.id
  let state = act(input, { type: 'clientAgree', proposalId, evidence: 'Klien menyetujui proposal ini (fiktif).' }, 'client')
  state = act(state, { type: 'clientInstruct', proposalId, evidence: 'Klien memberi instruksi perpanjangan atas proposal ini (fiktif).' }, 'client')
  for (const check of Object.keys(BROKER_CHECKS) as CheckKey[]) state = act(state, { type: 'setCheck', check, checked: true })
  return state
}

export function exportReadyCase(): RenewalCase { return act(dfsReadyCase(), { type: 'issueDfs' }) }

export function bindingReadyCase(input = exportReadyCase()): RenewalCase {
  return act(input, { type: 'requestBinding', dfsId: getCurrentDfs(input)!.id, dispatch: {
    channel: 'Email manual', recipient: 'underwriter@example.invalid', reference: 'FIKTIF-DISPATCH-001', sentAt: TEST_AT,
  } })
}
