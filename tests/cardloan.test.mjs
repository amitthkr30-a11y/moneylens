// HDFC credit-card loan "Loan EMI Table" (Insta Loan / Jumbo Loan). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmiTable, parseLoanStatement, upsertLoan } from '../js/core/loanParser.js';
import { ingest, emptyState } from '../js/core/ingest.js';
import { kpis, makeCtx, calendarEvents, loanOutstanding } from '../js/core/analytics.js';
import { demoCardLoanLines } from '../js/core/demo.js';
import { pdfLines } from './helpers.mjs';

test('INTEGRATION: card-loan PDF with real table layout (bordered cells, 2-line headers, 2 pages)', async () => {
  const lines = await pdfLines('synthetic_hdfc_card_loan_emi_table.pdf');
  assert.ok(isEmiTable(lines.join(' ')));
  const l = parseLoanStatement(lines); const c = demoCardLoanLines();
  assert.deepEqual([l.kind, l.bank, l.product, l.accountMasked, l.loanAmount, l.rate, l.estTenureMonths], ['emi_table', 'HDFC', 'Credit Card Insta Loan', 'XXXX XXXX 1234', 300000, 12.5, 36]);
  assert.equal(l.outstanding, +c.outs); assert.equal(l.schedule.length, 36);
  assert.deepEqual([l.emisPaid, l.remainingEmis, l.firstEmiDate, l.lastEmiDate], [29, 7, '2024-04-16', '2027-03-16']);
  assert.equal(l.currentEmi, 10036.09); assert.equal(l.transactions.length, 29);
});
test('flat text (as extracted by other PDF readers: all on one line)', () => {
  const l = parseLoanStatement([demoCardLoanLines().lines.join(' ')]);
  assert.deepEqual([l.emisPaid, l.remainingEmis, l.schedule.length], [29, 7, 36]);
});
test('fallback when header cells are emitted out of order', () => {
  const lines = ['Loan EMI Table', 'Loan Number Loan Booked Date Loan Type', '0000000000900005555', '05 Jan 2025', 'JUMBOLOAN', '30000.00', '15.00', '3', '10124.38',
    'Principal (Rs.) Interest (Rs.) Statement Date', '9781.88 619.32 16 Feb 2025', '9998.86 252.04 16 Mar 2025', '10124.38 126.55 16 Apr 2025'];
  const l = parseLoanStatement(lines);
  assert.deepEqual([l.product, l.emisPaid, l.remainingEmis, l.outstanding, l.interestRemaining, l.nextEmiDate], ['Credit Card Jumbo Loan', 2, 1, 10124.38, 126.55, '2025-04-16']);
});
test('ingest: detected even if "Savings" selected; no expense double-count; exact outstanding; calendar', () => {
  const st = emptyState();
  const r = ingest(st, { kind: 'pdf', lines: demoCardLoanLines().lines, fileName: 'LINKED LOANS.pdf', bank: 'Auto', accountType: 'Savings', last4: '', hash: 'h1' });
  assert.deepEqual([r.type, r.loanKind, r.emisPaid, r.remainingEmis], ['loan', 'emi_table', 29, 7]);
  assert.equal(kpis(st.transactions, makeCtx(st)).expenses, 0);
  const o = loanOutstanding(st.loanAccounts[0]); assert.ok(o.exact); assert.equal(o.outstanding, +demoCardLoanLines().outs);
  assert.ok(calendarEvents(st, '2026-09-01', 30).some(e => e.type === 'Loan EMI' && e.date === '2026-09-16'));
});
test('newer EMI table merges without duplicates', () => {
  const st = { loanAccounts: [] };
  upsertLoan(st, parseLoanStatement(demoCardLoanLines(28).lines), 'i1');
  upsertLoan(st, parseLoanStatement(demoCardLoanLines(29).lines), 'i2');
  assert.deepEqual([st.loanAccounts.length, st.loanAccounts[0].transactions.length, st.loanAccounts[0].emisPaid], [1, 29, 29]);
});
test('clear error when details row missing', () => assert.throws(() => parseLoanStatement(['Loan EMI Table', 'nothing']), /Loan Number/));
