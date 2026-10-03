# MoneyLens India
**Understand your money. Control your spending.**

A free, privacy-first personal finance & expense-intelligence web app for Indian bank accounts. It consolidates **HDFC Bank, SBI and other bank** statements (PDF / CSV / Excel), classifies every transaction, removes internal transfers and duplicates, detects recurring payments and subscriptions, tracks budgets, EMIs, credit cards, cash flow and net worth, and lets you ask questions about your money in plain English.

> 🔒 **No bank passwords, OTP, UPI PIN, card PIN or CVV are ever requested. No screen-scraping.**
> V1 runs **100% in your browser** — statements are parsed on your device and stored in your browser (IndexedDB, optional AES-256 passcode encryption). There is no server, so hosting on GitHub Pages is free.

---

## Features
| Area | What it does |
|---|---|
| Statement import | HDFC & SBI parsers + generic CSV / XLSX / PDF parser with **dynamic column detection**, multi-line narrations, Excel date serials, `Amount + Dr/Cr` layouts, password-protected PDFs |
| 10-step pipeline | detect file → detect bank → extract → normalize → de-duplicate → payment type → categorize → transfers → recurring → dashboard (runs in a Web Worker) |
| Classification | 15 categories / 70+ subcategories, 150+ Indian merchant rules, confidence score, **learns from your corrections** (per merchant / UPI ID) |
| UPI intelligence | Extracts VPA, payee name, 12-digit UTR, direction from HDFC & SBI UPI narrations |
| Transfers | Own-account transfer matching (amount + date window + accounts), credit-card bill payment double-count guard |
| Analytics | KPIs, category / merchant / payment-mode / bank / day-of-week / weekend / weekly / heatmap, drill-down, monthly scorecard with exact change |
| Planning | Budgets with 80% / 100% alerts, recurring payments, subscription manager, EMI tracker with amortisation estimates, credit cards, cash flow, net worth trend, financial calendar |
| Review centre | Unknown merchant / low confidence / possible duplicate / possible transfer / unusual — approve, recategorize, mark transfer, ignore |
| Ask MoneyLens | Deterministic assistant that answers **only** from your data and shows the source transactions |
| Reports | Monthly, annual, category, bank, merchant, transaction — export **CSV, Excel, PDF (print)** |
| Demo | 12 months of synthetic HDFC + SBI + credit-card data (₹1.5 L/month income) |

## Architecture (V1)
```
Browser ──► index.html (strict CSP, no external requests)
  js/ui/app.js          views, routing, events (light/dark, mobile bottom nav)
  js/ui/fileReader.js   secure intake: size limit, magic-byte type check, CSV/XLSX/PDF extraction
  js/worker.js          background processing (Web Worker)
  js/core/              pure, framework-free engine (100% unit-tested in Node)
    parsers.js          BaseStatementParser → HDFC / SBI / GenericCSV / GenericExcel / GenericPDF
    classifier.js       merchant normalization, UPI parsing, rules engine, learning overrides
    pipeline.js         normalize, duplicates, transfers, recurring, anomalies, review flags
    analytics.js        financial rules (configurable), KPIs, scorecard, budgets, cash flow, insights, EMI
    assistant.js        "chat with my finances" query engine
    providers.js        BankDataProvider / AccountAggregatorProvider (+ Mock, + Remote)
    store.js            IndexedDB persistence + WebCrypto AES-GCM encryption
  vendor/               pdf.js (Apache-2.0), JSZip (MIT) — vendored, no CDN
```
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md), [docs/ACCOUNT_AGGREGATOR.md](docs/ACCOUNT_AGGREGATOR.md).

## Tech stack
Vanilla ES modules (no build step), SVG charts, Web Workers, IndexedDB, WebCrypto, pdf.js, JSZip, Node's built-in test runner, GitHub Actions, GitHub Pages. V2 server mapping: PostgreSQL schema in `database/migrations/` (RLS-ready for Supabase).

## Local setup
Requirements: **Node.js 20+** (only for tests/dev server) and a modern browser.
```bash
git clone https://github.com/<your-username>/moneylens-india.git
cd moneylens-india
npm test                # 44 unit + integration tests
npm run lint            # syntax + safety rules
npm run check-secrets   # blocks secrets & real statements
npm start               # http://localhost:8080  (or: python -m http.server 8080)
```
> ES modules require serving over http(s) — opening `index.html` via `file://` will not work.

Try it: open the app → **Try demo**, or **Upload Statement** → pick `samples/synthetic_hdfc_statement.pdf`, last 4 digits `1234`.

## Environment variables
V1 needs **none**. `.env.example` lists variables for the optional V2 server / live Account Aggregator (`DATABASE_URL`, `AUTH_SECRET`, `AA_PROVIDER`, `AA_API_BASE`, `AA_CLIENT_ID`, `AA_CLIENT_SECRET`, `AI_API_KEY`, `STORAGE_BUCKET`, `NEXT_PUBLIC_APP_URL`). Copy to `.env` locally; `.env` is git-ignored and CI fails if one is committed.

## Database setup & migration (V2 server edition only)
```bash
psql "$DATABASE_URL" -f database/migrations/001_init.sql
psql "$DATABASE_URL" -f database/seed.sql
```
The RLS policies use Supabase's `auth.uid()`; on plain PostgreSQL replace it with your session user function.

## Testing
`npm test` runs: parsers (HDFC/SBI CSV, XLSX round-trip, **real PDF extraction with pdf.js**), classifier, merchant normalization, UPI, duplicates, transfers, credit-card double-count, recurring, anomalies, budgets, scorecard, EMI maths, net worth, assistant grounding, corrections persistence, import deletion, no-credential-fields check, mock AA lifecycle, and a 100k-transaction performance test. All test data is **synthetic** (`samples/synthetic_*`, regenerate with `node scripts/make-samples.mjs`).

## Deploy free on GitHub Pages
```bash
git init && git add . && git commit -m "MoneyLens India v1"
git branch -M main
git remote add origin https://github.com/<your-username>/moneylens-india.git
git push -u origin main
```
Then on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Every push runs lint → secret scan → tests → build; **deployment happens only from `main` and only if all checks pass**. Your app: `https://<your-username>.github.io/moneylens-india/`.

Alternative hosts (also free, static): Vercel / Netlify / Cloudflare Pages — publish the repository root, no build command.

## Security
CSP `default-src 'self'` (no third-party scripts, no network calls), all output HTML-escaped, CSV-injection-safe exports, magic-byte file validation, 15 MB limit, no credential fields (lint-enforced), masked account numbers, audit log without financial data, optional AES-256-GCM encryption at rest. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Bank integration & Account Aggregator
`BankDataProvider` → `StatementUploadProvider` (live), `MockAccountAggregatorProvider` (live, synthetic), `RemoteAccountAggregatorProvider` (calls your backend). Real AA (RBI framework) needs a licensed FIU/TSP partner and a server holding client secrets — never the browser. Details: [docs/ACCOUNT_AGGREGATOR.md](docs/ACCOUNT_AGGREGATOR.md).

## Known limitations
- Data lives in one browser on one device — use **Settings → Export** for backups; no cross-device sync in V1.
- Scanned (image) PDFs need OCR — download text PDF / Excel from net banking instead.
- Old binary `.xls` is not read — save as `.xlsx`/`.csv`.
- Classification is rule-based; unusual local merchants need one correction (then learned).
- Bank statement layouts change; the generic parser handles most, but new layouts may need a rule.
- Live AA connection requires V2 backend + regulated partner.

## Roadmap
**V2:** server edition (PostgreSQL schema included), email auth, live AA sync, notifications, optional LLM for free-text questions (still grounded on user data).
**V3:** installable PWA/offline, investment & net-worth automation, goals, family/shared finances, advanced insights.

## License
MIT. Not affiliated with HDFC Bank, SBI or any bank. Informational only — not financial advice.
