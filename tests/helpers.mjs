import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseCSVText } from '../js/core/parsers.js';
import { ingest, emptyState } from '../js/core/ingest.js';
export const require = createRequire(import.meta.url);
export const JSZip = require('../vendor/jszip/jszip.min.js');
export const sample = name => new URL('../samples/' + name, import.meta.url);
export function loadAllSamples() {
  const st = emptyState();
  const up = (file, bank, accountType, last4) => ingest(st, { kind: 'csv', rows: parseCSVText(fs.readFileSync(sample(file), 'utf8')), fileName: file, bank, accountType, last4 });
  return { st, h: up('synthetic_hdfc_statement.csv', 'Auto', 'Savings', '1234'), s: up('synthetic_sbi_statement.csv', 'Auto', 'Savings', '9876'), c: up('synthetic_hdfc_credit_card.csv', 'HDFC', 'Credit Card', '4321') };
}
let n = 0;
export function tx(over = {}) {
  n++;
  return { transaction_id: 't' + n, account_id: 'A', import_id: 'I', bank_name: 'HDFC', account_type: 'Savings', account_number_masked: 'XXXX XXXX 1234', transaction_date: '2026-09-01', value_date: '2026-09-01', description: '', reference_number: '', debit: 0, credit: 0, amount: 0, balance: null, review_flags: [], created_at: '2026-09-30T00:00:00Z', ...over, amount: over.debit || over.credit || 0 };
}
export async function pdfLines(file) {
  globalThis.DOMMatrix ??= class DOMMatrix {};
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const { itemsToLines } = await import('../js/core/xlsx.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(sample(file))), isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) lines.push(...itemsToLines((await (await doc.getPage(p)).getTextContent()).items));
  return lines;
}
