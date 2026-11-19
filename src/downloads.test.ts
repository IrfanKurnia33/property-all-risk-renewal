import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  applyAction, BROKER_CHECKS, createInitialCase, getActiveProposal, getBindingBlockers, getCurrentQuote,
  getCurrentWording, getExportBlockers, isRenewalCase, LOCAL_ACTORS, sampleClientResponse,
} from './domain.ts';
import type { CaseAction, CheckKey, RenewalCase, Role } from './domain.ts';
import {
  buildQuoteDocument, buildRenewalDocument, buildProposalDocument, buildSessionSummary, createQuoteBlob, createRenewalBlob, createProposalBlob,
  exportQuoteDocx, exportRenewalDocx, exportProposalDocx, exportSessionSummary,
} from './downloads.ts';

const timestamp = '2026-11-19T04:00:00.000Z';
const act = (state: RenewalCase, action: CaseAction, role: Role = 'broker') => applyAction(state, LOCAL_ACTORS[role], action, state.lockVersion, timestamp);

function reviewedCase(): RenewalCase {
  let state = createInitialCase();
  for (const item of getCurrentWording(state).items) state = act(state, { type: 'reviewWording', itemId: item.id, disposition: 'retain', note: 'Original words checked against source.', question: '' });
  return state;
}

function quoteCase(withChanges = false): RenewalCase {
  let state = reviewedCase();
  if (withChanges) {
    const items = structuredClone(getCurrentWording(state).items);
    items[0] = { ...items[0]!, direction: 'withdrawal', reply: '', replySource: { documentVersionId: 'reply-utama', locator: 'Page 1, cross-out', excerpt: '', shareable: false }, disposition: 'withdrawal-accepted', reviewNote: 'Explicit withdrawal decision retained.' };
    const outgoing = 'Requested enhancement <literal> & wording.\nSecond line retained exactly.';
    items.push({ id: 'enhancement-1', title: 'Enhancement test', prior: '', outgoing, reply: '',
      priorSource: null, outgoingSource: { documentVersionId: 'qs-source-utama', locator: 'Section 5', excerpt: outgoing, shareable: false },
      replySource: { documentVersionId: 'reply-utama', locator: 'Page 2, cross-out', excerpt: '', shareable: false },
      direction: 'enhancement', disposition: 'rejected-enhancement', reviewNote: 'Rejected new enhancement, not withdrawn existing cover.', question: '' });
    state = act(state, { type: 'reviseWording', items, note: 'Record separate three-way comparison decisions.' });
  }
  return act(state, { type: 'prepareQuote' });
}

function readyCase(withChanges = false, issueDfs = true): RenewalCase {
  let state = quoteCase(withChanges);
  state = act(state, { type: 'recordInsurerResponse', response: {
    optionId: state.selectedOptionId, materialRevision: getCurrentQuote(state)!.materialRevision,
    wordingVersion: getCurrentQuote(state)!.wordingVersion, quoteId: getCurrentQuote(state)!.id,
    insurerId: 'insurer-a', insurerName: 'Asuransi Fiktif A', externalRespondent: 'Underwriter A (external)',
    responseAt: timestamp, position: 'accepted', sharePercent: '100', leader: true,
    terms: structuredClone(state.terms), conditions: [{ text: 'Schedule checked', required: true, resolved: true }],
    evidence: { documentVersionId: 'reply-utama', locator: 'Email 19 Nov, attachment 1', excerpt: 'Insurer confirms this QS wording and 100% share.', shareable: false }, note: 'Manual external response.',
  } });
  state = act(state, { type: 'publishProposal' });
  state = act(state, { type: 'submitLocations', proposalId: getActiveProposal(state)!.id, locations: sampleClientResponse(state) }, 'client');
  for (const location of state.locations) state = act(state, { type: 'reviewLocation', locationId: location.id, result: 'matched', note: 'Matched written client evidence.' });
  state = act(state, { type: 'clientAgree', proposalId: getActiveProposal(state)!.id, evidence: 'Client agrees to this exact proposal.' }, 'client');
  state = act(state, { type: 'clientInstruct', proposalId: getActiveProposal(state)!.id, evidence: 'Client instructs renewal on this exact proposal.' }, 'client');
  for (const check of Object.keys(BROKER_CHECKS) as CheckKey[]) state = act(state, { type: 'setCheck', check, checked: true });
  assert.deepEqual(getExportBlockers(state), []);
  return issueDfs ? act(state, { type: 'issueDfs' }) : state;
}

async function documentText(blob: Blob) {
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(archive['[Content_Types].xml']);
  assert.ok(archive['word/styles.xml']);
  const xml = strFromU8(archive['word/document.xml']!);
  assert.match(xml, /<w:tbl>/);
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>/g)].map(match => match[1] === undefined ? '\n' : match[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join('');
  return { text, xml };
}

test('direct Word helpers reject unresolved cases and require prepared snapshots', async () => {
  const state = createInitialCase();
  assert.throws(() => buildRenewalDocument(state), /DFS belum dapat diekspor/);
  assert.throws(() => buildQuoteDocument(state), /QS belum dapat diekspor/);
  assert.throws(() => buildProposalDocument(state), /Proposal belum dapat diekspor/);
  await assert.rejects(createRenewalBlob(state), /belum dapat diekspor/);
  await assert.rejects(exportRenewalDocx(state), /belum dapat diekspor/);
  await assert.rejects(exportQuoteDocx(state), /belum dapat diekspor/);
  await assert.rejects(exportProposalDocx(state), /belum dapat diekspor/);
  assert.throws(() => buildQuoteDocument(reviewedCase()), /snapshot QS/);
  assert.throws(() => buildRenewalDocument(readyCase(false, false)), /snapshot DFS/);
  assert.throws(() => buildProposalDocument(quoteCase()), /Proposal belum dapat diekspor/);
});

test('proposal exports a published immutable version before client consent and excludes broker-private material', async () => {
  let state = readyCase(true, false);
  state = act(state, { type: 'saveNotes', notes: 'PRIVATE-BROKER-NOTES' });
  const before = structuredClone(state);
  const snapshot = getActiveProposal(state)!;
  const { text, xml } = await documentText(await createProposalBlob(state));
  assert.ok(text.includes('PROPOSAL PROPERTY ALL RISKS'));
  assert.ok(text.includes(`Kasus: ${state.id}`));
  assert.ok(text.includes('Produsen: broker'));
  assert.ok(text.includes('Snapshot proposal: proposal-1 v1'));
  assert.ok(text.includes(`Wording version: ${snapshot.wordingVersion}`));
  assert.ok(text.includes(`Material revision: ${snapshot.materialRevision}`));
  assert.ok(text.includes(`Dipublikasikan: ${snapshot.at}`));
  assert.ok(text.includes('SELURUH DATA FIKTIF'));
  assert.ok(text.includes('Enhancement ditolak'));
  assert.ok(text.includes('Penarikan wording lama dicatat'));
  assert.ok(text.includes('Register amandemen — terpisah dari wording'));
  assert.ok(text.includes('Asuransi Fiktif A · 100%'));
  assert.ok(text.includes('Schedule checked'));
  assert.ok(text.includes('IDR 3.381.000,00'));
  assert.ok(text.includes('versi sumber baru untuk ditinjau kembali'));
  for (const wording of snapshot.wording.filter(item => !['rejected-enhancement', 'withdrawal-accepted'].includes(item.disposition))) {
    assert.ok(text.includes(wording.outgoing), wording.title);
  }
  for (const privateText of ['PRIVATE-BROKER-NOTES', 'Original words checked against source.', 'Underwriter A (external)',
    'Manual external response.', 'Insurer confirms this QS wording and 100% share.', 'Explicit withdrawal decision retained.',
    'Page 1, cross-out', 'Requested enhancement <literal> & wording.\nSecond line retained exactly.', ...snapshot.sourceVersionIds]) {
    assert.equal(text.includes(privateText), false, `Private content must not enter proposal: ${privateText}`);
  }
  assert.doesNotMatch(xml, /documentProtection|<w:pict|<w:drawing/);
  assert.deepEqual(state, before);

  let unconfirmed = quoteCase();
  unconfirmed = act(unconfirmed, { type: 'recordInsurerResponse', response: {
    ...snapshot.responses[0]!, materialRevision: getCurrentQuote(unconfirmed)!.materialRevision,
    wordingVersion: getCurrentQuote(unconfirmed)!.wordingVersion, quoteId: getCurrentQuote(unconfirmed)!.id,
  } });
  unconfirmed = act(unconfirmed, { type: 'publishProposal' });
  assert.equal(unconfirmed.agreements.length, 0);
  assert.equal(unconfirmed.instructions.length, 0);
  const pending = await documentText(await createProposalBlob(unconfirmed));
  assert.ok(pending.text.includes('Menunggu konfirmasi periode berjalan'));
  await assert.rejects(createRenewalBlob(unconfirmed), /DFS belum dapat diekspor/);
});

test('early QS exports historical unconfirmed values with exact rates and excluded-peril context', async () => {
  const state = quoteCase();
  assert.ok(state.locations.every(location => !location.confirmation));
  assert.ok(getExportBlockers(state).length > 0);
  const { text } = await documentText(await createQuoteBlob(state));
  assert.ok(text.includes('QS PROPERTY ALL RISKS'));
  assert.ok(text.includes('Historis / belum dikonfirmasi klien'));
  assert.ok(text.includes('0,0483 %'));
  assert.ok(text.includes('IDR 3.381.000,00'));
  assert.ok(text.includes('IDR 3.400.000,00'));
  assert.ok(text.includes('Dikecualikan / tidak dihitung'));
  assert.ok(text.includes('HALF_UP ke 2 angka desimal'));
  assert.ok(text.includes('qs-source-utama'));
});

test('DFS package preserves snapshot provenance, verbatim clauses, separate decisions and insurer evidence', async () => {
  const state = readyCase(true);
  const before = structuredClone(state);
  assert.equal(isRenewalCase(state), true);
  const { text } = await documentText(await createRenewalBlob(state));
  assert.ok(text.includes('SELURUH DATA FIKTIF'));
  assert.ok(text.includes(`Revisi dokumen: ${state.revision}`));
  assert.ok(text.includes('Snapshot DFS: dfs-1'));
  assert.ok(text.includes('Opsi: utama'));
  assert.ok(text.includes('Proposal: proposal-1 v1'));
  assert.ok(text.includes('Wording version:'));
  assert.ok(text.includes('IDR 7.000.000.000,00'));
  for (const clause of state.originalClauses) assert.ok(text.includes(clause), clause);
  assert.ok(text.includes('Requested enhancement <literal> & wording.\nSecond line retained exactly.'));
  assert.ok(text.includes('rejected-enhancement'));
  assert.ok(text.includes('withdrawal-accepted'));
  assert.ok(text.includes('Page 1, cross-out'));
  assert.ok(text.includes('Page 2, cross-out'));
  assert.ok(text.includes('Insurer confirms this QS wording and 100% share.'));
  assert.ok(text.includes('Underwriter A (external)'));
  assert.ok(text.includes('Dicatat oleh: broker-demo'));
  assert.ok(text.includes('reply-utama'));
  assert.ok(text.includes('client-demo'));
  assert.ok(text.includes('Client agrees to this exact proposal.'));
  assert.ok(text.includes('Client instructs renewal on this exact proposal.'));
  assert.ok(text.includes('Register amandemen — terpisah dari wording asli'));
  assert.ok(text.indexOf('Register amandemen — terpisah dari wording asli') > text.indexOf('Requested enhancement <literal> & wording.\nSecond line retained exactly.'));
  assert.ok(text.includes('IDR 3.381.000,00'));
  assert.ok(text.includes('IDR 3.400.000,00'));
  assert.deepEqual(state, before, 'Document generation must not change case state.');
});

test('Word rendering preserves per-mille units without numeric conversion', async () => {
  let state = reviewedCase();
  const terms = structuredClone(state.terms);
  terms.premiumLines[0]!.rate = { ...terms.premiumLines[0]!.rate, value: '0.483', unit: 'per-mille' };
  state = act(state, { type: 'reviseTerms', terms, note: 'Explicit equivalent per-mille rate.' });
  state = act(state, { type: 'prepareQuote' });
  const { text } = await documentText(await createQuoteBlob(state));
  assert.ok(text.includes('0,483 ‰'));
  assert.ok(text.includes('IDR 3.381.000,00'));
});

test('material changes reject stale QS, proposal and DFS exports while preserving old snapshots', async () => {
  let state = readyCase();
  const oldDfs = structuredClone(state.dfsSnapshots);
  const oldQs = structuredClone(state.quoteSnapshots);
  const oldProposals = structuredClone(state.proposals);
  const terms = structuredClone(state.terms);
  terms.premiumLines[0]!.rate.value = '0.05';
  state = act(state, { type: 'reviseTerms', terms, note: 'Changed terms need fresh evidence.' });
  assert.equal(isRenewalCase(state), true);
  await assert.rejects(createRenewalBlob(state), /belum dapat diekspor/);
  await assert.rejects(createQuoteBlob(state), /belum dapat diekspor/);
  await assert.rejects(createProposalBlob(state), /belum dapat diekspor/);
  assert.deepEqual(state.dfsSnapshots, oldDfs);
  assert.deepEqual(state.quoteSnapshots, oldQs);
  assert.deepEqual(state.proposals, oldProposals);
});

test('session summary exposes stage blockers and retained client decisions before readiness', () => {
  let state = createInitialCase();
  state = act(state, { type: 'saveNotes', notes: 'Falih: cek sumber konfirmasi sebelum matching.\nMasih perlu follow-up alamat.' });
  const summary = buildSessionSummary(state);
  assert.ok(summary.includes(`Revisi saat ini: ${state.revision}`));
  assert.ok(summary.includes(`Lock version: ${state.lockVersion}`));
  assert.ok(summary.includes(state.notes));
  assert.ok(summary.includes(timestamp));
  assert.ok(summary.includes('Broker (broker-demo)'));
  for (const blocker of getExportBlockers(state)) assert.ok(summary.includes(blocker.label));
  const ready = readyCase(false, false);
  const readySummary = buildSessionSummary(ready);
  assert.ok(readySummary.includes('Persetujuan decision-1: proposal-1'));
  assert.ok(readySummary.includes('Instruksi decision-2: proposal-1'));
  assert.ok(readySummary.includes('Status pertanggungan: Belum binding'));
  for (const blocker of getBindingBlockers(ready)) assert.ok(readySummary.includes(blocker.label));
});

test('failed download setup surfaces an error and releases its object URL', context => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let removed = false;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ remove: () => { removed = true; }, click: () => { throw new Error('Blocked download'); } }), body: { append: () => {} } },
  });
  context.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  context.mock.method(URL, 'createObjectURL', () => 'blob:renewal-test');
  const revoke = context.mock.method(URL, 'revokeObjectURL', () => {});
  assert.throws(() => exportSessionSummary(createInitialCase()), /Unduhan tidak dapat dimulai/);
  assert.equal(removed, true);
  assert.equal(revoke.mock.calls[0]?.arguments[0], 'blob:renewal-test');
});

test('successful downloads remove temporary links and release URLs after browser consumption', context => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let removed = false;
  let clicked = false;
  const anchor = { href: '', download: '', hidden: false, remove: () => { removed = true; }, click: () => { clicked = true; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { append: () => {} } } });
  context.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.method(URL, 'createObjectURL', () => 'blob:renewal-success');
  const revoke = context.mock.method(URL, 'revokeObjectURL', () => {});
  exportSessionSummary(createInitialCase());
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.ok(anchor.download.endsWith('.md'));
  assert.equal(revoke.mock.callCount(), 0);
  context.mock.timers.tick(1000);
  assert.equal(revoke.mock.calls[0]?.arguments[0], 'blob:renewal-success');
});
