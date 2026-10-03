import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDuplicates, detectRecurring, runIntelligence } from '../js/core/pipeline.js';
import { classify } from '../js/core/classifier.js';
import { kpis, makeCtx, periodRange, budgetStatus, emiSchedule } from '../js/core/analytics.js';
import { emptyState } from '../js/core/ingest.js';
import { tx } from './helpers.mjs';
test('duplicates flagged, not deleted', () => {
  const a = tx({ import_id: 'I1', description: 'UPI-SWIGGY', debit: 300, reference_number: '111' }), b = tx({ import_id: 'I2', description: 'UPI-SWIGGY', debit: 300, reference_number: '111', created_at: '2026-10-01T00:00:00Z' });
  const list = [a, b]; detectDuplicates(list); assert.equal(list.length, 2); assert.equal(b.is_duplicate, true);
});
test('own transfer not an expense; card bill not double counted', () => {
  const st = emptyState(); st.accounts = [{ id: 'H', bank_name: 'HDFC', account_type: 'Savings' }, { id: 'S', bank_name: 'SBI', account_type: 'Savings' }];
  st.transactions = [tx({ account_id: 'H', description: 'NEFT DR-SBIN0001-OWN', debit: 50000, transaction_date: '2026-09-03' }), tx({ account_id: 'S', description: 'BY TRANSFER-NEFT HDFC', credit: 50000, transaction_date: '2026-09-04' }), tx({ account_id: 'H', description: 'UPI-SWIGGY', debit: 400, transaction_date: '2026-09-05' })];
  runIntelligence(st, '2026-09-30'); assert.equal(kpis(st.transactions, makeCtx(st)).expenses, 400);
  const s2 = emptyState(); s2.accounts = [{ id: 'H', account_type: 'Savings' }, { id: 'C', account_type: 'Credit Card' }];
  s2.transactions = [tx({ account_id: 'C', account_type: 'Credit Card', description: 'AMAZON', debit: 5000, transaction_date: '2026-09-02' }), tx({ account_id: 'H', description: 'CREDIT CARD PAYMENT NETBANKING', debit: 5000, transaction_date: '2026-09-20' })];
  runIntelligence(s2, '2026-09-30'); assert.equal(kpis(s2.transactions, makeCtx(s2)).expenses, 5000);
});
test('recurring Netflix; budgets; EMI maths; periods', () => {
  const list = []; for (let m = 1; m <= 6; m++) list.push(classify(tx({ description: 'NETFLIX.COM', debit: 649, transaction_date: `2026-0${m}-07` })));
  const rec = detectRecurring(list, '2026-06-30'); assert.deepEqual([rec[0].merchant, rec[0].annual_cost, rec[0].next_expected], ['Netflix', 7788, '2026-07-07']);
  const st = emptyState(); st.accounts = [{ id: 'A' }]; st.transactions = [tx({ description: 'UPI-SWIGGY', debit: 8200, transaction_date: '2026-09-06' })]; runIntelligence(st, '2026-09-30');
  assert.equal(budgetStatus([{ category: 'Food & Dining', amount: 10000 }], st.transactions, makeCtx(st), '2026-09')[0].status, 'nearing');
  assert.equal(emiSchedule({ principal: 1000000, ratePct: 12, tenureMonths: 12, startDate: new Date().toISOString().slice(0, 10) }).emi, 88848.79);
  assert.deepEqual(periodRange('last_month', '2026-03-15'), ['2026-02-01', '2026-02-28']);
});
