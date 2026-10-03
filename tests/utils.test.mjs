import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseAmount, parseSigned, maskAccount, inr, esc, addMonths } from '../js/core/utils.js';
test('parseDate handles Indian bank formats', () => {
  for (const [i, o] of [['05/09/26', '2026-09-05'], ['5 Sep 2026', '2026-09-05'], ['05-Sep-2026', '2026-09-05'], ['06-APR-2026', '2026-04-06'], ['01-APR-26', '2026-04-01'], ['16 Jan 2024', '2024-01-16'], [46270, '2026-09-05']]) assert.equal(parseDate(i), o, String(i));
  assert.equal(parseDate('Opening Balance'), null);
});
test('amounts, masking, formatting, escaping', () => {
  assert.equal(parseAmount('1,23,456.78'), 123456.78); assert.equal(parseSigned('(3,700)'), -3700);
  assert.equal(maskAccount('0000000000100875462'), 'XXXX XXXX 5462'); assert.equal(inr(150000), '₹1,50,000');
  assert.equal(esc('<img src=x>'), '&lt;img src=x&gt;'); assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});
