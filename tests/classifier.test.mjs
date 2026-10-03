import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseUPI, detectPaymentMode, aliasKey } from '../js/core/classifier.js';
import { tx } from './helpers.mjs';
const c = (description, o = {}) => classify(tx({ description, debit: 100, ...o }));
test('merchant normalization', () => {
  for (const d of ['AMAZON PAY INDIA', 'POS AMZN Mktp IN', 'AMAZON/SELLER 123']) assert.equal(c(d).merchant, 'Amazon', d);
  for (const d of ['SWIGGY', 'UPI-SWIGGY INDIA-swiggy@icici', 'BUNDL TECHNOLOGIES']) assert.equal(c(d).merchant, 'Swiggy', d);
});
test('categories', () => {
  assert.equal(c('NETFLIX.COM').subcategory, 'OTT'); assert.equal(c('ACH DR BSESTARMF NIPPON SIP').subcategory, 'SIP');
  assert.equal(c('ACH D- HDFC BANK LTD HOME LOAN EMI').merchant, 'HDFC Bank Home Loan EMI'); assert.equal(c('ATM WDL-ATM CASH').category, 'Cash');
});
test('UPI + payment modes', () => {
  const h = parseUPI('UPI-RAHUL SHARMA-rahul.sharma@oksbi-SBIN0000001-512345678901-dinner');
  assert.deepEqual([h.vpa, h.name, h.reference], ['rahul.sharma@oksbi', 'Rahul Sharma', '512345678901']);
  assert.equal(detectPaymentMode('ACH D- LIC'), 'Auto Debit');
});
test('corrections are learned', () => {
  const t = tx({ description: 'UPI-MYSTERY SHOP-mystery@ybl-X-1', debit: 300 }); t.upi_id = 'mystery@ybl';
  const r = classify(tx({ description: 'UPI-MYSTERY SHOP-mystery@ybl-X-2', debit: 120 }), { merchantOverrides: { [aliasKey(t)]: 'Corner Bakery' }, categoryOverrides: { 'Corner Bakery': ['Food & Dining', 'Snacks'] } });
  assert.deepEqual([r.merchant, r.subcategory], ['Corner Bakery', 'Snacks']);
});
