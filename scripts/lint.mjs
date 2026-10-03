// Zero-dependency lint: syntax check every JS module + project safety rules.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const files = []; const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!['node_modules', 'vendor', '.git'].includes(f)) walk(p); } else if (/\.(m?js)$/.test(f)) files.push(p); } };
walk('js'); walk('tests'); walk('scripts');
let errors = 0;
const RULES = [
  [/\beval\s*\(|new Function\s*\(/, 'eval/new Function is forbidden'],
  [/console\.(log|info|debug)\([^)]*(description|amount|debit|credit|balance|account)/i, 'never log financial data'],
  [/\.innerHTML\s*=\s*[^`'"]*\+/, 'build HTML with template + esc(), not string concatenation'],
  [/password|otp|upi_?pin|cvv/i, null], // checked below with context
];
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { console.error(`✖ ${f}: syntax error\n${e.stderr}`); errors++; }
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    for (const [re, msg] of RULES.slice(0, 3)) if (re.test(line)) { console.error(`✖ ${f}:${i + 1} ${msg}`); errors++; }
    // credential fields must never be form inputs (PDF statement password is the only allowed password field)
    if (/name="(netbanking|bank_?password|otp|upi_?pin|cvv|card_?pin)"/i.test(line)) { console.error(`✖ ${f}:${i + 1} credential input field is forbidden`); errors++; }
  });
}
console.log(errors ? `✖ ${errors} lint error(s)` : `✔ lint passed (${files.length} files)`); process.exit(errors ? 1 : 0);
