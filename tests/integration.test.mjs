import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadAllSamples, sample } from './helpers.mjs';
import { ingest, correctTransaction, findRegistered, deleteImport } from '../js/core/ingest.js';
import { parseCSVText } from '../js/core/parsers.js';
import * as A from '../js/core/analytics.js';
import { ask } from '../js/core/assistant.js';
import { demoCardLoanLines } from '../js/core/demo.js';
test('HDFC + SBI + card samples', () => {
  const { st, h, s } = loadAllSamples();
  assert.equal(h.detectedBank, 'HDFC'); assert.equal(s.detectedBank, 'SBI');
  assert.ok(st.transactions.every(t => /^XXXX XXXX \d{4}$/.test(t.account_number_masked)));
  const [f, t] = A.periodRange('this_month', A.latestDate(st.transactions));
  const k = A.kpis(A.filterTxns(st.transactions, { from: f, to: t }), A.makeCtx(st));
  assert.ok(k.income >= 150000 && k.transfers >= 40000);
});
test('re-import flagged; registry; corrections; assistant incl. card loan', () => {
  const { st } = loadAllSamples(); const ctx = A.makeCtx(st); const before = A.kpis(st.transactions, ctx).expenses;
  const r = ingest(st, { kind: 'csv', rows: parseCSVText(fs.readFileSync(sample('synthetic_hdfc_statement.csv'), 'utf8')), fileName: 'again.csv', bank: 'Auto', accountType: 'Savings', last4: '1234', hash: 'h1' });
  assert.equal(r.duplicates, r.processed); assert.equal(A.kpis(st.transactions, ctx).expenses, before); assert.ok(findRegistered(st, 'h1'));
  deleteImport(st, r.id);
  const t = st.transactions.find(x => x.merchant === 'Rahul Sharma'); correctTransaction(st, t.transaction_id, { category: 'Transfers', subcategory: 'Family Transfer' });
  assert.ok(st.transactions.filter(x => x.merchant === 'Rahul Sharma').every(x => x.subcategory === 'Family Transfer'));
  ingest(st, { kind: 'pdf', lines: demoCardLoanLines().lines, fileName: 'l.pdf', bank: 'Auto' });
  assert.match(ask('show my loans', st, ctx).answer, /Credit Card Insta Loan.*outstanding/s);
});
test('no credential-like fields in state', () => {
  const { st } = loadAllSamples(); const json = JSON.stringify(st).toLowerCase();
  for (const w of ['"password"', '"otp"', '"upi_pin"', '"cvv"', '"pin"']) assert.ok(!json.includes(w), w);
});
