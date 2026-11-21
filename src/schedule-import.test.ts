import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createScheduleTemplate, importScheduleWorkbook } from './schedule-import.ts';

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const headers = [
  'Location name', 'Address', 'Occupancy', 'Sum insured', 'Currency', 'Coverage / peril',
  'Rate', 'Rate unit', 'Rate basis', 'Rate applicability', 'Deductible', 'Remarks',
];

test('schedule template includes explicit rate context, currency, and review guidance', async () => {
  const blob = await createScheduleTemplate();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await blob.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Schedule', 'Read me']);
  const headerValues = workbook.getWorksheet('Schedule')!.getRow(1).values as unknown[];
  assert.deepEqual(headerValues.slice(1), headers);
  assert.match(String(workbook.getWorksheet('Read me')!.getCell('A5').value), /not client confirmation or a legal\/OJK assessment/i);
});

test('schedule import captures row and cell provenance and never uses cached formulas', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Insured sites');
  sheet.getCell('A1').value = 'Broker working copy';
  sheet.addRow([]);
  sheet.addRow(headers);
  sheet.addRow([
    'Factory A', 'District road', 'Metal component manufacturing', 3500000000, 'IDR', 'Property All Risks',
    { formula: '0.0483', result: 0.0483 }, 'percent', 'sum-insured', 'As stated in insurer quote',
    'IDR 10,000,000 each occurrence', 'Verify occupancy with client',
  ]);
  sheet.getRow(4).hidden = true;
  const file = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'schedule.xlsx', { type: xlsxMime });

  const result = await importScheduleWorkbook(file);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.source.sheetName, 'Insured sites');
  assert.equal(result.rows[0]!.source.rowNumber, 4);
  assert.equal(result.rows[0]!.source.cells.sumInsured, 'D4');
  assert.deepEqual(result.rows[0]!.source.formulaCells, ['G4']);
  assert.equal(result.rows[0]!.imported.sumInsured, '3500000000');
  assert.equal(result.rows[0]!.imported.rate, '');
  assert.equal(result.rows[0]!.imported.rateUnit, 'percent');
  assert.equal(result.rows[0]!.source.hidden, true);
  assert.match(result.rows[0]!.warnings.join(' '), /Formula cell G4 was not imported/);
  assert.match(result.rows[0]!.warnings.join(' '), /This is a hidden row/);
});

test('percentage-formatted numeric rates are left unconverted and require correction', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Schedule');
  sheet.addRow(headers);
  sheet.addRow([
    'Factory A', 'District road', 'Manufacturing', 3500000000, 'IDR', 'Property All Risks',
    0.0483, 'percent', 'sum-insured', 'As stated in insurer quote',
    'IDR 10,000,000 each occurrence', 'Verify occupancy with client',
  ]);
  sheet.getCell('G2').numFmt = '0.00%';
  const file = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'formatted-rate.xlsx', { type: xlsxMime });
  const result = await importScheduleWorkbook(file);
  const row = result.rows[0]!;
  assert.equal(row.imported.rate, '0.0483');
  assert.match(row.warnings.join(' '), /Rate cell G2 uses Excel percentage formatting/);
});

test('schedule import rejects non-template workbooks instead of guessing column meanings', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Schedule').addRow(['Location', 'Address', 'Sum insured']);
  const file = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], 'other.xlsx', { type: xlsxMime });
  await assert.rejects(importScheduleWorkbook(file), /No schedule rows were imported/);
});
