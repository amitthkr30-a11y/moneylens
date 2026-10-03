// Regenerates SYNTHETIC sample statements in /samples (CSV, XLSX, PDF). Never commit real statements.
// Usage: node scripts/make-samples.mjs   (PDF generation needs: npm i -D pdf-lib)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { generateDemo, toBankCSV, demoLoanLines, demoCardLoanLines } from '../js/core/demo.js';
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
let PDFLib; try { PDFLib = require('pdf-lib'); } catch { console.log('pdf-lib not installed: skipping PDF samples'); process.exit(0); }
const { PDFDocument, StandardFonts, rgb } = PDFLib;

{ // HDFC bank statement PDF
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
}
{ // HDFC home-loan Statement of Account PDF
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]); let y = 800; const T = (s, x, sz = 8) => page.drawText(s, { x, y, size: sz, font });
  T('HDFC Bank Ltd. (SYNTHETIC DEMO DATA)                Account No : 900000005521   Page 1 of 1', 30); y -= 18;
  T('Loan Account Number : 900000005521', 30); y -= 14; T('STATEMENT OF ACCOUNT FOR THE PERIOD 01-APR-26 to 30-SEP-26', 30); y -= 14;
  T('LOAN AMOUNT : 1500000   ROI : 08.40%   CURRENT EMI : 14800   DISBURSEMENT UPTO DATE: 1500000', 30); y -= 18;
  for (const [lab, a, b, c] of [['Opening balance', '0', '0', '0'], ['Receivable', '88800', '0', '88800'], ['Received', '88800', '0', '88800']]) { T(lab, 30); T(a, 200); T(b, 260); T(c, 320); y -= 12; }
  y -= 8; [['Acc Dt', 30], ['Doc No', 95], ['PM', 160], ['Description', 185], ['Amount', 345], ['Eff Dt', 395], ['Bounce Reason', 460]].forEach(([t, x]) => T(t, x)); y -= 14;
  for (const line of demoLoanLines().filter(l => /^\d{2}-[A-Z]{3}-\d{4} /.test(l))) {
    const m = line.match(/^(\S+) (\S+) (\S) (.+?) (\(?[\d,]+\)?) (\S+)\s*(.*)$/);
    T(m[1], 30); T(m[2], 95); T(m[3], 160); T(m[4], 185); T(m[5], 345); T(m[6], 395); if (m[7]) T(m[7], 460, 7); y -= 13;
  }
  y -= 10; T('Negative amounts are indicated in brackets.', 30); y -= 12; T('Paymode: A-ACH Mandate; B-Cheque; W-Web Online Receipt;', 30); y -= 12; T('TYPE : DEMO HOME LOAN', 30);
  fs.writeFileSync('samples/synthetic_hdfc_loan_statement.pdf', await doc.save());
}
/** HDFC credit-card loan "Loan EMI Table" with the same table layout as the real PDF (bordered cells,
 *  two-line column headers, centred values, rows continuing on page 2). */
export async function cardLoanPdf({ accNo, booked, type, amount, rate, tenure, outs, rows, firstPage = 57 }) {
  const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica); const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842; let page = doc.addPage([W, H]);
  const center = (s, x0, x1, y, font = f, size = 7) => page.drawText(s, { x: (x0 + x1) / 2 - font.widthOfTextAtSize(s, size) / 2, y, size, font });
  const box = (x0, y0, x1, y1) => page.drawRectangle({ x: x0, y: y1, width: x1 - x0, height: y0 - y1, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.5 });
  page.drawRectangle({ x: 40, y: 790, width: 160, height: 26, color: rgb(0.05, 0.2, 0.55) });
  page.drawText('HDFC BANK', { x: 70, y: 797, size: 15, font: fb, color: rgb(1, 1, 1) });
  page.drawText('We understand your world', { x: 40, y: 776, size: 9, font: f });
  center('Loan EMI Table', 200, 395, 752, f, 9);
  const cols = [40, 130, 205, 280, 355, 440, 495, 560];
  const heads = [['Loan Number'], ['Loan Booked Date'], ['Loan Type'], ['Principal', 'Amount (Rs.)'], ['Interest Rate (%)'], ['Tenure', '(months)'], ['Principal', 'Outstanding (Rs.)']];
  let y = 742; box(cols[0], y, cols[7], y - 18);
  heads.forEach((h, i) => { box(cols[i], y, cols[i + 1], y - 18); if (h.length === 1) center(h[0], cols[i], cols[i + 1], y - 11, fb, 6.5); else { center(h[0], cols[i], cols[i + 1], y - 7, fb, 6.5); center(h[1], cols[i], cols[i + 1], y - 15, fb, 6.5); } });
  y -= 18; const vals = [accNo, booked, type, amount, rate, tenure, outs];
  vals.forEach((v, i) => { box(cols[i], y, cols[i + 1], y - 10); center(v, cols[i], cols[i + 1], y - 7.5, f, 6.5); });
  const tc = [40, 225, 410, 560]; y -= 22;
  ['Principal (Rs.)', 'Interest (Rs.)', 'Statement Date'].forEach((h, i) => { box(tc[i], y, tc[i + 1], y - 10); center(h, tc[i], tc[i + 1], y - 7.5, fb, 6.5); });
  y -= 10;
  rows.forEach((r, k) => {
    if (k === firstPage) { page.drawText('This is a system generated document and does not require signature.', { x: 40, y: y - 14, size: 8, font: f }); page = doc.addPage([W, H]); y = 800; }
    r.forEach((v, i) => { box(tc[i], y, tc[i + 1], y - 9.2); center(v, tc[i], tc[i + 1], y - 7, f, 6.5); }); y -= 9.2;
  });
  page.drawText('This is a system generated document and does not require signature.', { x: 40, y: 760, size: 8, font: f });
  return doc.save();
}
{ const c = demoCardLoanLines(); fs.writeFileSync('samples/synthetic_hdfc_card_loan_emi_table.pdf', await cardLoanPdf({ accNo: '0000000000900001234', booked: '10 Mar 2024', type: 'INSTALOAN', amount: '300000.00', rate: '12.50', tenure: '36', outs: c.outs, rows: c.rows, firstPage: 30 })); }
console.log('samples written');
