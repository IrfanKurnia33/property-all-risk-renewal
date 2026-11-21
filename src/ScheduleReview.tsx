import { useState } from 'react';
import type { FormEvent } from 'react';
import { getCurrentSchedule, getScheduleRowIssues, isCurrentConfirmation } from './domain.ts';
import type { CaseAction, DocumentVersion, RenewalCase, ScheduleField, ScheduleRow, ScheduleRowData } from './domain.ts';
import { t } from './i18n.ts';
import { createScheduleTemplate, importScheduleWorkbook } from './schedule-import.ts';
import { FileControls } from './FileControls.tsx';

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Command = (action: CaseAction, formId?: string) => Promise<boolean>;

export function ScheduleReview({ state, busy, onCommand, onReadEvidence, onCreateAndUpload, onUpload, onDownload }: {
  state: RenewalCase
  busy: boolean
  onCommand: Command
  onReadEvidence: (id: string) => Promise<Blob>
  onCreateAndUpload: (file: File, periodStart: string, periodEnd: string) => Promise<boolean>
  onUpload: (id: string, file: File) => Promise<boolean>
  onDownload: (id: string) => Promise<void>
}) {
  const finalized = state.documents.filter(document => document.type === 'schedule' && document.file?.mimeType === xlsxMime);
  const pending = state.documents.filter(document => document.type === 'schedule' && !document.file);
  const [selectedId, setSelectedId] = useState(finalized.at(-1)?.id ?? '');
  const [periodStart, setPeriodStart] = useState(state.terms.periodStart);
  const [periodEnd, setPeriodEnd] = useState(state.terms.periodEnd);
  const [preview, setPreview] = useState<{ document: DocumentVersion; rows: ScheduleRow[]; warnings: string[] }>();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const source = finalized.find(document => document.id === selectedId);
  const current = getCurrentSchedule(state);

  async function downloadTemplate() {
    try {
      const { downloadBlob } = await import('./downloads.ts');
      downloadBlob(await createScheduleTemplate(), 'Rekonvia-property-schedule-template.xlsx');
      setMessage('Template downloaded.');
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The XLSX template could not be created.'); }
  }
  async function prepare(document: DocumentVersion) {
    setWorking(true); setMessage('Reading the finalized source and checking XLSX rows…');
    try {
      if (!document.file) throw new Error('Berkas schedule belum difinalisasi.');
      const blob = await onReadEvidence(document.id);
      const imported = await importScheduleWorkbook(new File([blob], document.name, { type: document.file.mimeType }));
      setPreview({ document, rows: imported.rows, warnings: imported.warnings });
      setMessage('Rows are ready for review. Imported values are not client confirmation.');
    } catch (error) {
      setPreview(undefined);
      setMessage(error instanceof Error ? error.message : 'The schedule XLSX could not be read.');
    } finally { setWorking(false); }
  }
  function updateRow(rowId: string, field: ScheduleField, value: string) {
    setPreview(previous => previous && ({ ...previous, rows: previous.rows.map(row => row.id === rowId
      ? { ...row, values: { ...row.values, [field]: value } } : row) }));
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!preview?.document.file) return;
    void onCommand({
      type: 'saveSchedule', sourceDocumentVersionId: preview.document.id,
      sourceSha256: preview.document.file.sha256, rows: preview.rows,
    }, e.currentTarget.id);
  }

  return <section className="min-w-0 space-y-5 rounded-lg border border-border-subtle bg-surface p-4 min-[561px]:p-5">
    <header className="space-y-2"><h3 className="text-base font-semibold">{t('Import and review property schedule')}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{t('Upload a completed XLSX, review every row, and save an immutable broker-reviewed version before preparing the QS.')}</p>
    </header>
    <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn inline-flex min-h-11 items-center gap-2 rounded-md border border-border-control bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-subtle" onClick={() => void downloadTemplate()}>{t('Download XLSX template')}</button>
      <span className="text-[13px] text-text-secondary">{t('Maximum 10 MiB and 200 rows per reviewed version.')}</span></div>
    <div className="rounded-md bg-surface-selected p-4 text-[13px] leading-relaxed text-text-secondary">
      {t('Imported schedules are broker source material, not client confirmation. Rates do not establish coverage, applicability, or legal compliance; no OJK reference match is available in this pilot.')}
      <br />{t('The client has not confirmed occupancy through the current location-confirmation flow.')}
    </div>
    <div className="grid min-w-0 gap-4 min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[760px]:items-end">
      <label className="grid min-w-0 gap-1.5 text-sm font-medium"><span>{t('Finalized schedule XLSX')}</span>
        <select className="min-h-11 min-w-0 rounded-md border border-border-control bg-surface px-3 text-base" value={selectedId} onChange={event => { setSelectedId(event.target.value); setPreview(undefined); setMessage(''); }}>
          <option value="">{t('Select a finalized schedule')}</option>
          {finalized.map(document => <option key={document.id} value={document.id}>{document.name} · {document.periodStart} – {document.periodEnd}</option>)}
        </select>
      </label>
      <button type="button" className="btn min-h-11 rounded-md border border-border-control bg-surface px-4 py-2.5 text-sm font-medium enabled:hover:bg-surface-subtle disabled:opacity-50" onClick={() => source && void prepare(source)} disabled={!source || busy || working}>{t('Prepare rows for review')}</button>
    </div>
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-link">{t('Upload a completed schedule XLSX')}</summary>
      <form id="schedule-upload" className="grid gap-4 pt-3" onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget, file = new FormData(form).get('schedule-file');
          if (!(file instanceof File) || !file.name.toLocaleLowerCase().endsWith('.xlsx')) { setMessage('Choose an .xlsx file.'); return; }
          if (periodStart > periodEnd) { setMessage('The start date must be on or before the end date.'); return; }
          setWorking(true); setMessage('Saving the source and uploading the XLSX…');
        try {
          const uploaded = await onCreateAndUpload(file, periodStart, periodEnd);
          if (uploaded) setMessage('XLSX finalized. Select the new version above and prepare its rows for review.');
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'The schedule XLSX could not be uploaded.');
        } finally { setWorking(false); }
      }}>
        <p className="text-[13px] leading-relaxed text-text-secondary">{t('Use the schedule period shown in the source. A prior-period schedule can be saved for comparison but cannot unlock the current QS.')}</p>
        <div className="grid min-w-0 gap-4 min-[561px]:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium"><span>{t('Schedule period starts')}</span><input type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} required /></label>
          <label className="grid gap-1.5 text-sm font-medium"><span>{t('Schedule period ends')}</span><input type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} required /></label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium"><span>{t('Schedule XLSX file')}</span><input name="schedule-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
        <button type="submit" className="btn min-h-11 justify-self-start rounded-md border border-action-primary bg-action-primary px-4 py-2.5 text-sm font-medium text-action-primary-text enabled:hover:bg-action-primary-hover disabled:opacity-50" disabled={busy || working}>{t('Upload and finalize XLSX')}</button>
      </form>
    </details>
    {!!pending.length && <div className="space-y-3 rounded-md border border-border-subtle p-4"><h4 className="text-sm font-semibold">{t('Schedule uploads awaiting a file')}</h4>{pending.map(document => <div key={document.id} className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 text-[13px] text-text-secondary">{document.name} · {document.periodStart} – {document.periodEnd}</div><FileControls document={document} upload={onUpload} download={onDownload} busy={busy || working} /></div>)}</div>}
    {current && <p className="text-[13px] leading-relaxed text-text-secondary">    {t('Current reviewed schedule')}: v{current.version} · {current.periodStart} – {current.periodEnd} · {current.rows.length} {t('rows')}</p>}
    {message && <p role="status" className="text-[13px] leading-relaxed text-text-secondary">{t(message)}</p>}
    {!!preview && <>
      <div className="space-y-2 rounded-md border border-border-subtle p-4 text-[13px] leading-relaxed">
        <strong className="text-sm">{preview.document.name} · {preview.rows.length} {t('rows')}</strong>
        <p>{t('Source period')}: {preview.document.periodStart} – {preview.document.periodEnd} · {t('Source SHA-256')}: <span className="break-all font-mono">{preview.document.file?.sha256}</span></p>
        {preview.document.periodStart !== state.terms.periodStart || preview.document.periodEnd !== state.terms.periodEnd
          ? <p className="text-status-pending-fg">{t('This is not the current renewal period. It can be retained for comparison, but a matching-period schedule is still required for the QS.')}</p>
          : <p>{t('Current renewal period schedule. All rows still require broker review.')}</p>}
        {preview.warnings.map((warning, index) => <p key={index} className="text-status-pending-fg">{localizedImportWarning(warning)}</p>)}
      </div>
      <form id="schedule-review" className="space-y-4" onSubmit={save}>
        {preview.rows.map((row, index) => {
          const issues = scheduleRowIssues(row, state.terms.currency);
          const previous = previousMatch(state, preview.document, row);
          const client = clientMatch(state, row);
          return <details key={row.id} className="rounded-md border border-border-subtle">
            <summary className="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="min-w-0 font-medium">{index + 1}. {row.values.locationName || t('Location name missing')} · {row.values.currency} {row.values.sumInsured || '—'}</span>
              <span className={issues.length ? 'text-status-pending-fg' : 'text-status-confirmed-fg'}>{issues.length ? `${issues.length} ${t('fields need correction')}` : t('Ready for broker review')}</span>
            </summary>
            <div className="space-y-4 border-t border-border-subtle p-4">
              <p className="text-[13px] leading-relaxed text-text-secondary">{t('Imported from')} {row.source.sheetName} · {t('row')} {row.source.rowNumber} · {t('cells')} {Object.values(row.source.cells).join(', ') || '—'}{row.source.hidden ? ` · ${t('hidden row')}` : ''}</p>
              {!!row.warnings.length && <ul className="list-disc space-y-1 pl-5 text-[13px] text-status-pending-fg">{row.warnings.map(warning => <li key={warning}>{localizedImportWarning(warning)}</li>)}</ul>}
              <div className="grid min-w-0 gap-4 min-[680px]:grid-cols-2">
                {fieldList.map(([field, label, multiline]) => <label key={field} className={`grid min-w-0 gap-1.5 text-sm font-medium ${multiline ? 'min-[680px]:col-span-2' : ''}`}>
                  <span>{t(label)}</span>
                  {field === 'rateUnit' ? <select value={row.values.rateUnit} onChange={event => updateRow(row.id, field, event.target.value)}>
                    <option value="">{t('Select explicit unit')}</option>
                    {!['', 'percent', 'per-mille'].includes(row.values.rateUnit) && <option value={row.values.rateUnit}>{row.values.rateUnit} · {t('unrecognized')}</option>}
                    <option value="percent">{t('Percent (%)')}</option><option value="per-mille">{t('Per-mille (‰)')}</option>
                  </select> : multiline ? <textarea rows={2} value={row.values[field]} onChange={event => updateRow(row.id, field, event.target.value)} />
                    : <input inputMode={field === 'sumInsured' || field === 'rate' ? 'decimal' : undefined} value={row.values[field]} onChange={event => updateRow(row.id, field, event.target.value)} />}
                  {row.values[field] !== row.imported[field] && <span className="text-[12px] font-normal text-text-secondary">{t('Imported value')}: {row.imported[field] || '—'}</span>}
                </label>)}
              </div>
              {!!issues.length && <ul className="list-disc space-y-1 pl-5 text-[13px] text-status-pending-fg" aria-label={t('Fields requiring correction')}>{issues.map(issue => <li key={issue}>{t(issue)}</li>)}</ul>}
              <p className="rounded-md bg-surface-subtle p-3 text-[13px] leading-relaxed text-text-secondary">{previous.message} {client.message}</p>
            </div>
          </details>;
        })}
        <p className="text-[13px] leading-relaxed text-text-secondary">{t('Rate, coverage, applicability, basis, currency, and deductible remain source context; this review does not calculate or approve cover.')}</p>
        <button type="submit" className="btn min-h-11 rounded-md border border-action-primary bg-action-primary px-4 py-2.5 text-sm font-medium text-action-primary-text enabled:hover:bg-action-primary-hover disabled:opacity-50" disabled={busy || working || preview.rows.some(row => scheduleRowIssues(row, state.terms.currency).length > 0)}>{t('Save reviewed schedule version')}</button>
      </form>
    </>}
  </section>;
}

const fieldList: [ScheduleField, string, boolean][] = [
  ['locationName', 'Location name', false], ['address', 'Address', false], ['occupancy', 'Occupancy', false],
  ['sumInsured', 'Sum insured (decimal)', false], ['currency', 'Currency', false], ['coverage', 'Coverage / peril', false],
  ['rate', 'Rate (exact source value)', false], ['rateUnit', 'Rate unit', false], ['rateBasis', 'Rate basis', false],
  ['rateApplicability', 'Rate applicability / source context', false], ['deductible', 'Deductible', false], ['remarks', 'Remarks', true],
];

function scheduleRowIssues(row: ScheduleRow, currency: string) {
  const rateNeedsCorrection = [...row.source.warnings, ...row.warnings]
    .some(warning => warning.startsWith('Rate cell ') && warning.includes('uses Excel percentage formatting;'))
    && row.values.rate === row.imported.rate;
  return getScheduleRowIssues(row.values, currency, rateNeedsCorrection);
}
function normalized(value: string) { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function previousMatch(state: RenewalCase, document: DocumentVersion, row: ScheduleRow) {
  const previous = (state.scheduleVersions ?? []).filter(version => {
    const source = state.documents.find(item => item.id === version.sourceDocumentVersionId);
    return !!source && source.periodEnd < document.periodStart;
  }).at(-1);
  if (!previous) return { message: t('No reviewed prior-period schedule is available for comparison.') };
  const candidates = previous.rows.filter(item => normalized(item.values.locationName) === normalized(row.values.locationName)
    || normalized(item.values.address) === normalized(row.values.address));
  if (!candidates.length) return { message: `${t('No matching row found in prior reviewed schedule.')} v${previous.version}` };
  if (candidates.length > 1) return { message: `${t('Prior schedule has multiple possible matches; compare manually.')} v${previous.version}` };
  const prior = candidates[0]!;
  const changed: (keyof ScheduleRowData)[] = ['locationName', 'address', 'occupancy', 'sumInsured', 'currency', 'coverage', 'rate', 'rateUnit', 'rateBasis', 'rateApplicability', 'deductible'];
  const fields = changed.filter(field => row.values[field] !== prior.values[field]);
  return { message: fields.length
    ? `${t('Changed from prior reviewed schedule') } v${previous.version}: ${fields.map(field => t(fieldList.find(([key]) => key === field)![1])).join(', ')}.`
    : `${t('Matches prior reviewed schedule on reviewed fields')} v${previous.version}.` };
}
function clientMatch(state: RenewalCase, row: ScheduleRow) {
  const confirmed = state.locations.filter(location => isCurrentConfirmation(state, location) && location.proposed);
  const candidates = confirmed.filter(location => normalized(location.proposed!.name) === normalized(row.values.locationName)
    || normalized(location.proposed!.address) === normalized(row.values.address));
  if (!confirmed.length) return { message: t('No current-period client-confirmed location data is available; schedule values remain broker-reviewed.') };
  if (!candidates.length) return { message: t('No matching client-confirmed location; investigate before treating values as aligned.') };
  if (candidates.length > 1) return { message: t('Multiple client-confirmed locations may match; compare manually.') };
  const location = candidates[0]!;
  const changes = [
    normalized(row.values.locationName) !== normalized(location.proposed!.name) ? t('Location name') : '',
    normalized(row.values.address) !== normalized(location.proposed!.address) ? t('Address') : '',
    row.values.sumInsured !== location.proposed!.sumInsured.amount || row.values.currency !== location.proposed!.sumInsured.currency ? t('Sum insured') : '',
  ].filter(Boolean);
  return { message: changes.length
    ? `${t('Mismatch with current client confirmation')}: ${changes.join(', ')}. ${t('Occupancy is not client-confirmed in this flow.')}`
    : t('Name, address, and sum insured match current client confirmation. Occupancy is not client-confirmed in this flow.') };
}
function localizedImportWarning(warning: string) {
  const percentage = warning.match(/^Rate cell (.+) uses Excel percentage formatting; verify the displayed source rate and correct it before saving\.$/);
  if (percentage) return `${t('Rate cell')} ${percentage[1]} ${t('uses Excel percentage formatting; verify the displayed source rate and correct it before saving.')}`;
  const formula = warning.match(/^Formula cell (.+) was not imported; replace it with a verified value\.$/);
  if (formula) return `${t('Formula cell')} ${formula[1]} ${t('was not imported; replace it with a verified value.')}`;
  const skipped = warning.match(/^Sheet "(.+)" skipped; required schedule template headers were not found\.$/);
  if (skipped) return `${t('Sheet')} "${skipped[1]}" ${t('was skipped because required schedule template headers were not found.')}`;
  const duplicate = warning.match(/^Sheet "(.+)", row (\d+): duplicate schedule headers\.$/);
  if (duplicate) return `${t('Sheet')} "${duplicate[1]}", ${t('row')} ${duplicate[2]}: ${t('duplicate schedule headers.')}`;
  const limit = warning.match(/^The import is limited to (\d+) rows per reviewed schedule version\. Split the workbook and review each part\.$/);
  if (limit) return `${t('The import is limited to')} ${limit[1]} ${t('rows per reviewed schedule version. Split the workbook and review each part.')}`;
  return t(warning);
}
