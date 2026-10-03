// Fails CI if secrets or (likely) real bank statements are committed.
import fs from 'node:fs'; import path from 'node:path';
const PATTERNS = [[/AKIA[0-9A-Z]{16}/, 'AWS key'], [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key'], [/ghp_[A-Za-z0-9]{36}/, 'GitHub token'], [/sk-[A-Za-z0-9]{32,}/, 'API secret key'],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase SECRET key'], [/(AA_CLIENT_SECRET|AUTH_SECRET|AI_API_KEY|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY)[ \t]*=[ \t]*\S{6,}/, 'secret value in env-style assignment'], [/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b(?!\d)/, 'possible full card number']];
const roleOf = jwt => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role; } catch { return null; } };
let bad = 0; const skip = new Set(['node_modules', '.git', 'vendor']);
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p);
  if (st.isDirectory()) { if (!skip.has(f)) walk(p); continue; }
  if (p === '.env' || /^\.env\.(?!example)/.test(f)) { console.error(`✖ ${p}: env files must not be committed`); bad++; }
  if (p.startsWith('samples') && !/^synthetic_/.test(f)) { console.error(`✖ ${p}: only synthetic_* sample statements may be committed`); bad++; }
  if (/\.(pdf|xlsx|xls)$/i.test(f) && !p.startsWith('samples')) { console.error(`✖ ${p}: statement-like file outside /samples`); bad++; }
  if (/\.(js|mjs|json|md|yml|yaml|html|css|csv|txt|example|sql)$/i.test(f) || f.startsWith('.env')) {
    const src = fs.readFileSync(p, 'utf8');
    for (const [re, name] of PATTERNS) { if ((p.startsWith('samples') || p.startsWith('tests')) && /card number|Supabase SECRET/.test(name)) continue; if (re.test(src)) { console.error(`✖ ${p}: ${name}`); bad++; } }
    for (const jwt of src.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []) if (roleOf(jwt) === 'service_role') { console.error(`✖ ${p}: Supabase service_role key. NEVER commit this`); bad++; }
  } } };
walk('.');
console.log(bad ? `✖ ${bad} problem(s) found` : '✔ no secrets or real statements detected'); process.exit(bad ? 1 : 0);
