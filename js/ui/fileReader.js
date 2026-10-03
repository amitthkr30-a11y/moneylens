// Browser-side secure file intake: size/type validation (magic bytes), then CSV / XLSX / PDF extraction.
import { parseCSVText, detectFileKind, MAX_FILE_BYTES, StatementError } from '../core/parsers.js';
import { readXlsx, itemsToLines } from '../core/xlsx.js';

let pdfjs = null;
async function loadPdf() {
  if (!pdfjs) { pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href; }
  return pdfjs;
}
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../../vendor/jszip/jszip.min.js', import.meta.url).href; s.onload = () => res(window.JSZip); s.onerror = () => rej(new Error('JSZip failed to load')); document.head.appendChild(s); });
}

export async function readStatementFile(file, password) {
  if (file.size > MAX_FILE_BYTES) throw new StatementError(`File is too large (max ${MAX_FILE_BYTES / 1048576} MB).`);
  if (file.size === 0) throw new StatementError('The file is empty.');
  const buf = await file.arrayBuffer();
  const kind = detectFileKind(file.name, new Uint8Array(buf.slice(0, 8)));
  if (kind === 'xls') throw new StatementError('Old .xls format is not supported. Please open it in Excel and "Save As" .xlsx or .csv.');
  if (kind === 'unknown') throw new StatementError('Unsupported file type. Please upload PDF, CSV, TXT or XLSX.');
  if (kind === 'csv') {
    const text = new TextDecoder('utf-8').decode(buf);
    if (/<script|<html/i.test(text.slice(0, 2000))) throw new StatementError('This file does not look like a bank statement.');
    return { kind, rows: parseCSVText(text) };
  }
  if (kind === 'xlsx') {
    try { return { kind, rows: await readXlsx(buf, await loadJSZip()) }; }
    catch (e) { throw new StatementError('Unable to read this Excel file.', e.message); }
  }
  const lib = await loadPdf();
  let doc;
  try { doc = await lib.getDocument({ data: new Uint8Array(buf), password: password || undefined, isEvalSupported: false }).promise; }
  catch (e) {
    if (e?.name === 'PasswordException') throw new StatementError(password ? 'Incorrect PDF password.' : 'This PDF is password-protected. Enter the statement password (it is used only in your browser and never stored).', 'PDF_PASSWORD');
    throw new StatementError('Unable to read this statement.', e.message);
  }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) { const page = await doc.getPage(p); const tc = await page.getTextContent(); lines.push(...itemsToLines(tc.items)); }
  if (lines.join('').trim().length < 50) throw new StatementError('This PDF appears to be a scanned image. Please download a text PDF, CSV or Excel statement from net banking.');
  return { kind, lines };
}
