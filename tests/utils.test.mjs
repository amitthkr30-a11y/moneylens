import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseAmount, maskAccount, inr, esc } from '../js/core/utils.js';

test('parseDate handles Indian bank formats', () => {
  assert.equal(parseDate('05/09/26'), '2026-09-05');          // HDFC dd/mm/yy
  assert.equal(parseDate('05/09/2026'), '2026-09-05');
  assert.equal(parseDate('5 Sep 2026'), '2026-09-05');         // SBI
  assert.equal(parseDate('05-Sep-2026'), '2026-09-05');
  assert.equal(parseDate('05-09-2026'), '2026-09-05');
  assert.equal(parseDate('2026-09-05'), '2026-09-05');
  assert.equal(parseDate(46270), '2026-09-05');                // Excel serial
  assert.equal(parseDate('Opening Balance'), null);
  assert.equal(parseDate('32/13/2026'), null);
});
test('parseAmount handles commas, rupee symbols, Dr/Cr suffix', () => {
  assert.equal(parseAmount('1,23,456.78'), 123456.78);
  assert.equal(parseAmount('₹ 500.00 Dr'), 500);
  assert.equal(parseAmount('2,000.00Cr'), 2000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('-'), null);
});
test('account numbers are always masked', () => {
  assert.equal(maskAccount('50100123456781234'), 'XXXX XXXX 1234');
  assert.equal(maskAccount('1234'), 'XXXX XXXX 1234');
});
test('inr formats with Indian grouping; esc blocks XSS', () => {
  assert.equal(inr(150000), '₹1,50,000');
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});
