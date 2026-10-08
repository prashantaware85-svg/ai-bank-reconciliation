#Requires -Version 5.1
<#
.SYNOPSIS
  Step 20: backup-age monitoring — fail loudly when backups go stale.
.DESCRIPTION
  Inspects the newest backup-*.dump in -BackupDir. Exit codes follow the
  Nagios convention so any monitor (Task Scheduler history, Uptime Kuma,
  cron mail, Datadog) can alert: 0 = fresh, 1 = older than -WarnHours,
  2 = missing/empty or older than -CritHours. Prints only safe
  diagnostics (file name, age, sizes) — never secrets.
  Nothing is created, modified, or deleted.
.PARAMETER BackupDir
  Directory holding backup-*.dump files.
.PARAMETER WarnHours
  Age in hours that raises a warning. Defaults to 26 (observability doc).
.PARAMETER CritHours
  Age in hours that is critical. Defaults to 50.
.EXAMPLE
  .\Check-BackupAge.ps1
  if ($LASTEXITCODE -ne 0) { Send-Alert }
#>
[CmdletBinding()]
param(
  [string]$BackupDir = (Join-Path $env:TEMP 'ai-bank-backups'),
  [double]$WarnHours = 26,
  [double]$CritHours = 50
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($CritHours -le $WarnHours) { throw 'CritHours must be greater than WarnHours.' }

$newest = Get-ChildItem -LiteralPath $BackupDir -Filter 'backup-*.dump' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $newest) {
  Write-Output "BACKUP_MISSING dir=$BackupDir (no backup-*.dump found)"
  exit 2
}
if ($newest.Length -le 0) {
  Write-Output "BACKUP_EMPTY file=$($newest.Name) (zero bytes; treated as missing)"
  exit 2
}
$ageHours = ((Get-Date) - $newest.LastWriteTime).TotalHours
$age = [math]::Round($ageHours, 1)
if ($ageHours -ge $CritHours) {
  Write-Output "BACKUP_STALE_CRITICAL file=$($newest.Name) ageHours=$age bytes=$($newest.Length)"
  exit 2
}
if ($ageHours -ge $WarnHours) {
  Write-Output "BACKUP_STALE_WARN file=$($newest.Name) ageHours=$age bytes=$($newest.Length)"
  exit 1
}
Write-Output "BACKUP_AGE_OK file=$($newest.Name) ageHours=$age bytes=$($newest.Length)"
exit 0
