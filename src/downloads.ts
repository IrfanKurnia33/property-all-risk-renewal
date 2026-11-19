import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import {
  getActiveProposal, getBindingBlockers, getCoverageStatus, getCurrentBindingRequest, getCurrentDfs,
  getCurrentQuote, getCurrentResponses, getExportBlockers, getProposalBlockers, getQsBlockers, isRenewalCase,
} from './domain.ts';
import type { RenewalCase, SourceReference, Terms, WordingItem } from './domain.ts';
import { addDecimals, calculatePremium, formatDecimal, PREMIUM_ROUNDING } from './decimal.ts';
import type { Money } from './decimal.ts';

const money = (value: Money) => `${value.currency} ${formatDecimal(value.amount, 2)}`;
const stageLabels = {
  materials: 'Bahan renewal', insurer: 'Review asuransi', proposal: 'Proposal klien',
  reconciliation: 'Rekonsiliasi data', final: 'Final review & binding',
};
const roleLabels = { broker: 'Broker', client: 'Klien' };
const filename = (state: RenewalCase, suffix: string) => `${state.id.replace(/[^a-zA-Z0-9-]/g, '-')}-r${state.revision}-${suffix}`;
const paragraph = (text: string) => new Paragraph({
  children: text.split(/\r?\n/).map((line, index) => new TextRun({ text: line, ...(index ? { break: 1 } : {}) })),
  spacing: { after: 140 },
});
const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 140 } });
const row = (cells: string[], header = false) => new TableRow({
  tableHeader: header,
  children: cells.map(text => new TableCell({
    children: [paragraph(text)], margins: { top: 100, bottom: 100, left: 100, right: 100 },
  })),
});
const table = (rows: string[][]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((cells, index) => row(cells, index === 0)) });
const citation = (source: SourceReference | null) => source ? `${source.documentVersionId} · ${source.locator}` : 'Tidak ada sumber pada peran ini.';

function termsContent(terms: Terms): (Paragraph | Table)[] {
  const calculated = terms.premiumLines.map(calculatePremium);
  return [
    table([
      ['Rincian', 'Terms pada snapshot'], ['Okupasi', terms.occupation],
      ['Periode', `${terms.periodStart} s.d. ${terms.periodEnd}`], ['Mata uang', terms.currency],
      ['Deductible', terms.deductible], ['Perluasan / pengecualian', terms.additionalCoverage], ['Riwayat klaim', terms.lossHistory],
    ]),
    table([
      ['Peril / penerapan', 'Basis', 'Rate / unit', 'Premi ilustratif', 'Premi tercatat insurer'],
      ...terms.premiumLines.map((line, index) => [
        `${line.peril}\n${line.included ? 'Termasuk perhitungan' : 'Dikecualikan / tidak dihitung'}`,
        `${money(line.basis)}\n${line.rate.basis}`,
        `${formatDecimal(line.rate.value)} ${line.rate.unit === 'percent' ? '%' : '‰'}`,
        calculated[index] ? money(calculated[index]!) : 'Tidak dihitung; rate tidak membuktikan cover.',
        line.recordedPremium ? money(line.recordedPremium) : 'Belum tercatat',
      ]),
    ]),
    paragraph(`Total ilustrasi: ${money({ amount: addDecimals(calculated.flatMap(value => value ? [value.amount] : [])), currency: terms.currency })}. ${PREMIUM_ROUNDING}`),
    paragraph('Ilustrasi dan premi tercatat insurer disimpan terpisah. Rate saja tidak menetapkan cover atau premi yang ditagih. Pajak dan biaya tidak dihitung.'),
  ];
}

function wordingContent(items: WordingItem[]): Paragraph[] {
  return items.flatMap(item => [
    heading(item.title),
    paragraph(`Arah perubahan: ${item.direction}\nHasil review: ${item.disposition}\nCatatan: ${item.reviewNote}\nPertanyaan: ${item.question || 'Tidak ada'}`),
    paragraph('Prior agreed baseline — ' + citation(item.priorSource)), paragraph(item.prior || '(Tidak ada wording historis untuk item ini.)'),
    paragraph('Outgoing QS — ' + citation(item.outgoingSource)), paragraph(item.outgoing),
    paragraph('Insurer reply — ' + citation(item.replySource)), paragraph(item.reply || '(Tidak ada wording balasan; lihat bukti dan hasil review.)'),
  ]);
}

function sourcesContent(state: RenewalCase, versionIds: string[]): Paragraph[] {
  return [...new Set(versionIds)].map(id => {
    const doc = state.documents.find(document => document.id === id);
    if (!doc) throw new Error('Versi sumber tidak tersedia: ' + id);
    return paragraph(`${doc.id} · ${doc.documentId} v${doc.version}\n${doc.name} · ${doc.type} · ${doc.insuranceClass}\nProdusen: ${doc.producer}\nPeriode: ${doc.periodStart} s.d. ${doc.periodEnd}\nOpsi: ${doc.optionId ?? 'Historis / referensi'} · status: ${doc.status}`);
  });
}

function renderDocument(state: RenewalCase, kind: 'QS' | 'DFS', children: (Paragraph | Table)[]): Document {
  return new Document({
    title: `Rekonvia — ${kind} PAR — ${state.clientName} — revisi ${state.revision}`,
    subject: 'Pilot manual — seluruh data fiktif', creator: 'Rekonvia',
    description: 'Draft editable dari snapshot; bukan polis atau bukti pertanggungan.',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 140 } } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: [
      new Paragraph({ text: `Rekonvia · ${kind} PROPERTY ALL RISKS`, heading: HeadingLevel.TITLE }),
      paragraph('SIMULASI — SELURUH DATA FIKTIF. Draft editable untuk pengujian; bukan polis, bukti pertanggungan, atau instruksi binding nyata.'),
      paragraph(`Klien: ${state.clientName}\nKasus: ${state.id}\nProdusen: broker\nRevisi dokumen: ${state.revision}\nLock version: ${state.lockVersion}`),
      ...children,
    ] }],
  });
}

/** Direct exports use the same guards as commands and only render current immutable snapshots. */
export function buildRenewalDocument(state: RenewalCase): Document {
  if (!isRenewalCase(state)) throw new Error('DFS belum dapat diekspor: data kasus tidak valid.');
  const blockers = getExportBlockers(state);
  const dfs = getCurrentDfs(state);
  if (blockers.length || !dfs) throw new Error(`DFS belum dapat diekspor: ${blockers.map(item => item.label).join('; ') || 'Siapkan snapshot DFS versi terkini.'}`);
  const proposal = dfs.proposal;
  const participants = proposal.responses.filter(response => dfs.responseIds.includes(response.id));
  const agreement = state.agreements.find(item => item.id === dfs.agreementId)!;
  const instruction = state.instructions.find(item => item.id === dfs.instructionId)!;
  return renderDocument(state, 'DFS', [
    paragraph(`Snapshot DFS: ${dfs.id}\nOpsi: ${dfs.optionId}\nProposal: ${proposal.id} v${proposal.version}\nMaterial revision: ${proposal.materialRevision}\nWording version: ${proposal.wordingVersion}\nDisiapkan: ${dfs.at} oleh ${dfs.recordedBy}\nPersetujuan: ${dfs.agreementId}\nInstruksi renewal: ${dfs.instructionId}`),
    heading('1. Lokasi dan nilai terkonfirmasi klien'),
    table([['Lokasi', 'Alamat', 'Sum insured'], ...dfs.locations.map(location => [location.values.name, location.values.address, money(location.values.sumInsured)]),
      ['Total', '', money({ amount: addDecimals(dfs.locations.map(location => location.values.sumInsured.amount)), currency: proposal.terms.currency })]]),
    heading('2. Terms dan perhitungan'), ...termsContent(proposal.terms),
    heading('3. Wording tiga arah — kata sumber dipertahankan'), ...wordingContent(proposal.wording),
    heading('4. Posisi setiap anggota panel'),
    ...participants.flatMap(response => [
      paragraph(`${response.insurerName} · ${formatDecimal(response.sharePercent)}%\nPosisi: ${response.position} · leader: ${response.leader ? 'ya' : 'tidak'}\nRespons eksternal: ${response.externalRespondent}, ${response.responseAt}\nDicatat oleh: ${response.recordedBy}, ${response.recordedAt}\nQS: ${response.quoteId} · wording v${response.wordingVersion}\nBukti: ${citation(response.evidence)}`),
      paragraph(response.evidence.excerpt),
      ...response.conditions.map(condition => paragraph(`Kondisi ${condition.required ? 'wajib' : 'diungkapkan'}: ${condition.text} · ${condition.resolved ? 'selesai' : 'belum selesai'}`)),
    ]),
    heading('5. Bukti konfirmasi klien'),
    ...dfs.locations.map(location => paragraph(`${location.values.name}\nDikonfirmasi oleh: ${location.confirmation.confirmedBy}\nSumber: ${location.confirmation.source}\nWaktu: ${location.confirmation.at}\nSubmission: ${location.confirmation.submissionId}`)),
    paragraph(`Persetujuan ${agreement.id}\n${agreement.recordedBy} · ${agreement.at}\n${agreement.evidence}`),
    paragraph(`Instruksi renewal ${instruction.id}\n${instruction.recordedBy} · ${instruction.at}\n${instruction.evidence}`),
    paragraph('Broker mencocokkan bukti dan memeriksa dokumen. Persetujuan serta instruksi klien dan acknowledgment setiap insurer dicatat terpisah.'),
    heading('6. Versi sumber'), ...sourcesContent(state, [...proposal.sourceVersionIds, ...participants.map(response => response.evidence.documentVersionId)]),
  ]);
}

export function buildQuoteDocument(state: RenewalCase): Document {
  if (!isRenewalCase(state)) throw new Error('QS belum dapat diekspor: data kasus tidak valid.');
  const blockers = getQsBlockers(state);
  const quote = getCurrentQuote(state);
  if (blockers.length || !quote) throw new Error(`QS belum dapat diekspor: ${blockers.map(item => item.label).join('; ') || 'Siapkan snapshot QS versi terkini.'}`);
  return renderDocument(state, 'QS', [
    paragraph(`Snapshot QS: ${quote.id}\nOpsi: ${quote.optionId}\nMaterial revision: ${quote.materialRevision}\nWording version: ${quote.wordingVersion}\nDisiapkan: ${quote.at} oleh ${quote.recordedBy}`),
    heading('1. Schedule untuk quotation'),
    table([['Lokasi', 'Alamat', 'Sum insured', 'Status periode berjalan'], ...quote.locations.map(location => [location.values.name, location.values.address, money(location.values.sumInsured), location.currentConfirmed ? 'Dikonfirmasi klien' : 'Historis / belum dikonfirmasi klien'])]),
    paragraph('Data historis dapat digunakan untuk QS. Data ini tetap memerlukan konfirmasi klien sebelum DFS.'),
    heading('2. Terms usulan'), ...termsContent(quote.terms),
    heading('3. Review wording tiga arah'), ...wordingContent(quote.wording),
    heading('4. Versi sumber'), ...sourcesContent(state, quote.sourceVersionIds),
  ]);
}

export async function createRenewalBlob(state: RenewalCase): Promise<Blob> { return Packer.toBlob(buildRenewalDocument(state)); }
export async function createQuoteBlob(state: RenewalCase): Promise<Blob> { return Packer.toBlob(buildQuoteDocument(state)); }

function download(blob: Blob, name: string): void {
  let url: string | undefined;
  let link: HTMLAnchorElement | undefined;
  let started = false;
  try {
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    started = true;
  } catch (error) {
    throw new Error('Unduhan tidak dapat dimulai. Izinkan unduhan pada browser lalu coba lagi.', { cause: error });
  } finally {
    link?.remove();
    // Give the browser time to consume the URL before releasing its memory.
    if (url) {
      const completedUrl = url;
      if (started) setTimeout(() => URL.revokeObjectURL(completedUrl), 1000);
      else URL.revokeObjectURL(completedUrl);
    }
  }
}

export async function exportRenewalDocx(state: RenewalCase): Promise<void> { download(await createRenewalBlob(state), filename(state, 'draft-renewal.docx')); }
export async function exportQuoteDocx(state: RenewalCase): Promise<void> { download(await createQuoteBlob(state), filename(state, 'QS.docx')); }

export function buildSessionSummary(state: RenewalCase): string {
  const proposal = getActiveProposal(state);
  const request = getCurrentBindingRequest(state);
  const sections = [
    ['Penghambat QS', getQsBlockers(state)], ['Penghambat proposal', getProposalBlockers(state)],
    ['Penghambat ekspor Word', getExportBlockers(state)], ['Penghambat binding', getBindingBlockers(state)],
  ] as const;
  return [
    '# Rekonvia — Ringkasan sesi uji renewal PAR', '',
    'SIMULASI — seluruh data dan komunikasi fiktif. Bukan catatan binding nyata.', '',
    `- Klien: ${state.clientName}`, `- Kasus: ${state.id}`, `- Revisi saat ini: ${state.revision}`, `- Lock version: ${state.lockVersion}`,
    `- Opsi aktif: ${state.selectedOptionId}`, `- Dibuat: ${new Date().toISOString()}`, `- Periode: ${state.terms.periodStart} s.d. ${state.terms.periodEnd}`,
    `- QS: ${getCurrentQuote(state)?.id ?? 'Belum disiapkan'}`,
    `- Proposal aktif: ${proposal ? `${proposal.id} v${proposal.version}, revisi ${proposal.revision}` : 'Belum dipublikasikan'}`,
    `- DFS: ${getCurrentDfs(state)?.id ?? 'Belum disiapkan'}`,
    `- Pengiriman binding: ${request ? `${request.id}; ${request.dispatch.channel}; ${request.dispatch.reference}; ${request.dispatch.sentAt}` : 'Belum dicatat'}`,
    `- Status pertanggungan: ${getCoverageStatus(state)}`, '',
    '## Respons insurer eksternal', '',
    ...getCurrentResponses(state).map(response => `- ${response.insurerName}: ${response.position}, ${response.sharePercent}%; responden ${response.externalRespondent}; dicatat ${response.recordedBy}; ${citation(response.evidence)}`), '',
    '## Riwayat keputusan klien', '',
    ...state.agreements.map(item => `- Persetujuan ${item.id}: ${item.proposalId}; revisi ${item.revision}; ${item.recordedBy}; ${item.at}; ${item.evidence}`),
    ...state.instructions.map(item => `- Instruksi ${item.id}: ${item.proposalId}; revisi ${item.revision}; ${item.recordedBy}; ${item.at}; ${item.evidence}`), '',
    ...sections.flatMap(([title, blockers]) => [`## ${title}`, '', ...(blockers.length ? blockers.map(blocker => `- [${stageLabels[blocker.stage]}] ${blocker.label}`) : ['Tidak ada penghambat pada revisi ini.']), '']),
    '## Catatan uji Falih', '', state.notes.trim() || 'Belum ada catatan.', '', '## Aktivitas sesi', '',
    ...state.activity.map(event => `- ${event.at} · ${roleLabels[event.actor.role]} (${event.actor.id}) · revisi ${event.revision} · lock ${event.lockVersion}: ${event.label}`), '',
  ].join('\n');
}

export function exportSessionSummary(state: RenewalCase): void {
  download(new Blob([buildSessionSummary(state)], { type: 'text/markdown;charset=utf-8' }), filename(state, 'ringkasan-sesi.md'));
}
