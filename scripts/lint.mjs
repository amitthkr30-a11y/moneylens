// Zero-dependency lint: syntax check every JS module + project safety rules.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const files = []; const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!['node_modules', 'vendor', '.git'].includes(f)) walk(p); } else if (/\.(m?js)$/.test(f)) files.push(p); } };
walk('js'); walk('tests'); walk('scripts');
let errors = 0;
const RULES = [[/\beval\s*\(|new Function\s*\(/, 'eval/new Function is forbidden'], [/console\.(log|info|debug)\([^)]*(description|amount|debit|credit|balance|account)/i, 'never log financial data']];
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { console.error(`✖ ${f}: syntax error\n${e.stderr}`); errors++; }
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const [re, msg] of RULES) if (re.test(line)) { console.error(`✖ ${f}:${i + 1} ${msg}`); errors++; }
    if (/name="(netbanking|bank_?password|otp|upi_?pin|cvv|card_?pin)"/i.test(line)) { console.error(`✖ ${f}:${i + 1} bank credential input field is forbidden`); errors++; }
  });
}
console.log(errors ? `✖ ${errors} lint error(s)` : `✔ lint passed (${files.length} files)`); process.exit(errors ? 1 : 0);
