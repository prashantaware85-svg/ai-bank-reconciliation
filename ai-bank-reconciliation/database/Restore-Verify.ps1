#Requires -Version 5.1
<#
.SYNOPSIS
  Step 18: isolated restore drill — restores a dump into a scratch database,
  verifies counts + migrations + secret hygiene, then drops the scratch DB.
.DESCRIPTION
  NEVER touches the source database except read-only SELECT counts.
  Refuses to use the source name (or postgres/template0/template1) as the
  scratch name. Fails closed if counts mismatch, migrations are missing,
  or secret shapes are found in the dump. Prints only safe diagnostics.
.PARAMETER DumpFile
  Custom-format dump created by Backup-Postgres.ps1.
.PARAMETER ScratchDb
  Isolated database name. Defaults to restore_drill_<yyyyMMdd_HHmm>.
.PARAMETER EnvFile
  Path to backend/.env. Defaults to ..\backend\.env relative to this script.
.PARAMETER PgBin
  PostgreSQL bin dir. Defaults to C:\Program Files\PostgreSQL\18\bin.
.EXAMPLE
  .\Restore-Verify.ps1 -DumpFile "$env:TEMP\ai-bank-backups\backup-20261006-2000.dump"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DumpFile,
  [string]$ScratchDb = ('restore_drill_' + (Get-Date -Format 'yyyyMMdd_HHmm')),
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\backend\.env'),
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DotEnvValue([string]$Path, [string]$Key) {
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace "^$Key=", '').Trim()
}

function Invoke-Sql([string]$Db, [string]$Sql) {
  return (& "$PgBin\psql.exe" -h $pgHost -p $pgPort -U $pgUser -d $Db -t -A -c $Sql) -join "`n"
}

$pgUser = Get-DotEnvValue $EnvFile 'POSTGRES_USER'
$pgPass = Get-DotEnvValue $EnvFile 'POSTGRES_PASSWORD'
$pgHost = Get-DotEnvValue $EnvFile 'POSTGRES_HOST'
$pgPort = Get-DotEnvValue $EnvFile 'POSTGRES_PORT'
$pgDb = Get-DotEnvValue $EnvFile 'POSTGRES_DB'
if (-not $pgDb) {
  $url = Get-DotEnvValue $EnvFile 'DATABASE_URL'
  $m = [regex]::Match($url, '^postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)')
  if (-not $m.Success) { throw 'Cannot determine Postgres connection from .env.' }
  if (-not $pgUser) { $pgUser = $m.Groups[1].Value }
  if (-not $pgPass) { $pgPass = [uri]::UnescapeDataString($m.Groups[2].Value) }
  if (-not $pgHost) { $pgHost = $m.Groups[3].Value }
  if (-not $pgPort) { $pgPort = $m.Groups[4].Value }
  if (-not $pgDb) { $pgDb = $m.Groups[5].Value }
}
if (-not $pgHost) { $pgHost = '127.0.0.1' }
if (-not $pgPort) { $pgPort = '5432' }
if (-not ($pgUser -and $pgPass -and $pgDb)) { throw 'Postgres user/password/database are not configured.' }

# Guardrails: scratch name must be safe and must NOT be the source DB.
if ($ScratchDb -notmatch '^[A-Za-z][A-Za-z0-9_]{0,62}$') { throw "Unsafe scratch name: $ScratchDb" }
$protected = @('postgres', 'template0', 'template1', $pgDb.ToLower())
if ($protected -contains $ScratchDb.ToLower()) { throw "Scratch name '$ScratchDb' is protected (source/system DB). Refusing." }
if (-not (Test-Path -LiteralPath $DumpFile)) { throw "Dump file not found: $DumpFile" }

$env:PGPASSWORD = $pgPass
$created = $false
try {
  # 1. Source counts (read-only).
  # NOTE: SQL identifiers use backtick-escaped quotes (Windows PowerShell
  # strips plain double quotes when passing -c text to native psql).
  $srcUser = Invoke-Sql $pgDb "SELECT count(*) FROM \`"User\`";"
  $srcAi = Invoke-Sql $pgDb "SELECT count(*) FROM \`"AIAnalysis\`";"
  $srcAudit = Invoke-Sql $pgDb "SELECT count(*) FROM \`"AuditLog\`";"

  # 2. Create scratch + restore (isolated; source untouched).
  Invoke-Sql 'postgres' "CREATE DATABASE `"$ScratchDb`";"
  $created = $true
  & "$PgBin\pg_restore.exe" -h $pgHost -p $pgPort -U $pgUser -d $ScratchDb --clean --if-exists $DumpFile 2>&1 | Out-String -Width 200 | Write-Output
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed (exit $LASTEXITCODE)." }

  # 3. Verify counts + migrations state.
  $reUser = Invoke-Sql $ScratchDb "SELECT count(*) FROM \`"User\`";"
  $reAi = Invoke-Sql $ScratchDb "SELECT count(*) FROM \`"AIAnalysis\`";"
  $reAudit = Invoke-Sql $ScratchDb "SELECT count(*) FROM \`"AuditLog\`";"
  $reMig = Invoke-Sql $ScratchDb "SELECT count(*) FROM \`"_prisma_migrations\`";"
  $failures = @()
  if ($srcUser.Trim() -ne $reUser.Trim()) { $failures += "User count mismatch source=$($srcUser.Trim()) restored=$($reUser.Trim())" }
  if ($srcAi.Trim() -ne $reAi.Trim()) { $failures += "AIAnalysis count mismatch source=$($srcAi.Trim()) restored=$($reAi.Trim())" }
  if ($srcAudit.Trim() -ne $reAudit.Trim()) { $failures += "AuditLog count mismatch source=$($srcAudit.Trim()) restored=$($reAudit.Trim())" }
  if ([int]$reMig.Trim() -le 0) { $failures += '_prisma_migrations has no rows; schema state unproven' }

  # 4. Secret hygiene: dump SQL text must not contain secret shapes.
  $scanFile = Join-Path ([System.IO.Path]::GetTempPath()) ("drill-scan-$ScratchDb.sql")
  & "$PgBin\pg_restore.exe" -f $scanFile $DumpFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore SQL export for scan failed.' }
  $hits = Select-String -LiteralPath $scanFile -Pattern 'AI_API_KEY\s*=|JWT_(REFRESH_)?SECRET\s*=|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(ql)?://[^/\s:]+:[^/\s@]+@' -AllMatches |
    ForEach-Object { $_.LineNumber } | Select-Object -First 5
  Remove-Item -Force -LiteralPath $scanFile
  if ($hits) { $failures += "secret shapes found in dump at SQL lines: $($hits -join ',')" }

  if ($failures.Count -gt 0) { throw ('VERIFY_FAILED: ' + ($failures -join ' | ')) }
  Write-Output "RESTORE_OK scratch=$ScratchDb user=$($reUser.Trim()) ai=$($reAi.Trim()) audit=$($reAudit.Trim()) migrations=$($reMig.Trim()) secrets=clean"
} finally {
  if ($created) {
    Invoke-Sql 'postgres' "DROP DATABASE `"$ScratchDb`";"
    Write-Output "SCRATCH_DROPPED scratch=$ScratchDb"
  }
  $env:PGPASSWORD = $null
}
