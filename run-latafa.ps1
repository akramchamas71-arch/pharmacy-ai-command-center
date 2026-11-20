$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$out = Join-Path $env:TEMP "pacc-tunnel-out.txt"
$err = Join-Path $env:TEMP "pacc-tunnel-err.txt"
Remove-Item $out,$err -ErrorAction SilentlyContinue
Write-Host "1/3 Opening secure tunnel to the database... (wait up to 60 seconds)"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c","railway connect Postgres --tunnel-only" -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  $text = ""
  if (Test-Path $out) { $text += (Get-Content $out -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $err) { $text += (Get-Content $err -Raw -ErrorAction SilentlyContinue) }
  if ($text -match "postgres(ql)?://[^\s]+") { $url = $Matches[0] }
}
if (-not $url) {
  Write-Host "FAILED: could not get the database address from the tunnel." -ForegroundColor Red
  taskkill /T /F /PID $p.Id | Out-Null
  exit 1
}
Write-Host "Tunnel is open." -ForegroundColor Green
$env:DATABASE_URL = $url
try {
  Write-Host "2/3 Creating the partner-company tables and adding Latafa..."
  npx prisma generate
  npx tsx prisma/real-data/setupSuppliers.ts
  Write-Host "3/3 Done." -ForegroundColor Green
}
finally {
  taskkill /T /F /PID $p.Id | Out-Null
  Write-Host "Tunnel closed."
}
