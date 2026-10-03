# MoneyLens v1.2.1: one-click setup / repair for Windows.
# Run from the folder where you extracted the zip:
#   Right-click this file -> "Run with PowerShell"
#   or: powershell -ExecutionPolicy Bypass -File .\SETUP_WINDOWS.ps1
$ErrorActionPreference = "Stop"
$Target = "D:\Software\moneylens"
$Here   = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "MoneyLens v1.2.1 setup" -ForegroundColor Cyan

if ((Resolve-Path $Here).Path -ne $Target) {
  if (Test-Path $Target) {
    $Backup = "D:\Software\moneylens_old_" + (Get-Date -Format "yyyyMMdd_HHmmss")
    Write-Host "Backing up old folder to $Backup"
    Rename-Item $Target $Backup
    if (Test-Path "$Backup\.git") { Write-Host "Keeping your Git history"; Move-Item "$Backup\.git" "$Here\.git" -Force }
    if ((Test-Path "$Backup\js\config.js") -and (Select-String -Path "$Backup\js\config.js" -Pattern "supabase.co" -Quiet)) {
      Write-Host "Keeping your Supabase settings"; Copy-Item "$Backup\js\config.js" "$Here\js\config.js" -Force }
  }
  Copy-Item $Here $Target -Recurse -Force
}
Set-Location $Target
Write-Host "Installed in $Target" -ForegroundColor Green
Write-Host "Starting local server: open http://localhost:8000 and press Ctrl+Shift+R. Sidebar must show v1.2.1." -ForegroundColor Yellow
Write-Host "Press Ctrl+C in this window to stop the server."
Start-Process "http://localhost:8000"
python -m http.server 8000
