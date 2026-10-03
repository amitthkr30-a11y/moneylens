// Regenerates SYNTHETIC sample statements in /samples (CSV, XLSX, PDF). Never use real statements.
// Usage: node scripts/make-samples.mjs   (PDF generation needs: npm i -D pdf-lib)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { generateDemo, toBankCSV } from '../js/core/demo.js';
import { writeXlsx } from '../js/core/xlsx.js';
const require = createRequire(import.meta.url);
const JSZip = require('../vendor/jszip/jszip.min.js');
const d = generateDemo('2026-09-30', 6, 7);
fs.mkdirSync('samples', { recursive: true });
fs.writeFileSync('samples/synthetic_hdfc_statement.csv', toBankCSV(d.HDFC, 'HDFC'));
fs.writeFileSync('samples/synthetic_sbi_statement.csv', toBankCSV(d.SBI, 'SBI'));
fs.writeFileSync('samples/synthetic_hdfc_credit_card.csv', 'Transaction Date,Transaction Details,Amount,Dr/Cr\n' + d.CARD.map(t => [t.date, `"${t.description}"`, (t.debit || t.credit).toFixed(2), t.debit ? 'Dr' : 'Cr'].join(',')).join('\n'));
const sbiRows = [['State Bank of India'], ['Account Statement - SYNTHETIC DEMO DATA'], [], ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance'],
  ...d.SBI.map(t => [t.date.split('-').reverse().join('-'), t.valueDate.split('-').reverse().join('-'), t.description, t.reference, t.debit || '', t.credit || '', t.balance])];
fs.writeFileSync('samples/synthetic_sbi_statement.xlsx', await writeXlsx([{ name: 'Statement', rows: sbiRows }], JSZip));
let PDFLib; try { PDFLib = require('pdf-lib'); } catch { console.log('pdf-lib not installed — skipping PDF sample'); process.exit(0); }
const { PDFDocument, StandardFonts } = PDFLib;
const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
const rows = d.HDFC.slice(0, 60); let page, y;
const f = s => { const [yy, m, dd] = s.split('-'); return `${dd}/${m}/${yy.slice(2)}`; };
const newPage = () => { page = doc.addPage([842, 595]); y = 560; page.drawText('HDFC BANK Ltd. - Statement of Account (SYNTHETIC DEMO DATA)', { x: 30, y, size: 11, font }); y -= 22;
  [['Date', 30], ['Narration', 80], ['Chq./Ref.No.', 400], ['Value Dt', 500], ['Withdrawal Amt.', 560], ['Deposit Amt.', 650], ['Closing Balance', 740]].forEach(([t, x]) => page.drawText(t, { x, y, size: 8, font })); y -= 16; };
newPage();
page.drawText('Opening Balance', { x: 80, y, size: 8, font }); page.drawText((rows[0].balance + rows[0].debit - rows[0].credit).toFixed(2), { x: 740, y, size: 8, font }); y -= 14;
for (const t of rows) {
  if (y < 40) newPage();
  const n = v => v ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  page.drawText(f(t.date), { x: 30, y, size: 8, font }); page.drawText(t.description.slice(0, 62), { x: 80, y, size: 7, font });
  page.drawText(t.reference, { x: 400, y, size: 7, font }); page.drawText(f(t.valueDate), { x: 500, y, size: 8, font });
  if (t.debit) page.drawText(n(t.debit), { x: 560, y, size: 8, font }); if (t.credit) page.drawText(n(t.credit), { x: 650, y, size: 8, font });
  page.drawText(n(t.balance), { x: 740, y, size: 8, font }); y -= 14;
}
fs.writeFileSync('samples/synthetic_hdfc_statement.pdf', await doc.save());
console.log('samples written');
