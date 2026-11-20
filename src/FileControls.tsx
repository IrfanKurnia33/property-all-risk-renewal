import { formatNumber, t } from './i18n.ts';
import { useEffect, useState } from 'react';
import type { DocumentVersion } from './domain.ts';
export function FileControls({document,upload,download,busy}:{document:DocumentVersion;upload:(id:string,file:File)=>Promise<boolean>;download:(id:string)=>Promise<void>;busy:boolean}) {
  const [file,setFile]=useState<File|null>(null);
  useEffect(()=>{if(document.file)setFile(null);},[document.file?.id]);
  const id='upload-'+document.id;
  if(document.file)return <div className="max-w-md space-y-2 text-sm"><p className="text-status-confirmed-fg">{t("Berkas tersimpan ·")}{' '}{formatNumber((document.file.byteSize/1024).toFixed(1))} {t("KiB")}</p><p className="break-all text-xs text-text-secondary">{t("SHA-256:")}{' '}{document.file.sha256}</p><button type="button" className="text-button" onClick={()=>void download(document.file!.id)} disabled={busy}>{t("Unduh berkas sumber")}</button></div>;
  return <form id={id} className="max-w-md space-y-2" onSubmit={async e=>{e.preventDefault();if(file)await upload(document.id,file);}}>
    <label htmlFor={id+'-file'}>{t("Berkas untuk")}{' '}{document.id}</label>
    <input id={id+'-file'} type="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp" required disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)} />
    <p className="text-xs text-text-secondary">{t("PDF, DOCX, XLSX atau foto · maksimum 10 MiB · data fiktif")}</p>
    <button type="submit" className="btn min-h-11 rounded-md border border-border-control bg-surface px-4 py-2 text-sm disabled:opacity-50" disabled={busy || !file}>{t("Unggah dan finalisasi")}</button>
  </form>;
}
