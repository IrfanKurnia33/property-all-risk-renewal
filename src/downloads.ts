import { getActiveProposal, getBindingBlockers, getCoverageStatus, getCurrentBindingRequest, getCurrentDfs, getCurrentQuote, getCurrentResponses, getExportBlockers, getProposalBlockers, getQsBlockers } from './domain.ts';
import type { RenewalCase, SourceReference } from './domain.ts';
import { createRenewalBlob, createQuoteBlob, createProposalBlob } from '../supabase/functions/_shared/documents.ts';
export { buildRenewalDocument, buildQuoteDocument, buildProposalDocument, createRenewalBlob, createQuoteBlob, createProposalBlob } from '../supabase/functions/_shared/documents.ts';
const stageLabels = { materials: 'Bahan renewal', insurer: 'Review asuransi', proposal: 'Proposal klien', reconciliation: 'Rekonsiliasi data', final: 'Final review & binding' };
const roleLabels = { broker: 'Broker', client: 'Klien' };
const filename = (state: RenewalCase, suffix: string) => state.id.replace(/[^a-zA-Z0-9-]/g, '-') + '-r' + state.revision + '-' + suffix;
const citation = (source: SourceReference | null) => source ? source.documentVersionId + ' · ' + source.locator : 'Tidak ada sumber pada peran ini.';

export function downloadBlob(blob: Blob, name: string): void {
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

export async function exportRenewalDocx(state: RenewalCase): Promise<void> { downloadBlob(await createRenewalBlob(state), filename(state, 'draft-renewal.docx')); }
export async function exportQuoteDocx(state: RenewalCase): Promise<void> { downloadBlob(await createQuoteBlob(state), filename(state, 'QS.docx')); }
export async function exportProposalDocx(state: RenewalCase): Promise<void> { downloadBlob(await createProposalBlob(state), filename(state, 'proposal.docx')); }

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
  downloadBlob(new Blob([buildSessionSummary(state)], { type: 'text/markdown;charset=utf-8' }), filename(state, 'ringkasan-sesi.md'));
}
