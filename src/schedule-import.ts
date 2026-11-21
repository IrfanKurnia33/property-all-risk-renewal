import type ExcelJS from 'exceljs';
import type { ScheduleField, ScheduleRow, ScheduleRowData } from './domain.ts';
import { prepareDocument } from './document-preparation.ts';

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const maxRows = 200;
const headers: { field: ScheduleField; label: string; width: number }[] = [
  { field: 'locationName', label: 'Location name', width: 28 },
  { field: 'address', label: 'Address', width: 38 },
  { field: 'occupancy', label: 'Occupancy', width: 28 },
  { field: 'sumInsured', label: 'Sum insured', width: 20 },
  { field: 'currency', label: 'Currency', width: 12 },
  { field: 'coverage', label: 'Coverage / peril', width: 26 },
  { field: 'rate', label: 'Rate', width: 14 },
  { field: 'rateUnit', label: 'Rate unit', width: 15 },
  { field: 'rateBasis', label: 'Rate basis', width: 22 },
  { field: 'rateApplicability', label: 'Rate applicability', width: 32 },
  { field: 'deductible', label: 'Deductible', width: 30 },
  { field: 'remarks', label: 'Remarks', width: 34 },
];
const aliases: Record<string, ScheduleField> = Object.fromEntries([
  ['location name', 'locationName'], ['location', 'locationName'], ['nama lokasi', 'locationName'],
  ['address', 'address'], ['alamat', 'address'],
  ['occupancy', 'occupancy'], ['occupation', 'occupancy'], ['okupasi', 'occupancy'],
  ['sum insured', 'sumInsured'], ['tsi', 'sumInsured'], ['nilai pertanggungan', 'sumInsured'],
  ['currency', 'currency'], ['mata uang', 'currency'],
  ['coverage / peril', 'coverage'], ['coverage', 'coverage'], ['peril', 'coverage'], ['jaminan / peril', 'coverage'], ['risiko / jaminan', 'coverage'],
  ['rate', 'rate'], ['tarif', 'rate'],
  ['rate unit', 'rateUnit'], ['unit rate', 'rateUnit'], ['unit tarif', 'rateUnit'],
  ['rate basis', 'rateBasis'], ['basis rate', 'rateBasis'], ['basis tarif', 'rateBasis'],
  ['rate applicability', 'rateApplicability'], ['applicability', 'rateApplicability'], ['penerapan rate', 'rateApplicability'],
  ['deductible', 'deductible'], ['risiko sendiri', 'deductible'],
  ['remarks', 'remarks'], ['remark', 'remarks'], ['catatan', 'remarks'],
]);
const requiredFields: ScheduleField[] = headers.filter(header => header.field !== 'remarks').map(header => header.field);
const emptyData = (): ScheduleRowData => ({
  locationName: '', address: '', occupancy: '', sumInsured: '', currency: '', coverage: '',
  rate: '', rateUnit: '', rateBasis: '', rateApplicability: '', deductible: '', remarks: '',
});
const text = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if ('richText' in value && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
  if ('text' in value) return String(value.text);
  if ('error' in value) return `[Cell error: ${String(value.error)}]`;
  return '';
};
const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export async function createScheduleTemplate(): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Schedule');
  sheet.columns = headers.map(({ label, width }) => ({ header: label, key: label, width }));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = `A1:${String.fromCharCode(64 + headers.length)}1`;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183D3A' } };

  const guide = workbook.addWorksheet('Read me');
  guide.addRows([
    ['Property schedule template'],
    ['One row per insured location. Keep values as shown in the source; do not infer coverage or rate applicability.'],
    ['Sum insured currency must be explicit. Rate must include its unit (percent or per-mille) and basis.'],
    ['Formula cells are not imported. Replace them with verified values before upload.'],
    ['Template schedule format is designed for broker review; it is not client confirmation or a legal/OJK assessment.'],
    ['Format template jadwal properti'],
    ['Satu baris per lokasi. Pertahankan nilai sesuai sumber; jangan menyimpulkan jaminan atau penerapan rate.'],
    ['Mata uang sum insured harus eksplisit. Rate harus menyertakan unit (percent atau per-mille) dan basis.'],
    ['Sel formula tidak diimpor. Ganti dengan nilai yang telah diverifikasi sebelum mengunggah.'],
    ['Template ini untuk review broker; bukan konfirmasi klien atau penilaian hukum/OJK.'],
  ]);
  guide.getColumn(1).width = 110;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], { type: xlsxMime });
}

export async function importScheduleWorkbook(file: File): Promise<{ rows: ScheduleRow[]; warnings: string[] }> {
  const prepared = await prepareDocument(file);
  if (prepared.kind !== 'xlsx' || !prepared.coverage.complete) throw new Error('Upload a readable XLSX within the preparation limits.');

  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const bytes = new Uint8Array(await file.arrayBuffer());
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  if (!workbook.worksheets.length || workbook.worksheets.length > 50) throw new Error('The workbook must contain 1–50 sheets.');

  const warnings = [...prepared.warnings];
  const rows: ScheduleRow[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') {
      warnings.push(`Sheet tersembunyi "${sheet.name}" tidak diimpor.`);
      continue;
    }
    let mapping: Partial<Record<ScheduleField, number>> | undefined;
    let headerRow = 0;
    for (let number = 1; number <= Math.min(sheet.rowCount, 20); number++) {
      const candidate: Partial<Record<ScheduleField, number>> = {};
      let duplicate = false;
      sheet.getRow(number).eachCell({ includeEmpty: false }, (cell, column) => {
        const field = aliases[normalize(text(cell.value))];
        if (!field) return;
        if (candidate[field] !== undefined) duplicate = true;
        candidate[field] = column;
      });
      if (duplicate) throw new Error(`Sheet "${sheet.name}", row ${number}: duplicate schedule headers.`);
      if (requiredFields.every(field => candidate[field] !== undefined)) {
        mapping = candidate; headerRow = number; break;
      }
    }
    if (!mapping) {
      warnings.push(`Sheet "${sheet.name}" skipped; required schedule template headers were not found.`);
      continue;
    }

    for (let number = headerRow + 1; number <= sheet.rowCount; number++) {
      const row = sheet.getRow(number), imported = emptyData();
      const cells: Partial<Record<ScheduleField, string>> = {};
      const formulaCells: string[] = [], rowWarnings: string[] = [];
      let hasData = false;
      for (const { field } of headers) {
        const column = mapping[field];
        if (column === undefined) continue;
        const cell = row.getCell(column);
        cells[field] = cell.address;
        if (cell.value === null || cell.value === undefined) continue;
        hasData = true;
        if (cell.type === ExcelJS.ValueType.Formula) {
          formulaCells.push(cell.address);
          rowWarnings.push(`Formula cell ${cell.address} was not imported; replace it with a verified value.`);
          continue;
        }
        if (field === 'rate' && typeof cell.value === 'number' && cell.numFmt.includes('%')) {
          rowWarnings.push(`Rate cell ${cell.address} uses Excel percentage formatting; verify the displayed source rate and correct it before saving.`);
        }
        imported[field] = text(cell.value);
      }
      if (!hasData) continue;
      if (row.hidden) rowWarnings.push('This is a hidden row; check the original source before using its values.');
      rows.push({
        id: `row-${rows.length + 1}`,
        source: { sheetName: sheet.name, rowNumber: number, cells, formulaCells, hidden: row.hidden, warnings: [...rowWarnings] },
        imported: structuredClone(imported),
        values: structuredClone(imported),
        warnings: [...rowWarnings],
      });
      if (rows.length > maxRows) throw new Error(`The import is limited to ${maxRows} rows per reviewed schedule version. Split the workbook and review each part.`);
    }
  }
  if (!rows.length) throw new Error('No schedule rows were imported. Use the Rekonvia template on a visible sheet.');
  return { rows, warnings: [...new Set(warnings)] };
}
