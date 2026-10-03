import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCSVText, mapColumns, detectBank, HDFCStatementParser, SBIStatementParser, GenericCSVParser, GenericPDFParser, detectFileKind, StatementError } from '../js/core/parsers.js';
import { readXlsx, writeXlsx } from '../js/core/xlsx.js';
import { sample, JSZip, pdfLines } from './helpers.mjs';
test('CSV parser handles quotes and newlines', () => assert.deepEqual(parseCSVText('a,b\n"x, y","he said ""hi"""\n"multi\nline",2'), [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']]));
test('dynamic columns & bank detection', () => {
  const m = mapColumns(['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
  assert.deepEqual([m.date, m.description, m.debit, m.credit, m.balance], [0, 1, 4, 5, 6]);
  assert.equal(detectBank('State Bank of India Txn Date Description'), 'SBI'); assert.equal(detectBank('HDFC BANK Ltd Date Narration'), 'HDFC');
});
test('HDFC/SBI CSV + Dr/Cr + unsupported', () => {
  assert.ok(new HDFCStatementParser().parseTable(parseCSVText(fs.readFileSync(sample('synthetic_hdfc_statement.csv'), 'utf8'))).length > 100);
  assert.ok(new SBIStatementParser().parseTable(parseCSVText(fs.readFileSync(sample('synthetic_sbi_statement.csv'), 'utf8'))).length > 80);
  assert.deepEqual(new GenericCSVParser().parseTable(parseCSVText('Date,Details,Amount,Dr/Cr\n2026-09-01,AMAZON,500.00,Dr\n2026-09-02,PAY,900.00,Cr')).map(r => [r.debit, r.credit]), [[500, 0], [0, 900]]);
  assert.throws(() => new GenericCSVParser().parseTable([['foo'], ['1']]), e => e instanceof StatementError);
});
test('file kind from magic bytes', () => { assert.equal(detectFileKind('x.csv', new Uint8Array([0x25, 0x50, 0x44, 0x46])), 'pdf'); assert.equal(detectFileKind('x.exe', new Uint8Array([0x4d, 0x5a])), 'unknown'); });
test('XLSX round trip + SBI XLSX sample', async () => {
  const buf = await writeXlsx([{ name: 'S', rows: [['Date', 'Narration', 'Debit'], ['01/09/2026', 'A & B', 12.5]] }], JSZip);
  assert.deepEqual(await readXlsx(buf, JSZip), [['Date', 'Narration', 'Debit'], ['01/09/2026', 'A & B', '12.5']]);
  assert.ok(new SBIStatementParser().parseTable(await readXlsx(fs.readFileSync(sample('synthetic_sbi_statement.xlsx')), JSZip)).length > 80);
});
test('INTEGRATION: HDFC bank PDF via pdf.js', async () => { assert.equal(new GenericPDFParser('HDFC').parseLines(await pdfLines('synthetic_hdfc_statement.pdf')).length, 60); });
