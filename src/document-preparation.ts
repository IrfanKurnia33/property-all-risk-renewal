import { strFromU8, unzipSync } from 'fflate';
import { fileType, MAX_FILE, validateUpload } from '../supabase/functions/_shared/upload-validation.ts';

export interface PreparedSection { id: string; locator: string; text: string }
export interface PreparedPage { number: number; locator: string; hasText: boolean; prepared?: boolean }
export interface PreparedDocument {
  kind: 'pdf' | 'docx' | 'xlsx' | 'image';
  sections: PreparedSection[];
  pages?: PreparedPage[];
  warnings: string[];
  coverage: { totalUnits: number; preparedUnits: number; complete: boolean; unit: 'page' | 'section' | 'sheet' | 'image' };
}
export interface PreparedImage { blob: Blob; dataUrl: string; width: number; height: number; rotation: number }

const MAX_PAGES = 100, MAX_SECTIONS = 2000, MAX_CHARACTERS = 200_000, MAX_SECTION_CHARACTERS = 20_000;
const MAX_SHEETS = 50, MAX_CELLS = 50_000, MAX_IMAGE_PIXELS = 25_000_000, PREVIEW_EDGE = 1600;
const fail = (message: string): never => { throw new Error(message); };

async function sourceBytes(file: File): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!file.size || file.size > MAX_FILE) fail('Ukuran berkas harus lebih dari nol dan maksimum 10 MiB.');
  const mime = fileType(file.name), bytes = new Uint8Array(await file.arrayBuffer());
  validateUpload(bytes, file.name, mime);
  return { bytes, mime };
}

function collectSections(candidates: { locator: string; text: string }[]) {
  const sections: PreparedSection[] = [];
  let characters = 0, preparedUnits = 0;
  for (const candidate of candidates) {
    if (!candidate.text.trim()) { preparedUnits++; continue; }
    let offset = 0;
    while (offset < candidate.text.length && sections.length < MAX_SECTIONS && characters < MAX_CHARACTERS) {
      const length = Math.min(MAX_SECTION_CHARACTERS, candidate.text.length - offset, MAX_CHARACTERS - characters);
      const text = candidate.text.slice(offset, offset + length);
      sections.push({ id: `section-${sections.length + 1}`, locator: candidate.locator +
        (candidate.text.length > MAX_SECTION_CHARACTERS ? ` / karakter ${offset + 1}–${offset + length}` : ''), text });
      characters += length; offset += length;
    }
    if (offset !== candidate.text.length) break;
    preparedUnits++;
  }
  return { sections, preparedUnits, complete: preparedUnits === candidates.length };
}

/** XML is read as text only; fields, links, embedded objects and document instructions are never executed. */
export function extractDocxXml(xml: string, partLabel = 'DOCX isi') {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Deklarasi entitas XML tidak didukung. Simpan ulang sebagai DOCX biasa.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('XML DOCX tidak dapat dibaca.');
  const sections: { locator: string; text: string }[] = [], warnings: string[] = [];
  const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const isWord = (element: Element, name: string) => element.namespaceURI === wordNamespace && element.localName === name;
  const direct = (element: Element, name: string) => [...element.children].filter(child => isWord(child, name));
  let paragraph = 0, table = 0;
  function textOf(element: Element): string {
    if (isWord(element, 't')) return element.textContent ?? '';
    if (isWord(element, 'delText')) return `[Teks dihapus: ${element.textContent ?? ''}]`;
    if (isWord(element, 'tab')) return '\t';
    if (isWord(element, 'br') || isWord(element, 'cr')) return '\n';
    if (isWord(element, 'noBreakHyphen')) return '\u2011';
    if (isWord(element, 'softHyphen')) return '\u00ad';
    return [...element.children].map(textOf).join('');
  }
  function visit(element: Element) {
    if (isWord(element, 'p')) {
      const text = textOf(element); paragraph++;
      if (text.trim()) sections.push({ locator: `${partLabel} / paragraf ${paragraph}`, text });
      return;
    }
    if (isWord(element, 'tbl')) {
      table++;
      direct(element, 'tr').forEach((row, rowIndex) => direct(row, 'tc').forEach((cell, cellIndex) => {
        const paragraphs = [...cell.getElementsByTagNameNS(wordNamespace, 'p')];
        const text = paragraphs.map(textOf).join('\n');
        if (text.trim()) sections.push({ locator: `${partLabel} / tabel ${table} / baris ${rowIndex + 1} / sel ${cellIndex + 1}`, text });
      }));
      return;
    }
    [...element.children].forEach(visit);
  }
  visit(document.documentElement);
  if (document.getElementsByTagNameNS(wordNamespace, 'del').length || document.getElementsByTagNameNS(wordNamespace, 'ins').length)
    warnings.push('DOCX memiliki perubahan terlacak. Teks penghapusan ditandai; tentukan versi wording yang berlaku melalui tinjauan manual.');
  if (document.getElementsByTagNameNS(wordNamespace, 'drawing').length || document.getElementsByTagNameNS(wordNamespace, 'pict').length)
    warnings.push('Gambar dan objek DOCX tidak di-OCR. Periksa berkas asli untuk teks gambar, kotak teks dan tata letak.');
  if (document.getElementsByTagNameNS(wordNamespace, 'fldChar').length || document.getElementsByTagNameNS(wordNamespace, 'fldSimple').length)
    warnings.push('Field DOCX tidak dihitung ulang; hasil tersimpan dapat kedaluwarsa.');
  return { sections, warnings };
}

function prepareDocx(bytes: Uint8Array): PreparedDocument {
  const parts = unzipSync(bytes, { filter: entry => /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(entry.name) });
  const names = Object.keys(parts).sort((a, b) => a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b));
  const candidates: { locator: string; text: string }[] = [], warnings: string[] = [];
  for (const name of names) {
    const parsed = extractDocxXml(strFromU8(parts[name]!), name);
    candidates.push(...parsed.sections); warnings.push(...parsed.warnings);
  }
  const collected = collectSections(candidates);
  if (!collected.complete) warnings.push('Batas persiapan tercapai: maksimum 2.000 bagian dan 200.000 karakter. Bagian sisanya belum disiapkan. Pecah berkas atau tinjau manual.');
  if (!candidates.length) warnings.push('Tidak ditemukan teks DOCX. Periksa gambar atau berkas asli secara manual.');
  return { kind: 'docx', sections: collected.sections, warnings: [...new Set(warnings)],
    coverage: { totalUnits: candidates.length, preparedUnits: collected.preparedUnits, complete: collected.complete && candidates.length > 0, unit: 'section' } };
}

async function prepareXlsx(bytes: Uint8Array): Promise<PreparedDocument> {
  // Inspect the already validated archive before ExcelJS allocates cell objects.
  const sheets = unzipSync(bytes, { filter: entry => /^xl\/(worksheets\/sheet\d+|workbook|sharedStrings)\.xml$/.test(entry.name) });
  let cellCount = 0;
  for (const sheet of Object.values(sheets)) {
    const xml = strFromU8(sheet);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('Deklarasi entitas XML tidak didukung. Simpan ulang sebagai XLSX biasa.');
    cellCount += (xml.match(/<(?:\w+:)?c(?:\s|>)/g) ?? []).length;
    if (cellCount > MAX_CELLS) fail('XLSX melebihi batas 50.000 sel. Pecah workbook sebelum persiapan; tidak ada formula yang dijalankan.');
  }
  const imported = await import('exceljs'), workbook = new imported.default.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const candidates: { locator: string; text: string; sheet: number }[] = [], warnings: string[] = [];
  let formulas = 0, missingResults = 0;
  function valueText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'object') return String(value);
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map(item => typeof item.text === 'string' ? item.text : '').join('');
    if ('error' in value) return `[Kesalahan: ${String(value.error)}]`;
    if ('text' in value) return String(value.text) + ('hyperlink' in value ? ` [Tautan tersimpan: ${String(value.hyperlink)}]` : '');
    return '';
  }
  const selectedSheets = workbook.worksheets.slice(0, MAX_SHEETS);
  selectedSheets.forEach((sheet, sheetIndex) => {
    const visibility = sheet.state === 'visible' ? '' : ` [${sheet.state}]`;
    if (visibility) warnings.push(`Sheet "${sheet.name}" berstatus ${sheet.state}; isinya tetap disertakan dengan penanda.`);
    sheet.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, cell => {
        let text: string;
        if (cell.type === imported.default.ValueType.Formula) {
          formulas++;
          const value = cell.value as { result?: unknown; formula?: string; sharedFormula?: string };
          const result = value.result === undefined ? '[tidak tersedia]' : valueText(value.result);
          if (value.result === undefined) missingResults++;
          text = `Formula tersimpan: =${cell.formula ?? value.formula ?? ''}` +
            (value.sharedFormula ? ` [formula bersama ${value.sharedFormula}]` : '') + `\nHasil tersimpan: ${result}`;
        } else text = valueText(cell.value);
        if (!text) return;
        const hidden = row.hidden || sheet.getColumn(cell.col).hidden;
        cells.push(`${cell.address}${hidden ? ' [baris/kolom tersembunyi]' : ''}: ${text}` +
          (cell.numFmt && cell.numFmt !== 'General' ? ` [format tersimpan: ${cell.numFmt}]` : ''));
      });
      if (cells.length) candidates.push({ locator: `XLSX / sheet "${sheet.name}"${visibility} / baris ${row.number}`, text: cells.join('\n'), sheet: sheetIndex });
    });
  });
  const collected = collectSections(candidates);
  const fullyPrepared = selectedSheets.filter((_, index) => candidates.every((candidate, candidateIndex) => candidate.sheet !== index || candidateIndex < collected.preparedUnits)).length;
  const complete = collected.complete && workbook.worksheets.length <= MAX_SHEETS;
  if (formulas) warnings.push(`${formulas} formula dibaca tanpa dijalankan. Hasil tersimpan bukan bukti perhitungan terbaru${missingResults ? `; ${missingResults} hasil tidak tersedia` : ''}.`);
  if (!complete) warnings.push('Batas persiapan XLSX tercapai: maksimum 50 sheet, 2.000 bagian dan 200.000 karakter. Cakupan sisanya belum disiapkan.');
  if (!candidates.length) warnings.push('Tidak ditemukan isi sel XLSX. Periksa berkas asli.');
  return { kind: 'xlsx', sections: collected.sections, warnings,
    coverage: { totalUnits: workbook.worksheets.length, preparedUnits: fullyPrepared, complete: complete && candidates.length > 0, unit: 'sheet' } };
}

async function pdfLibrary() {
  const pdf = await import('pdfjs-dist');
  pdf.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  return pdf;
}
async function openPdf(file: File) {
  const { bytes, mime } = await sourceBytes(file);
  if (mime !== 'application/pdf') fail('Berkas harus berupa PDF.');
  const pdf = await pdfLibrary();
  const task = pdf.getDocument({ data: bytes, enableXfa: false, stopAtErrors: true, maxImageSize: MAX_IMAGE_PIXELS,
    canvasMaxAreaInBytes: MAX_IMAGE_PIXELS * 4, disableAutoFetch: true, disableStream: true });
  try { return { document: await task.promise, destroy: () => task.destroy() }; }
  catch (error) { await task.destroy(); throw error; }
}
async function preparePdf(file: File): Promise<PreparedDocument> {
  const opened = await openPdf(file), { document } = opened, candidates: { locator: string; text: string }[] = [], pages: PreparedPage[] = [];
  let characters = 0, truncated = false;
  try {
    for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES); number++) {
      const locator = `PDF / halaman ${number}`;
      if (characters >= MAX_CHARACTERS) { pages.push({ number, locator, hasText: false, prepared: false }); truncated = true; continue; }
      const page = await document.getPage(number), reader = page.streamTextContent({ disableNormalization: true }).getReader();
      let text = '', complete = true;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!('str' in item)) continue;
            const next = item.str + (item.hasEOL ? '\n' : ' '), available = MAX_CHARACTERS - characters - text.length;
            text += next.slice(0, available);
            if (next.length > available) { complete = false; truncated = true; break; }
          }
          if (!complete) break;
        }
      } finally {
        if (!complete) await reader.cancel();
        reader.releaseLock();
      }
      text = text.trim(); characters += text.length;
      pages.push({ number, locator, hasText: !!text, prepared: complete }); candidates.push({ locator, text }); page.cleanup();
    }
    const collected = collectSections(candidates), textPages = pages.filter(page => page.hasText && page.prepared).length;
    const noTextPages = pages.filter(page => page.prepared && !page.hasText).map(page => page.number);
    const warnings = ['Urutan teks PDF dapat berbeda dari tata letak kolom/tabel. Cocokkan dengan tampilan halaman sebelum memakai hasil.'];
    if (noTextPages.length) warnings.push(`Halaman tanpa teks terdeteksi: ${noTextPages.join(', ')}. Pilih pratinjau/AI gambar atau lakukan tinjauan manual; halaman kosong juga mungkin.`);
    if (document.numPages > MAX_PAGES || !collected.complete || truncated) warnings.push('Batas persiapan PDF tercapai: maksimum 100 halaman, 2.000 bagian dan 200.000 karakter. Halaman/bagian sisanya belum disiapkan.');
    return { kind: 'pdf', sections: collected.sections, pages, warnings,
      coverage: { totalUnits: document.numPages, preparedUnits: textPages, complete: textPages === document.numPages, unit: 'page' } };
  } finally { await opened.destroy(); }
}

export async function prepareDocument(file: File): Promise<PreparedDocument> {
  const { bytes, mime } = await sourceBytes(file);
  if (mime === 'application/pdf') return preparePdf(file);
  if (mime.endsWith('wordprocessingml.document')) return prepareDocx(bytes);
  if (mime.endsWith('spreadsheetml.sheet')) return prepareXlsx(bytes);
  return { kind: 'image', sections: [], pages: [{ number: 1, locator: 'Gambar / halaman 1', hasText: false }],
    warnings: ['Gambar belum ditranskripsikan. Periksa orientasi dan pratinjau sebelum memilih AI gambar atau entri manual.'],
    coverage: { totalUnits: 1, preparedUnits: 0, complete: false, unit: 'image' } };
}

function normalRotation(rotation: number) {
  if (!Number.isInteger(rotation) || rotation % 90 !== 0) fail('Rotasi harus kelipatan 90 derajat.');
  return ((rotation % 360) + 360) % 360;
}
function safeDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS)
    fail('Gambar melebihi batas 25 megapiksel atau dimensi tidak valid. Kecilkan gambar sebelum persiapan.');
}
function inspectImageDimensions(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png' && bytes.length >= 24) return safeDimensions(view.getUint32(16), view.getUint32(20));
  if (mime === 'image/webp' && bytes.length >= 20) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X' && bytes.length >= 30) return safeDimensions(1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16));
    if (chunk === 'VP8 ' && bytes.length >= 30) return safeDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) { const packed = view.getUint32(21, true); return safeDimensions(1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff)); }
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker !== undefined && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8)
        return safeDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      offset += length;
    }
  }
  fail('Dimensi gambar tidak dapat dibaca dengan aman. Simpan ulang sebagai JPEG, PNG atau WebP biasa.');
}
async function canvasImage(canvas: HTMLCanvasElement, rotation: number): Promise<PreparedImage> {
  let blob: Blob | undefined;
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Pratinjau gambar gagal dibuat.')), 'image/jpeg', quality));
    if (blob.size <= 1_500_000) break;
  }
  if (!blob || blob.size > 1_500_000) throw new Error('Pratinjau melebihi 1,5 MB. Kecilkan gambar atau pilih halaman yang lebih sederhana.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Pratinjau gambar gagal dibaca.')); reader.readAsDataURL(blob);
  });
  return { blob, dataUrl, width: canvas.width, height: canvas.height, rotation };
}

export async function renderPdfPage(file: File, pageNumber: number, rotation = 0): Promise<PreparedImage> {
  const angle = normalRotation(rotation), opened = await openPdf(file), { document } = opened;
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > Math.min(document.numPages, MAX_PAGES)) fail('Pilih halaman PDF 1–100 yang tersedia.');
    const page = await document.getPage(pageNumber), base = page.getViewport({ scale: 1, rotation: (page.rotate + angle) % 360 });
    safeDimensions(base.width, base.height);
    const viewport = page.getViewport({ scale: Math.min(2, PREVIEW_EDGE / Math.max(base.width, base.height)), rotation: (page.rotate + angle) % 360 });
    const canvas = window.document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas tidak tersedia pada browser ini.');
    await page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
    return await canvasImage(canvas, angle);
  } finally { await opened.destroy(); }
}

export async function prepareImage(file: File, rotation = 0): Promise<PreparedImage> {
  const angle = normalRotation(rotation), { bytes, mime } = await sourceBytes(file);
  if (!mime.startsWith('image/')) fail('Berkas harus berupa JPEG, PNG atau WebP.');
  inspectImageDimensions(bytes, mime);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    safeDimensions(bitmap.width, bitmap.height);
    const turned = angle === 90 || angle === 270, width = turned ? bitmap.height : bitmap.width, height = turned ? bitmap.width : bitmap.height;
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas tidak tersedia pada browser ini.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate(angle * Math.PI / 180);
    context.drawImage(bitmap, -bitmap.width * scale / 2, -bitmap.height * scale / 2, bitmap.width * scale, bitmap.height * scale);
    return await canvasImage(canvas, angle);
  } finally { bitmap.close(); }
}
