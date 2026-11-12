import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { getBindingBlockers, getCoverageStatus, getExportBlockers } from './domain.ts';
import type { RenewalCase } from './domain.ts';

const currency = (value: number) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(value);

const stageLabels = {
  materials: 'Bahan renewal', insurer: 'Review asuransi', proposal: 'Proposal klien',
  reconciliation: 'Rekonsiliasi data', final: 'Final review & binding',
};

const roleLabels = { broker: 'Broker', insurer: 'Asuransi', client: 'Klien' };
const filename = (state: RenewalCase, suffix: string) => `${state.id.replace(/[^a-zA-Z0-9-]/g, '-')}-r${state.revision}-${suffix}`;
const paragraph = (text: string) => new Paragraph({
  children: text.split(/\r?\n/).map((line, index) => new TextRun({ text: line, ...(index ? { break: 1 } : {}) })),
  spacing: { after: 140 },
});
const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 140 } });
const row = (cells: string[], header = false) => new TableRow({
  tableHeader: header,
  children: cells.map((text) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })],
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
  })),
});

/** The same readiness guard protects the UI and direct calls to the exporter. */
export function buildRenewalDocument(state: RenewalCase): Document {
  const blockers = getExportBlockers(state);
  if (blockers.length) {
    throw new Error(`Draft Word belum dapat diekspor: ${blockers.map((blocker) => blocker.label).join('; ')}`);
  }

  const locations = state.locations.map((location) => {
    if (!location.proposed || !location.confirmation?.confirmed || location.review !== 'matched') {
      throw new Error(`Konfirmasi lokasi ${location.prior.name} belum lengkap.`);
    }
    return { ...location.proposed, confirmation: location.confirmation };
  });
  const total = locations.reduce((sum, location) => sum + location.sumInsured, 0);
  const latestProposal = state.proposals.at(-1);
  const rate = `${(state.terms.rateBps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;

  return new Document({
    title: `Draft renewal PAR — ${state.clientName} — revisi ${state.revision}`,
    subject: 'Prototipe wawancara — seluruh data fiktif',
    creator: 'PAR renewal prototype',
    description: 'Draft simulasi yang dapat diedit; bukan polis atau instruksi binding nyata.',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 140 } } } },
    },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children: [
        new Paragraph({ text: 'DRAFT RENEWAL QUOTATION', heading: HeadingLevel.TITLE }),
        paragraph('PROPERTY ALL RISKS'),
        paragraph('SIMULASI — SELURUH DATA FIKTIF. Dokumen ini dapat diedit untuk pengujian; bukan polis, bukti pertanggungan, atau instruksi binding nyata.'),
        paragraph(`Klien: ${state.clientName}\nReferensi kasus: ${state.id}\nRevisi dokumen: ${state.revision}\nProposal terakhir: ${latestProposal ? `v${latestProposal.version}, revisi ${latestProposal.revision}` : 'Belum dikirim'}\nDibuat: ${new Date().toISOString()}`),
        heading('1. Lokasi dan nilai pertanggungan terkonfirmasi'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row(['Lokasi', 'Alamat terkonfirmasi', 'Sum insured'], true),
            ...locations.map((location) => row([location.name, location.address, currency(location.sumInsured)])),
            row(['Total sum insured', '', currency(total)], true),
          ],
        }),
        heading('2. Terms renewal'),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row(['Rincian', 'Kesepakatan revisi ini'], true),
            row(['Okupasi', state.terms.occupation]),
            row(['Periode pertanggungan', `${state.terms.periodStart} s.d. ${state.terms.periodEnd}`]),
            row(['Rate tahunan', rate]),
            row(['Premi indikatif sebelum pajak dan biaya', currency(Math.round(total * state.terms.rateBps / 10_000))]),
            row(['Deductible', state.terms.deductible]),
            row(['Additional coverage', state.terms.additionalCoverage]),
            row(['Riwayat klaim', state.terms.lossHistory]),
          ],
        }),
        paragraph('Premi di atas merupakan indikasi simulasi: total sum insured × rate. Pajak, biaya, dan perhitungan underwriting nyata tidak termasuk.'),
        paragraph(`Kesepakatan asuransi: revisi ${state.insurerAgreement?.revision}; ${state.insurerAgreement?.at}. ${state.insurerAgreement?.note ?? ''}`),
        heading('3. Klausul asli — tetap utuh'),
        ...state.originalClauses.map(paragraph),
        heading('4. Amandemen — dicatat terpisah'),
        ...(state.amendments.length ? state.amendments.flatMap((amendment, index) => [
          paragraph(`${index + 1}. ${amendment.status === 'accepted' ? 'Diterima' : 'Ditolak'} — diajukan oleh ${roleLabels[amendment.proposedBy]}`),
          paragraph(amendment.text),
          paragraph(`Catatan keputusan: ${amendment.note || 'Tidak ada catatan tambahan.'}`),
        ]) : [paragraph('Tidak ada usulan amandemen.')]),
        heading('5. Sumber konfirmasi klien'),
        ...locations.flatMap((location) => [
          paragraph(`${location.name}\nDikonfirmasi oleh: ${location.confirmation.confirmedBy}\nSumber: ${location.confirmation.source}\nWaktu konfirmasi: ${location.confirmation.at}\nStatus pemeriksaan broker: cocok dengan konfirmasi klien.`),
        ]),
        paragraph('Broker memeriksa dan mencocokkan data; broker tidak memberikan approval formal. Persetujuan klien atas proposal dan acknowledgment binding asuransi dicatat terpisah di aplikasi.'),
      ],
    }],
  });
}

export async function createRenewalBlob(state: RenewalCase): Promise<Blob> {
  return Packer.toBlob(buildRenewalDocument(state));
}

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

export async function exportRenewalDocx(state: RenewalCase): Promise<void> {
  const blob = await createRenewalBlob(state);
  download(blob, filename(state, 'draft-renewal.docx'));
}

export function buildSessionSummary(state: RenewalCase): string {
  const blockers = getExportBlockers(state);
  const bindingBlockers = getBindingBlockers(state);
  const proposal = state.proposals.at(-1);
  return [
    '# Ringkasan sesi uji renewal PAR',
    '',
    'SIMULASI — seluruh data dan komunikasi fiktif. Bukan catatan binding nyata.',
    '',
    `- Klien: ${state.clientName}`,
    `- Kasus: ${state.id}`,
    `- Revisi saat ini: ${state.revision}`,
    `- Dibuat: ${new Date().toISOString()}`,
    `- Periode: ${state.terms.periodStart} s.d. ${state.terms.periodEnd}`,
    `- Kesepakatan asuransi: ${state.insurerAgreement ? `revisi ${state.insurerAgreement.revision} (${state.insurerAgreement.at})` : 'Belum ada'}`,
    `- Proposal terakhir: ${proposal ? `v${proposal.version}, revisi ${proposal.revision} (${proposal.sentAt})` : 'Belum dikirim'}`,
    `- Persetujuan klien: ${state.clientAgreement ? `proposal v${state.clientAgreement.proposalVersion}, revisi ${state.clientAgreement.revision} (${state.clientAgreement.at}); ${state.clientAgreement.evidence}` : 'Belum ada'}`,
    `- Permintaan binding: ${state.bindingRequest ? `revisi ${state.bindingRequest.revision} (${state.bindingRequest.at})` : 'Belum ada'}`,
    `- Acknowledgment asuransi: ${state.bindingAcknowledgment ? `${state.bindingAcknowledgment.reference}, revisi ${state.bindingAcknowledgment.revision} (${state.bindingAcknowledgment.at})` : 'Belum ada'}`,
    `- Status pertanggungan: ${getCoverageStatus(state)}`,
    '',
    '## Penghambat ekspor Word',
    '',
    ...(blockers.length ? blockers.map((blocker) => `- [${stageLabels[blocker.stage]}] ${blocker.label}`) : ['Tidak ada penghambat pada revisi ini.']),
    '',
    '## Penghambat binding',
    '',
    ...(bindingBlockers.length ? bindingBlockers.map((blocker) => `- [${stageLabels[blocker.stage]}] ${blocker.label}`) : ['Tidak ada penghambat permintaan binding pada revisi ini.']),
    '',
    '## Catatan uji Falih',
    '',
    state.notes.trim() || 'Belum ada catatan.',
    '',
    '## Aktivitas sesi',
    '',
    ...state.activity.map((event) => `- ${event.at} · ${roleLabels[event.role]} · revisi ${event.revision}: ${event.label}`),
    '',
  ].join('\n');
}

export function exportSessionSummary(state: RenewalCase): void {
  download(new Blob([buildSessionSummary(state)], { type: 'text/markdown;charset=utf-8' }), filename(state, 'ringkasan-sesi.md'));
}
