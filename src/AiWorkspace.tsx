import { formatDate, formatNumber, t } from './i18n.ts';
import { useEffect, useRef, useState } from 'react';
import type { RenewalCase } from './domain.ts';
import { Badge, Button, Note, Panel } from './App.tsx';
import type { PreparedDocument, PreparedImage } from './document-preparation.ts';
import type { AiBatch, AiFindingReview, AiSection, AiHistory, AiSourceOption, AiSourceCatalog, AiStep } from '../supabase/functions/_shared/ai-contract.ts';

type OpenSource = { source:AiSourceOption; file:File; prepared:PreparedDocument };
type Request = <T>(path:string,input?:unknown)=>Promise<T>;
type PendingRequest = {path:string;input:unknown};
const stepLabels:Record<string,string> = {pending:'Belum diproses',running:'Sedang diproses',completed:'Hasil tersedia',failed:'Gagal · tinjau manual'};
const formatTime = (value:string)=>formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })+' WIB';
const reason = (error:unknown)=>error instanceof Error?error.message:'Permintaan belum berhasil. Tinjau sumber secara manual atau muat ulang status.';
const uncertain = (error:unknown)=>typeof error==='object' && error!==null && 'status' in error && (Number(error.status)===0 || Number(error.status)>=500);
const sectionId = (fileId:string,suffix:string)=>fileId+':'+suffix;
const extensions:Record<string,string>={'application/pdf':'.pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
const emptySources:AiSourceCatalog={caseDocuments:[],priorSlips:[],standardTerms:[]};
const clauseLabels:Record<string,string>={new_or_strengthened:'Baru atau diperkuat',removed:'Dihapus',modified:'Diubah',unchanged:'Tidak berubah',unresolved:'Belum dapat dipastikan'};

export function AiWorkspace({state,request,loadEvidence,busy=false}:{
  state:RenewalCase;request:Request;loadEvidence:(documentId:string,sourceType?:'case'|'workspace-standard-terms')=>Promise<Blob>;busy?:boolean;
}) {
  const path='cases/'+encodeURIComponent(state.id)+'/ai';
  const [status,setStatus]=useState<AiHistory|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [working,setWorking]=useState(false),[pending,setPending]=useState<PendingRequest|null>(null);
  const [opened,setOpened]=useState<OpenSource[]>([]),[documentId,setDocumentId]=useState(''),[activeId,setActiveId]=useState('');
  const [priorSlipId,setPriorSlipId]=useState(''),[standardTermsId,setStandardTermsId]=useState('');
  const [selected,setSelected]=useState<AiSection[]>([]),[purpose,setPurpose]=useState<'extract'|'compare'|'clause-review'>('clause-review'),[consent,setConsent]=useState(false);
  const [page,setPage]=useState(1),[rotation,setRotation]=useState(0),[preview,setPreview]=useState<{section:AiSection;image:PreparedImage}|null>(null);
  const [images,setImages]=useState<Record<string,PreparedImage>>({});
  const mounted=useRef(true),latestRequest=useRef(request),readSequence=useRef(0),alert=useRef<HTMLDivElement>(null);
  latestRequest.current=request;
  const sources=status?.sources??emptySources;
  const documents=[...sources.caseDocuments,...sources.standardTerms];
  const active=opened.find(source=>source.source.documentVersionId===activeId);
  const locked=busy || working || pending!==null;
  const budgetExhausted=!!status && status.budget.attemptsToday>=status.budget.limit;
  const workspaceBusy=!!status?.budget.inFlightUntil && Date.parse(status.budget.inFlightUntil)>Date.now();
  const textLength=selected.reduce((sum,section)=>sum+(section.text?.length??0),0),imageCount=selected.filter(section=>section.kind==='image').length;
  const unprocessedCount=opened.reduce((sum,source)=>{
    const textNotSelected=textSections(source).filter(section=>!selected.some(item=>item.id===section.id)).length;
    const selectedImagePages=new Set(selected.filter(section=>section.documentVersionId===source.source.documentVersionId && section.kind==='image').map(section=>Number(section.id.match(/:p(\d+):r/)?.[1])).filter(number=>source.prepared.kind==='image' || source.prepared.pages?.some(item=>item.number===number && (!item.hasText || item.prepared===false))));
    return sum+textNotSelected+Math.max(0,source.prepared.coverage.totalUnits-source.prepared.coverage.preparedUnits-selectedImagePages.size);
  },0);
  const pairReady=selected.some(section=>section.kind==='text' && section.sourceType==='case' && section.documentVersionId===priorSlipId)
    && selected.some(section=>section.kind==='text' && section.sourceType==='workspace-standard-terms' && section.documentVersionId===standardTermsId);

  useEffect(()=>{
    if(!priorSlipId && sources.priorSlips[0])setPriorSlipId(sources.priorSlips[0].documentVersionId);
    if(!standardTermsId && sources.standardTerms[0])setStandardTermsId(sources.standardTerms[0].documentVersionId);
    if(!documentId && documents[0])setDocumentId(documents[0].documentVersionId);
  },[sources,priorSlipId,standardTermsId,documentId,documents]);

  async function refresh() {
    const sequence=++readSequence.current;
    const result=await latestRequest.current<AiHistory>(path);
    if(mounted.current && sequence===readSequence.current)setStatus(result);
  }
  useEffect(()=>{
    let live=true;
    mounted.current=true;
    setWorking(true);
    void refresh().catch(cause=>{if(live)setError(reason(cause));}).finally(()=>{if(live)setWorking(false);});
    return()=>{live=false;mounted.current=false;};
  },[state.id]);
  useEffect(()=>{if(error)alert.current?.focus();},[error]);

  async function reload() {
    setWorking(true);setError('');
    try{await refresh();}catch(cause){if(mounted.current)setError(reason(cause));}
    finally{if(mounted.current)setWorking(false);}
  }
  async function send(operation:PendingRequest) {
    setWorking(true);setError('');setNotice('');
    try{
      await latestRequest.current(operation.path,operation.input);
      if(!mounted.current)return;
      setPending(null);
      await refresh();
      if(mounted.current)setNotice('Status bantuan AI tersimpan. Data renewal dan prasyarat tindakan tetap perlu ditinjau pada formulir utama.');
    }catch(cause){
      if(mounted.current){setPending(uncertain(cause)?operation:null);setError(reason(cause));}
    }finally{if(mounted.current)setWorking(false);}
  }
  function select(section:AiSection) {
    setError('');setConsent(false);
    if(selected.some(item=>item.id===section.id)){setSelected(items=>items.filter(item=>item.id!==section.id));return;}
    if(selected.length>=40){setError('Pilih paling banyak 40 bagian atau halaman untuk satu kelompok.');return;}
    if(section.kind==='text' && textLength+(section.text?.length??0)>40_000){setError('Jumlah kutipan melebihi 40.000 karakter. Kurangi bagian yang dipilih.');return;}
    if(section.kind==='image' && imageCount>=5){setError('Pilih paling banyak lima halaman gambar per kelompok. Setiap halaman diproses terpisah.');return;}
    setSelected(items=>[...items,section]);
  }
  async function prepareSource(source:AiSourceOption):Promise<OpenSource> {
    const blob=await loadEvidence(source.documentVersionId,source.sourceType);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
    if(blob.size!==source.byteSize || [...digest].map(value=>value.toString(16).padStart(2,'0')).join('')!==source.sha256)
      throw new Error('Berkas unduhan berbeda dari versi sumber tersimpan. Muat ulang kasus dan periksa berkas asli sebelum melanjutkan.');
    const file=new File([blob],source.name+(extensions[source.mimeType]??''),{type:source.mimeType});
    const {prepareDocument}=await import('./document-preparation.ts');
    return {source,file,prepared:await prepareDocument(file)};
  }
  async function openSource(source:AiSourceOption) {
    const existing=opened.find(item=>item.source.documentVersionId===source.documentVersionId);
    if(existing){setActiveId(source.documentVersionId);setPage(1);setRotation(0);setPreview(null);return existing;}
    if(opened.length>=10){throw new Error('Paling banyak 10 berkas dapat dibuka bersamaan di browser. Kosongkan persiapan browser sebelum membuka sumber lain; kelompok tersimpan tetap tersedia.');}
    return prepareSource(source);
  }
  async function openDocument() {
    const source=documents.find(item=>item.documentVersionId===documentId);
    if(!source)return;
    setWorking(true);setError('');setPreview(null);
    try{
      const prepared=await openSource(source);
      if(!mounted.current)return;
      setOpened(items=>items.some(item=>item.source.documentVersionId===source.documentVersionId)?items:[...items,prepared]);
      setActiveId(source.documentVersionId);setPage(1);setRotation(0);setConsent(false);
    }catch(cause){if(mounted.current)setError(reason(cause));}
    finally{if(mounted.current)setWorking(false);}
  }
  async function openComparisonPair() {
    const prior=sources.priorSlips.find(source=>source.documentVersionId===priorSlipId);
    const terms=sources.standardTerms.find(source=>source.documentVersionId===standardTermsId);
    if(!prior || !terms){setError('Pilih Final Slip sebelumnya dan versi Standard T&C yang tersedia sebelum menyiapkan perbandingan.');return;}
    if(selected.length && !window.confirm(t("Mengganti pasangan sumber akan menghapus pilihan yang belum disimpan. Lanjutkan?")))return;
    const needed=[prior,terms].filter(source=>!opened.some(item=>item.source.documentVersionId===source.documentVersionId)).length;
    if(opened.length+needed>10){setError('Kosongkan persiapan browser sebelum membuka pasangan sumber ini. Kelompok tersimpan tetap tersedia.');return;}
    setWorking(true);setError('');setNotice('');
    try{
      const preparedPrior=await openSource(prior),preparedTerms=await openSource(terms);
      if(!mounted.current)return;
      const pair=[preparedPrior,preparedTerms],sections=pair.flatMap(textSections);
      const length=sections.reduce((sum,section)=>sum+(section.text?.length??0),0);
      const fits=sections.length>0 && sections.length<=40 && length<=40_000;
      setOpened(current=>[...current.filter(item=>item.source.documentVersionId!==prior.documentVersionId && item.source.documentVersionId!==terms.documentVersionId),...pair]);
      setActiveId(prior.documentVersionId);setPage(1);setRotation(0);setPreview(null);setSelected(fits?sections:[]);
      setImages({});setPurpose('clause-review');setConsent(false);
      if(!fits)setNotice('Kutipan pasangan ini melebihi batas pilihan otomatis. Pilih bagian yang relevan dari kedua sumber secara manual.');
    }catch(cause){if(mounted.current)setError(reason(cause));}
    finally{if(mounted.current)setWorking(false);}
  }
  async function renderPreview() {
    if(!active)return;
    setWorking(true);setError('');
    try{
      const {renderPdfPage,prepareImage}=await import('./document-preparation.ts');
      const image=active.prepared.kind==='pdf'?await renderPdfPage(active.file,page,rotation):await prepareImage(active.file,rotation);
      if(!mounted.current)return;
      const section:AiSection={id:sectionId(active.source.documentVersionId,'p'+page+':r'+rotation),documentVersionId:active.source.documentVersionId,
        sourceType:active.source.sourceType,sha256:active.source.sha256,
        locator:(active.prepared.kind==='pdf'?'Halaman '+page:'Gambar 1')+' · orientasi '+rotation+'°',kind:'image'};
      setPreview({section,image});
      setImages(current=>Object.fromEntries([...Object.entries(current).filter(([id])=>selected.some(item=>item.id===id)),[section.id,image]]));
    }catch(cause){if(mounted.current)setError(reason(cause));}
    finally{if(mounted.current)setWorking(false);}
  }
  function textSections(source:OpenSource):AiSection[] {
    return source.prepared.sections.map((section,index)=>({id:sectionId(source.source.documentVersionId,'t'+index),
      documentVersionId:source.source.documentVersionId,sourceType:source.source.sourceType,sha256:source.source.sha256,
      locator:section.locator,kind:'text',text:section.text}));
  }
  async function createBatch() {
    if(!consent || !selected.length || (purpose==='clause-review' && !pairReady))return;
    await send({path:path+'/batches',input:{idempotencyKey:crypto.randomUUID(),purpose,sections:selected,unprocessedCount}});
    if(mounted.current)setConsent(false);
  }
  async function runStep(batch:AiBatch,step:AiStep) {
    const image=batch.sections.find(section=>step.sectionIds.includes(section.id) && section.kind==='image');
    const prepared=image?images[image.id]:null;
    if(image && !prepared){setError('Buka kembali berkas sumber untuk '+image.locator+', pilih orientasi yang sama, lalu tampilkan pratinjau sebelum memproses langkah ini.');return;}
    await send({path:path+'/batches/'+batch.id+'/steps/'+step.index,input:{idempotencyKey:crypto.randomUUID(),...(prepared?{imageDataUrl:prepared.dataUrl}:{})}});
  }
  const sourceLabel=(section:AiSection)=>{
    const source=(section.sourceType==='workspace-standard-terms'?sources.standardTerms:sources.caseDocuments)
      .find(item=>item.documentVersionId===section.documentVersionId);
    return source?`${source.name} · v${source.version}`:section.documentVersionId;
  };

  return <div data-ai-workspace className="min-w-0"><Panel title={t("Tinjauan klausul renewal dengan AI")} description={t("Mulai dengan membandingkan Final Slip sebelumnya dan versi Standard T&C yang dipilih. Tinjau setiap kutipan sebelum mencatat keputusan broker.")}>
    <Note highlight>{t("Gunakan sumber fiktif saja. Kutipan dan halaman yang Anda pilih dikirim ke penyedia eksternal melalui OpenRouter. Saran AI tidak mengonfirmasi nilai klien, penerimaan insurer, wording yang disepakati, atau kesiapan QS, proposal dan DFS.")}</Note>
    {error && <div ref={alert} role="alert" tabIndex={-1} className="rounded-md border border-status-blocked-fg bg-status-blocked-bg p-3 text-sm text-status-blocked-fg">{t(error)}</div>}
    {notice && <p role="status" className="text-sm text-text-secondary">{t(notice)}</p>}
    {working && <p role="status" className="text-sm text-text-secondary">{t("Menyiapkan atau memuat bantuan AI…")}</p>}
    <div className="flex flex-wrap items-center gap-3"><Badge tone="blue">{status?.budget.attemptsToday??'–'} / {status?.budget.limit??40} {t("percobaan hari ini")}</Badge><Button disabled={busy || working} onClick={()=>void reload()} testId="ai-refresh">{t("Muat ulang status AI")}</Button></div>
    <p className="text-[13px] text-text-secondary">{t("Batas berlaku per workspace, termasuk percobaan gagal. Router gratis tidak menjamin ketersediaan model. Satu permintaan berjalan pada satu waktu; proses manual tetap tersedia.")}</p>
    {budgetExhausted && <Note>{t("Anggaran percobaan hari ini sudah habis. Lanjutkan tinjauan manual; anggaran harian dihitung berdasarkan tanggal UTC.")}</Note>}
    {workspaceBusy && <Note>{t("Workspace sedang memproses permintaan lain, paling lama hingga")}{' '}{formatTime(status!.budget.inFlightUntil!)}{t(". Muat ulang status setelah permintaan berakhir.")}</Note>}
    {pending && <div className="space-y-3"><Note>{t("Hasil permintaan terakhir belum diketahui. Ulangi permintaan yang sama untuk memeriksa hasil tanpa menggandakan langkah.")}</Note><Button disabled={busy || working} onClick={()=>void send(pending)} testId="ai-retry-same">{t("Periksa permintaan terakhir")}</Button></div>}
    <div className="space-y-4 rounded-md border border-border-subtle bg-surface-subtle p-4 sm:p-5" data-testid="ai-clause-entry">
      <div><h4 className="text-sm font-semibold">{t("Pasangan sumber perbandingan")}</h4><p className="mt-1 text-[13px] text-text-secondary">{t("Versi eligible terbaru dipilih otomatis. Ubah pilihan bila perlu; isi dokumen tetap diperiksa terhadap sumber asli.")}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="ai-prior-slip">{t("Final Slip sebelumnya")}</label><select id="ai-prior-slip" value={priorSlipId} disabled={locked} onChange={event=>setPriorSlipId(event.target.value)} className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base">{sources.priorSlips.map(source=><option key={source.documentVersionId} value={source.documentVersionId}>{source.name} · v{source.version} · {source.periodEnd}</option>)}</select></div>
        <div><label htmlFor="ai-standard-terms">{t("Standard T&C workspace")}</label><select id="ai-standard-terms" value={standardTermsId} disabled={locked} onChange={event=>setStandardTermsId(event.target.value)} className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base">{sources.standardTerms.map(source=><option key={source.documentVersionId} value={source.documentVersionId}>{source.name} · v{source.version}</option>)}</select></div>
      </div>
      {(!sources.priorSlips.length || !sources.standardTerms.length) && <Note>{!sources.priorSlips.length && t("Final Slip sebelumnya yang eligible belum memiliki berkas finalized. Lanjutkan sementara melalui Sumber dokumen dan review wording manual.")}{!sources.priorSlips.length && !sources.standardTerms.length && ' '}{!sources.standardTerms.length && t("Belum ada Standard T&C finalized. Minta Superadmin mengunggah versinya di Pengaturan workspace. Review manual tetap tersedia.")}</Note>}
      <div className="flex flex-wrap items-center gap-3"><Button primary disabled={locked || !priorSlipId || !standardTermsId} onClick={()=>void openComparisonPair()} testId="ai-open-pair">{t("Siapkan pasangan sumber")}</Button><span className="text-[13px] text-text-secondary">{t("Ekstraksi dilakukan lokal di browser. OpenRouter belum dipanggil.")}</span></div>
    </div>
    <details className="rounded-md border border-border-subtle p-4" data-testid="ai-preparation">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{t("Buka sumber tambahan atau pilih bagian manual")}</summary>
      <fieldset disabled={locked} className="mt-4 min-w-0 space-y-5">
        {!documents.length?<Note>{t("Unggah dan finalisasi berkas sumber melalui inventaris dokumen sebelum menyiapkan bantuan AI.")}</Note>:<form className="space-y-3" onSubmit={event=>{event.preventDefault();void openDocument();}}>
          <div><label htmlFor="ai-document">{t("Berkas sumber tersimpan")}</label><select id="ai-document" className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base" value={documentId} required onChange={event=>setDocumentId(event.target.value)}><option value="">{t("Pilih versi sumber")}</option>{documents.map(document=><option key={document.documentVersionId} value={document.documentVersionId}>{document.name} · {t("· v")}{document.version}</option>)}</select></div>
          <Button type="submit" disabled={!documentId} testId="ai-open-source">{t("Buka sumber di browser")}</Button>
          <p className="text-[13px] text-text-secondary">{t("Berkas asli tetap tersimpan tanpa perubahan. Ekstraksi dan pratinjau disiapkan di browser; belum ada permintaan ke AI.")}</p>
        </form>}
        {opened.length>0 && <div><label htmlFor="ai-opened-document">{t("Sumber yang sudah dibuka")}</label><select id="ai-opened-document" value={activeId} className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base" onChange={event=>{setActiveId(event.target.value);setPage(1);setRotation(0);setPreview(null);}}>{opened.map(source=><option key={source.source.documentVersionId} value={source.source.documentVersionId}>{source.source.name} · v{source.source.version}</option>)}</select></div>}
        {opened.length>0 && <Button onClick={()=>{setOpened([]);setActiveId('');setSelected([]);setImages({});setPreview(null);setConsent(false);}}>{t("Kosongkan persiapan browser")}</Button>}
        {active && <div className="space-y-4">
          <p className="text-[13px] text-text-secondary">{active.source.name} · v{active.source.version} · {active.prepared.coverage.preparedUnits}/{active.prepared.coverage.totalUnits} {t("unit dapat disiapkan sebagai teks. Teks hasil ekstraksi perlu dibandingkan dengan berkas asli.")}</p>
          {active.prepared.warnings.length>0 && <ul className="list-disc space-y-2 pl-5 text-sm text-text-secondary">{active.prepared.warnings.map((warning,index)=><li key={index}>{t(warning)}</li>)}</ul>}
          {textSections(active).map(section=><details key={section.id} className="rounded-md border border-border-subtle p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm">{section.locator} · {formatNumber(section.text!.length)} {t("karakter")}{selected.some(item=>item.id===section.id)?' · dipilih':''}</summary><div className="space-y-3"><label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={selected.some(item=>item.id===section.id)} onChange={()=>select(section)} /><span>{t("Sertakan")}{' '}{section.locator}</span></label><textarea aria-label={t('Kutipan sumber '+section.locator)} className="min-h-40" readOnly value={section.text} /></div></details>)}
          {(active.prepared.kind==='pdf' || active.prepared.kind==='image') && <div className="space-y-4 rounded-md border border-border-subtle p-4">
            <h4 className="text-sm font-semibold">{t("Halaman gambar / scan")}</h4>
            <div className="grid gap-3 sm:grid-cols-2">{active.prepared.kind==='pdf' && <div><label htmlFor="ai-page">{t("Halaman PDF")}</label><select id="ai-page" className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base" value={page} onChange={event=>{setPage(Number(event.target.value));setPreview(null);}}>{active.prepared.pages?.map(item=><option key={item.number} value={item.number}>{item.locator}{t(item.prepared===false?' · teks belum disiapkan':item.hasText?' · memiliki teks':' · perlu tinjauan gambar')}</option>)}</select></div>}<div><label htmlFor="ai-rotation">{t("Orientasi pratinjau")}</label><select id="ai-rotation" className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base" value={rotation} onChange={event=>{setRotation(Number(event.target.value));setPreview(null);}}>{[0,90,180,270].map(value=><option key={value} value={value}>{value}°</option>)}</select></div></div>
            <Button onClick={()=>void renderPreview()} testId="ai-preview-page">{t("Tampilkan pratinjau halaman")}</Button>
            {preview && <div className="space-y-3"><p className="text-[13px] text-text-secondary">{preview.section.locator} · {preview.image.width} × {preview.image.height} {t("px ·")}{' '}{(preview.image.blob.size/1024).toFixed(0)} {t("KiB")}</p><img src={preview.image.dataUrl} width={preview.image.width} height={preview.image.height} className="max-h-96 w-full rounded-md border border-border-control bg-surface object-contain" alt={t('Pratinjau sumber '+preview.section.locator)} /><label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={selected.some(item=>item.id===preview.section.id)} onChange={()=>select(preview.section)} /><span>{t("Sertakan halaman dan orientasi ini")}</span></label></div>}
          </div>}
        </div>}
        <div className="space-y-4 border-t border-border-subtle pt-5">
          <p className="text-sm font-semibold">{t("Pilihan saat ini:")}{' '}{selected.filter(section=>section.kind==='text').length} {t("bagian teks ·")}{' '}{formatNumber(textLength)}{t("/40.000 karakter ·")}{' '}{imageCount}{t("/5 halaman gambar")}</p>
          <p className="text-[13px] text-text-secondary">{unprocessedCount} {t("bagian/halaman dari sumber yang dibuka belum dipilih.")}{' '}{Math.max(0,documents.length-opened.length)} {t("berkas tersimpan belum dibuka. Pemrosesan pilihan ini belum merupakan peninjauan seluruh dokumen.")}</p>
          {selected.length>0 && <ul className="space-y-2 text-sm">{selected.map(section=><li key={section.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-subtle p-3"><span>{sourceLabel(section)} · {section.locator}</span><button type="button" className="text-button min-h-11" onClick={()=>select(section)}>{t("Hapus bagian dari pilihan")}</button></li>)}</ul>}
          <div><label htmlFor="ai-purpose">{t("Tujuan bantuan")}</label><select id="ai-purpose" value={purpose} className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base" onChange={event=>{setPurpose(event.target.value as 'extract'|'compare'|'clause-review');setConsent(false);}}><option value="clause-review">{t("Review perbedaan klausul")}</option><option value="compare">{t("Bandingkan kutipan dan temukan perbedaan")}</option><option value="extract">{t("Susun temuan dari sumber terpilih")}</option></select></div>
          {purpose==='clause-review' && <Note>{t("Review klausul memerlukan setidaknya satu kutipan teks terpilih dari masing-masing sumber. Halaman gambar menjadi konteks tambahan; pastikan batas cakupan dan kutipan sumber sebelum menyimpan.")}</Note>}
          {purpose==='compare' && <Note>{t("Perbandingan teks mencakup kutipan teks yang dipilih. Untuk scan, pilih juga teks pembanding dari slip sebelumnya atau QS. Setiap halaman gambar diproses sendiri dengan konteks teks kelompok ini; perbandingan antarhalaman gambar tetap memerlukan pemeriksaan manual.")}</Note>}
          <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} /><span>{t("Saya memastikan pilihan ini hanya berisi data fiktif dan menyetujui pengiriman kutipan/halaman terpilih ke penyedia AI eksternal. Saya akan memeriksa setiap temuan terhadap sumber asli.")}</span></label>
          <Button primary disabled={!consent || !selected.length || !status || (purpose==='clause-review' && !pairReady)} onClick={()=>void createBatch()} testId="ai-create-batch">{t("Simpan kelompok pilihan")}</Button>
          <Note>{t("Menyimpan kelompok belum memanggil AI. Mulai setiap langkah secara terpisah di bawah. Kegagalan tidak diulang otomatis; hasil yang sudah tersedia tetap tersimpan.")}</Note>
        </div>
      </fieldset>
    </details>
    <div className="space-y-5" data-testid="ai-batches">
      <h4 className="text-sm font-semibold">{t("Kelompok dan hasil tersimpan")}</h4>
      {!status?.batches.length && <p className="text-sm text-text-secondary">{t("Belum ada kelompok sumber untuk kasus ini. Alur manual dapat dilanjutkan tanpa bantuan AI.")}</p>}
      {status?.batches.map(batch=><details key={batch.id} className="rounded-md border border-border-subtle p-4" open={status.batches[0]?.id===batch.id}>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{t(batch.purpose==='clause-review'?'Review klausul':batch.purpose==='compare'?'Perbandingan':'Temuan sumber')} · {formatTime(batch.createdAt)} · {batch.steps.filter(step=>step.status==='completed').length}/{batch.steps.length} {t("langkah menghasilkan saran")}</summary>
        <div className="mt-4 space-y-5"><p className="break-all text-[13px] text-text-secondary">{t("Kelompok")}{' '}{batch.id} · {batch.sections.length} {t("bagian/halaman terpilih ·")}{' '}{batch.unprocessedCount} {t("bagian/halaman tidak disertakan saat disimpan")}</p><Note>{t("Cakupan hanya pada pilihan kelompok ini. Langkah gagal dan bagian yang tidak dipilih tetap perlu ditinjau secara manual; hasil AI tidak menandakan peninjauan dokumen selesai.")}</Note>
          {batch.steps.map(step=><Step key={step.index} batch={batch} step={step} sources={sources} disabled={locked} cannotRun={budgetExhausted || workspaceBusy} imageAvailable={step.sectionIds.every(id=>batch.sections.find(section=>section.id===id)?.kind!=='image' || !!images[id])} onRun={()=>void runStep(batch,step)} onReview={(decision,note)=>void send({path:path+'/batches/'+batch.id+'/steps/'+step.index+'/review',input:{idempotencyKey:crypto.randomUUID(),decision,note}})} onFindingReview={(findingIndex,decision,note)=>void send({path:path+'/batches/'+batch.id+'/steps/'+step.index+'/findings/'+findingIndex+'/review',input:{idempotencyKey:crypto.randomUUID(),decision,note}})} />)}
        </div>
      </details>)}
    </div>
  </Panel></div>;
}

function Step({batch,step,sources:catalog,disabled,cannotRun,imageAvailable,onRun,onReview,onFindingReview}:{
  batch:AiBatch;step:AiStep;sources:AiSourceCatalog;disabled:boolean;cannotRun:boolean;imageAvailable:boolean;onRun:()=>void;
  onReview:(decision:'reviewed'|'dismissed',note:string)=>void;onFindingReview:(index:number,decision:AiFindingReview['decision'],note:string)=>void;
}) {
  const [note,setNote]=useState(''),[checked,setChecked]=useState(false),[copied,setCopied]=useState('');
  const sources=batch.sections.filter(section=>step.sectionIds.includes(section.id));
  const result=step.result;
  const sourceLabel=(section:AiSection)=>{
    const source=(section.sourceType==='workspace-standard-terms'?catalog.standardTerms:catalog.caseDocuments)
      .find(item=>item.documentVersionId===section.documentVersionId);
    return source?`${source.name} · v${source.version}`:section.documentVersionId;
  };
  async function copy(value:string) {
    try{await navigator.clipboard.writeText(value);setCopied('Kutipan sumber disalin. Cocokkan wording dengan berkas asli sebelum memasukkannya ke formulir manual.');}
    catch{setCopied('Pilih teks pada kotak kutipan sumber lalu salin dengan keyboard.');}
  }
  return <section className="min-w-0 space-y-4 border-t border-border-subtle pt-5">
    <div className="flex flex-wrap items-center gap-3"><h5 className="text-sm font-semibold">{t("Langkah")}{' '}{step.index+1}</h5><Badge tone={step.status==='completed'?'blue':step.status==='failed'?'amber':''}>{t(stepLabels[step.status])}</Badge></div>
    <ul className="space-y-2 text-[13px] text-text-secondary">{sources.map(source=><li key={source.id}>{sourceLabel(source)} · {source.locator} · {source.kind==='image'?t('gambar'):t('kutipan teks')}</li>)}</ul>
    {step.status==='pending' && <><Button primary disabled={disabled || cannotRun || !imageAvailable} onClick={onRun} testId={'ai-run-step-'+step.index}>{t("Proses langkah")}{' '}{step.index+1}</Button>{!imageAvailable && <Note>{t("Untuk melanjutkan halaman gambar, buka kembali berkas sumber, pilih halaman dan orientasi yang sama, lalu tampilkan pratinjaunya. Gambar tidak disimpan dalam riwayat AI.")}</Note>}</>}
    {step.status==='running' && <Note>{t("Permintaan sudah dimulai. Muat ulang status untuk memeriksa hasil; langkah ini tidak dikirim ulang otomatis.")}</Note>}
    {step.status==='failed' && <Note>{t("Langkah ini belum menghasilkan saran yang dapat dipakai (")}{t(step.errorCode??'AI_UNAVAILABLE')}{t("). Tinjau sumber secara manual. Jika diperlukan, buat kelompok baru untuk percobaan baru; percobaan tersebut memakai anggaran harian.")}</Note>}
    {result && <div className="space-y-4">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.summary}</p>
      {result.warnings.length>0 && <ul className="list-disc space-y-2 pl-5 text-sm text-text-secondary">{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
      {result.findings.map((finding,index)=><div key={index} className="space-y-3 rounded-md border border-border-subtle p-4">
        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{finding.title}</p>{finding.category && <Badge tone={finding.category==='unresolved'?'amber':'blue'}>{t(clauseLabels[finding.category])}</Badge>}</div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{finding.detail}</p>
        {finding.recommendedAction && <p className="text-sm"><strong>{t("Tindak lanjut yang disarankan:")}</strong>{' '}{finding.recommendedAction}</p>}
        <div className="space-y-3">{finding.sourceIds.map(id=>{const source=batch.sections.find(section=>section.id===id);return source?<details key={id}><summary className="min-h-11 cursor-pointer py-2 text-[13px] text-link">{t("Periksa sumber:")}{' '}{sourceLabel(source)} · {source.locator}</summary>{source.kind==='text'?<div className="space-y-3"><textarea aria-label={t('Kutipan rujukan '+source.locator)} readOnly value={source.text} className="min-h-32" /><Button onClick={()=>void copy(source.text!)} disabled={disabled}>{t("Salin kutipan sumber")}</Button></div>:<p className="text-[13px] text-text-secondary">{t("Buka berkas asli dan pratinjau halaman yang dirujuk. Model dapat salah membaca gambar.")}</p>}</details>:<Note key={id}>{t("Rujukan tidak tersedia. Jangan gunakan temuan ini sebelum memeriksa sumber.")}</Note>;})}</div>
        {finding.proposedText && <div className="space-y-3"><label htmlFor={'ai-suggestion-'+batch.id+'-'+step.index+'-'+index}>{t("Saran AI untuk dibandingkan dengan sumber")}</label><textarea id={'ai-suggestion-'+batch.id+'-'+step.index+'-'+index} readOnly value={finding.proposedText} /><p className="text-[13px] text-text-secondary">{t("Pertahankan wording yang disepakati dari sumber asli. Catat perubahan sebagai amandemen terpisah melalui formulir manual.")}</p></div>}
        {batch.purpose==='clause-review' && <FindingDecision review={step.findingReviews?.find(review=>review.findingIndex===index)} disabled={disabled} findingIndex={index} onSave={(decision,note)=>onFindingReview(index,decision,note)} />}
      </div>)}
      {copied && <p role="status" className="text-[13px] text-text-secondary">{t(copied)}</p>}
      {batch.purpose!=='clause-review' && (step.review?<div className="space-y-2 rounded-md bg-surface-subtle p-3 text-sm"><p className="font-semibold">{step.review.decision==='reviewed'?t('Saran ditinjau broker'):t('Saran tidak digunakan')} · {formatTime(step.review.at)}</p><p className="whitespace-pre-wrap">{step.review.note}</p><p className="text-[13px] text-text-secondary">{t("Catatan ini tidak mengubah fakta, wording, keputusan klien/insurer atau prasyarat renewal.")}</p></div>:<form className="space-y-3" onSubmit={event=>{event.preventDefault();const submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;onReview(submitter?.value==='dismissed'?'dismissed':'reviewed',note);}}><div><label htmlFor={'ai-review-'+batch.id+'-'+step.index}>{t("Catatan tinjauan broker")}</label><textarea id={'ai-review-'+batch.id+'-'+step.index} required maxLength={2000} value={note} disabled={disabled} onChange={event=>setNote(event.target.value)} /></div><label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>setChecked(event.target.checked)} /><span>{t("Saya memeriksa kutipan, konteks, dan setiap saran terhadap berkas sumber asli. Keputusan renewal tetap dicatat melalui formulir manual.")}</span></label><div className="flex flex-wrap gap-3"><button type="submit" value="reviewed" className="btn min-h-11 rounded-md border border-border-control bg-surface px-4 py-2 text-sm disabled:opacity-50" disabled={disabled || !checked}>{t("Catat saran ditinjau")}</button><button type="submit" value="dismissed" className="btn min-h-11 rounded-md border border-border-control bg-surface px-4 py-2 text-sm disabled:opacity-50" disabled={disabled}>{t("Catat saran tidak digunakan")}</button></div></form>)}
    </div>}
  </section>;
}

function FindingDecision({review,disabled,findingIndex,onSave}:{review?:AiFindingReview;disabled:boolean;findingIndex:number;onSave:(decision:AiFindingReview['decision'],note:string)=>void}) {
  const [decision,setDecision]=useState<AiFindingReview['decision']>('follow-up'),[note,setNote]=useState(''),[checked,setChecked]=useState(false);
  if(review)return <div className="space-y-2 rounded-md bg-surface-subtle p-3 text-sm" data-testid={'ai-finding-review-'+findingIndex}>
    <p className="font-semibold">{t(review.decision==='accepted'?'Saran diterima sebagai kandidat':review.decision==='rejected'?'Saran ditolak':'Perlu tindak lanjut')} · {formatTime(review.at)}</p>
    <p className="whitespace-pre-wrap">{review.note}</p>
    <p className="text-[13px] text-text-secondary">{t("Catatan keputusan ini hanya untuk temuan AI. Wording dan status renewal tidak berubah; tindak lanjut tetap dicatat melalui formulir manual.")}</p>
  </div>;
  return <form className="space-y-3 border-t border-border-subtle pt-3" data-testid={'ai-finding-review-'+findingIndex} onSubmit={event=>{event.preventDefault();onSave(decision,note);}}>
    <div><label htmlFor={'ai-finding-decision-'+findingIndex}>{t("Keputusan broker atas temuan ini")}</label><select id={'ai-finding-decision-'+findingIndex} value={decision} disabled={disabled} onChange={event=>setDecision(event.target.value as AiFindingReview['decision'])} className="min-h-11 w-full rounded-md border border-border-control bg-surface px-3 py-2 text-base"><option value="accepted">{t("Terima sebagai kandidat")}</option><option value="rejected">{t("Tolak saran")}</option><option value="follow-up">{t("Tindak lanjuti")}</option></select></div>
    <div><label htmlFor={'ai-finding-note-'+findingIndex}>{t("Alasan atau pertanyaan tindak lanjut")}</label><textarea id={'ai-finding-note-'+findingIndex} required maxLength={2000} value={note} disabled={disabled} onChange={event=>setNote(event.target.value)} /></div>
    <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>setChecked(event.target.checked)} /><span>{t("Saya sudah membandingkan kedua kutipan dengan sumber asli. Keputusan ini tidak mengubah wording atau memberi approval formal.")}</span></label>
    <Button type="submit" disabled={disabled || !checked} testId={'ai-save-finding-'+findingIndex}>{t("Simpan keputusan broker")}</Button>
  </form>;
}
