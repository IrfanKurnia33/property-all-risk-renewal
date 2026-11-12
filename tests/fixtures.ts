import { applyAction, BROKER_CHECKS, createInitialCase, sampleClientClarification, sampleClientResponse } from '../src/domain.ts';
import type { CheckKey } from '../src/domain.ts';

export function partialResponseCase() {
  let state = createInitialCase();
  state = applyAction(state, 'broker', { type: 'sendQuote' });
  state = applyAction(state, 'insurer', { type: 'insurerAgree', note: 'Setuju quotation contoh.' });
  state = applyAction(state, 'broker', { type: 'sendProposal' });
  return applyAction(state, 'client', { type: 'submitLocations', locations: sampleClientResponse(state) });
}

export function exportReadyCase() {
  let state = partialResponseCase();
  state = applyAction(state, 'client', { type: 'submitLocations', locations: sampleClientClarification(state) });
  for (const location of state.locations) {
    state = applyAction(state, 'broker', { type: 'reviewLocation', locationId: location.id, result: 'matched', note: 'Sesuai konfirmasi klien.' });
  }
  state = applyAction(state, 'broker', { type: 'sendQuote' });
  state = applyAction(state, 'insurer', { type: 'insurerAgree', note: 'Setuju data terbaru dari klien.' });
  state = applyAction(state, 'broker', { type: 'sendProposal' });
  for (const check of Object.keys(BROKER_CHECKS) as CheckKey[]) {
    state = applyAction(state, 'broker', { type: 'setCheck', check, checked: true });
  }
  return state;
}
