# Security Policy

## Threat model (V1, browser-only)
Financial data never leaves the user's device: there is no backend, no analytics, no third-party script. The main risks are XSS (leaking data from IndexedDB), malicious uploaded files, and device access.

| Control | Implementation |
|---|---|
| No credentials | The app never asks for net-banking ID/password, OTP, UPI PIN, card PIN or CVV. `scripts/lint.mjs` fails CI if such input fields are added. PDF *document* passwords are used in memory only and never stored. |
| No scraping | No code contacts bank websites. Live data only via consent-based Account Aggregator (server-side, V2). |
| Content-Security-Policy | `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'` — inline scripts and external origins are blocked. |
| XSS | All dynamic values pass through `esc()`; no `eval`/`new Function` (lint-enforced). |
| File upload | 15 MB limit, magic-byte type detection (`%PDF`, ZIP), HTML/script content rejected, pdf.js with `isEvalSupported:false`, parsing inside a Web Worker. |
| Malware scanning | V1 never executes or stores uploaded files (parsed to text in memory). V2 architecture: upload to quarantine bucket → ClamAV/cloud AV scan → parse → delete original. |
| Encryption at rest | Optional passcode: PBKDF2-SHA256 (310,000 iterations) → AES-256-GCM via WebCrypto. |
| Masking | Only last 4 digits stored (`XXXX XXXX 1234`). |
| Exports | CSV formula-injection neutralised (`=`, `+`, `-`, `@` prefixes). |
| Logging | Audit log stores actions/counts only; error log stores messages/codes, never narrations, amounts or file content. |
| Secrets | None needed in V1. `.env` git-ignored; `scripts/check-secrets.mjs` blocks keys, env files, card numbers and non-synthetic statements in CI. |

## V2 server checklist
HTTPS only + HSTS; `Secure; HttpOnly; SameSite=Lax` cookies; CSRF tokens on state-changing routes; Zod input validation; Prisma/parameterised SQL; rate limiting (login, upload, AI); argon2id password hashing; Postgres RLS (see migration); column encryption for narrations; per-user authorization on every query; structured logs with PII redaction.

## Reporting a vulnerability
Please open a **private security advisory** on GitHub (Security → Advisories → Report a vulnerability). Do not include real financial data in reports.
