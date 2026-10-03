import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCSVText, mapColumns, detectBank, HDFCStatementParser, SBIStatementParser, GenericCSVParser, GenericPDFParser, detectFileKind, StatementError } from '../js/core/parsers.js';
import { readXlsx, itemsToLines, writeXlsx } from '../js/core/xlsx.js';
import { sample, JSZip } from './helpers.mjs';

test('CSV parser handles quotes, embedded commas and newlines', () => {
  const rows = parseCSVText('a,b\n"x, y","he said ""hi"""\n"multi\nline",2');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']]);
});
test('columns are mapped dynamically (not a fixed layout)', () => {
  const m = mapColumns(['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
  assert.deepEqual([m.date, m.description, m.reference, m.valueDate, m.debit, m.credit, m.balance], [0, 1, 2, 3, 4, 5, 6]);
  const s = mapColumns(['Balance', 'Credit', 'Debit', 'Description', 'Txn Date']); // shuffled
  assert.deepEqual([s.date, s.description, s.debit, s.credit, s.balance], [4, 3, 2, 1, 0]);
});
test('bank detection uses header area, ignores other banks in narrations', () => {
  assert.equal(detectBank('State Bank of India Txn Date Value Date Description Ref No./Cheque No. Debit Credit Balance'), 'SBI');
  assert.equal(detectBank('HDFC BANK Ltd Date Narration Chq./Ref.No.'), 'HDFC');
  assert.equal(detectBank('Date Particulars Amount'), 'Other');
});
test('HDFC CSV sample parses with debit/credit/balance', () => {
  const raw = new HDFCStatementParser().parseTable(parseCSVText(fs.readFileSync(sample('synthetic_hdfc_statement.csv'), 'utf8')));
  assert.ok(raw.length > 100);
  const sal = raw.find(r => /SALARY/.test(r.description));
  assert.equal(sal.credit, 150000); assert.equal(sal.debit, 0); assert.ok(sal.balance > 0);
});
test('SBI CSV sample parses "5 Sep 2026" dates', () => {
  const raw = new SBIStatementParser().parseTable(parseCSVText(fs.readFileSync(sample('synthetic_sbi_statement.csv'), 'utf8')));
  assert.ok(raw.length > 80);
  assert.match(raw[0].date, /^2026-\d\d-\d\d$/);
});
test('Amount + Dr/Cr single-column format (credit cards)', () => {
  const raw = new GenericCSVParser().parseTable(parseCSVText('Transaction Date,Transaction Details,Amount,Dr/Cr\n2026-09-01,AMAZON,500.00,Dr\n2026-09-02,PAYMENT RECEIVED,900.00,Cr'));
  assert.deepEqual(raw.map(r => [r.debit, r.credit]), [[500, 0], [0, 900]]);
});
test('unsupported layout raises a friendly error', () => {
  assert.throws(() => new GenericCSVParser().parseTable([['foo', 'bar'], ['1', '2']]), e => e instanceof StatementError && /not currently supported/.test(e.userMessage));
});
test('file type is detected from magic bytes, not just extension', () => {
  assert.equal(detectFileKind('x.csv', new Uint8Array([0x25, 0x50, 0x44, 0x46])), 'pdf');
  assert.equal(detectFileKind('x.pdf', new Uint8Array([0x50, 0x4b, 3, 4])), 'xlsx');
  assert.equal(detectFileKind('x.exe', new Uint8Array([0x4d, 0x5a])), 'unknown');
});
test('PDF line parser infers direction from running balance', () => {
  const raw = new GenericPDFParser().parseLines(['Opening Balance 10,000.00', '01/09/26 SALARY ACME 123456789012 01/09/26 5,000.00 15,000.00', '02/09/26 UPI-SWIGGY 02/09/26 500.00 14,500.00', 'continued narration']);
  assert.deepEqual(raw.map(r => [r.credit, r.debit]), [[5000, 0], [0, 500]]);
  assert.equal(raw[0].reference, '123456789012');
});
test('XLSX writer → reader round trip', async () => {
  const buf = await writeXlsx([{ name: 'S', rows: [['Date', 'Narration', 'Debit'], ['01/09/2026', 'A & B <x>', 12.5]] }], JSZip);
  const rows = await readXlsx(buf, JSZip);
  assert.deepEqual(rows, [['Date', 'Narration', 'Debit'], ['01/09/2026', 'A & B <x>', '12.5']]);
});
test('INTEGRATION: SBI XLSX sample statement', async () => {
  const rows = await readXlsx(fs.readFileSync(sample('synthetic_sbi_statement.xlsx')), JSZip);
  const raw = new SBIStatementParser().parseTable(rows);
  assert.ok(raw.length > 80);
});
test('INTEGRATION: HDFC PDF sample statement via pdf.js', async () => {
  globalThis.DOMMatrix ??= class DOMMatrix {}; // text extraction only; browsers provide the real one
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(sample('synthetic_hdfc_statement.pdf'))), isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) lines.push(...itemsToLines((await (await doc.getPage(p)).getTextContent()).items));
  const raw = new GenericPDFParser('HDFC').parseLines(lines);
  assert.equal(raw.length, 60);
  const csv = new HDFCStatementParser().parseTable(parseCSVText(fs.readFileSync(sample('synthetic_hdfc_statement.csv'), 'utf8'))).slice(0, 60);
  raw.forEach((r, i) => { assert.equal(r.date, csv[i].date); assert.equal(r.debit, csv[i].debit); assert.equal(r.credit, csv[i].credit); });
});
