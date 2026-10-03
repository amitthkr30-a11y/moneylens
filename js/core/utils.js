// Shared helpers (pure, no DOM) — usable in browser and Node tests.
export const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };

/** Parse many Indian bank date formats → 'YYYY-MM-DD' or null. */
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) return iso(year(m[3]), +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})[\s\-\/]?([A-Za-z]{3,4})[a-z]*[\s\-\/,]*(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return iso(year(m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
function year(y) { y = +y; return y < 100 ? 2000 + y : y; }
function iso(y, mo, d) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parse "1,23,456.78", "₹ 500 Dr", "(200.00)" → number (absolute) or null. */
export function parseAmount(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? Math.abs(v) : null;
  const s = String(v).replace(/[₹,\s]|INR|Rs\.?/gi, '').replace(/(Cr|Dr)$/i, '').replace(/[()]/g, '');
  if (s === '' || s === '-' || s === '--') return null;
  const n = Number(s);
  return isFinite(n) ? Math.abs(n) : null;
}
/** Signed amount: "(3,700)" or "-3700" → -3700. */
export function parseSigned(v) {
  const a = parseAmount(v); if (a === null) return null;
  return /^\s*\(|^\s*-/.test(String(v)) ? -a : a;
}

export function maskAccount(num) {
  const digits = String(num || '').replace(/\D/g, '');
  return 'XXXX XXXX ' + (digits.slice(-4) || '0000');
}

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const monthKey = d => d.slice(0, 7);
export const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);

export function inr(n, dec = 0) {
  const v = Number(n || 0);
  return (v < 0 ? '-' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Stable small hash for ids (non-cryptographic). */
export function hashId(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

/** Escape text for safe HTML insertion (XSS protection). */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function addMonths(d, n) {
  const [y, m, day] = d.split('-').map(Number); const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}
