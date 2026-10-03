import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoanStatement, parseLoanStatement, estimateTenure, upsertLoan } from '../js/core/loanParser.js';
import { ingest, emptyState, findRegistered, deleteImport } from '../js/core/ingest.js';
import { demoLoanLines } from '../js/core/demo.js';
import { kpis, makeCtx } from '../js/core/analytics.js';
import { pdfLines } from './helpers.mjs';
// Same structure as HDFC home-loan "Statement of Account" text (column blocks); synthetic numbers.
const COLS = `HDFC Bank Account No : 900000007777 Page 1 of 2
Loan Account Number : **900000007777
STATEMENT OF ACCOUNT FOR THE PERIOD 01-APR-26 to 03-OCT-26** LOAN AMOUNT : 268583 ROI : 10.75% CURRENT EMI : 3700 DISBURSEMENT UPTO DATE: 268583 Opening balance 0 0 0 Receivable 22200 0 22200 Received 22200 0 22200
Acc Dt Doc No PM Description Amount Eff Dt Bounce Reason (For Chq Bounce if any) 06-APR-2026 06-MAY-2026 06-JUN-2026 06-JUL-2026 06-JUL-2026 09-JUL-2026
09-JUL-2026 09-JUL-2026
06-AUG-2026 06-SEP-2026
1111111095 2222222125 3333333156 4444444186 4444444186 55555559
55555559 55555559
6666666217 7777777248
A A A A B W
W W
A A
E M I E M I E M I E M I E M I INT ON UNPAID EMI/PEMI - L1 E M I CHEQUE DISHONOURED CHARGES E M I E M I
3700 3700 3700 3700 (3700) 3
3700 450
3700 3700
05-APR-2026 05-MAY-2026 05-JUN-2026 05-JUL-2026 05-JUL-2026 08-JUL-2026
08-JUL-2026 08-JUL-2026
05-AUG-2026 05-SEP-2026
BALANCE INSUFFICIENT
453 453 Receipts other than EMI and PMI
DATE :
TYPE : XPRESS HOME LOAN TOP-UP`.split('\n');
test('home-loan SOA (column layout): EMIs, bounce, charges', () => {
  const l = parseLoanStatement(COLS);
  assert.deepEqual([l.kind, l.product, l.loanAmount, l.rate, l.currentEmi, l.emisPaid, l.bounces, l.charges], ['soa', 'XPRESS HOME LOAN TOP-UP', 268583, 10.75, 3700, 6, 1, 453]);
  assert.equal(l.transactions.find(t => t.type === 'EMI bounced').bounceReason, 'BALANCE INSUFFICIENT');
});
test('home-loan SOA (row layout) + synthetic PDF', async () => {
  assert.deepEqual([parseLoanStatement(demoLoanLines()).bounces, parseLoanStatement(demoLoanLines()).charges], [1, 462]);
  const l = parseLoanStatement(await pdfLines('synthetic_hdfc_loan_statement.pdf'));
  assert.deepEqual([l.accountMasked, l.loanAmount, l.transactions.length, l.bounces], ['XXXX XXXX 5521', 1500000, 10, 1]);
});
test('privacy: borrower details are not stored', () => {
  const json = JSON.stringify(parseLoanStatement(['MR TEST BORROWER NAGPUR (CKYC No: XXXXXXXXXX1111)', ...demoLoanLines()]));
  assert.ok(!/BORROWER|NAGPUR|CKYC|900000005521/.test(json));
});
test('tenure estimate + ingest routing + merge + delete', () => {
  assert.equal(estimateTenure(268583, 10.75, 3700), 118);
  const st = emptyState();
  const r = ingest(st, { kind: 'pdf', lines: COLS, fileName: 'loan.pdf', bank: 'Auto', accountType: 'Savings', hash: 'abc' });
  assert.equal(r.type, 'loan'); assert.equal(st.transactions.length, 0); assert.equal(kpis(st.transactions, makeCtx(st)).expenses, 0);
  assert.equal(findRegistered(st, 'abc').type, 'loan');
  const again = ingest(st, { kind: 'pdf', lines: COLS, fileName: 'copy.pdf', bank: 'Auto', hash: 'def' });
  assert.deepEqual([again.added, st.loanAccounts.length], [0, 1]);
  deleteImport(st, r.id); deleteImport(st, again.id); assert.equal(st.loanAccounts.length, 0);
  const s2 = emptyState(); upsertLoan(s2, parseLoanStatement(demoLoanLines()), 'i1'); s2.loanAccounts[0].firstEmiDate = '2024-01-05';
  upsertLoan(s2, { ...parseLoanStatement(demoLoanLines()), periodTo: '2027-03-31' }, 'i2'); assert.equal(s2.loanAccounts[0].firstEmiDate, '2024-01-05');
});
