import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import {
  getActiveProposal, getCurrentDfs,
  getCurrentQuote, getExportBlockers, getProposalBlockers, getQsBlockers, isRenewalCase,
} from './domain.ts';
import type { RenewalCase, ScheduleRowData, ScheduleVersion, SourceReference, Terms, WordingItem } from './domain.ts';
import { clientProposal } from './api-contract.ts';
import { addDecimals, calculatePremium, formatDecimal, PREMIUM_ROUNDING } from './decimal.ts';
import type { Money } from './decimal.ts';

const money = (value: Money) => `${value.currency} ${formatDecimal(value.amount, 2)}`;
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
    paragraph(`Gross premium illustration (no client discount applied): ${money({ amount: addDecimals(calculated.flatMap(value => value ? [value.amount] : [])), currency: terms.currency })}. ${PREMIUM_ROUNDING}`),
    paragraph('Calculated gross premium and insurer-recorded premium are separate. No client discount is included. Rate alone does not establish coverage or charged premium. Taxes and fees are not calculated.'),
  ];
}

const scheduleFields: [keyof ScheduleRowData, string][] = [
  ['locationName', 'Location name'], ['address', 'Address'], ['occupancy', 'Occupancy'],
  ['sumInsured', 'Sum insured'], ['currency', 'Currency'], ['coverage', 'Coverage / peril'],
  ['rate', 'Rate'], ['rateUnit', 'Rate unit'], ['rateBasis', 'Rate basis'],
  ['rateApplicability', 'Rate applicability'], ['deductible', 'Deductible'], ['remarks', 'Remarks'],
];
function reviewedScheduleContent(state: RenewalCase, schedule: ScheduleVersion): (Paragraph | Table)[] {
  const source = state.documents.find(document => document.id === schedule.sourceDocumentVersionId)!;
  return [
    paragraph(`Broker-reviewed schedule v${schedule.version} · period ${schedule.periodStart} to ${schedule.periodEnd}\nSource: ${source.name} · SHA-256 ${schedule.sourceSha256}\nReviewed: ${schedule.reviewedAt} by ${schedule.reviewedBy}`),
    ...schedule.rows.flatMap((row, index) => [
      paragraph(`${index + 1}. ${row.values.locationName} · XLSX sheet "${row.source.sheetName}" · row ${row.source.rowNumber}`),
      table([
        ['Field', 'Imported source value', 'Broker-reviewed value', 'Source cell'],
        ...scheduleFields.map(([field, label]) => [
          label, row.imported[field] || 'Not imported',
          row.values[field] || '—', row.source.cells[field] ?? 'Not mapped',
        ]),
      ]),
      ...(row.warnings.length ? [paragraph(`Review warnings: ${row.warnings.join('; ')}`)] : []),
    ]),
    paragraph('This schedule is broker-reviewed source material, not client confirmation. Occupancy has not been confirmed through the current client location flow.'),
  ];
}

const directionLabels: Record<WordingItem['direction'], string> = {
  retained: 'Dipertahankan', enhancement: 'Enhancement baru', withdrawal: 'Penarikan wording lama', change: 'Perubahan',
};
const dispositionLabels: Record<WordingItem['disposition'], string> = {
  unreviewed: 'Belum ditinjau', retain: 'Pertahankan wording', accepted: 'Wording QS diterima',
  'rejected-enhancement': 'Enhancement ditolak', 'withdrawal-accepted': 'Penarikan wording lama dicatat', followup: 'Perlu klarifikasi',
};

function wordingContent(items: WordingItem[]): (Paragraph | Table)[] {
  return [paragraph('Teks setiap versi di bawah disalin utuh dari snapshot. Amandemen dan keputusan review dicatat terpisah; catatan review tidak mengganti teks sumber.'), ...items.flatMap(item => [
    heading(item.title),
    paragraph('Prior agreed baseline — ' + citation(item.priorSource)), paragraph(item.prior || '(Tidak ada wording historis untuk item ini.)'),
    paragraph('Outgoing QS — ' + citation(item.outgoingSource)), paragraph(item.outgoing),
    paragraph('Insurer reply — ' + citation(item.replySource)), paragraph(item.reply || '(Tidak ada wording balasan; lihat bukti dan hasil review.)'),
  ]), heading('Register amandemen — terpisah dari wording asli'),
  table([['Item', 'Arah perubahan', 'Hasil review', 'Catatan dan pertanyaan'], ...items.map(item => [
    item.title, `${directionLabels[item.direction]} (${item.direction})`, `${dispositionLabels[item.disposition]} (${item.disposition})`,
    `Catatan: ${item.reviewNote}\nPertanyaan: ${item.question || 'Tidak ada'}`,
  ])])];
}

function sourcesContent(state: RenewalCase, versionIds: string[]): Paragraph[] {
  return [...new Set(versionIds)].map(id => {
    const doc = state.documents.find(document => document.id === id);
    if (!doc) throw new Error('Versi sumber tidak tersedia: ' + id);
    return paragraph(`${doc.id} · ${doc.documentId} v${doc.version}\n${doc.name} · ${doc.type} · ${doc.insuranceClass}\nProdusen: ${doc.producer}\nPeriode: ${doc.periodStart} s.d. ${doc.periodEnd}\nOpsi: ${doc.optionId ?? 'Historis / referensi'} · status: ${doc.status}\n${doc.file ? `SHA-256: ${doc.file.sha256}` : 'Belum ada berkas tersimpan; metadata simulasi saja.'}`);
  });
}

function renderDocument(state: RenewalCase, kind: 'QS' | 'PROPOSAL' | 'DFS', children: (Paragraph | Table)[]): Document {
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
      heading('Penggunaan dokumen editable'),
      paragraph('Dokumen ini dihasilkan dari snapshot tersimpan. Perubahan di Word tidak mengubah snapshot atau status kesiapan Rekonvia. Unggah dokumen hasil edit sebagai versi sumber baru untuk ditinjau kembali.'),
    ] }],
  });
}

export function buildProposalDocument(state: RenewalCase): Document {
  if (!isRenewalCase(state)) throw new Error('Proposal belum dapat diekspor: data kasus tidak valid.');
  const blockers = getProposalBlockers(state);
  const snapshot = getActiveProposal(state);
  if (blockers.length || !snapshot || snapshot.optionId !== state.selectedOptionId || snapshot.revision !== state.revision) {
    throw new Error(`Proposal belum dapat diekspor: ${blockers.map(item => item.label).join('; ') || 'Publikasikan snapshot proposal versi terkini.'}`);
  }
  // Use the same public allowlist as the client API; broker evidence never enters the shared proposal Word file.
  const proposal = clientProposal(snapshot);
  return renderDocument(state, 'PROPOSAL', [
    paragraph(`Snapshot proposal: ${proposal.id} v${proposal.version}\nOpsi: ${proposal.optionId}\nMaterial revision: ${snapshot.materialRevision}\nWording version: ${snapshot.wordingVersion}\nDipublikasikan: ${proposal.publishedAt}`),
    paragraph('Proposal yang telah dipublikasikan untuk review klien. Persetujuan proposal dan instruksi renewal merupakan dua langkah terpisah. Dokumen ini tidak membuktikan instruksi klien atau acknowledgment insurer.'),
    heading('1. Schedule pada proposal yang dipublikasikan'),
    table([['Lokasi', 'Alamat', 'Sum insured', 'Status pada snapshot'], ...proposal.locations.map(location => [
      location.values.name, location.values.address, money(location.values.sumInsured),
      location.currentConfirmed ? 'Dikonfirmasi klien pada snapshot' : 'Menunggu konfirmasi periode berjalan',
    ])]),
    paragraph('Status konfirmasi di atas berlaku pada snapshot proposal ini. Klien tetap memeriksa nama, alamat, dan nilai untuk periode berjalan di Rekonvia.'),
    heading('2. Terms dan perhitungan'), ...termsContent(proposal.terms),
    heading('3. Wording yang dipublikasikan — teks dipertahankan'),
    ...proposal.wording.flatMap(item => [heading(item.title), paragraph(item.wording || '(Tidak ada wording efektif untuk item ini; lihat register amandemen.)')]),
    heading('4. Register amandemen — terpisah dari wording'),
    table([['Item', 'Arah perubahan', 'Hasil review'], ...proposal.wording.map(item => [item.title, directionLabels[item.direction], dispositionLabels[item.disposition]])]),
    paragraph('Register ini menjelaskan hasil review yang dipublikasikan. Penolakan enhancement dan penarikan wording lama dicatat sebagai keputusan yang berbeda.'),
    heading('5. Panel dan kondisi yang diungkapkan'),
    ...proposal.participants.flatMap(participant => [
      paragraph(`${participant.insurerName} · ${formatDecimal(participant.sharePercent)}% · leader: ${participant.leader ? 'ya' : 'tidak'}`),
      ...participant.conditions.map(condition => paragraph(`Kondisi ${condition.required ? 'wajib' : 'diungkapkan'}: ${condition.text} · ${condition.resolved ? 'selesai' : 'belum selesai'}`)),
    ]),
    heading('6. Versi sumber publikasi'),
    paragraph(`Proposal: ${proposal.id} v${proposal.version}\nRevisi kasus pada publikasi: ${proposal.revision}\nVersi material: ${snapshot.materialRevision}\nVersi wording: ${snapshot.wordingVersion}`),
    paragraph('Dokumen mengikuti snapshot publikasi di atas. Kutipan bukti dan catatan kerja broker tetap berada dalam catatan privat broker.'),
  ]);
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
    ...(quote.schedule ? reviewedScheduleContent(state, quote.schedule) : [
      table([['Lokasi', 'Alamat', 'Sum insured', 'Status periode berjalan'], ...quote.locations.map(location => [location.values.name, location.values.address, money(location.values.sumInsured), location.currentConfirmed ? 'Dikonfirmasi klien' : 'Historis / belum dikonfirmasi klien'])]),
      paragraph('Data historis dapat digunakan untuk QS. Data ini tetap memerlukan konfirmasi klien sebelum DFS.'),
    ]),
    heading('2. Terms usulan'), ...termsContent(quote.terms),
    heading('3. Review wording tiga arah'), ...wordingContent(quote.wording),
    heading('4. Versi sumber'), ...sourcesContent(state, quote.sourceVersionIds),
  ]);
}

export async function createRenewalBlob(state: RenewalCase): Promise<Blob> { return Packer.toBlob(buildRenewalDocument(state)); }
export async function createQuoteBlob(state: RenewalCase): Promise<Blob> { return Packer.toBlob(buildQuoteDocument(state)); }
export async function createProposalBlob(state: RenewalCase): Promise<Blob> { return Packer.toBlob(buildProposalDocument(state)); }

