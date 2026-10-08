#Requires -Version 5.1
<#
.SYNOPSIS
  Step 20: register (or re-register) the daily PostgreSQL backup task.
.DESCRIPTION
  Registers a Windows Task Scheduler job that runs the existing
  database/Backup-Postgres.ps1 (Step 18, reused as-is — no duplicate
  implementation). The daily time is configurable; nothing is
  hard-coded to a production hour. Backup failures throw inside the
  backup script, so the task reports a non-zero LastRunResult.
  No secrets are stored in the task definition (the script reads
  backend/.env at run time and never prints values).
.PARAMETER TaskName
  Scheduled-task name. Defaults to 'AI-Bank-Backup-Daily'.
.PARAMETER DailyTime
  Daily run time (24h 'HH:mm'). Defaults to '02:30'. Sundays–Saturdays.
.PARAMETER EnvFile
  backend/.env used by the backup script at run time.
.PARAMETER OutDir
  Dump destination used by the backup script.
.PARAMETER PgBin
  PostgreSQL bin dir used by the backup script.
.EXAMPLE
  .\Register-BackupSchedule.ps1
.EXAMPLE
  .\Register-BackupSchedule.ps1 -DailyTime '03:15' -OutDir 'D:\backups\ai-bank'
.NOTES
  To remove: Unregister-ScheduledTask -TaskName 'AI-Bank-Backup-Daily' -Confirm:$false
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'AI-Bank-Backup-Daily',
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$DailyTime = '02:30',
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\backend\.env'),
  [string]$OutDir = (Join-Path $env:TEMP 'ai-bank-backups'),
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$backupScript = Join-Path $PSScriptRoot 'Backup-Postgres.ps1'
if (-not (Test-Path -LiteralPath $backupScript)) { throw "Backup script not found: $backupScript" }
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Env file not found: $EnvFile" }

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "Replacing existing scheduled task '$TaskName'."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`" -EnvFile `"$EnvFile`" -OutDir `"$OutDir`" -PgBin `"$PgBin`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments `
  -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($DailyTime, 'HH:mm', $null))
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Description 'Daily AI Bank Reconciliation PostgreSQL backup (Step 20).' | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$next = ($task | Get-ScheduledTaskInfo).NextRunTime
Write-Output "SCHEDULE_OK task=$TaskName daily=$DailyTime state=$($task.State) nextRun=$next"
Write-Output "Verify with: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
