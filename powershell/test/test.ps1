#!/usr/bin/env pwsh
# Mirrors node/test/cli.test.mjs and bash/test/test.sh — runs pmsec.ps1
# under a fresh $HOME and diffs the on-disk shape against the same bytes
# the other suites verify.
$ErrorActionPreference = 'Stop'
$Here  = Split-Path -Parent $MyInvocation.MyCommand.Path
function _PathJoinBootstrap {
  if ($args.Count -eq 0) { return '' }
  $r = $args[0]
  for ($i = 1; $i -lt $args.Count; $i++) {
    foreach ($p in ($args[$i] -split '[\\/]')) { if ($p -ne '') { $r = Join-Path $r $p } }
  }
  return $r
}
$Pmsec = (Resolve-Path (_PathJoinBootstrap $Here '..' 'pmsec.ps1')).Path
$PwshExe = if ($IsWindows) {
  (Get-Process -Id $PID).Path
} else {
  (Get-Process -Id $PID).Path
}

$script:Pass = 0
$script:Fail = 0
$script:LastFail = ''

function PathJoin {
  if ($args.Count -eq 0) { return '' }
  $result = $args[0]
  for ($i = 1; $i -lt $args.Count; $i++) {
    foreach ($p in ($args[$i] -split '[\\/]')) {
      if ($p -ne '') { $result = Join-Path $result $p }
    }
  }
  return $result
}

function NewHome {
  $d = PathJoin ([System.IO.Path]::GetTempPath()) ('pmsec-ps-' + [guid]::NewGuid().ToString('N').Substring(0,8))
  [void](New-Item -ItemType Directory -Path $d -Force)
  return $d
}

# Save and clear every env var that would otherwise leak from the dev shell
# into pmsec; only the explicit overrides ($Home, $Extra) reach the child.
function InvokePmsec([string]$HomeDir, [hashtable]$Extra, [string[]]$Argv) {
  $envKeys = @(
    'NPM_CONFIG_USERCONFIG','UV_CONFIG_FILE','BUN_CONFIG_FILE',
    'YARN_RC_FILENAME','CARGO_HOME','MISE_GLOBAL_CONFIG_FILE',
    'APPDATA','LOCALAPPDATA','PMSEC_PLATFORM','XDG_CONFIG_HOME',
    'PMSEC_HOME','HOME','USERPROFILE'
  )
  $saved = @{}
  foreach ($k in $envKeys) {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
    [Environment]::SetEnvironmentVariable($k, $null, 'Process')
  }
  [Environment]::SetEnvironmentVariable('HOME', $HomeDir, 'Process')
  [Environment]::SetEnvironmentVariable('USERPROFILE', $HomeDir, 'Process')
  [Environment]::SetEnvironmentVariable('PMSEC_HOME', $HomeDir, 'Process')
  [Environment]::SetEnvironmentVariable('XDG_CONFIG_HOME', (Join-Path $HomeDir '.config'), 'Process')
  # Force the unix path layout for shape parity across runners; the
  # Windows-specific layout is exercised by the dedicated APPDATA test.
  [Environment]::SetEnvironmentVariable('PMSEC_PLATFORM', 'linux', 'Process')
  if ($Extra) {
    foreach ($k in $Extra.Keys) {
      [Environment]::SetEnvironmentVariable($k, $Extra[$k], 'Process')
    }
  }
  $errFile = [System.IO.Path]::GetTempFileName()
  # On Windows PowerShell 5.1, native command stderr writes also surface as
  # ErrorRecord under $ErrorActionPreference='Stop' and would abort the
  # caller; relax that for the duration of the child invocation.
  $oldEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $stdout = (& $PwshExe -NoProfile -File $Pmsec @Argv 2>$errFile | Out-String)
    $code = $LASTEXITCODE
    $stderr = [System.IO.File]::ReadAllText($errFile)
  } finally {
    $ErrorActionPreference = $oldEAP
    Remove-Item -Force -LiteralPath $errFile -ErrorAction Ignore
    foreach ($k in $envKeys) {
      [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process')
    }
  }
  return @{ Code = $code; Out = $stdout; Err = $stderr }
}

function AssertFileEq([string]$Label, [string]$Expected, [string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    $script:LastFail = "$Label`n  file missing: $Path"
    return $false
  }
  $actual = [System.IO.File]::ReadAllText($Path)
  if ($actual -eq $Expected) { return $true }
  $script:LastFail = "$Label`n  expected: $($Expected | ConvertTo-Json)`n  actual:   $($actual | ConvertTo-Json)"
  return $false
}

function AssertMatch([string]$Label, [string]$Pattern, [string]$Haystack) {
  if ($Haystack -match $Pattern) { return $true }
  $script:LastFail = "$Label`n  pattern: $Pattern`n  body:    $($Haystack.Substring(0, [Math]::Min(400, $Haystack.Length)))"
  return $false
}

function T([string]$Name, [scriptblock]$Body) {
  try {
    if (& $Body) {
      $script:Pass++
      Write-Host "PASS  $Name"
    } else {
      $script:Fail++
      Write-Host "FAIL  $Name"
      Write-Host $script:LastFail
    }
  } catch {
    $script:Fail++
    Write-Host "FAIL  $Name (exception)"
    Write-Host $_.ToString()
  }
}

# ---------- tests ----------

T 'set writes every supported tool config' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('set','7')
    if ($r.Code -ne 0) { $script:LastFail = "exit code $($r.Code)`n$($r.Out)"; return $false }
    $ok = $true
    $ok = $ok -and (AssertMatch 'npm key' '(?m)^min-release-age=7$' ([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))))
    $ok = $ok -and (AssertMatch 'pnpm key' '(?m)^minimum-release-age=10080$' ([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))))
    $ok = $ok -and (AssertMatch 'bun section' '(?m)^\[install\]$' ([System.IO.File]::ReadAllText((Join-Path $h '.bunfig.toml'))))
    $ok = $ok -and (AssertMatch 'bun key' '(?m)^minimumReleaseAge = 604800$' ([System.IO.File]::ReadAllText((Join-Path $h '.bunfig.toml'))))
    $ok = $ok -and (AssertMatch 'yarn key' '(?m)^npmMinimalAgeGate: "7d"$' ([System.IO.File]::ReadAllText((Join-Path $h '.yarnrc.yml'))))
    $ok = $ok -and (AssertMatch 'uv key' '(?m)^exclude-newer = "7 days"$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'uv' 'uv.toml'))))
    $ok = $ok -and (AssertMatch 'mise section' '(?m)^\[settings\]$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'mise' 'config.toml'))))
    $ok = $ok -and (AssertMatch 'mise key' '(?m)^minimum_release_age = "7d"$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'mise' 'config.toml'))))
    $ok = $ok -and (AssertMatch 'mise paranoid extra' '(?m)^paranoid = true$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'mise' 'config.toml'))))
    $ok = $ok -and (AssertMatch 'npm audit-level extra' '(?m)^audit-level=high$' ([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))))
    $ok = $ok -and (AssertMatch 'pnpm trust-policy extra' '(?m)^trust-policy=no-downgrade$' ([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))))
    $ok = $ok -and (AssertMatch 'pnpm block-exotic-subdeps extra' '(?m)^block-exotic-subdeps=true$' ([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))))
    $ok = $ok -and (AssertMatch 'yarn enableHardenedMode extra' '(?m)^enableHardenedMode: true$' ([System.IO.File]::ReadAllText((Join-Path $h '.yarnrc.yml'))))
    return $ok
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'check passes after set across all tools' {
  $h = NewHome
  try {
    [void](InvokePmsec $h $null @('set','7'))
    $r = InvokePmsec $h $null @('check','--min','7')
    if ($r.Code -ne 0) { $script:LastFail = "exit $($r.Code)`n$($r.Out)" }
    return $r.Code -eq 0
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'check fails when missing or stale' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('check')
    if ($r.Code -ne 1) { $script:LastFail = "expected exit 1, got $($r.Code)`n$($r.Out)"; return $false }
    foreach ($t in 'npm','pnpm','yarn','bun','cargo','mise','uv') {
      if (-not (AssertMatch "MISSING $t" "MISSING $t" $r.Out)) { return $false }
    }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'unset preserves unrelated keys per file' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "registry=https://r/`nmin-release-age=7`nminimum-release-age=10080`n")
    [void](New-Item -ItemType Directory -Force -Path (PathJoin $h '.config' 'uv'))
    [System.IO.File]::WriteAllText((PathJoin $h '.config' 'uv' 'uv.toml'), "exclude-newer = ""7 days""`nindex-strategy = ""unsafe-best-match""`n")
    [System.IO.File]::WriteAllText((Join-Path $h '.bunfig.toml'), "[install]`nminimumReleaseAge = 604800`nregistry = ""https://x/""`n")
    [System.IO.File]::WriteAllText((Join-Path $h '.yarnrc.yml'), "npmMinimalAgeGate: ""7d""`nnpmRegistryServer: ""https://r/""`n")
    [void](InvokePmsec $h $null @('unset'))
    $ok = $true
    $ok = $ok -and (AssertFileEq '.npmrc'    "registry=https://r/`n"                                  (Join-Path $h '.npmrc'))
    $ok = $ok -and (AssertFileEq 'uv.toml'   "index-strategy = ""unsafe-best-match""`n"               (PathJoin $h '.config' 'uv' 'uv.toml'))
    $ok = $ok -and (AssertFileEq '.bunfig'   "[install]`nregistry = ""https://x/""`n"                 (Join-Path $h '.bunfig.toml'))
    $ok = $ok -and (AssertFileEq '.yarnrc'   "npmRegistryServer: ""https://r/""`n"                    (Join-Path $h '.yarnrc.yml'))
    return $ok
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'set replaces existing values in place' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "min-release-age=3`nregistry=https://r/`n")
    [void](InvokePmsec $h $null @('set','10','--tool','npm'))
    return (AssertFileEq '.npmrc' "min-release-age=10`nregistry=https://r/`naudit-level=high`n" (Join-Path $h '.npmrc'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '--tool restricts which tools get written' {
  $h = NewHome
  try {
    [void](InvokePmsec $h $null @('set','7','--tool','npm,bun'))
    if (-not (Test-Path -LiteralPath (Join-Path $h '.npmrc')))      { $script:LastFail = '.npmrc not written'; return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $h '.bunfig.toml'))){ $script:LastFail = '.bunfig.toml not written'; return $false }
    if (Test-Path -LiteralPath (PathJoin $h '.config' 'uv' 'uv.toml')) { $script:LastFail = 'uv.toml unexpectedly written'; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'Windows uv path uses APPDATA' {
  $h = NewHome
  try {
    $appdata = PathJoin $h 'AppData' 'Roaming'
    [void](InvokePmsec $h @{ APPDATA = $appdata; PMSEC_PLATFORM = 'win32' } @('set','7','--tool','uv'))
    return (AssertMatch 'uv key' '(?m)^exclude-newer = "7 days"$' ([System.IO.File]::ReadAllText((PathJoin $appdata 'uv' 'uv.toml'))))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '--json emits parseable JSON for check' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('check','--json')
    $data = $null
    try { $data = $r.Out | ConvertFrom-Json } catch { $script:LastFail = "json parse failed: $_`n$($r.Out)"; return $false }
    if ($data.ok -ne $false) { $script:LastFail = "expected ok=false, got $($data.ok)"; return $false }
    if ($data.rows.Count -ne 7) { $script:LastFail = "expected 7 rows, got $($data.rows.Count)"; return $false }
    $names = ($data.rows | ForEach-Object { $_.tool }) -join ','
    if ($names -ne 'npm,pnpm,yarn,bun,cargo,mise,uv') { $script:LastFail = "row order: $names"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'bun set inserts key inside existing [install] section' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.bunfig.toml'), "[install]`nregistry = ""https://x/""`n")
    [void](InvokePmsec $h $null @('set','7','--tool','bun'))
    return (AssertFileEq '.bunfig' "[install]`nminimumReleaseAge = 604800`nregistry = ""https://x/""`n" (Join-Path $h '.bunfig.toml'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'bun set creates [install] section if missing' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.bunfig.toml'), "telemetry = false`n")
    [void](InvokePmsec $h $null @('set','7','--tool','bun'))
    return (AssertFileEq '.bunfig' "telemetry = false`n`n[install]`nminimumReleaseAge = 604800`n" (Join-Path $h '.bunfig.toml'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'yarn check parses npmMinimalAgeGate days correctly' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.yarnrc.yml'), "npmMinimalAgeGate: ""14d""`nenableHardenedMode: true`n")
    $r = InvokePmsec $h $null @('check','--json','--tool','yarn','--min','7')
    $data = $r.Out | ConvertFrom-Json
    if ($data.ok -ne $true) { $script:LastFail = "expected ok=true"; return $false }
    if ($data.rows[0].days -ne 14) { $script:LastFail = "expected 14 days, got $($data.rows[0].days)"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'pnpm check normalizes minutes to days' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "minimum-release-age=20160`n")
    $r = InvokePmsec $h $null @('check','--json','--tool','pnpm')
    $data = $r.Out | ConvertFrom-Json
    if ($data.rows[0].days -ne 14) { $script:LastFail = "expected 14, got $($data.rows[0].days)"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '.bak is created once and never overwritten' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "registry=https://original/`n")
    [void](InvokePmsec $h $null @('set','7','--tool','npm'))
    [void](InvokePmsec $h $null @('set','10','--tool','npm'))
    return (AssertFileEq '.npmrc.bak' "registry=https://original/`n" (Join-Path $h '.npmrc.bak'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'set 0 exits 2 with usage error' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('set','0')
    if ($r.Code -ne 2) { $script:LastFail = "expected exit 2, got $($r.Code)`nstderr: $($r.Err)"; return $false }
    return ($r.Err -match 'set requires integer DAYS > 0')
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'hardening extras roundtrip (check / set / unset)' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "minimum-release-age=20160`n")
    $r = InvokePmsec $h $null @('check','--json','--tool','pnpm','--min','7')
    if ($r.Code -ne 1) { $script:LastFail = "extras-missing exit $($r.Code)"; return $false }
    $data = $r.Out | ConvertFrom-Json
    if ($data.ok -ne $false) { $script:LastFail = "extras-missing ok != false"; return $false }
    if ($data.rows[0].extras.Count -ne 2) { $script:LastFail = "expected 2 extras, got $($data.rows[0].extras.Count)"; return $false }
    [void](InvokePmsec $h $null @('set','14','--tool','pnpm'))
    $body = [System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))
    if ($body -notmatch '(?m)^trust-policy=no-downgrade$') { $script:LastFail = "trust-policy not written: $body"; return $false }
    if ($body -notmatch '(?m)^block-exotic-subdeps=true$') { $script:LastFail = "block-exotic-subdeps not written: $body"; return $false }
    $r2 = InvokePmsec $h $null @('check','--json','--tool','pnpm','--min','7')
    if ($r2.Code -ne 0) { $script:LastFail = "after-set exit $($r2.Code)"; return $false }
    if (($r2.Out | ConvertFrom-Json).ok -ne $true) { $script:LastFail = "after-set ok != true"; return $false }
    [void](InvokePmsec $h $null @('unset','--tool','pnpm'))
    $after = [System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))
    if ($after -match 'trust-policy') { $script:LastFail = "trust-policy not removed: $after"; return $false }
    if ($after -match 'block-exotic-subdeps') { $script:LastFail = "block-exotic-subdeps not removed: $after"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '--version prints PmsecVersion' {
  $h = NewHome
  try {
    $expected = (Select-String -Path $Pmsec -Pattern "PmsecVersion = '([^']+)'" | Select-Object -First 1).Matches[0].Groups[1].Value
    foreach ($flag in @('--version', '-V')) {
      $r = InvokePmsec $h $null @($flag)
      if ($r.Code -ne 0) { $script:LastFail = "$flag exit $($r.Code)`n$($r.Out)"; return $false }
      if ($r.Out.Trim() -ne "pmsec $expected") { $script:LastFail = "$flag out '$($r.Out.Trim())' != 'pmsec $expected'"; return $false }
    }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

# ---------- summary ----------

Write-Host ""
Write-Host "$($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { exit 1 }
exit 0
