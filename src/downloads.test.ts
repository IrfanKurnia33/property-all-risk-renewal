import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { createInitialCase, getBindingBlockers, getExportBlockers } from './domain.ts';
import type { RenewalCase } from './domain.ts';
import { buildRenewalDocument, buildSessionSummary, createRenewalBlob, exportRenewalDocx, exportSessionSummary } from './downloads.ts';

const timestamp = '2026-11-11T04:00:00.000Z';

function readyCase(): RenewalCase {
  const state = createInitialCase();
  state.revision = 7;
  state.quoteRevision = 7;
  state.locations = state.locations.map((location, index) => ({
    ...location,
    proposed: {
      ...location.prior,
      address: index === 2 ? 'Jl. Industri Raya, Cikarang — alamat lengkap fiktif' : location.prior.address,
      sumInsured: index === 0 ? 4_200_000_000 : index === 1 ? 2_000_000_000 : 1_800_000_000,
    },
    confirmation: { confirmed: true, source: 'Konfirmasi tertulis klien — simulasi', confirmedBy: 'Dina (klien fiktif)', at: timestamp },
    review: 'matched',
    reviewNote: 'Cocok dengan konfirmasi klien.',
  }));
  state.insurerAgreement = { revision: 7, at: timestamp, note: 'T&C dan data risiko revisi ini disepakati — simulasi.' };
  state.proposals = [{ version: 2, revision: 7, sentAt: timestamp, note: 'Proposal revisi lengkap.' }];
  state.checks = { identity: true, period: true, rate: true, deductible: true, clauses: true };
  state.originalClauses = ['Original clause & literal wording: 72 hours.\nSecond line remains unchanged.'];
  state.amendments = [
    { id: 'accepted', text: 'Accepted separate amendment <for testing>.', status: 'accepted', proposedBy: 'insurer', note: 'Disepakati pada revisi ini.' },
    { id: 'rejected', text: 'Rejected amendment remains a separate record.', status: 'rejected', proposedBy: 'broker', note: 'Tidak diterapkan.' },
  ];
  assert.deepEqual(getExportBlockers(state), []);
  return state;
}

test('Word export rejects an unresolved case, including direct helper calls', async () => {
  const state = createInitialCase();
  assert.throws(() => buildRenewalDocument(state), /belum dapat diekspor/);
  await assert.rejects(createRenewalBlob(state), /belum dapat diekspor/);
  await assert.rejects(exportRenewalDocx(state), /belum dapat diekspor/);
});

test('editable DOCX package contains confirmed updates, exact original clauses, and separate amendment decisions', async () => {
  const state = readyCase();
  const snapshot = structuredClone(state);
  const blob = await createRenewalBlob(state);
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(archive['[Content_Types].xml']);
  assert.ok(archive['word/styles.xml']);
  const xml = strFromU8(archive['word/document.xml']!);
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]!
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join('\n');

  assert.match(xml, /<w:tbl>/);
  assert.ok(text.includes('SELURUH DATA FIKTIF'));
  assert.ok(text.includes('Revisi dokumen: 7'));
  assert.ok(text.includes('4.200.000.000'));
  assert.ok(text.includes('2.000.000.000'));
  assert.ok(text.includes('1.800.000.000'));
  assert.ok(text.includes('8.000.000.000'));
  assert.ok(!text.includes('3.500.000.000'));
  assert.ok(!text.includes('1.500.000.000'));
  assert.ok(text.includes(state.locations[2]!.proposed!.address));
  assert.ok(text.includes(state.terms.periodStart));
  assert.ok(text.includes(state.terms.periodEnd));
  assert.ok(text.includes(new Intl.NumberFormat('id-ID').format(Math.round(8_000_000_000 * state.terms.rateBps / 10_000))));
  assert.ok(text.includes(state.originalClauses[0]!));
  assert.ok(text.includes('Amandemen — dicatat terpisah'));
  assert.ok(text.includes('Diterima — diajukan oleh Asuransi'));
  assert.ok(text.includes('Ditolak — diajukan oleh Broker'));
  assert.ok(text.includes(state.amendments[0]!.text));
  assert.ok(text.includes(state.amendments[1]!.text));
  assert.ok(text.includes('Dina (klien fiktif)'));
  assert.ok(text.includes('Konfirmasi tertulis klien — simulasi'));
  assert.deepEqual(state, snapshot, 'Generating a document must not change case state.');
});

test('session summary is available before readiness and preserves blockers, revision, notes, and activity', () => {
  const state = createInitialCase();
  state.notes = 'Falih: cek sumber konfirmasi sebelum matching.\nMasih perlu follow-up alamat.';
  state.activity.push({ id: 'test-event', at: timestamp, role: 'broker', revision: state.revision, label: 'Memeriksa bukti pembaruan lokasi.' });
  const summary = buildSessionSummary(state);
  assert.ok(summary.includes(`Revisi saat ini: ${state.revision}`));
  assert.ok(summary.includes(state.notes));
  assert.ok(summary.includes('Memeriksa bukti pembaruan lokasi.'));
  assert.ok(summary.includes(timestamp));
  for (const blocker of getExportBlockers(state)) assert.ok(summary.includes(blocker.label));
});

test('an export-ready summary still reports remaining client agreement before binding', () => {
  const state = readyCase();
  const summary = buildSessionSummary(state);
  const exportSection = summary.split('## Penghambat ekspor Word')[1]!.split('## Penghambat binding')[0]!;
  const bindingSection = summary.split('## Penghambat binding')[1]!.split('## Catatan uji Falih')[0]!;
  assert.ok(exportSection.includes('Tidak ada penghambat pada revisi ini.'));
  assert.ok(summary.includes('Status pertanggungan: Belum binding'));
  assert.ok(getBindingBlockers(state).length > 0);
  for (const blocker of getBindingBlockers(state)) assert.ok(bindingSection.includes(blocker.label));
  assert.ok(bindingSection.includes('Klien belum menyetujui versi proposal terbaru.'));
});

test('failed download setup surfaces an error and releases its object URL', (context) => {
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

test('successful downloads remove temporary links and release object URLs after the browser consumes them', (context) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let removed = false;
  let clicked = false;
  const anchor = { href: '', download: '', hidden: false, remove: () => { removed = true; }, click: () => { clicked = true; } };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => anchor, body: { append: () => {} } },
  });
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
