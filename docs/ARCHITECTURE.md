# Architecture

## Data flow
```
File ─► fileReader (validate size/type) ─► CSV rows | XLSX rows | PDF lines
     ─► Worker: ingest()
          1 detectBank(header area)   2 parserFor(bank, kind).parse*()   3 normalize() → transaction model
          4 classify() (rules + learned overrides)   5 detectDuplicates()   6 detectTransfers()
          7 detectRecurring()   8 detectAnomalies()   9 buildReviewFlags()   10 summary
     ─► IndexedDB (optionally AES-GCM encrypted) ─► views compute analytics on demand
```
`runIntelligence()` is idempotent and re-runs over the full dataset after every import or correction, so cross-account logic (transfers, duplicates, recurring) is always consistent.

## Financial rules (`analytics.js`, configurable in Settings)
- **Expense** = debit, not duplicate, not transfer, not ignored, not Investment, not credit-card bill payment *when a card statement is imported*.
- **Income** = credit, not duplicate/transfer/ignored, not card-payment-received, not on a credit-card account; refunds reduce spending instead of counting as income (toggle).
- **Investments** tracked separately (SIP/MF/stocks/NPS/FD/RD) and excluded from expenses; savings = income − expenses.

## Transfer detection
Debit in account A ↔ credit of identical amount in account B within *N* days (default 3); skipped for confidently-classified merchant spends; also narration matches against the user's own name(s); manual confirm/reject persists (`transfer_confirmed`).

## Recurring detection
Group by merchant → split into amount clusters (±15% for EMI/SIP/rent/subscriptions, identical amounts for discretionary merchants; utilities kept whole as bills vary) → median interval ≈ 7 / 30 / 91 / 365 days, ≥70% regular gaps, minimum occurrences → next date by calendar month.

## Folder mapping vs. the original Next.js plan
| Requested | V1 location |
|---|---|
| /app, /components | `js/ui/app.js`, `js/ui/charts.js` |
| /parsers | `js/core/parsers.js`, `js/core/xlsx.js` |
| /services | `js/core/pipeline.js`, `js/core/providers.js`, `js/core/ingest.js` |
| /analytics | `js/core/analytics.js`, `js/core/assistant.js` |
| /database, /prisma | `database/migrations/*.sql` (V2) |
| /lib | `js/core/utils.js`, `js/core/store.js` |

## Why browser-only for V1
GitHub Pages only serves static files; a browser-only design makes hosting free, keeps sensitive data off any server (simplest privacy story), and removes auth/DB operating costs. The engine in `js/core` is framework-agnostic and can run unchanged in a Node/Next.js API for V2.
