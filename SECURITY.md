# Security
- **No bank credentials.** The app never asks for bank logins, PINs or CVVs. Lint blocks credential input fields. PDF passwords are used in memory only.
- **Locked-down page.** The Content-Security-Policy is `default-src 'self'`. The only outside network access allowed is `*.supabase.co`.
- **XSS protection.** All dynamic text is escaped, and `eval` is banned.
- **File uploads.** Files are limited to 15 MB, file type is checked by magic bytes, parsing runs in a Web Worker, and each file gets a SHA-256 fingerprint.
- **Cloud data.** Row Level Security protects both the `user_data` table and the storage bucket, which is private. Only the anon/publishable key is used. The client refuses service_role keys, and CI blocks committing them.
- **Optional local encryption.** A passcode encrypts local data with PBKDF2-SHA256 (310k iterations) and AES-256-GCM.
- **Privacy.** Account and loan numbers are masked to their last 4 digits. Borrower name, address and CKYC number are not stored. Exports are protected against CSV formula injection.
- **Not end-to-end encrypted.** Cloud data is protected by RLS and Supabase's encryption at rest, but you, as the project owner, can see it in your Supabase dashboard.
