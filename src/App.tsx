import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BROKER_CHECKS, getBindingBlockers, getCoverageStatus, getExportBlockers, getSelectedOption, getCurrentWording, getCurrentQuote, getCurrentResponses, getActiveProposal, getCurrentDfs, getCurrentBindingRequest, getQsBlockers, getProposalBlockers, isCurrentConfirmation, isBindingComplete, LOCAL_ACTORS, sampleClientResponse } from './domain';
import type { Actor, Blocker, CaseAction, CheckKey, ClientLocationInput, DocumentType, RenewalCase, Role, Stage, Terms, SourceReference, WordingItem } from './domain';
import { calculatePremium, formatDecimal, PREMIUM_ROUNDING } from './decimal';
import type { Money } from './decimal';
import { downloadStoredBackup, useRenewalCase } from './persistence';
import { Tour, useTour } from './Tour';
import { FileControls } from './FileControls';
import { requiredSourceIds } from '../supabase/functions/_shared/api-contract.ts';

const STAGES: { id: Stage; label: string; description: string }[] = [
  { id: 'materials', label: 'Bahan renewal', description: 'Mulai dari dokumen yang sudah disepakati.' },
  { id: 'insurer', label: 'Review asuransi', description: 'Bandingkan T&C dan catat hasil negosiasi.' },
  { id: 'proposal', label: 'Proposal klien', description: 'Kirim proposal dan terima konfirmasi klien.' },
  { id: 'reconciliation', label: 'Rekonsiliasi data', description: 'Cocokkan setiap perubahan dengan sumbernya.' },
  { id: 'final', label: 'Final review & binding', description: 'Periksa rincian, unduh draft, lalu teruskan binding.' },
];
const money = (value: Money) => value.currency + ' ' + formatDecimal(value.amount);
const shortDate = (value: string) => new Date(`${value}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
const eventDate = (value: string) => new Date(value).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
const period = (terms: Terms) => `${shortDate(terms.periodStart)} – ${shortDate(terms.periodEnd)}`;

const iconPaths: Record<string, ReactNode> = {
  shield: <><path d="m12 3 8 3v5c0 5-3.8 8-8 10-4.2-2-8-5-8-10V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  circle: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3h.01" /></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8m-8 4h6" /></>,
  building: <><path d="M4 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M2 21h20M8 7h1m4 0h1M8 11h1m4 0h1M8 15h1m4 0h1M10 21v-3h3v3" /></>,
  location: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  send: <><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 17h.01" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  chat: <path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z" />,
  refresh: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  compare: <><path d="M4 5h16M4 12h16M4 19h16M8 2v6m8 1v6m-8 1v6" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v1" /></>,
};
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name] ?? iconPaths.circle}</svg>;
}
export function Badge({ children, tone = '', icon }: { children: ReactNode; tone?: string; icon?: string }) {
  const colors: Record<string, string> = {
    blue: 'border-status-review-fg/20 bg-status-review-bg text-status-review-fg',
    green: 'border-status-confirmed-fg/20 bg-status-confirmed-bg text-status-confirmed-fg',
    amber: 'border-status-pending-fg/20 bg-status-pending-bg text-status-pending-fg',
    red: 'border-status-blocked-fg/20 bg-status-blocked-bg text-status-blocked-fg',
  };
  return <span className={`badge ${tone} inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] leading-normal font-medium [&_.icon]:size-3.5 ${colors[tone] ?? 'border-border-subtle bg-surface-subtle text-text-secondary'}`}>{icon && <Icon name={icon} />}{children}</span>;
}
export function Button({ children, onClick, primary = false, disabled = false, icon, testId, type = 'button' }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; icon?: string; testId?: string; type?: 'button' | 'submit' }) {
  return <button type={type} className={`btn inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm leading-snug font-medium transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none [&_.icon]:size-4 ${primary ? 'primary border-action-primary bg-action-primary text-action-primary-text enabled:hover:border-action-primary-hover enabled:hover:bg-action-primary-hover enabled:active:bg-action-primary-active' : 'border-border-control bg-surface text-text-primary enabled:hover:bg-surface-subtle enabled:active:bg-surface-selected'}`} onClick={onClick} disabled={disabled} data-testid={testId}>{icon && <Icon name={icon} />}{children}</button>;
}
export function Note({ children, highlight = false }: { children: ReactNode; highlight?: boolean }) {
  return <div className={`info-note flex gap-2.5 text-[13px] leading-relaxed text-text-secondary [&>.icon]:mt-0.5 [&>.icon]:size-4 [&>.icon]:text-text-muted ${highlight ? 'highlight rounded-md bg-surface-selected px-4 py-3.5' : ''}`}><Icon name="circle" /><div>{children}</div></div>;
}
function Blockers({ blockers, navigate }: { blockers: Blocker[]; navigate?: (stage: Stage) => void }) {
  if (!blockers.length) return <div className="info-note flex gap-2.5 text-[13px] leading-relaxed text-text-secondary"><Icon name="check" /><p>Semua rincian sudah jelas untuk revisi ini.</p></div>;
  return <ul className="blocker-list">{blockers.map(blocker => <li key={blocker.id}>{navigate ? <button type="button" className="min-h-11 text-link focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" onClick={() => navigate(blocker.stage)}><Icon name="circle" /><span>{blocker.label}</span></button> : <p className="flex gap-2 py-2 text-[13px] text-text-secondary"><Icon name="circle" />{blocker.label}</p>}</li>)}</ul>;
}

type Command = (action: CaseAction, formId?: string) => Promise<boolean>;
export interface AccountControls {
  email:string; pending:boolean; conflict:boolean; retryAvailable:boolean;
  onLogout:()=>void; onBack:()=>void; onReload:()=>Promise<void>; onRetry:()=>Promise<boolean>;
  onExport:(kind:'QS'|'DFS')=>Promise<boolean>;
  onUpload:(id:string,file:File)=>Promise<boolean>; onDownloadDocument:(id:string)=>Promise<void>;
}
export type WorkspaceStore = Omit<ReturnType<typeof useRenewalCase>,'dispatch'> & {
  dispatch:(actor:Actor,action:CaseAction)=>boolean|Promise<boolean>;
};
const field = (data: FormData, name: string) => String(data.get(name) ?? '');
const ref = (documentVersionId: string, excerpt: string, locator = 'Email / bagian terkait'): SourceReference => ({ documentVersionId, excerpt, locator, shareable: false });
const documentLabels: Record<DocumentType, string> = { 'prior-slip': 'Slip disepakati sebelumnya', schedule: 'Schedule', 'issued-change': 'Perubahan polis terdahulu', 'standard-wording': 'Referensi standar', QS: 'QS keluar', 'insurer-reply': 'Balasan insurer', proposal: 'Proposal', DFS: 'DFS', 'client-evidence': 'Konfirmasi klien', 'binding-evidence': 'Bukti binding' };
export const dispositionLabels: Record<WordingItem['disposition'], string> = { unreviewed: 'Belum ditinjau', retain: 'Pertahankan wording', accepted: 'Wording QS diterima', 'rejected-enhancement': 'Enhancement ditolak', 'withdrawal-accepted': 'Penarikan wording lama dicatat', followup: 'Perlu klarifikasi' };

export function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="panel"><div className="panel-head"><div><h3>{title}</h3>{description && <p>{description}</p>}</div></div><div className="panel-body space-y-5">{children}</div></section>;
}
function Select({ name, label, children, defaultValue }: { name: string; label: string; children: ReactNode; defaultValue?: string }) {
  return <div><label htmlFor={name}>{label}</label><select id={name} name={name} defaultValue={defaultValue} className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base text-text-primary">{children}</select></div>;
}
export function TextField({ name, label, value = '', textarea = false, required = true, type = 'text' }: { name: string; label: string; value?: string; textarea?: boolean; required?: boolean; type?: string }) {
  return <div><label htmlFor={name}>{label}</label>{textarea ? <textarea id={name} name={name} defaultValue={value} required={required} /> : <input id={name} name={name} defaultValue={value} required={required} type={type} />}</div>;
}
function EvidenceSelect({ state, name, type, optionId, value = '' }: { state: RenewalCase; name: string; type: DocumentType; optionId?: string; value?: string }) {
  return <Select name={name} label="Versi sumber" defaultValue={value}><option value="">Pilih versi sumber</option>{state.documents.filter(d => d.type === type && (!optionId || d.optionId === optionId)).map(d => <option key={d.id} value={d.id}>{d.name} · v{d.version} · {d.producer}</option>)}</Select>;
}
function Citation({ source, state, open }: { source: SourceReference | null; state: RenewalCase; open: (id: string) => void }) {
  if (!source) return <p className="small muted">Tidak ada sumber pada sisi ini.</p>;
  const doc = state.documents.find(d => d.id === source.documentVersionId)!;
  return <button type="button" className="text-button break-words text-left" onClick={() => open(doc.id)}><Icon name="file" />{doc.name} · v{doc.version} · {source.locator}</button>;
}
function SourceDialog({ id, state, onClose }: { id: string | null; state: RenewalCase; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const doc = state.documents.find(d => d.id === id);
  useEffect(() => { if (doc) dialog.current?.showModal(); else dialog.current?.close(); }, [id]);
  const wording = state.wordingRevisions.flatMap(w => w.items).flatMap(i => [i.priorSource, i.outgoingSource, i.replySource]).filter(s => s?.documentVersionId === id);
  const excerpts = [...new Set(wording.map(s => s!.excerpt))];
  return <dialog ref={dialog} className="document-dialog" aria-labelledby="document-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="panel-head"><div><h2 id="document-title">{doc?.name}</h2><p>Versi sumber fiktif · isi kutipan manual</p></div><button type="button" className="text-button" aria-label="Tutup dokumen" onClick={onClose}><Icon name="close" /></button></div>
    {doc && <div className="document-body"><dl><dt>Identitas / versi</dt><dd>{doc.documentId} / v{doc.version} ({doc.id})</dd><dt>Kelas / jenis</dt><dd>{doc.insuranceClass} / {documentLabels[doc.type]}</dd><dt>Periode</dt><dd>{doc.periodStart} – {doc.periodEnd}</dd><dt>Pembuat sumber</dt><dd>{doc.producer}</dd><dt>Opsi / status</dt><dd>{doc.optionId ?? 'Referensi lintas opsi'} / {doc.status}</dd><dt>Pencatat</dt><dd>{doc.recordedBy} · {eventDate(doc.createdAt)} WIB</dd></dl>
      <h3 className="mb-4">Kutipan tersimpan</h3><ol className="clause-list">{excerpts.map((s, i) => <li key={i} className="whitespace-pre-wrap">{s || '(Tidak dimuat pada balasan)'}</li>)}</ol><p className="context-note">{doc.note}</p><Note>{doc.file ? `Berkas tersimpan dengan SHA-256 ${doc.file.sha256}. Pemeriksaan format dan hash tidak membuktikan kecocokan kutipan.` : 'Ini metadata dan kutipan fiktif untuk review manual. File belum diunggah atau diverifikasi terhadap kutipan.'}</Note></div>}
  </dialog>;
}
function SourceInventory({ state, open, command, account }: { state: RenewalCase; open: (id: string) => void; command: Command; account?:AccountControls }) {
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget), id = field(data, 'doc-id');
    command({ type: 'addDocument', document: { id, documentId: field(data, 'doc-identity'), version: Number(field(data, 'doc-version')), name: field(data, 'doc-name'), type: field(data, 'doc-type') as DocumentType, insuranceClass: 'PAR', periodStart: field(data, 'doc-start'), periodEnd: field(data, 'doc-end'), producer: field(data, 'doc-producer'), optionId: field(data, 'doc-option') || null, status: field(data, 'doc-status') as 'received', fictional: true, note: 'Sumber fiktif dicatat manual. Belum ada unggahan file.' } }, e.currentTarget.id);
  }
  return <Panel title="Dokumen dan versi sumber" description="Pisahkan slip lama, referensi standar, QS, balasan, dan bukti binding."><Badge icon="file">{state.documents.length} dokumen</Badge>
    <div className="divide-y divide-border-subtle">{state.documents.map(d => <div key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0"><div className="min-w-0 flex-1"><strong className="text-sm">{d.name}</strong><p className="small muted">{documentLabels[d.type]} · {d.insuranceClass} · v{d.version} · {d.status}<br />{d.periodStart} – {d.periodEnd} · {d.producer}<br />{d.optionId ?? 'Referensi'} · {d.id}</p></div><div className="min-w-0 space-y-3"><Button onClick={() => open(d.id)} icon="file">Lihat dokumen</Button>{account && <FileControls document={d} upload={account.onUpload} download={account.onDownloadDocument} busy={account.pending || account.conflict || account.retryAvailable} />}</div></div>)}</div>
    <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-link">Catat versi sumber fiktif baru</summary><form id="add-document" className="space-y-4 pt-4" onSubmit={add}><div className="field-grid"><TextField name="doc-id" label="ID versi unik" /><TextField name="doc-identity" label="ID identitas dokumen" /><TextField name="doc-name" label="Nama dokumen" /><TextField name="doc-version" label="Nomor versi" type="number" value="1" /><TextField name="doc-producer" label="Pembuat sumber / insurer" value="Asuransi Fiktif A" /><Select name="doc-type" label="Jenis sumber" defaultValue="insurer-reply">{Object.entries(documentLabels).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</Select><TextField name="doc-start" label="Awal periode sumber" type="date" value={state.terms.periodStart} /><TextField name="doc-end" label="Akhir periode sumber" type="date" value={state.terms.periodEnd} /><Select name="doc-option" label="Opsi dokumen" defaultValue={state.selectedOptionId}><option value="">Referensi lintas opsi</option>{state.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Select><Select name="doc-status" label="Status dokumen" defaultValue="received"><option value="received">Diterima</option><option value="draft">Draft</option><option value="agreed">Disepakati</option><option value="issued">Diterbitkan</option></Select></div><Button type="submit">Simpan versi sumber</Button></form></details>
  </Panel>;
}
function WordingReview({ state, command, open }: { state: RenewalCase; command: Command; open: (id: string) => void }) {
  const current = getCurrentWording(state);
  function edit(e: FormEvent<HTMLFormElement>, item: WordingItem) {
    e.preventDefault();
    const data = new FormData(e.currentTarget), outgoing = field(data, 'out-' + item.id), reply = field(data, 'reply-' + item.id), replyDoc = field(data, 'reply-doc-' + item.id);
    const updated: WordingItem = { ...item, outgoing, reply, outgoingSource: ref(field(data, 'out-doc-' + item.id), outgoing, item.outgoingSource.locator), replySource: replyDoc ? ref(replyDoc, reply, 'Balasan ' + item.title) : null, direction: field(data, 'direction-' + item.id) as WordingItem['direction'], disposition: 'unreviewed', reviewNote: '', question: '' };
    command({ type: 'reviseWording', items: current.items.map(i => i.id === item.id ? updated : i), note: field(data, 'edit-note-' + item.id) }, e.currentTarget.id);
  }
  return <Panel title="Review wording tiga arah" description={'Baseline disepakati → QS keluar → balasan insurer. Wording v' + current.version + '; semua versi lama tetap tersimpan.'}>
    <div className="space-y-8">{current.items.map(item => <article key={item.id} className="space-y-4 border-b border-border-subtle pb-6 last:border-0 last:pb-0"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold">{item.title}</h4><Badge tone={item.disposition === 'unreviewed' || item.disposition === 'followup' ? 'amber' : 'green'}>{dispositionLabels[item.disposition]}</Badge></div>
      <div className="grid gap-4 md:grid-cols-3">{([{ title: 'Baseline disepakati', text: item.prior, source: item.priorSource }, { title: 'QS keluar', text: item.outgoing, source: item.outgoingSource }, { title: 'Balasan insurer', text: item.reply, source: item.replySource }]).map(side => <div key={side.title} className="min-w-0 space-y-3 rounded-md border border-border-subtle p-4"><p className="small muted">{side.title}</p><p className="whitespace-pre-wrap text-sm">{side.text || (side.source ? '(Tidak dimuat dalam sumber)' : 'Belum ada / tidak berlaku')}</p><Citation state={state} source={side.source} open={open} /></div>)}</div>
      <p className="small muted">Arah: {item.direction} · {item.question || 'Tidak ada pertanyaan tercatat.'}</p>
      <form id={'review-' + item.id} className="space-y-4" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); command({ type: 'reviewWording', itemId: item.id, disposition: field(d, 'disposition-' + item.id) as WordingItem['disposition'], note: field(d, 'review-note-' + item.id), question: field(d, 'question-' + item.id) }, e.currentTarget.id); }}><Select name={'disposition-' + item.id} label="Hasil review broker" defaultValue={item.disposition === 'unreviewed' ? 'retain' : item.disposition}>{Object.entries(dispositionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select><TextField name={'review-note-' + item.id} label="Catatan review wording" value={item.reviewNote} /><TextField name={'question-' + item.id} label="Pertanyaan yang belum selesai" value={item.question} required={false} /><Button type="submit">Simpan review wording</Button></form>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-link">Catat perubahan QS atau balasan {item.title}</summary><form id={'edit-' + item.id} className="space-y-4 pt-3" onSubmit={e => edit(e, item)}><TextField textarea name={'out-' + item.id} label="Wording QS persis" value={item.outgoing} /><EvidenceSelect state={state} type="QS" name={'out-doc-' + item.id} optionId={state.selectedOptionId} value={item.outgoingSource.documentVersionId} /><TextField textarea name={'reply-' + item.id} label="Wording balasan persis" value={item.reply} required={false} /><EvidenceSelect state={state} type="insurer-reply" name={'reply-doc-' + item.id} optionId={state.selectedOptionId} value={item.replySource?.documentVersionId} /><Select name={'direction-' + item.id} label="Arah perubahan" defaultValue={item.direction}><option value="retained">Dipertahankan</option><option value="enhancement">Enhancement baru</option><option value="withdrawal">Wording lama ditarik</option><option value="change">Berubah</option></Select><TextField name={'edit-note-' + item.id} label="Alasan versi wording baru" /><Button type="submit">Simpan versi wording baru</Button></form></details>
    </article>)}</div>
    <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-link">Tambah usulan enhancement terpisah</summary><form id="add-enhancement" className="space-y-4 pt-3" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget), text = field(d, 'enhancement-text'); const item: WordingItem = { id: 'enhancement-' + (current.items.length + 1), title: field(d, 'enhancement-title'), prior: '', priorSource: null, outgoing: text, outgoingSource: ref(field(d, 'enhancement-source'), text), reply: '', replySource: null, direction: 'enhancement', disposition: 'unreviewed', reviewNote: '', question: '' }; command({ type: 'reviseWording', items: [...current.items, item], note: field(d, 'enhancement-note') }, e.currentTarget.id); }}><TextField name="enhancement-title" label="Judul enhancement" /><TextField name="enhancement-text" label="Wording enhancement persis" textarea /><EvidenceSelect state={state} name="enhancement-source" type="QS" optionId={state.selectedOptionId} /><TextField name="enhancement-note" label="Alasan enhancement" /><Button type="submit">Simpan usulan enhancement</Button></form></details>
  </Panel>;
}
function Premiums({ terms }: { terms: Terms }) {
  return <div className="space-y-4">{terms.premiumLines.map(line => {
    const illustration = calculatePremium(line);
    return <div key={line.id} className="rounded-md border border-border-subtle p-4"><div className="mb-3 flex flex-wrap justify-between gap-2"><strong className="text-sm">{line.peril}</strong><Badge tone={line.included ? 'blue' : ''}>{line.included ? 'Termasuk' : 'Dikecualikan'}</Badge></div><dl className="data-pairs"><dt>Rate / basis</dt><dd>{formatDecimal(line.rate.value)}{line.rate.unit === 'percent' ? '%' : '‰'} · {money(line.basis)} · sum insured</dd><dt>Premi ilustratif</dt><dd>{illustration ? money(illustration) : 'Tidak dihitung: cover dikecualikan'}</dd><dt>Premi tercatat insurer</dt><dd>{line.recordedPremium ? money(line.recordedPremium) : 'Tidak ada premi tercatat'}</dd></dl></div>;
  })}<p className="small muted">{PREMIUM_ROUNDING} Premi ilustratif terpisah dari premi yang dicatat insurer; belum termasuk pajak dan biaya.</p></div>;
}
function TermsEditor({ state, command }: { state: RenewalCase; command: Command }) {
  const terms = state.terms;
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    command({ type: 'reviseTerms', note: field(d, 'terms-note'), terms: { ...terms, occupation: field(d, 'occupation'), periodStart: field(d, 'period-start'), periodEnd: field(d, 'period-end'), deductible: field(d, 'deductible'), additionalCoverage: field(d, 'coverage'), lossHistory: field(d, 'loss-history'),
      premiumLines: terms.premiumLines.map(line => ({ ...line, included: d.has('included-' + line.id), rate: { ...line.rate, value: field(d, 'rate-' + line.id), unit: field(d, 'unit-' + line.id) as 'percent' }, recordedPremium: field(d, 'recorded-' + line.id) ? { amount: field(d, 'recorded-' + line.id), currency: terms.currency } : null })) } }, e.currentTarget.id);
  }
  return <Panel title="Terms dan perhitungan premi" description="Rate disimpan persis dalam desimal, dengan unit dan peril."><Premiums terms={terms} /><details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-link">Ubah usulan terms</summary><form id="edit-terms" className="space-y-4 pt-3" onSubmit={save}><TextField name="occupation" label="Occupation" value={terms.occupation} /><div className="field-grid"><TextField name="period-start" label="Mulai pertanggungan" type="date" value={terms.periodStart} /><TextField name="period-end" label="Akhir pertanggungan" type="date" value={terms.periodEnd} /></div><TextField name="deductible" label="Deductible" textarea value={terms.deductible} /><TextField name="coverage" label="Perluasan / pengecualian" textarea value={terms.additionalCoverage} /><TextField name="loss-history" label="Riwayat klaim" value={terms.lossHistory} />{terms.premiumLines.map(line => <fieldset key={line.id} className="space-y-4 rounded-md border border-border-subtle p-4"><legend className="px-2 text-sm font-medium">{line.peril}</legend><label className="confirmation-checkbox"><input type="checkbox" name={'included-' + line.id} defaultChecked={line.included} /><span>Cover termasuk (rate terisi saja tidak menetapkan cover)</span></label><div className="field-grid"><TextField name={'rate-' + line.id} label={'Rate ' + line.peril + ' (desimal titik)'} value={line.rate.value} /><Select name={'unit-' + line.id} label={'Unit rate ' + line.peril} defaultValue={line.rate.unit}><option value="percent">Persen (%)</option><option value="per-mille">Per mil (‰)</option></Select></div><TextField name={'recorded-' + line.id} label={'Premi tercatat insurer ' + line.peril + ' (' + terms.currency + ')'} value={line.recordedPremium?.amount ?? ''} required={false} /></fieldset>)}<TextField name="terms-note" label="Alasan perubahan terms" /><Button primary type="submit">Simpan usulan terms</Button></form></details></Panel>;
}

function InsurerPanel({ state, command, open }: { state: RenewalCase; command: Command; open: (id: string) => void }) {
  const option = getSelectedOption(state), quote = getCurrentQuote(state), responses = getCurrentResponses(state);
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!quote) return;
    const d = new FormData(e.currentTarget), terms = structuredClone(state.terms), counter = field(d, 'response-rate');
    if (counter) terms.premiumLines[0].rate.value = counter;
    command({ type: 'recordInsurerResponse', response: { optionId: option.id, materialRevision: option.materialRevision, wordingVersion: option.wordingVersion, quoteId: quote.id,
      insurerId: field(d, 'insurer-id'), insurerName: field(d, 'insurer-name'), externalRespondent: field(d, 'external-respondent'), responseAt: field(d, 'response-date') + ':00+07:00',
      position: field(d, 'response-position') as 'accepted', sharePercent: field(d, 'response-share'), leader: d.has('response-leader'), terms,
      conditions: field(d, 'response-condition') ? [{ text: field(d, 'response-condition'), required: d.has('condition-required'), resolved: d.has('condition-resolved') }] : [],
      evidence: ref(field(d, 'response-source'), field(d, 'response-evidence'), field(d, 'response-locator')), note: field(d, 'response-note') } }, e.currentTarget.id);
  }
  return <><Panel title="Posisi panel per insurer" description="Outreach, persetujuan leader, dan kapasitas 100% adalah fakta terpisah. Alternatif tetap terpisah.">
    <Note highlight>Opsi: {option.name} · QS {quote?.id ?? 'belum disiapkan'} · basis material {option.materialRevision} · wording v{option.wordingVersion}. Respons dicatat oleh broker dari komunikasi eksternal.</Note>
    {!responses.length && <p className="small muted">Belum ada respons untuk versi QS ini.</p>}
    {responses.map(r => <article key={r.id} className="space-y-3 border-b border-border-subtle pb-4 last:border-0"><div className="flex flex-wrap justify-between gap-3"><strong className="text-sm">{r.insurerName} · {r.sharePercent}%{r.leader ? ' · Leader' : ''}</strong><Badge tone={r.position === 'accepted' && JSON.stringify(r.terms) === JSON.stringify(state.terms) ? 'green' : 'amber'}>{r.position === 'accepted' ? JSON.stringify(r.terms) === JSON.stringify(state.terms) ? 'Sesuai QS' : 'Terms berbeda' : r.position}</Badge></div><p className="small muted">Responden: {r.externalRespondent} · {eventDate(r.responseAt)} WIB<br />Dicatat: {r.recordedBy} · {r.quoteId} · {r.id}</p><p className="text-sm">{r.evidence.excerpt}</p><Citation state={state} source={r.evidence} open={open} />{r.conditions.map((c, i) => <p key={i} className="small">{c.required ? 'Wajib' : 'Diungkapkan'} · {c.resolved ? 'Selesai' : 'Belum selesai'}: {c.text}</p>)}</article>)}
    <p className="small muted">Riwayat: {state.insurerResponses.length} respons seluruh opsi / versi. Perubahan posisi dicatat sebagai respons baru.</p><details><summary className="min-h-11 cursor-pointer py-3 text-sm text-link">Lihat riwayat respons dan alternatif</summary><ol className="space-y-4 pt-3">{state.insurerResponses.map(r => <li key={r.id} className="text-sm"><strong>{r.insurerName} · {r.optionId} · {r.sharePercent}%</strong><p className="small muted">{r.position} · {r.quoteId} · wording v{r.wordingVersion} · {r.id}<br />{r.evidence.excerpt}</p></li>)}</ol></details>
    <Blockers blockers={getProposalBlockers(state)} />
  </Panel><Panel title="Catat respons insurer eksternal" description="Nama insurer dan responden eksternal dipisahkan dari broker yang mencatat."><form id="record-response" onSubmit={save} className="space-y-4">
    <div className="field-grid"><TextField name="insurer-id" label="ID insurer" value="insurer-a" /><TextField name="insurer-name" label="Nama insurer" value="Asuransi Fiktif A" /><TextField name="external-respondent" label="Responden eksternal insurer" /><TextField name="response-date" label="Waktu respons insurer (WIB)" type="datetime-local" value="2026-11-19T09:00" /><TextField name="response-share" label="Partisipasi (%) — desimal titik" value="100" /><Select name="response-position" label="Posisi insurer" defaultValue="accepted"><option value="accepted">Menerima QS</option><option value="pending">Menunggu / bersyarat</option><option value="outreach">Outreach saja</option><option value="declined">Menolak</option></Select></div>
    <label className="confirmation-checkbox"><input type="checkbox" name="response-leader" /><span>Insurer bertindak sebagai leader (tidak mewakili anggota lain)</span></label><EvidenceSelect state={state} name="response-source" type="insurer-reply" optionId={option.id} /><TextField name="response-locator" label="Halaman / bagian sumber respons" value="Email, paragraf persetujuan dan share" /><TextField name="response-evidence" label="Kutipan respons insurer persis" textarea /><TextField name="response-rate" label="Counter rate PAR (kosong jika sama dengan QS)" required={false} /><TextField name="response-condition" label="Kondisi insurer (bila ada)" textarea required={false} />
    <div className="space-y-2"><label className="confirmation-checkbox"><input type="checkbox" name="condition-required" defaultChecked /><span>Kondisi wajib dipenuhi sebelum DFS</span></label><label className="confirmation-checkbox"><input type="checkbox" name="condition-resolved" /><span>Pemenuhan kondisi tercantum dalam bukti respons ini</span></label></div><TextField name="response-note" label="Catatan pencatatan respons" required={false} /><Note>Respons ini mengacu {quote?.id ?? 'QS yang belum tersedia'}. Untuk memperbarui share atau kondisi, catat respons baru dengan sumbernya.</Note><Button primary type="submit" disabled={!quote} testId="record-response">Simpan respons eksternal</Button>
  </form></Panel></>;
}
function ClientData({ state, command, dirty }: { state: RenewalCase; command: Command; dirty: (id: string) => void }) {
  const proposal = getActiveProposal(state)!;
  const [inputs, setInputs] = useState<ClientLocationInput[]>(() => state.locations.map(l => ({ locationId: l.id, ...structuredClone(l.proposed ?? l.prior), confirmed: l.confirmation?.confirmed ?? false, evidence: l.confirmation?.source ?? '' })));
  function update(id: string, values: Partial<ClientLocationInput>) { setInputs(old => old.map(i => i.locationId === id ? { ...i, ...values } : i)); }
  return <form id="client-locations" className="space-y-6" onSubmit={e => { e.preventDefault(); command({ type: 'submitLocations', proposalId: proposal.id, locations: inputs }, e.currentTarget.id); }}>
    <Note highlight>Konfirmasikan data periode {period(proposal.terms)}, termasuk nilai dan alamat yang tetap. Hanya klien yang mengirim konfirmasi ini.</Note>
    {inputs.map(input => <fieldset key={input.locationId} className="space-y-4 border-t border-border-subtle pt-5"><legend className="px-2 text-sm font-semibold">{state.locations.find(l => l.id === input.locationId)!.prior.name}</legend>
      <div className="field-grid"><div><label htmlFor={'client-name-' + input.locationId}>Nama lokasi</label><input id={'client-name-' + input.locationId} value={input.name} onChange={e => update(input.locationId, { name: e.target.value })} required /></div><div><label htmlFor={'client-value-' + input.locationId}>Sum insured {input.sumInsured.currency} (desimal titik)</label><input id={'client-value-' + input.locationId} inputMode="decimal" value={input.sumInsured.amount} onChange={e => update(input.locationId, { sumInsured: { ...input.sumInsured, amount: e.target.value } })} required /></div></div>
      <div><label htmlFor={'client-address-' + input.locationId}>Alamat lokasi</label><textarea id={'client-address-' + input.locationId} value={input.address} onChange={e => update(input.locationId, { address: e.target.value })} /></div><div><label htmlFor={'client-evidence-' + input.locationId}>Sumber konfirmasi klien</label><textarea id={'client-evidence-' + input.locationId} value={input.evidence} onChange={e => update(input.locationId, { evidence: e.target.value })} /></div>
      <label className="confirmation-checkbox"><input type="checkbox" checked={input.confirmed} onChange={e => update(input.locationId, { confirmed: e.target.checked })} /><span>Saya mengonfirmasi nama, alamat, dan nilai lokasi ini untuk periode berjalan.</span></label>
    </fieldset>)}
    <div className="button-row"><Button disabled={isBindingComplete(state)} onClick={() => { setInputs(sampleClientResponse(state)); dirty('client-locations'); }}>Isi contoh: semua data tetap</Button><Button primary type="submit" testId="submit-client-locations" disabled={isBindingComplete(state) || proposal.terms.periodStart !== state.terms.periodStart || proposal.terms.periodEnd !== state.terms.periodEnd}>Kirim konfirmasi lokasi</Button></div>
  </form>;
}
function ProposalView({ state, role, command, dirty, locationsDirty = false }: { state: RenewalCase; role: Role; command: Command; dirty: (id: string) => void; locationsDirty?: boolean }) {
  const proposal = getActiveProposal(state);
  const decisionsBlocked = isBindingComplete(state) || locationsDirty || proposal?.revision !== state.revision || state.locations.some(l => !isCurrentConfirmation(state, l));
  return <><Panel title="Proposal aktif" description="Satu opsi dipublikasikan; proposal dan keputusan versi lama tetap tersedia.">
    {role === 'broker' && <><Blockers blockers={getProposalBlockers(state)} /><Button primary disabled={getProposalBlockers(state).length > 0} onClick={() => command({ type: 'publishProposal' })} testId="publish-proposal">Publikasikan proposal terbaru</Button></>}
    {proposal ? <><div className="flex flex-wrap items-center justify-between gap-3"><strong>Proposal v{proposal.version} · {proposal.optionId}</strong><Badge tone={proposal.revision === state.revision ? 'blue' : 'amber'}>{proposal.revision === state.revision ? 'Versi saat ini' : 'Perlu diperbarui'}</Badge></div><p className="small muted">{proposal.id} · revisi {proposal.revision} · wording v{proposal.wordingVersion} · {eventDate(proposal.at)} WIB<br />{proposal.terms.occupation} · {period(proposal.terms)}</p>
      <Premiums terms={proposal.terms} /><div className="space-y-3">{proposal.locations.map(l => <div key={l.id} className="rounded-md bg-surface-subtle p-4"><strong className="text-sm">{l.values.name} · {money(l.values.sumInsured)}</strong><p className="small muted">{l.values.address}<br />{l.currentConfirmed ? 'Dikonfirmasi saat publikasi' : 'Historis / belum dikonfirmasi untuk periode berjalan'}</p></div>)}</div>
      <div><h4 className="mb-3 text-sm font-semibold">Posisi insurer dan kondisi yang diungkapkan</h4>{proposal.responses.filter(r => r.position === 'accepted').map(r => <div key={r.id} className="mb-4 text-sm"><strong>{r.insurerName} · {r.sharePercent}%</strong>{r.conditions.length ? r.conditions.map((c, i) => <p key={i}>{c.text} — {c.required ? 'wajib' : 'diungkapkan'}, {c.resolved ? 'selesai' : 'belum selesai'}</p>) : <p className="muted">Tidak ada kondisi tercatat.</p>}</div>)}</div><div><h4 className="mb-3 text-sm font-semibold">Wording dan keputusan review</h4><ol className="clause-list">{proposal.wording.map(i => <li key={i.id}><span className="whitespace-pre-wrap">{i.outgoing}</span><p className="small muted">{dispositionLabels[i.disposition]}{i.replySource && ' · Balasan: ' + (i.reply || '(tidak dimuat)')}</p></li>)}</ol></div>
    </> : <Note>Broker belum mempublikasikan proposal. Klien mulai terlibat setelah tahap ini.</Note>}
    {role === 'broker' && <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-link">Riwayat proposal dan keputusan klien</summary><div className="space-y-4 pt-3">{state.proposals.map(p => <p key={p.id} className="small">v{p.version} · {p.optionId} · revisi {p.revision} · {p.id}{p.id === state.activeProposalId ? ' · aktif' : ' · disupersesi'}</p>)}<p className="small muted">{state.agreements.length} persetujuan · {state.instructions.length} instruksi · {state.submissions.length} pengiriman data; semuanya tetap tersimpan.</p></div></details>}
  </Panel>{role === 'client' && proposal && <><Panel title="Konfirmasi data periode berjalan"><ClientData state={state} command={command} dirty={dirty} /></Panel><Panel title="Keputusan klien atas proposal" description="Persetujuan proposal dan instruksi renewal dicatat terpisah. Tanggapan baru membuat keputusan sebelumnya perlu diperbarui.">
    {decisionsBlocked && <Note>Simpan konfirmasi setiap lokasi sebelum memberikan keputusan. Jika ada perubahan material, tunggu proposal terbaru dari broker.</Note>}
    <form id="client-decision" className="space-y-4" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget), submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; command({ type: submitter?.value === 'instruction' ? 'clientInstruct' : 'clientAgree', proposalId: proposal.id, evidence: field(d, 'client-decision-evidence') }, e.currentTarget.id); }}><TextField name="client-decision-evidence" label="Bukti keputusan / instruksi klien" textarea /><div className="button-row"><button type="submit" name="decision" value="agreement" disabled={decisionsBlocked} className="btn min-h-11 rounded-md border border-border-control px-4 py-2 text-sm disabled:opacity-50" data-testid="client-agree">Setujui proposal terbaru</button><button type="submit" name="decision" value="instruction" disabled={decisionsBlocked || getExportBlockers(state).some(b => b.id === 'client-agreement')} className="btn min-h-11 rounded-md border border-action-primary bg-action-primary px-4 py-2 text-sm text-action-primary-text disabled:opacity-50" data-testid="client-instruct">Berikan instruksi renewal</button></div></form>
  </Panel></>}</>;
}
function Reconciliation({ state, command }: { state: RenewalCase; command: Command }) {
  return <div className="space-y-5">{state.locations.map(l => <Panel key={l.id} title={l.prior.name} description="Broker mencocokkan data dan sumber, tanpa memberikan approval formal."><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-md border border-border-subtle p-4"><p className="small muted">Historis · periode sebelumnya</p><strong>{money(l.prior.sumInsured)}</strong><p className="small">{l.prior.name}<br />{l.prior.address}</p></div><div className="rounded-md border border-border-subtle p-4"><p className="small muted">Usulan periode berjalan</p><strong>{l.proposed ? money(l.proposed.sumInsured) : 'Menunggu klien'}</strong><p className="small">{l.proposed?.name}<br />{l.proposed?.address || 'Alamat belum dikonfirmasi'}</p></div></div><Badge tone={l.review === 'matched' ? 'green' : 'amber'}>{l.review === 'matched' ? 'Sudah dicocokkan' : l.review === 'followup' ? 'Perlu follow-up' : 'Belum dicocokkan'}</Badge><p className="small">Sumber klien: {l.confirmation?.source || 'Belum ada'}<br />{l.confirmation && l.confirmation.confirmedBy + ' · ' + l.confirmation.submissionId}</p><form id={'match-' + l.id} className="space-y-4" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); command({ type: 'reviewLocation', locationId: l.id, result: field(d, 'result-' + l.id) as 'matched', note: field(d, 'match-note-' + l.id) }, e.currentTarget.id); }}><Select name={'result-' + l.id} label="Hasil pencocokan" defaultValue="matched"><option value="matched">Cocok dengan bukti klien</option><option value="followup">Perlu klarifikasi</option></Select><TextField name={'match-note-' + l.id} label="Catatan pencocokan" value={l.reviewNote} /><Button type="submit" disabled={!l.proposed} testId={'match-' + l.id}>Simpan pencocokan</Button></form></Panel>)}</div>;
}

function Binding({ state, command }: { state: RenewalCase; command: Command }) {
  const dfs = getCurrentDfs(state), request = getCurrentBindingRequest(state);
  const participants = getCurrentResponses(state).filter(r => r.position === 'accepted');
  return <Panel title="Pengiriman dan acknowledgment binding" description="Broker mencatat komunikasi eksternal. Konfirmasi leader tidak mewakili seluruh panel.">
    <Badge tone={getCoverageStatus(state) === 'Terjadwal' || getCoverageStatus(state) === 'Aktif' ? 'green' : 'amber'}>{getCoverageStatus(state)}</Badge>
    {request ? <p className="small">Pengiriman {request.id} · DFS {request.dfsId}<br />{request.dispatch.channel} · {request.dispatch.reference}<br />{request.dispatch.recipient} · {eventDate(request.dispatch.sentAt)} WIB</p> : <form id="binding-dispatch" className="space-y-4" onSubmit={e => { e.preventDefault(); if (!dfs) return; const d = new FormData(e.currentTarget); command({ type: 'requestBinding', dfsId: dfs.id, dispatch: { channel: field(d, 'dispatch-channel'), reference: field(d, 'dispatch-reference'), recipient: field(d, 'dispatch-recipient'), sentAt: field(d, 'dispatch-time') + ':00+07:00' } }, e.currentTarget.id); }}><TextField name="dispatch-channel" label="Kanal pengiriman eksternal" value="Email" /><TextField name="dispatch-reference" label="Referensi pengiriman binding" /><TextField name="dispatch-recipient" label="Penerima pengiriman binding" /><TextField name="dispatch-time" label="Waktu pengiriman (WIB)" type="datetime-local" /><Button primary type="submit" disabled={getBindingBlockers(state).length > 0} testId="request-binding">Catat pengiriman binding</Button></form>}
    <div className="space-y-3">{participants.map(r => <p key={r.id} className="text-sm"><strong>{r.insurerName} · {r.sharePercent}%</strong><br />{request && state.bindingAcknowledgments.some(a => a.requestId === request.id && a.insurerId === r.insurerId) ? 'Acknowledgment versi ini tercatat' : 'Menunggu acknowledgment anggota ini'}</p>)}</div>
    {request && <form id="binding-ack" className="space-y-4 border-t border-border-subtle pt-5" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); command({ type: 'acknowledgeBinding', requestId: request.id, insurerId: field(d, 'ack-insurer'), externalRespondent: field(d, 'ack-respondent'), evidence: ref(field(d, 'ack-source'), field(d, 'ack-evidence'), 'Acknowledgment untuk ' + request.id + ' / ' + request.dfsId) }, e.currentTarget.id); }}><Note>Bukti harus menyebut pengiriman {request.id}, DFS {request.dfsId}, dan opsi {request.optionId}.</Note><Select name="ack-insurer" label="Anggota panel yang memberikan acknowledgment">{participants.map(r => <option key={r.insurerId} value={r.insurerId}>{r.insurerName}</option>)}</Select><TextField name="ack-respondent" label="Responden eksternal binding" /><EvidenceSelect state={state} name="ack-source" type="binding-evidence" optionId={state.selectedOptionId} /><TextField name="ack-evidence" label="Kutipan acknowledgment binding" textarea /><Button type="submit" testId="acknowledge-binding">Simpan acknowledgment anggota</Button></form>}
    <Note>Periode pertanggungan: {period(state.terms)}. Status mengikuti periode dan acknowledgment setiap peserta, bukan tanggal tombol diklik.</Note>
  </Panel>;
}

export default function App() {
  const store=useRenewalCase();
  return <RenewalWorkspace store={store} />;
}
export function RenewalWorkspace({store,account}:{store:WorkspaceStore;account?:AccountControls}) {
  const { state, error, dispatch, reset, clearError, storageError, recoveryRequired } = store;
  const [formEpoch,setFormEpoch]=useState(0);
  const [pendingCheck,setPendingCheck]=useState<{key:CheckKey;checked:boolean}|null>(null);
  const [stage, setStage] = useState<Stage>('materials'), [role, setRole] = useState<Role>('broker');
  const [source, setSource] = useState<string | null>(null), [status, setStatus] = useState(''), [downloadError, setDownloadError] = useState('');
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [hasDrafts, setHasDrafts] = useState(false);
  const dirtyForms = useRef(new Set<string>()), mobileNavigation = useRef<HTMLDetailsElement>(null), mainHeading = useRef<HTMLHeadingElement>(null), errorNotice = useRef<HTMLDivElement>(null), previousStage = useRef(stage);
  const { tourOpen, openTour, closeTour } = useTour();
  const option = getSelectedOption(state), quote = getCurrentQuote(state), proposal = getActiveProposal(state), dfs = getCurrentDfs(state);
  const locked = isBindingComplete(state);
  const sourceBlockers=(action:CaseAction):Blocker[]=>account?requiredSourceIds(state,action).filter(id=>!state.documents.find(d=>d.id===id)?.file).map(id=>({id:'file-'+id,stage:'materials',label:'Broker: unggah dan finalisasi '+(state.documents.find(d=>d.id===id)?.name??id)+'.'})):[];
  const qsBlockers = [...getQsBlockers(state),...sourceBlockers({type:'prepareQuote'})], proposalBlockers = [...getProposalBlockers(state),...sourceBlockers({type:'publishProposal'})], exportBlockers = [...getExportBlockers(state),...sourceBlockers({type:'issueDfs'})], bindingBlockers = getBindingBlockers(state);
  const stageIndex = STAGES.findIndex(s => s.id === stage), stageInfo = STAGES[stageIndex];
  function discardDrafts(formId?: string) {
    const otherDrafts = [...dirtyForms.current].some(id => id !== formId);
    return !otherDrafts || window.confirm('Ada isian yang belum disimpan. Buang isian tersebut untuk melanjutkan?');
  }
  function committed() {
    dirtyForms.current.clear();setHasDrafts(false);setFormEpoch(n=>n+1);
    setStatus('Perubahan tersimpan. Riwayat dan bukti versi sebelumnya tetap tersedia.');setDownloadError('');
  }
  async function command(action: CaseAction, formId?: string) {
    if (busyRef.current || account?.pending || !discardDrafts(formId)) return false;
    busyRef.current=true;setBusy(true);
    if(action.type==='setCheck')setPendingCheck({key:action.check,checked:action.checked});
    try{if (!await dispatch(LOCAL_ACTORS[role], action)) return false;committed();return true;}
    finally{busyRef.current=false;setBusy(false);setPendingCheck(null);}
  }
  const fileAccount=account?{...account,onUpload:async(id:string,file:File)=>{
    if(busyRef.current || !discardDrafts('upload-'+id))return false;
    const result=await account.onUpload(id,file);if(result)committed();return result;
  }}:undefined;
  function navigate(target: Stage) {
    if (busyRef.current || target === stage || !discardDrafts()) return;
    dirtyForms.current.clear();
    setHasDrafts(false);
    setStage(target);
    setStatus('');
    mobileNavigation.current?.removeAttribute('open');
  }
  function changeRole(value: Role) {
    if (busyRef.current || !discardDrafts()) return;
    dirtyForms.current.clear();
    setHasDrafts(false);
    setRole(value);
    setSource(null);
    if (value === 'client') setStage('proposal');
    clearError();
    setStatus('');
  }
  function resetCase() {
    if (busyRef.current || !reset()) return;
    dirtyForms.current.clear();
    setHasDrafts(false);
    setRole('broker');
    setStage('materials');
    setSource(null);
    setStatus('Kasus fiktif versi baru dimulai.');
  }
  async function download(kind: 'QS' | 'DFS') {
    if (busyRef.current || !discardDrafts()) return;
    busyRef.current = true;
    setBusy(true);
    setDownloadError('');
    try {
      if(account){if(await account.onExport(kind))committed();return;}
      const exports = await import('./downloads');
      if (kind === 'QS') await exports.exportQuoteDocx(state); else await exports.exportRenewalDocx(state);
      busyRef.current = false;
      const snapshotId = kind === 'QS' ? quote!.id : dfs!.id;
      if (await command({ type: 'recordExport', kind, snapshotId })) setStatus('Unduhan ' + kind + ' disiapkan. Periksa dokumen sebelum menggunakannya.');
    } catch (cause) { setDownloadError(cause instanceof Error ? cause.message : 'Dokumen belum dapat diunduh.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function summary() {
    try { (await import('./downloads')).exportSessionSummary(state); }
    catch (cause) { setDownloadError(cause instanceof Error ? cause.message : 'Ringkasan belum dapat diunduh.'); }
  }
  useEffect(() => {
    if (previousStage.current !== stage) { mainHeading.current?.focus(); previousStage.current = stage; }
  }, [stage]);
  useEffect(() => { if (error || downloadError) errorNotice.current?.focus(); }, [error, downloadError]);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) { if (dirtyForms.current.size) e.preventDefault(); }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const next = qsBlockers.length || !quote ? { stage: 'materials' as Stage, title: 'Tinjau sumber dan siapkan QS', detail: 'Data historis boleh masuk QS dengan label belum dikonfirmasi.' }
    : proposalBlockers.length ? { stage: 'insurer' as Stage, title: 'Catat posisi insurer untuk opsi ini', detail: 'Panel harus merujuk QS dan wording yang sama; alternatif tidak digabung.' }
    : !proposal || proposal.revision !== state.revision ? { stage: 'proposal' as Stage, title: 'Publikasikan proposal terbaru', detail: 'Klien mulai mengonfirmasi data setelah proposal dipublikasikan.' }
    : exportBlockers.length ? { stage: exportBlockers[0].stage, title: exportBlockers[0].label, detail: 'Selesaikan konfirmasi, keputusan, kondisi, dan pencocokan sebelum DFS.' }
    : { stage: 'final' as Stage, title: dfs ? 'Catat pengiriman dan acknowledgment setiap insurer' : 'Siapkan DFS versi terkini', detail: 'Instruksi klien, pengiriman broker, dan acknowledgment insurer adalah catatan terpisah.' };
  function stageNav() {
    return <nav className="stage-nav grid gap-2" aria-label="Tahap renewal">{STAGES.map((item, index) => <button key={item.id} type="button" disabled={role === 'client' && item.id !== 'proposal'} className={'stage-link group flex min-h-11 w-full items-start gap-3 rounded-md border px-3 py-3 text-left text-sm transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50 motion-reduce:transition-none max-[800px]:items-center ' + (item.id === stage ? 'border-border-subtle bg-surface-selected text-text-primary' : 'border-transparent text-text-secondary enabled:hover:bg-surface-subtle')} aria-current={stage === item.id ? 'step' : undefined} onClick={() => navigate(item.id)}><span className={'stage-number flex size-6 shrink-0 items-center justify-center rounded-md text-[13px] ' + (item.id === stage ? 'bg-action-primary text-action-primary-text' : 'bg-surface-subtle text-text-secondary')}>{index + 1}</span><span>{item.label}</span></button>)}</nav>;
  }
  const markDirty = (id: string) => { dirtyForms.current.add(id); setHasDrafts(true); };
  const context = <aside className="context-column"><Panel title="Kesiapan per keluaran"><dl className="data-pairs"><dt>QS</dt><dd>{qsBlockers.length ? qsBlockers.length + ' penghambat' : quote ? quote.id : 'Siap disiapkan'}</dd><dt>Proposal</dt><dd>{proposalBlockers.length ? proposalBlockers.length + ' penghambat' : 'Panel sesuai 100%'}</dd><dt>DFS</dt><dd>{exportBlockers.length ? exportBlockers.length + ' penghambat' : dfs?.id ?? 'Siap disiapkan'}</dd></dl><button type="button" className="text-button" onClick={() => navigate('final')}>Lihat rincian kesiapan <Icon name="arrow" /></button><p className="small muted">Revisi material {state.revision} · versi simpan {state.lockVersion}</p></Panel><Panel title="Aktivitas terbaru"><ol className="activity-list">{state.activity.slice(-4).reverse().map(a => <li key={a.id} className="activity-item"><p>{a.label}</p><time>{eventDate(a.at)} WIB · {a.actor.id}</time></li>)}</ol></Panel></aside>;
  return <><a className="skip-link" href="#main">Langsung ke workspace</a><div className="app-shell bg-canvas text-text-primary"><aside className="sidebar border-border-subtle bg-surface"><div className="brand px-1 pb-8"><img src="/assets/logos/logotype-light-mode.svg" width="435" height="85" className="h-auto w-40 max-w-full" alt="Rekonvia" /></div><div className="sidebar-section-label">Workspace renewal</div>{stageNav()}<div className="sidebar-bottom"><div className="sidebar-case"><Icon name="building" /><strong>{account ? 'Kasus brokerage' : 'Satu kasus fiktif'}</strong><span>{state.id} · PAR</span></div>{!account && <button className="text-button" onClick={openTour}><Icon name="help" />Ulangi tur</button>}<button className="text-button" onClick={summary}><Icon name="download" />Ringkasan sesi</button><p className="sidebar-footer">{account ? 'Akun broker · tersimpan di server' : 'Simulasi lokal · akun nyata menyusul'}<br />Data fiktif · komunikasi eksternal dicatat manual</p></div></aside><div className="app-body"><header className="topbar border-border-subtle bg-surface"><div className="breadcrumb"><img src="/assets/logos/logotype-light-mode.svg" width="435" height="85" className="h-auto w-28 min-[801px]:hidden" alt="Rekonvia" /><Icon name="building" className="hidden min-[801px]:block" /><strong>{state.id}</strong><span className="crumb-stage">/ {stageInfo.label}</span></div>{account ? <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 text-sm"><span className="max-w-48 break-words text-text-secondary">Broker · {account.email}</span><button className="text-button" onClick={()=>{if(discardDrafts())account.onBack();}}>Daftar kasus</button><button className="text-button" onClick={account.onLogout}>Keluar</button></div> : <div className="role-control"><label htmlFor="role-select" className="simulation-label"><Icon name="users" /><span>Peran simulasi</span></label><select id="role-select" className="role-select border-border-control bg-surface text-base text-text-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring sm:text-sm" value={role} onChange={e => changeRole(e.target.value as Role)} data-testid="role-select"><option value="broker">Broker · Nusa Risk Partners</option><option value="client" disabled={!proposal}>Klien{!proposal ? ' (setelah proposal)' : ''}</option></select></div>}</header><details className="mobile-stage-nav" ref={mobileNavigation}><summary>Tahap {stageIndex + 1} dari 5 · {stageInfo.label}</summary>{stageNav()}<div className="button-row px-4 pb-3">{!account && <button className="text-button" onClick={openTour}>Ulangi tur</button>}<button className="text-button" onClick={summary}>Ringkasan sesi</button></div></details>
    <main id="main" className="workspace" tabIndex={-1}><div className="case-heading"><div><p className="eyebrow">Property All Risks · Renewal</p><h1>{state.clientName}</h1><div className="case-meta"><span>{state.id}</span><span><Icon name="calendar" />{period(state.terms)}</span><span>Revisi {state.revision} · versi simpan {state.lockVersion}</span></div></div><div className="case-heading-status"><Badge tone="blue">{getCoverageStatus(state)}</Badge><p>Data fiktif · {account?'akun broker':'simulasi lokal'}</p></div></div>
      {account && <div className="mb-5 space-y-3 rounded-lg border border-border-subtle bg-surface p-4 text-sm"><p>{account.conflict ? 'Versi berubah. Isian belum disimpan tetap tersedia; tinjau versi terbaru sebelum mengirim kembali.' : 'Perubahan disimpan melalui server. Muat ulang untuk melihat aktivitas sesi lain; isian Anda tetap tersedia.'}</p><div className="button-row"><Button onClick={()=>{void account.onReload();}} disabled={account.pending || account.retryAvailable}>Muat ulang versi terbaru</Button>{account.retryAvailable && <Button primary onClick={async()=>{if(await account.onRetry())committed();}} disabled={account.pending}>Coba ulang tindakan yang sama</Button>}</div></div>}
      {storageError && <div className="notice mb-5 rounded-lg border border-status-pending-fg/20 bg-status-pending-bg p-4 text-sm text-status-pending-fg" role="alert"><strong>Penyimpanan browser</strong><p>{storageError}</p>{recoveryRequired && <div className="button-row mt-4"><Button onClick={() => { try { downloadStoredBackup(); } catch (cause) { setDownloadError(String(cause)); } }}>Unduh cadangan data lama</Button><Button onClick={resetCase}>Mulai kasus versi baru</Button></div>}</div>}
      {(error || downloadError) && <div ref={errorNotice} tabIndex={-1} role="alert" className="notice error mb-5 flex gap-3 rounded-lg border border-status-blocked-fg/20 bg-status-blocked-bg p-4 text-sm text-status-blocked-fg"><div className="min-w-0 flex-1"><strong>Periksa kembali</strong><p>{error || downloadError}</p></div><button type="button" className="text-button" aria-label="Tutup pesan kesalahan" onClick={() => { clearError(); setDownloadError(''); }}><Icon name="close" /></button></div>}
      {status && <div role="status" className="notice success mb-5 rounded-lg border border-status-confirmed-fg/20 bg-status-confirmed-bg p-4 text-sm text-status-confirmed-fg">{status}</div>}
      {locked && <div role="status" className="mb-5 rounded-lg border border-status-confirmed-fg/20 bg-status-confirmed-bg p-4 text-sm text-status-confirmed-fg">Acknowledgment setiap anggota panel telah dicatat. Data renewal terkunci; sumber, unduhan, dan catatan sesi tetap tersedia.</div>}{role === 'broker' && <><div className="next-action"><div className="next-action-icon"><Icon name="arrow" /></div><div className="next-action-text"><strong>{next.title}</strong><p>{next.detail}</p></div><button className="text-button" onClick={() => navigate(next.stage)}>Buka tahap <Icon name="arrow" /></button></div><div className="mb-6 rounded-lg border border-border-subtle bg-surface p-4"><label htmlFor="selected-option">Opsi quotation aktif</label><select id="selected-option" disabled={locked} value={state.selectedOptionId} className="min-h-11 w-full rounded-md border border-border-control px-3 text-base" onChange={e => { if (e.target.value !== state.selectedOptionId) command({ type: 'selectOption', optionId: e.target.value }); }}>{state.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select><p className="field-help">Memilih opsi lain menyupersesi proposal aktif. Alternatif 100% tidak dijumlahkan.</p></div></>}
      <div className="stage-heading"><div><span className="stage-step">Tahap {stageIndex + 1} dari 5</span><h2 tabIndex={-1} ref={mainHeading}>{stageInfo.label}</h2><p>{stageInfo.description}</p></div></div>
      <div className={role === 'broker' ? 'stage-grid' : ''}><fieldset disabled={busy || !!account?.pending || !!account?.retryAvailable || recoveryRequired} className="main-column min-w-0 border-0 p-0" key={role + '-' + stage + '-' + (account?formEpoch:state.lockVersion)} onChangeCapture={e => { const form = (e.target as HTMLElement).closest('form'); if (form) markDirty(form.id); }}>
        {role === 'client' ? <ProposalView state={state} role={role} command={command} dirty={markDirty} locationsDirty={hasDrafts && dirtyForms.current.has('client-locations')} /> : stage === 'materials' ? <><Panel title="Siapkan quotation slip (QS)" description="Tinjau wording dan sumber sebelum QS; konfirmasi klien diminta setelah proposal."><Note highlight>Lokasi dan sum insured pada sumber lama tetap historis / belum dikonfirmasi untuk periode berjalan.</Note><Blockers blockers={qsBlockers} navigate={navigate} /><div className="button-row"><Button primary onClick={() => command({ type: 'prepareQuote' })} disabled={qsBlockers.length > 0 || !!quote} testId="send-quote">Siapkan QS</Button><Button onClick={() => download('QS')} disabled={!quote || qsBlockers.length > 0} icon="download" testId="export-qs">Unduh QS Word</Button></div>{quote && <p className="small muted">{quote.id} · opsi {option.id} · wording v{quote.wordingVersion}</p>}</Panel><SourceInventory state={state} open={setSource} command={command} account={fileAccount} /><WordingReview state={state} command={command} open={setSource} /><TermsEditor state={state} command={command} /></> : stage === 'insurer' ? <><InsurerPanel state={state} command={command} open={setSource} /><WordingReview state={state} command={command} open={setSource} /><TermsEditor state={state} command={command} /></> : stage === 'proposal' ? <ProposalView state={state} role={role} command={command} dirty={markDirty} /> : stage === 'reconciliation' ? <Reconciliation state={state} command={command} /> : <><Panel title="Kesiapan DFS" description="Perlu konfirmasi risiko, persetujuan proposal, instruksi klien, bukti panel, dan pemeriksaan broker."><Blockers blockers={exportBlockers} navigate={navigate} /><div className="checklist">{(Object.entries(BROKER_CHECKS) as [CheckKey, string][]).map(([key, title]) => <label key={key}><input type="checkbox" checked={pendingCheck?.key===key?pendingCheck.checked:state.checks[key]} aria-busy={pendingCheck?.key===key} disabled={exportBlockers.some(b => !b.id.startsWith('check-'))} onChange={e => command({ type: 'setCheck', check: key, checked: e.target.checked })} data-testid={'check-' + key} /><span>{title}</span></label>)}</div><div className="button-row"><Button primary onClick={() => command({ type: 'issueDfs' })} disabled={exportBlockers.length > 0} testId="issue-dfs">Siapkan DFS versi terkini</Button><Button onClick={() => download('DFS')} disabled={!dfs || exportBlockers.length > 0} testId="export-word" icon="download">Unduh DFS Word</Button></div>{dfs && <p className="small muted">{dfs.id} · {dfs.proposalId} · revisi {dfs.revision}</p>}<Blockers blockers={bindingBlockers.filter(b => !exportBlockers.some(e => e.id === b.id))} navigate={navigate} /></Panel><Binding state={state} command={command} /><Panel title="Catatan sesi"><form id="session-notes" className="space-y-4" onSubmit={e => { e.preventDefault(); command({ type: 'saveNotes', notes: field(new FormData(e.currentTarget), 'notes') }, e.currentTarget.id); }}><TextField name="notes" label="Catatan observasi dan pertanyaan" value={state.notes} textarea required={false} /><Button type="submit">Simpan catatan sesi</Button></form><button type="button" className="text-button" onClick={summary}>Unduh ringkasan sesi <Icon name="download" /></button></Panel></>}
      </fieldset>{role === 'broker' && context}</div><footer className="workspace-footer"><span><Icon name={storageError ? 'circle' : 'check'} />{storageError ? 'Periksa penyimpanan di atas' : account?'Progres tersimpan di server':'Progres tersimpan di browser ini'} · data fiktif</span>{!account && <button type="button" className="text-button" onClick={resetCase} data-testid="reset-case"><Icon name="refresh" />Mulai ulang kasus</button>}</footer>
    </main></div></div><SourceDialog id={source} state={state} onClose={() => setSource(null)} />{!account && <Tour open={tourOpen} onClose={closeTour} />}</>;
}
