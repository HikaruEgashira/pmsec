# pmsec Intune Platform Script entry point.
# Upload this file as-is. Intune does not support command-line arguments for
# Platform Scripts, so this wrapper downloads pmsec and registers its scheduled
# task internally before running the payload.
# License: MIT.
# SPDX-License-Identifier: MIT

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$pmsecCommit = '72aed32e31ad3917d0a6634d2e1bf45601e1f2ea'
$pmsecUri = "https://raw.githubusercontent.com/HikaruEgashira/pmsec/$pmsecCommit/powershell/pmsec.ps1"
$taskName = 'pmsec daily'
$dailyAt = '12:00'

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'this Intune Platform Script is only supported on Windows'
  }

  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  if ($null -eq $identity.User -or $identity.User.Value -eq 'S-1-5-18') {
    throw 'configure Intune to run this script using the logged-on credentials (required for WSL access)'
  }

  $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw 'could not resolve the current user''s LocalAppData directory'
  }

  $installDir = Join-Path $localAppData 'pmsec'
  $installPath = Join-Path $installDir 'pmsec.ps1'
  $tempPath = $installPath + '.download-' + [guid]::NewGuid().ToString('N')
  [void](New-Item -ItemType Directory -Path $installDir -Force)

  try {
    # GitHub requires TLS 1.2 on Windows PowerShell 5.1 hosts.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $pmsecUri -OutFile $tempPath
    Move-Item -LiteralPath $tempPath -Destination $installPath -Force
  } finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction Ignore
  }

  $powershellExe = Join-Path $PSHOME 'powershell.exe'
  $taskArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $installPath + '"'
  $action = New-ScheduledTaskAction `
    -Execute $powershellExe `
    -Argument $taskArguments `
    -WorkingDirectory $installDir
  $trigger = New-ScheduledTaskTrigger -Daily -At $dailyAt
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal `
    -UserId $identity.Name `
    -LogonType Interactive `
    -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Apply pmsec hardening to Windows and WSL every day.' `
    -Force | Out-Null

  & $powershellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $installPath
  exit $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine("pmsec Intune install: $_")
  exit 1
}
