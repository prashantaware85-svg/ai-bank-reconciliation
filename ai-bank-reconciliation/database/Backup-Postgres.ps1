#Requires -Version 5.1
<#
.SYNOPSIS
  Step 18: timestamped PostgreSQL custom-format backup (pg_dump -Fc).
.DESCRIPTION
  Reads connection values from backend/.env (POSTGRES_* or DATABASE_URL),
  never prints them, and writes backup-<yyyyMMdd-HHmm>.dump to -OutDir
  (TEMP by default so dumps are never committed). Validates the dump is
  non-empty and parseable by pg_restore --list, then prints path, size,
  entry count, and SHA256 (all safe to share).
.PARAMETER EnvFile
  Path to backend/.env. Defaults to ..\backend\.env relative to this script.
.PARAMETER OutDir
  Dump destination. Defaults to $env:TEMP\ai-bank-backups.
.PARAMETER PgBin
  PostgreSQL bin dir. Defaults to C:\Program Files\PostgreSQL\18\bin.
.EXAMPLE
  .\Backup-Postgres.ps1
#>
[CmdletBinding()]
param(
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\backend\.env'),
  [string]$OutDir = (Join-Path $env:TEMP 'ai-bank-backups'),
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DotEnvValue([string]$Path, [string]$Key) {
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return ($line -replace "^$Key=", '').Trim()
}

$pgUser = Get-DotEnvValue $EnvFile 'POSTGRES_USER'
$pgPass = Get-DotEnvValue $EnvFile 'POSTGRES_PASSWORD'
$pgHost = Get-DotEnvValue $EnvFile 'POSTGRES_HOST'
$pgPort = Get-DotEnvValue $EnvFile 'POSTGRES_PORT'
$pgDb = Get-DotEnvValue $EnvFile 'POSTGRES_DB'
if (-not $pgDb) {
  $url = Get-DotEnvValue $EnvFile 'DATABASE_URL'
  $m = [regex]::Match($url, '^postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)')
  if (-not $m.Success) { throw 'Cannot determine Postgres connection from .env (need POSTGRES_* or DATABASE_URL).' }
  if (-not $pgUser) { $pgUser = $m.Groups[1].Value }
  if (-not $pgPass) { $pgPass = [uri]::UnescapeDataString($m.Groups[2].Value) }
  if (-not $pgHost) { $pgHost = $m.Groups[3].Value }
  if (-not $pgPort) { $pgPort = $m.Groups[4].Value }
  if (-not $pgDb) { $pgDb = $m.Groups[5].Value }
}
if (-not $pgHost) { $pgHost = '127.0.0.1' }
if (-not $pgPort) { $pgPort = '5432' }
if (-not ($pgUser -and $pgPass -and $pgDb)) { throw 'Postgres user/password/database are not configured.' }

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$dump = Join-Path $OutDir "backup-$stamp.dump"
$env:PGPASSWORD = $pgPass
try {
  & "$PgBin\pg_dump.exe" -h $pgHost -p $pgPort -U $pgUser -d $pgDb -Fc -f $dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)." }
  $bytes = (Get-Item -LiteralPath $dump).Length
  if ($bytes -le 0) { throw 'Dump file is empty.' }
  $entries = & "$PgBin\pg_restore.exe" --list $dump | Measure-Object -Line | Select-Object -ExpandProperty Lines
  if ($entries -le 0) { throw 'pg_restore --list found no restorable entries.' }
  $sha = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash
  Write-Output "BACKUP_OK path=$dump bytes=$bytes entries=$entries sha256=$sha"
} finally {
  $env:PGPASSWORD = $null
}
