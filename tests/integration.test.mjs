import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadAllSamples, sample } from './helpers.mjs';
import { ingest, correctTransaction, deleteImport } from '../js/core/ingest.js';
import { parseCSVText } from '../js/core/parsers.js';
import * as A from '../js/core/analytics.js';
import { ask } from '../js/core/assistant.js';
import { generateDemo } from '../js/core/demo.js';
import { MockAccountAggregatorProvider } from '../js/core/providers.js';

test('upload HDFC + SBI + card → banks detected, summary counts', () => {
  const { st, h, s, c } = loadAllSamples();
  assert.equal(h.detectedBank, 'HDFC'); assert.equal(s.detectedBank, 'SBI');
  assert.equal(h.processed + s.processed + c.processed, st.transactions.length);
  assert.ok(h.categorized / h.processed > 0.9);
  assert.equal(st.accounts.length, 3);
  assert.ok(st.transactions.every(t => /^XXXX XXXX \d{4}$/.test(t.account_number_masked)));
});
test('dashboard numbers are computed from data and transfers excluded', () => {
  const { st } = loadAllSamples(); const ctx = A.makeCtx(st);
  const [f, t] = A.periodRange('this_month', A.latestDate(st.transactions));
  const k = A.kpis(A.filterTxns(st.transactions, { from: f, to: t }), ctx);
  assert.ok(k.income >= 150000 && k.income < 151000, 'salary + interest');
  assert.ok(k.transfers >= 40000, 'HDFC→SBI 40k self transfer detected');
  assert.ok(k.expenses > 0 && k.expenses < k.income);
  const rec = st.recurring.map(r => r.merchant);
  for (const m of ['Rent', 'Netflix', 'Spotify', 'HDFC Bank Home Loan EMI']) assert.ok(rec.includes(m), m);
});
test('re-importing the same statement flags duplicates and does not change expenses', () => {
  const { st } = loadAllSamples(); const ctx = A.makeCtx(st); const before = A.kpis(st.transactions, ctx).expenses;
  const r = ingest(st, { kind: 'csv', rows: parseCSVText(fs.readFileSync(sample('synthetic_hdfc_statement.csv'), 'utf8')), fileName: 'again.csv', bank: 'Auto', accountType: 'Savings', last4: '1234' });
  assert.equal(r.duplicates, r.processed);
  assert.equal(A.kpis(st.transactions, ctx).expenses, before);
});
test('category correction persists, is learned, and survives recalculation', () => {
  const { st } = loadAllSamples();
  const t = st.transactions.find(x => x.merchant === 'Rahul Sharma');
  correctTransaction(st, t.transaction_id, { category: 'Transfers', subcategory: 'Family Transfer' });
  const all = st.transactions.filter(x => x.merchant === 'Rahul Sharma');
  assert.ok(all.length > 1 && all.every(x => x.subcategory === 'Family Transfer'));
  const copy = JSON.parse(JSON.stringify(st)); // persisted form
  assert.equal(copy.categoryOverrides['Rahul Sharma'][1], 'Family Transfer');
});
test('assistant answers only from data and returns source transactions', () => {
  const { st } = loadAllSamples(); const ctx = A.makeCtx(st);
  const r = ask('How much did I spend on food last month?', st, ctx);
  const total = r.sources.reduce((a, t) => a + t.debit, 0);
  assert.match(r.answer, /Food & Dining/); assert.ok(r.answer.includes(Math.round(total).toLocaleString('en-IN')));
  assert.ok(r.sources.every(s => st.transactions.includes(s)));
  assert.match(ask('Show transactions above ₹10,000', st, ctx).answer, /above ₹10,000/);
  assert.match(ask('Compare HDFC and SBI spending', st, ctx).answer, /HDFC: ₹.*\n.*SBI/s);
});
test('deleting an import removes its transactions & orphan account', () => {
  const { st, c } = loadAllSamples(); deleteImport(st, c.id);
  assert.ok(!st.transactions.some(t => t.import_id === c.id)); assert.equal(st.accounts.length, 2);
});
test('state never contains credential-like fields', () => {
  const { st } = loadAllSamples(); const json = JSON.stringify(st).toLowerCase();
  for (const w of ['"password"', '"otp"', '"upi_pin"', '"cvv"', '"pin"']) assert.ok(!json.includes(w), w);
});
test('demo generator is deterministic & mock AA consent lifecycle works', async () => {
  assert.deepEqual(generateDemo('2026-09-30', 3, 1), generateDemo('2026-09-30', 3, 1));
  const p = new MockAccountAggregatorProvider(generateDemo('2026-09-30', 2, 1));
  const { consentHandle } = await p.initiateConsent({ banks: ['HDFC', 'SBI'] });
  assert.equal(await p.getConsentStatus(consentHandle), 'ACTIVE');
  const accs = await p.fetchAccounts(consentHandle); assert.equal(accs.length, 2);
  assert.ok((await p.fetchTransactions(consentHandle, accs[0])).length > 10);
  await p.revokeConsent(consentHandle);
  await assert.rejects(p.fetchTransactions(consentHandle, accs[0]));
});
test('performance: 100k transactions process in reasonable time', () => {
  const { st } = loadAllSamples(); const base = st.transactions.slice();
  const big = []; for (let i = 0; big.length < 100000; i++) for (const t of base) big.push({ ...t, transaction_id: t.transaction_id + '_' + i, reference_number: t.reference_number + i, import_id: 'perf' + i });
  st.transactions = big.slice(0, 100000);
  const t0 = Date.now(); A.kpis(st.transactions, A.makeCtx(st)); A.byCategory(st.transactions, A.makeCtx(st)); A.monthly(st.transactions, A.makeCtx(st));
  assert.ok(Date.now() - t0 < 5000, `analytics took ${Date.now() - t0}ms`);
});
test('PDF bank detection ignores other banks mentioned in narrations', () => {
  const st = { ...loadAllSamples().st, transactions: [], accounts: [], imports: [] };
  const r = ingest(st, { kind: 'pdf', lines: ['HDFC BANK Ltd. - Statement of Account', 'Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance', 'Opening Balance 10,000.00', '03/09/26 IB FUNDS TRANSFER DR-SBI SELF 400000000001 03/09/26 5,000.00 5,000.00'], fileName: 'x.pdf', bank: 'Auto', accountType: 'Savings', last4: '1234' });
  assert.equal(r.bank, 'HDFC');
});
