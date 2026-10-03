// Statement parser architecture: BaseStatementParser → HDFC / SBI / Generic CSV / Excel / PDF.
// All parsers turn a "table" (array of row arrays) or PDF text lines into RawTransaction[]:
// { date, valueDate, description, reference, debit, credit, balance }
import { parseDate, parseAmount } from './utils.js';

export class StatementError extends Error {
  constructor(userMessage, detail) { super(userMessage); this.userMessage = userMessage; this.detail = detail; }
}

/** RFC4180-ish CSV parser (handles quotes, embedded commas/newlines, ; or tab delimiters). */
export function parseCSVText(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/).slice(0, 30).join('\n');
  const delim = [',', ';', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
}

const SYN = {
  date: ['txn date', 'transaction date', 'tran date', 'date', 'posting date', 'trans date'],
  valueDate: ['value date', 'value dt'],
  description: ['narration', 'description', 'particulars', 'remarks', 'details', 'transaction details', 'transaction remarks'],
  reference: ['chq./ref.no.', 'ref no./cheque no.', 'chq/ref no', 'cheque no', 'chq no', 'reference no', 'ref no', 'reference', 'utr', 'chq./ref.no'],
  debit: ['withdrawal amt.', 'withdrawal amt', 'withdrawal amount', 'withdrawal', 'withdrawals', 'debit amount', 'debit', 'dr amount', 'dr'],
  credit: ['deposit amt.', 'deposit amt', 'deposit amount', 'deposit', 'deposits', 'credit amount', 'credit', 'cr amount', 'cr'],
  amount: ['amount', 'transaction amount', 'amount (inr)', 'amt'],
  drcr: ['dr/cr', 'cr/dr', 'debit/credit', 'type', 'txn type'],
  balance: ['closing balance', 'balance', 'available balance', 'running balance', 'balance (inr)'],
};
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Dynamically map header cells → column indexes (exact match first, then contains). */
export function mapColumns(header) {
  const h = header.map(norm), map = {}, used = new Set();
  for (const pass of ['exact', 'contains']) {
    for (const [key, words] of Object.entries(SYN)) {
      if (map[key] !== undefined) continue;
      for (const w of words) {
        const idx = h.findIndex((c, i) => !used.has(i) && (pass === 'exact' ? c === w : c.includes(w) && w.length > 2));
        if (idx >= 0) { map[key] = idx; used.add(idx); break; }
      }
    }
  }
  return map;
}

export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const m = mapColumns(rows[i]);
    if (m.date !== undefined && m.description !== undefined && (m.debit !== undefined || m.credit !== undefined || m.amount !== undefined)) return { index: i, map: m };
  }
  return null;
}

export function detectBank(headerText) {
  // Use only the statement title/header area; narrations often contain other banks' UPI handles/IFSCs.
  const t = headerText.toLowerCase();
  if (/state bank of india|\bsbi\b(?!n)/.test(t) || (t.includes('txn date') && t.includes('ref no./cheque no'))) return 'SBI';
  if (/hdfc bank/.test(t) || (t.includes('narration') && t.includes('chq./ref.no'))) return 'HDFC';
  return 'Other';
}

export class BaseStatementParser {
  constructor(bank) { this.bank = bank; }
  /** @param {string[][]} rows */
  parseTable(rows) {
    const hdr = findHeaderRow(rows);
    if (!hdr) throw new StatementError('This statement format is not currently supported.', 'No header row with date/description/amount columns found');
    const { index, map } = hdr, out = [];
    let lastTxn = null;
    for (const r of rows.slice(index + 1)) {
      const date = parseDate(r[map.date]);
      const desc = (r[map.description] || '').trim();
      if (!date) { // continuation lines (multi-line narration) — append to previous
        if (lastTxn && desc && !/total|opening|closing|statement|page/i.test(desc)) lastTxn.description += ' ' + desc;
        continue;
      }
      let debit = map.debit !== undefined ? parseAmount(r[map.debit]) : null;
      let credit = map.credit !== undefined ? parseAmount(r[map.credit]) : null;
      if (debit === null && credit === null && map.amount !== undefined) {
        const raw = String(r[map.amount] ?? ''); const a = parseAmount(raw);
        const flag = map.drcr !== undefined ? norm(r[map.drcr]) : '';
        const isDr = /^d|debit|dr/.test(flag) || /dr$/i.test(raw.trim()) || /^-/.test(raw.trim());
        if (a !== null) { if (isDr) debit = a; else credit = a; }
      }
      if (!debit && !credit) continue;
      lastTxn = {
        date, valueDate: parseDate(r[map.valueDate]) || date, description: desc,
        reference: map.reference !== undefined ? String(r[map.reference] || '').replace(/^0+(?=\d{6,})/, '') : '',
        debit: debit || 0, credit: credit || 0,
        balance: map.balance !== undefined ? parseAmount(r[map.balance]) : null,
      };
      out.push(lastTxn);
    }
    return out;
  }
}
export class HDFCStatementParser extends BaseStatementParser { constructor() { super('HDFC'); } }
export class SBIStatementParser extends BaseStatementParser { constructor() { super('SBI'); } }
export class GenericCSVParser extends BaseStatementParser { constructor() { super('Other'); } }
export class GenericExcelParser extends BaseStatementParser { constructor() { super('Other'); } }

/**
 * GenericPDFParser: works on text lines extracted by pdf.js (grouped by y-coordinate).
 * A transaction line starts with a date and ends with 1–3 amounts; the final amount is the balance.
 * Debit/credit direction is inferred from the balance movement, falling back to keywords.
 */
export class GenericPDFParser {
  constructor(bank = 'Other') { this.bank = bank; }
  parseLines(lines) {
    const out = []; let prevBal = null;
    const AMT = /(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}(?:\s?(?:Cr|Dr))?/gi;
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ').trim();
      const dm = line.match(/^(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}[\s\-][A-Za-z]{3}[\s\-]\d{2,4})/);
      if (/opening balance|b\/f|brought forward/i.test(line)) { const a = line.match(AMT); if (a) prevBal = parseAmount(a[a.length - 1]); continue; }
      if (!dm) { if (out.length && line && !AMT.test(line) && !/page|statement|total/i.test(line)) out[out.length - 1].description += ' ' + line; AMT.lastIndex = 0; continue; }
      const date = parseDate(dm[1]); if (!date) continue;
      const amts = line.match(AMT) || []; if (!amts.length) continue;
      let rest = line.slice(dm[0].length);
      const vd = rest.match(/^\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/); let valueDate = date;
      if (vd) { valueDate = parseDate(vd[1]) || date; rest = rest.slice(vd[0].length); }
      const firstAmtIdx = rest.search(AMT);
      let description = rest.slice(0, firstAmtIdx).trim();
      const vd2 = description.match(/\s(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})$/); // HDFC: Date | Narration | Ref | Value Dt | amounts
      if (vd2) { valueDate = parseDate(vd2[1]) || valueDate; description = description.slice(0, -vd2[0].length).trim(); }
      const refm = description.match(/\s(\d{8,22})$/); let reference = '';
      if (refm) { reference = refm[1]; description = description.slice(0, -refm[0].length).trim(); }
      const nums = amts.map(parseAmount);
      const balance = nums.length >= 2 ? nums[nums.length - 1] : null;
      const amount = nums.length >= 2 ? nums[nums.length - 2] : nums[0];
      let isCredit;
      if (prevBal !== null && balance !== null) isCredit = Math.abs(prevBal + amount - balance) < 0.02 ? true : Math.abs(prevBal - amount - balance) < 0.02 ? false : undefined;
      if (isCredit === undefined) isCredit = /\bcr\b|credit|salary|neft cr|by transfer|deposit|interest|refund|reversal/i.test(line) && !/\bdr\b|to transfer|withdrawal/i.test(line);
      out.push({ date, valueDate, description, reference, debit: isCredit ? 0 : amount, credit: isCredit ? amount : 0, balance });
      if (balance !== null) prevBal = balance;
    }
    if (!out.length) throw new StatementError('Unable to read this statement.', 'No transaction lines detected in PDF text (scanned PDFs need OCR).');
    return out;
  }
}

export function parserFor(bank, kind) {
  if (kind === 'pdf') return new GenericPDFParser(bank);
  if (bank === 'HDFC') return new HDFCStatementParser();
  if (bank === 'SBI') return new SBIStatementParser();
  return kind === 'xlsx' ? new GenericExcelParser() : new GenericCSVParser();
}

export function detectFileKind(name, firstBytes) {
  const n = name.toLowerCase();
  if (firstBytes && firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && firstBytes[2] === 0x44 && firstBytes[3] === 0x46) return 'pdf'; // %PDF
  if (firstBytes && firstBytes[0] === 0x50 && firstBytes[1] === 0x4b) return 'xlsx'; // ZIP container
  if (firstBytes && firstBytes[0] === 0xd0 && firstBytes[1] === 0xcf) return 'xls';
  if (/\.(csv|txt|tsv)$/.test(n)) return 'csv';
  if (/\.xlsx?$/.test(n)) return 'xlsx';
  if (/\.pdf$/.test(n)) return 'pdf';
  return 'unknown';
}
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
