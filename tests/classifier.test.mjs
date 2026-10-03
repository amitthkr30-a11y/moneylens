import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseUPI, detectPaymentMode, aliasKey } from '../js/core/classifier.js';
import { tx } from './helpers.mjs';
const c = (description, o = {}) => classify(tx({ description, debit: 100, ...o }));

test('merchant normalization collapses aliases', () => {
  for (const d of ['AMAZON PAY INDIA', 'POS AMZN Mktp IN', 'AMAZON/SELLER 123', 'Amazon']) assert.equal(c(d).merchant, 'Amazon', d);
  for (const d of ['SWIGGY', 'UPI-SWIGGY INDIA-swiggy@icici', 'SWIGGY PVT LTD', 'BUNDL TECHNOLOGIES']) assert.equal(c(d).merchant, 'Swiggy', d);
  assert.equal(c('AMAZON PRIME MEMBERSHIP').merchant, 'Amazon Prime');
});
test('categories & subcategories', () => {
  assert.deepEqual([c('UPI-ZOMATO LTD').category, c('UPI-ZOMATO LTD').subcategory], ['Food & Dining', 'Food Delivery']);
  assert.equal(c('NETFLIX.COM').subcategory, 'OTT');
  assert.equal(c('IOCL PETROL PUMP').subcategory, 'Fuel');
  assert.equal(c('TATA POWER ELECTRICITY').subcategory, 'Electricity');
  assert.equal(c('ACH DR BSESTARMF NIPPON SIP').subcategory, 'SIP');           // must NOT be BSES electricity
  assert.equal(c('ACH D- HDFC BANK LTD HOME LOAN EMI').merchant, 'HDFC Bank Home Loan EMI');
  assert.equal(c('ATM WDL-ATM CASH 1234').category, 'Cash');
  const sal = classify(tx({ description: 'NEFT CR-CITI0000001-ACME TECHNOLOGIES PVT LTD-SALARY', credit: 150000 }));
  assert.equal(sal.subcategory, 'Salary'); assert.equal(sal.is_salary, true);
});
test('UPI intelligence for HDFC and SBI narrations', () => {
  const h = parseUPI('UPI-RAHUL SHARMA-rahul.sharma@oksbi-SBIN0000001-512345678901-dinner');
  assert.deepEqual([h.vpa, h.name, h.reference], ['rahul.sharma@oksbi', 'Rahul Sharma', '512345678901']);
  const s = parseUPI('TO TRANSFER-UPI/DR/512345678901/RAHUL KUM/SBIN/rahul@oksbi/Payment--');
  assert.deepEqual([s.vpa, s.name, s.direction], ['rahul@oksbi', 'Rahul Kum', 'out']);
  assert.equal(parseUPI('NEFT CR SALARY'), null);
});
test('payment modes', () => {
  assert.equal(detectPaymentMode('UPI/SWIGGY'), 'UPI');
  assert.equal(detectPaymentMode('NEFT CR-XYZ'), 'NEFT');
  assert.equal(detectPaymentMode('POS 4111XXXX STARBUCKS'), 'Debit Card');
  assert.equal(detectPaymentMode('ACH D- LIC'), 'Auto Debit');
  assert.equal(detectPaymentMode('ATM WDL'), 'Cash');
});
test('user corrections are learned (merchant alias + category rule)', () => {
  const t = tx({ description: 'UPI-MYSTERY SHOP-mystery@ybl-X-1', debit: 300 }); t.upi_id = 'mystery@ybl';
  const ctx = { merchantOverrides: { [aliasKey(t)]: 'Corner Bakery' }, categoryOverrides: { 'Corner Bakery': ['Food & Dining', 'Snacks'] } };
  const r = classify(tx({ description: 'UPI-MYSTERY SHOP-mystery@ybl-X-2', debit: 120 }), ctx);
  assert.deepEqual([r.merchant, r.category, r.subcategory, r.confidence_score], ['Corner Bakery', 'Food & Dining', 'Snacks', 1]);
});
