import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDuplicates, detectTransfers, detectRecurring, detectAnomalies, runIntelligence, DEFAULT_SETTINGS } from '../js/core/pipeline.js';
import { classify } from '../js/core/classifier.js';
import { kpis, makeCtx } from '../js/core/analytics.js';
import { emptyState } from '../js/core/ingest.js';
import { tx } from './helpers.mjs';

test('duplicates across imports are flagged, never deleted', () => {
  const a = tx({ import_id: 'I1', description: 'UPI-SWIGGY', debit: 300, reference_number: '111' });
  const b = tx({ import_id: 'I2', description: 'UPI-SWIGGY', debit: 300, reference_number: '111', created_at: '2026-10-01T00:00:00Z' });
  const list = [a, b]; detectDuplicates(list);
  assert.equal(list.length, 2); assert.ok(!a.is_duplicate); assert.equal(b.is_duplicate, true);
});
test('HDFC → SBI ₹50,000 own transfer is NOT an expense', () => {
  const st = emptyState();
  st.accounts = [{ id: 'H', bank_name: 'HDFC', account_type: 'Savings' }, { id: 'S', bank_name: 'SBI', account_type: 'Savings' }];
  st.transactions = [
    tx({ account_id: 'H', description: 'NEFT DR-SBIN0001-AMIT-OWN', debit: 50000, transaction_date: '2026-09-03' }),
    tx({ account_id: 'S', bank_name: 'SBI', description: 'BY TRANSFER-NEFT HDFC', credit: 50000, transaction_date: '2026-09-04' }),
    tx({ account_id: 'H', description: 'UPI-SWIGGY', debit: 400, transaction_date: '2026-09-05' }),
  ];
  runIntelligence(st, '2026-09-30');
  const k = kpis(st.transactions, makeCtx(st));
  assert.equal(k.expenses, 400); assert.equal(k.income, 0); assert.equal(k.transfers, 50000);
  assert.ok(st.transactions[0].is_transfer && st.transactions[1].is_transfer);
});
test('transfer not matched outside the window or same account', () => {
  const list = [tx({ account_id: 'H', debit: 5000, description: 'NEFT DR X', transaction_date: '2026-09-01' }), tx({ account_id: 'S', credit: 5000, description: 'NEFT CR', transaction_date: '2026-09-10' })];
  list.forEach(t => classify(t));
  assert.equal(detectTransfers(list, [{ id: 'H' }, { id: 'S' }], DEFAULT_SETTINGS), 0);
});
test('credit-card bill payment is not double counted when card statement imported', () => {
  const st = emptyState();
  st.accounts = [{ id: 'H', bank_name: 'HDFC', account_type: 'Savings' }, { id: 'C', bank_name: 'HDFC', account_type: 'Credit Card' }];
  st.transactions = [
    tx({ account_id: 'C', account_type: 'Credit Card', description: 'AMAZON', debit: 3000, transaction_date: '2026-09-02' }),
    tx({ account_id: 'C', account_type: 'Credit Card', description: 'FLIPKART', debit: 2000, transaction_date: '2026-09-03' }),
    tx({ account_id: 'H', description: 'CREDIT CARD PAYMENT NETBANKING', debit: 5000, transaction_date: '2026-09-20' }),
  ];
  runIntelligence(st, '2026-09-30');
  assert.equal(kpis(st.transactions, makeCtx(st)).expenses, 5000); // not 10,000
  st.settings.excludeCcPaymentIfCardImported = false;                // configurable rule
  assert.equal(kpis(st.transactions, makeCtx(st)).expenses, 10000);
});
test('recurring: monthly Netflix detected with next date & annual cost; random spends are not', () => {
  const list = [];
  for (let m = 1; m <= 6; m++) list.push(classify(tx({ description: 'NETFLIX.COM', debit: 649, transaction_date: `2026-0${m}-07` })));
  for (let m = 1; m <= 6; m++) list.push(classify(tx({ description: 'UPI-SWIGGY', debit: 200 + m * 37, transaction_date: `2026-0${m}-10` })));
  const rec = detectRecurring(list, '2026-06-30');
  assert.equal(rec.length, 1);
  assert.deepEqual([rec[0].merchant, rec[0].frequency, rec[0].annual_cost, rec[0].is_subscription, rec[0].next_expected], ['Netflix', 'Monthly', 7788, true, '2026-07-07']);
});
test('anomaly flags unusual merchant spend & large cash, never says fraud', () => {
  const list = [400, 450, 380, 420, 5200].map((d, i) => classify(tx({ description: 'UPI-SWIGGY', debit: d, transaction_date: `2026-09-0${i + 1}` })));
  list.push(classify(tx({ description: 'ATM WDL CASH', debit: 25000 })));
  detectAnomalies(list, DEFAULT_SETTINGS);
  assert.match(list[4].anomaly, /usual Swiggy spend/); assert.equal(list[5].anomaly, 'Large cash withdrawal');
  assert.ok(!list.some(t => /fraud/i.test(t.anomaly)));
});
