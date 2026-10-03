# MoneyLens v1.2.1: full replacement (upgrade from ANY earlier version)

This zip is the COMPLETE app, not a small patch. It includes everything from v1.1 (loans, cloud sync,
no re-upload) plus the HDFC credit-card loan "Loan EMI Table" reader.

How to tell which version you are running: the sidebar (bottom-left) shows **v1.2.1**, and the upload
page heading says **"Upload statement"** with a **"Statement type"** dropdown that includes **Loan**.
If you see "Upload bank statement" / "Account type", you are still on the old v1.0 files.

## Easiest: run SETUP_WINDOWS.ps1 (does everything below automatically)

## Manual install (Windows PowerShell)
```powershell
cd "D:\Software"
Rename-Item "moneylens" "moneylens_old"
Expand-Archive -Path "$env:USERPROFILE\Downloads\moneylens-v1.2.1-full.zip" -DestinationPath "D:\Software" -Force
Move-Item "D:\Software\moneylens_old\.git" "D:\Software\moneylens\.git" -Force
```
If you had already put Supabase values into the old `js\config.js`, copy that one file back:
```powershell
Copy-Item "D:\Software\moneylens_old\js\config.js" "D:\Software\moneylens\js\config.js" -Force
```
(Skip this if you never set up Supabase.)

## Test locally
```powershell
cd "D:\Software\moneylens"
python -m http.server 8000
```
Open http://localhost:8000 and press **Ctrl + Shift + R** (or Ctrl + F5) to clear the browser cache.
Check the sidebar says **v1.2.1**. Then **Upload Statement** → choose `LINKED LOANS_....pdf` → **Process statement**.
You do not need to change Statement type. Loan PDFs are detected automatically. Then open **Loans**.

Your data already in the browser is kept.

## Publish
```powershell
cd "D:\Software\moneylens"
git add -A
git commit -m "MoneyLens v1.2.1: card loan EMI table + loans + cloud sync"
git push
```
Wait 1–2 minutes, open https://amitthkr30-a11y.github.io/moneylens/ and press Ctrl + Shift + R.
When everything works, you can delete `D:\Software\moneylens_old`.

## Cloud sync (optional)
See `docs/SUPABASE_SETUP.md`.
