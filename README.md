# MoneyLens India v1.2.1
**Understand your money. Control your spending.**

A free, privacy-first personal finance app for Indian bank accounts. It runs in your browser and can be hosted for free on GitHub Pages.

> 🔒 It never asks for net-banking passwords, OTP, UPI PIN, card PIN or CVV, and it does no screen-scraping. Statements are parsed in your browser. Cloud Sync is optional and uses your own Supabase project.

## Supported statements
| Statement | Formats |
|---|---|
| HDFC / SBI / other bank accounts | PDF, CSV, XLSX (columns detected automatically) |
| Credit cards | CSV/XLSX (`Amount + Dr/Cr` or Debit/Credit columns) |
| HDFC home / plot / top-up loan **Statement of Account** | PDF: EMIs, bounces, cheque-dishonour charges, penal interest, overdue |
| HDFC credit-card loan **Loan EMI Table** (Insta / Jumbo / SmartEMI) | PDF: full schedule, EMIs billed and remaining, principal outstanding as per bank, interest paid and remaining |

## Features
- Dashboard and analytics
- Monthly scorecard
- Budgets
- Subscriptions and recurring payments
- Loans
- EMI calculator
- Credit cards
- Cash flow
- Net worth
- Financial calendar, including loan EMI dates
- Review centre
- Ask MoneyLens
- Reports with CSV, Excel and PDF export
- Statement library with SHA-256 fingerprints, so the same file is never imported twice
- Cloud Sync across laptop and iPhone
- Light and dark mode
- Can be installed on the iPhone home screen

## Run locally
```powershell
cd "D:\Software\moneylens"
python -m http.server 8000
```
Then open http://localhost:8000. Don't double-click `index.html`: browsers block modules opened from `file://`.

## Tests
`npm test` runs 31 tests, including real PDF extraction through pdf.js. `npm run lint` and `npm run check-secrets` run the other checks.

## Upgrade, deploy and cloud setup
- Upgrade and deploy: see `INSTALL_v1.2.1.md`.
- Cloud Sync: see `docs/SUPABASE_SETUP.md`.

MIT License. Not affiliated with any bank. Information only, not financial advice.
