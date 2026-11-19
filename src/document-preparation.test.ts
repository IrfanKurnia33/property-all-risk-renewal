import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { strToU8, zipSync } from 'fflate';
import { extractDocxXml, prepareDocument, prepareImage, renderPdfPage } from './document-preparation.ts';

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const word = (body: string) => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
function pdfFixture(pageCount = 2) {
  const content = 'BT /F1 14 Tf 20 100 Td (Synthetic PAR wording unchanged.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 4} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...Array.from({ length: pageCount }, (_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageCount + 4 + index} 0 R >>`),
    ...Array.from({ length: pageCount }, (_, index) => `<< /Length ${index === 0 ? content.length : 0} >>\nstream\n${index === 0 ? content : ''}\nendstream`),
  ];
  let text = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return text;
}

test('preparation rejects unsupported, empty, oversize, encrypted and dangerous Office sources before parsing', async () => {
  await assert.rejects(prepareDocument(new File(['test'], 'source.exe')), /Unsupported file/);
  await assert.rejects(prepareDocument(new File([], 'source.pdf')), /maksimum 10 MiB/);
  await assert.rejects(prepareDocument(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'source.pdf')), /maksimum 10 MiB/);
  await assert.rejects(prepareDocument(new File(['%PDF-1.7\n/Encrypt 1 0 R'], 'encrypted.pdf')), /Encrypted PDF/);
  const archive = zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(word('<w:p><w:r><w:t>Sample</w:t></w:r></w:p>')),
    'word/vbaProject.bin': new Uint8Array([0, 1]),
  });
  await assert.rejects(prepareDocument(new File([archive], 'macro.docx', { type: docxMime })), /Macro/);
});

test('XLSX preserves coordinates, hidden data, exact text, formulas and cached values without evaluation', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Risiko & Lokasi');
  sheet.getCell('A1').value = '  Wording exact & unchanged.  ';
  sheet.getCell('B2').value = 1250000000.25; sheet.getCell('B2').numFmt = '#,##0.00';
  sheet.getCell('C2').value = { formula: 'B2*0.001', result: 1250000.00025 };
  sheet.getCell('D3').value = { formula: 'WEBSERVICE("https://example.invalid/never-fetch")' };
  sheet.getRow(3).hidden = true;
  sheet.getCell('A4').value = { text: 'External evidence', hyperlink: 'https://example.invalid/not-followed' };
  const hidden = workbook.addWorksheet('Prior schedule', { state: 'veryHidden' });
  hidden.getCell('D5').value = 'HIDDEN-SOURCE-RETAINED';
  const buffer = await workbook.xlsx.writeBuffer();
  const prepared = await prepareDocument(new File([new Uint8Array(buffer)], 'schedule.xlsx', { type: xlsxMime }));
  assert.equal(prepared.kind, 'xlsx'); assert.equal(prepared.coverage.complete, true);
  assert.equal(prepared.coverage.totalUnits, 2); assert.equal(prepared.coverage.preparedUnits, 2);
  const text = prepared.sections.map(section => `${section.locator}\n${section.text}`).join('\n');
  assert.match(text, /sheet "Risiko & Lokasi" \/ baris 1/);
  assert.match(text, /A1:   Wording exact & unchanged\.  /);
  assert.match(text, /B2: 1250000000\.25 \[format tersimpan: #,##0\.00\]/);
  assert.match(text, /C2: Formula tersimpan: =B2\*0\.001\nHasil tersimpan: 1250000\.00025/);
  assert.match(text, /D3 \[baris\/kolom tersembunyi\]: Formula tersimpan: =WEBSERVICE/);
  assert.match(text, /Hasil tersimpan: \[tidak tersedia\]/);
  assert.match(text, /Tautan tersimpan: https:\/\/example\.invalid\/not-followed/);
  assert.match(text, /sheet "Prior schedule" \[veryHidden\] \/ baris 5\nD5: HIDDEN-SOURCE-RETAINED/);
  assert.match(prepared.warnings.join('\n'), /2 formula dibaca tanpa dijalankan/);
  assert.match(prepared.warnings.join('\n'), /1 hasil tidak tersedia/);
});

test('XLSX reports incomplete coverage when its text budget is exhausted', async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Long schedule');
  for (let row = 1; row <= 8; row++) sheet.getCell(`A${row}`).value = 'word '.repeat(6000);
  const buffer = await workbook.xlsx.writeBuffer(), prepared = await prepareDocument(new File([new Uint8Array(buffer)], 'long.xlsx'));
  assert.equal(prepared.coverage.complete, false); assert.equal(prepared.coverage.preparedUnits, 0);
  assert.equal(prepared.coverage.totalUnits, 1);
  assert.equal(prepared.sections.reduce((total, section) => total + section.text.length, 0), 200_000);
  assert.ok(prepared.sections.every(section => section.text.length <= 20_000));
  assert.match(prepared.warnings.join('\n'), /Cakupan sisanya belum disiapkan/);
});

test('XLSX expansion is bounded before ExcelJS allocates excessive cell objects', async () => {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
    'xl/workbook.xml': strToU8('<workbook/>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet>${'<c r="A1"/>'.repeat(50_001)}</worksheet>`),
  });
  await assert.rejects(prepareDocument(new File([bytes], 'too-many-cells.xlsx')), /50\.000 sel/);
});

test('DOCX uses actual browser XML parsing and retains paragraphs, table cells and review warnings', async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/ms-playwright');
  process.env.TMP = resolve('.cache/browser-temp'); process.env.TEMP = process.env.TMP;
  const { chromium } = await import('@playwright/test'), browser = await chromium.launch({ channel: 'chromium' });
  try {
    const page = await browser.newPage();
    const parsed = await page.evaluate(extractDocxXml, word(
      '<w:p><w:r><w:t xml:space="preserve"> Exact &amp; wording. </w:t><w:tab/><w:t>Second</w:t><w:br/><w:t>line.</w:t></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Location A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1,000,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:del><w:r><w:delText>Prior sentence.</w:delText></w:r></w:del><w:ins><w:r><w:t>Proposed sentence.</w:t></w:r></w:ins><w:r><w:fldChar w:fldCharType="begin"/><w:drawing/></w:r></w:p>'
    ));
    assert.equal(parsed.sections[0]?.text, ' Exact & wording. \tSecond\nline.');
    assert.deepEqual(parsed.sections.slice(1, 3), [
      { locator: 'DOCX isi / tabel 1 / baris 1 / sel 1', text: 'Location A' },
      { locator: 'DOCX isi / tabel 1 / baris 1 / sel 2', text: '1,000,000' },
    ]);
    assert.equal(parsed.sections[3]?.text, '[Teks dihapus: Prior sentence.]Proposed sentence.');
    assert.match(parsed.warnings.join('\n'), /perubahan terlacak/);
    assert.match(parsed.warnings.join('\n'), /tidak di-OCR/);
    assert.match(parsed.warnings.join('\n'), /tidak dihitung ulang/);
    await assert.rejects(page.evaluate(extractDocxXml, '<!DOCTYPE document [<!ENTITY x SYSTEM "https://example.invalid">]>' + word('<w:p/>')), /entitas XML/);
    await assert.rejects(page.evaluate(extractDocxXml, '<broken>'), /XML DOCX/);
  } finally { await browser.close(); }
});

test('images explicitly remain untranscribed and invalid orientations fail before rendering', async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const file = new File([bytes], 'photo.png');
  const prepared = await prepareDocument(file);
  assert.equal(prepared.kind, 'image'); assert.equal(prepared.coverage.complete, false);
  assert.equal(prepared.coverage.preparedUnits, 0); assert.deepEqual(prepared.sections, []);
  assert.match(prepared.warnings[0]!, /belum ditranskripsikan/);
  await assert.rejects(prepareImage(file, 15), /kelipatan 90/);
  await assert.rejects(renderPdfPage(file, 1, 12), /kelipatan 90/);
  const huge = new Uint8Array(24); huge.set(bytes); const view = new DataView(huge.buffer); view.setUint32(16, 10_000); view.setUint32(20, 10_000);
  await assert.rejects(prepareImage(new File([huge], 'huge.png')), /25 megapiksel/);
});

test('Vite serves the real lazy PDF worker, editable DOCX text, bounded image previews and untouched originals', { timeout: 90_000 }, async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/ms-playwright');
  process.env.TMP = resolve('.cache/browser-temp'); process.env.TEMP = process.env.TMP;
  const [{ chromium }, { createServer }] = await Promise.all([import('@playwright/test'), import('vite')]);
  const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, watch: null } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); browser = await chromium.launch({ channel: 'chromium' });
    const page = await browser.newPage(); await page.goto(server.resolvedUrls!.local[0]!);
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      'word/document.xml': strToU8(word('<w:p><w:r><w:t>Editable original source &amp; exact words.</w:t></w:r></w:p>')),
      'word/header1.xml': strToU8('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>HEADER SOURCE RETAINED</w:t></w:r></w:p></w:hdr>'),
    });
    const result = await page.evaluate(async ({ pdf, longPdf, docx }) => {
      const modulePath = '/src/document-preparation.ts';
      const preparation = await import(modulePath);
      const file = new File([pdf], 'source.pdf', { type: 'application/pdf' });
      const digest = async (source: File) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await source.arrayBuffer()))).join(',');
      const before = await digest(file), prepared = await preparation.prepareDocument(file);
      const preview = await preparation.renderPdfPage(file, 1, 90), after = await digest(file);
      const previewBitmap = await createImageBitmap(preview.blob), previewCanvas = document.createElement('canvas');
      previewCanvas.width = preview.width; previewCanvas.height = preview.height;
      const previewContext = previewCanvas.getContext('2d')!; previewContext.drawImage(previewBitmap, 0, 0); previewBitmap.close();
      const previewPixels = previewContext.getImageData(0, 0, preview.width, preview.height).data;
      let darkPixels = 0; for (let index = 0; index < previewPixels.length; index += 4) if (previewPixels[index]! < 200) darkPixels++;
      const capped = await preparation.prepareDocument(new File([longPdf], 'large.pdf'));
      const docxPrepared = await preparation.prepareDocument(new File([Uint8Array.from(docx)], 'source.docx'));
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
      const context = canvas.getContext('2d')!; context.fillStyle = '#123456'; context.fillRect(0, 0, 400, 200);
      const original = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      const photo = new File([original], 'scan.png'), photoBefore = await digest(photo), image = await preparation.prepareImage(photo, 90);
      const jpeg = new Uint8Array(await (await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg'))).arrayBuffer());
      const exif = Uint8Array.from([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
      const orientedBytes = new Uint8Array(jpeg.length + exif.length); orientedBytes.set(jpeg.subarray(0, 2)); orientedBytes.set(exif, 2); orientedBytes.set(jpeg.subarray(2), 2 + exif.length);
      const oriented = await preparation.prepareImage(new File([orientedBytes], 'exif-photo.jpg'));
      const webpSource = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/webp'));
      const webp = await preparation.prepareImage(new File([webpSource], 'photo.webp'));
      const oversized = new Uint8Array(30); oversized.set([255, 216, 255, 192, 0, 17, 8, 0x27, 0x10, 0x27, 0x10]);
      let oversizedRejected = false;
      try { await preparation.prepareImage(new File([oversized], 'large.jpg')); } catch (error) { oversizedRejected = String(error).includes('25 megapiksel'); }
      return { prepared, preview: { width: preview.width, height: preview.height, type: preview.blob.type, size: preview.blob.size, dataUrl: preview.dataUrl.slice(0, 23), darkPixels },
        unchanged: before === after, capped, docxPrepared, oversizedRejected, oriented: { width: oriented.width, height: oriented.height }, webp: { width: webp.width, height: webp.height },
        image: { width: image.width, height: image.height, type: image.blob.type, size: image.blob.size, unchanged: photoBefore === await digest(photo) } };
    }, { pdf: pdfFixture(), longPdf: pdfFixture(101), docx: [...docx] });
    assert.equal(result.prepared.sections[0].text, 'Synthetic PAR wording unchanged.');
    assert.equal(result.prepared.sections[0].locator, 'PDF / halaman 1');
    assert.equal(result.prepared.pages.length, 2); assert.equal(result.prepared.pages[1].hasText, false);
    assert.equal(result.prepared.coverage.preparedUnits, 1); assert.equal(result.prepared.coverage.complete, false);
    assert.match(result.prepared.warnings.join('\n'), /Halaman tanpa teks terdeteksi: 2/);
    assert.equal(result.preview.type, 'image/jpeg'); assert.ok(result.preview.size <= 1_500_000);
    assert.equal(result.preview.width, 400); assert.equal(result.preview.height, 800);
    assert.ok(result.preview.darkPixels > 100, 'PDF preview must actually render its wording');
    assert.match(result.preview.dataUrl, /^data:image\/jpeg;base64,/); assert.equal(result.unchanged, true);
    assert.equal(result.capped.pages.length, 100); assert.equal(result.capped.coverage.totalUnits, 101);
    assert.equal(result.capped.coverage.complete, false); assert.match(result.capped.warnings.join('\n'), /maksimum 100 halaman/);
    assert.equal(result.docxPrepared.sections[0].text, 'Editable original source & exact words.');
    assert.ok(result.docxPrepared.sections.some((section: { locator: string; text: string }) => section.locator.includes('header1.xml') && section.text === 'HEADER SOURCE RETAINED'));
    assert.equal(result.image.width, 200); assert.equal(result.image.height, 400); assert.equal(result.image.type, 'image/jpeg');
    assert.ok(result.image.size <= 1_500_000); assert.equal(result.image.unchanged, true); assert.equal(result.oversizedRejected, true);
    assert.deepEqual(result.oriented, { width: 200, height: 400 });
    assert.deepEqual(result.webp, { width: 400, height: 200 });
  } finally { await browser?.close(); await server.close(); }
});
