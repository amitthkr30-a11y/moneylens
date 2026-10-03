import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, previousRange, budgetStatus, emiSchedule, netWorth, scorecard, makeCtx, kpis, byWeekend } from '../js/core/analytics.js';
import { runIntelligence } from '../js/core/pipeline.js';
import { emptyState } from '../js/core/ingest.js';
import { tx } from './helpers.mjs';

test('period ranges are calendar-exact', () => {
  assert.deepEqual(periodRange('this_month', '2026-09-28'), ['2026-09-01', '2026-09-30']);
  assert.deepEqual(periodRange('last_month', '2026-03-15'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(periodRange('3m', '2026-01-10'), ['2025-11-01', '2026-01-31']);
  assert.deepEqual(previousRange('this_month', '2026-09-28'), ['2026-08-01', '2026-08-31']);
  assert.deepEqual(previousRange('6m', '2026-09-28'), ['2025-10-01', '2026-03-31']);
});
function state() {
  const st = emptyState(); st.accounts = [{ id: 'A', bank_name: 'HDFC', account_type: 'Savings' }];
  st.transactions = [
    tx({ description: 'NEFT SALARY ACME', credit: 150000, transaction_date: '2026-09-01' }),
    tx({ description: 'UPI-SWIGGY', debit: 8200, transaction_date: '2026-09-06' }),       // Sunday
    tx({ description: 'UPI-UBER', debit: 1800, transaction_date: '2026-09-08' }),
    tx({ description: 'ACH DR BSESTARMF SIP', debit: 25000, transaction_date: '2026-09-05' }),
    tx({ description: 'UPI-SWIGGY', debit: 8500, transaction_date: '2026-08-06' }),
    tx({ description: 'NEFT SALARY ACME', credit: 150000, transaction_date: '2026-08-01' }),
  ];
  runIntelligence(st, '2026-09-30'); return st;
}
test('KPIs: investments are excluded from expenses, savings rate computed', () => {
  const st = state(); const k = kpis(st.transactions.filter(t => t.transaction_date >= '2026-09-01'), makeCtx(st));
  assert.deepEqual([k.income, k.expenses, k.investments, k.savings, k.savingsRate], [150000, 10000, 25000, 140000, 93.33]);
});
test('budget utilisation, remaining & status', () => {
  const st = state();
  const [food] = budgetStatus([{ category: 'Food & Dining', amount: 10000 }], st.transactions, makeCtx(st), '2026-09');
  assert.deepEqual([food.actual, food.remaining, food.utilization, food.status], [8200, 1800, 82, 'nearing']);
});
test('scorecard shows exact numeric change vs previous month', () => {
  const st = state(); const sc = scorecard(st.transactions, makeCtx(st), '2026-09');
  const food = sc.find(r => r.metric === 'Food & Dining');
  assert.deepEqual([food.previous, food.current, food.change, food.changePct], [8500, 8200, -300, -3.53]);
});
test('weekday vs weekend split', () => {
  const st = state(); const w = byWeekend(st.transactions.filter(t => t.transaction_date >= '2026-09-01'), makeCtx(st));
  assert.equal(w.find(x => x.key === 'Weekend').value, 8200);
});
test('EMI amortisation estimate matches standard formula', () => {
  const r = emiSchedule({ principal: 1000000, ratePct: 12, tenureMonths: 12, startDate: new Date().toISOString().slice(0, 10) });
  assert.equal(r.emi, 88848.79); assert.equal(r.outstanding, 1000000); assert.equal(r.estimate, true);
  assert.equal(r.totalInterest, 66185.46);
});
test('net worth = assets − liabilities', () => {
  assert.deepEqual(netWorth([{ kind: 'asset', value: 500000 }, { kind: 'asset', value: 100000 }, { kind: 'liability', value: 250000 }]), { assets: 600000, liabilities: 250000, netWorth: 350000 });
});
