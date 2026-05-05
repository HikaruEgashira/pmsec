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

function InvokePmsec([string]$HomeDir, [hashtable]$Extra, [string[]]$Argv) {
  $envKeys = @(
    'NPM_CONFIG_USERCONFIG','UV_CONFIG_FILE','BUN_CONFIG_FILE',
    'YARN_RC_FILENAME','CARGO_HOME','MISE_GLOBAL_CONFIG_FILE',
    'APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME',
    'PMSEC_HOME','HOME','USERPROFILE','PMSEC_FAKE_SCOPES','PMSEC_NO_WSL',
    'PMSEC_NPM_VERSION','PMSEC_PNPM_VERSION','PMSEC_YARN_VERSION',
    'PMSEC_BUN_VERSION','PMSEC_CARGO_VERSION','PMSEC_MISE_VERSION','PMSEC_UV_VERSION'
  )
  $saved = @{}
  foreach ($k in $envKeys) {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
    [Environment]::SetEnvironmentVariable($k, $null, 'Process')
  }
  # Default scope = a single Linux scope rooted at $HomeDir. This stands in
  # for "one WSL distro" and reproduces the original behaviour of every
  # tool dropping its config under $HomeDir/... Tests can override via
  # $Extra.PMSEC_FAKE_SCOPES (e.g. for win32 APPDATA paths or multi-scope).
  [Environment]::SetEnvironmentVariable('PMSEC_FAKE_SCOPES', "test|$HomeDir|linux", 'Process')
  # Hide the host pnpm so version-aware extras (pnpm 11 default enforcement)
  # don't depend on what's installed on the test machine. Tests that exercise
  # pnpm 11 behavior pass an override via $Extra.
  [Environment]::SetEnvironmentVariable('PMSEC_PNPM_VERSION', 'none', 'Process')
  if ($Extra) {
    foreach ($k in $Extra.Keys) {
      [Environment]::SetEnvironmentVariable($k, $Extra[$k], 'Process')
    }
  }
  $errFile = [System.IO.Path]::GetTempFileName()
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

T 'enable writes the bundle for every tool' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('enable')
    if ($r.Code -ne 0) { $script:LastFail = "exit code $($r.Code)`n$($r.Out)"; return $false }
    $pnpmrcPath = PathJoin $h '.config' 'pnpm' 'rc'
    $ok = $true
    $ok = $ok -and (AssertMatch 'npm key' '(?m)^min-release-age=3$' ([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))))
    $ok = $ok -and (AssertMatch 'pnpm key' '(?m)^minimum-release-age=4320$' ([System.IO.File]::ReadAllText($pnpmrcPath)))
    if (([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))) -match 'minimum-release-age') {
      $script:LastFail = 'pnpm key leaked into .npmrc'; return $false
    }
    $ok = $ok -and (AssertMatch 'bun section' '(?m)^\[install\]$' ([System.IO.File]::ReadAllText((Join-Path $h '.bunfig.toml'))))
    $ok = $ok -and (AssertMatch 'bun key' '(?m)^minimumReleaseAge = 259200$' ([System.IO.File]::ReadAllText((Join-Path $h '.bunfig.toml'))))
    $ok = $ok -and (AssertMatch 'yarn key' '(?m)^npmMinimalAgeGate: "3d"$' ([System.IO.File]::ReadAllText((Join-Path $h '.yarnrc.yml'))))
    $ok = $ok -and (AssertMatch 'uv key' '(?m)^exclude-newer = "3 days"$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'uv' 'uv.toml'))))
    $ok = $ok -and (AssertMatch 'mise section' '(?m)^\[settings\]$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'mise' 'config.toml'))))
    $ok = $ok -and (AssertMatch 'mise key' '(?m)^minimum_release_age = "3d"$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'mise' 'config.toml'))))
    $ok = $ok -and (AssertMatch 'mise paranoid extra' '(?m)^paranoid = true$' ([System.IO.File]::ReadAllText((PathJoin $h '.config' 'mise' 'config.toml'))))
    $ok = $ok -and (AssertMatch 'npm audit-level extra' '(?m)^audit-level=high$' ([System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))))
    $ok = $ok -and (AssertMatch 'pnpm trust-policy extra' '(?m)^trust-policy=no-downgrade$' ([System.IO.File]::ReadAllText($pnpmrcPath)))
    $ok = $ok -and (AssertMatch 'pnpm block-exotic-subdeps extra' '(?m)^block-exotic-subdeps=true$' ([System.IO.File]::ReadAllText($pnpmrcPath)))
    $ok = $ok -and (AssertMatch 'pnpm strict-dep-builds extra' '(?m)^strict-dep-builds=true$' ([System.IO.File]::ReadAllText($pnpmrcPath)))
    $ok = $ok -and (AssertMatch 'yarn enableHardenedMode extra' '(?m)^enableHardenedMode: true$' ([System.IO.File]::ReadAllText((Join-Path $h '.yarnrc.yml'))))
    return $ok
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'check passes after enable across all tools' {
  $h = NewHome
  try {
    [void](InvokePmsec $h $null @('enable'))
    $r = InvokePmsec $h $null @('check')
    if ($r.Code -ne 0) { $script:LastFail = "exit $($r.Code)`n$($r.Out)" }
    return $r.Code -eq 0
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'check fails when bundle missing' {
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

T 'disable preserves unrelated keys per file' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "registry=https://r/`nmin-release-age=3`n")
    [void](New-Item -ItemType Directory -Force -Path (PathJoin $h '.config' 'pnpm'))
    [System.IO.File]::WriteAllText((PathJoin $h '.config' 'pnpm' 'rc'), "minimum-release-age=4320`nstore-dir=/tmp/pstore`n")
    [void](New-Item -ItemType Directory -Force -Path (PathJoin $h '.config' 'uv'))
    [System.IO.File]::WriteAllText((PathJoin $h '.config' 'uv' 'uv.toml'), "exclude-newer = ""3 days""`nindex-strategy = ""unsafe-best-match""`n")
    [System.IO.File]::WriteAllText((Join-Path $h '.bunfig.toml'), "[install]`nminimumReleaseAge = 259200`nregistry = ""https://x/""`n")
    [System.IO.File]::WriteAllText((Join-Path $h '.yarnrc.yml'), "npmMinimalAgeGate: ""3d""`nnpmRegistryServer: ""https://r/""`n")
    [void](InvokePmsec $h $null @('disable'))
    $ok = $true
    $ok = $ok -and (AssertFileEq '.npmrc'    "registry=https://r/`n"                                  (Join-Path $h '.npmrc'))
    $ok = $ok -and (AssertFileEq 'pnpm rc'   "store-dir=/tmp/pstore`n"                                (PathJoin $h '.config' 'pnpm' 'rc'))
    $ok = $ok -and (AssertFileEq 'uv.toml'   "index-strategy = ""unsafe-best-match""`n"               (PathJoin $h '.config' 'uv' 'uv.toml'))
    $ok = $ok -and (AssertFileEq '.bunfig'   "[install]`nregistry = ""https://x/""`n"                 (Join-Path $h '.bunfig.toml'))
    $ok = $ok -and (AssertFileEq '.yarnrc'   "npmRegistryServer: ""https://r/""`n"                    (Join-Path $h '.yarnrc.yml'))
    return $ok
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'enable upgrades values that are weaker than the request' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "min-release-age=1`nregistry=https://r/`n")
    [void](InvokePmsec $h $null @('enable','--tool','npm'))
    return (AssertFileEq '.npmrc' "min-release-age=3`nregistry=https://r/`naudit-level=high`n" (Join-Path $h '.npmrc'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'enable preserves stricter existing cooldowns' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "min-release-age=99`nregistry=https://r/`n")
    $r = InvokePmsec $h $null @('enable','--tool','npm')
    if ($r.Out -notmatch '(?m)^keep ') { $script:LastFail = "expected keep line, got: $($r.Out)"; return $false }
    return (AssertFileEq '.npmrc' "min-release-age=99`nregistry=https://r/`naudit-level=high`n" (Join-Path $h '.npmrc'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'enable --force overwrites stricter existing values' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "min-release-age=99`n")
    [void](InvokePmsec $h $null @('enable','--tool','npm','--days','1','--force'))
    $body = [System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))
    if ($body -notmatch '(?m)^min-release-age=1$') { $script:LastFail = "expected min-release-age=1, got: $body"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'enable --days upgrades when request exceeds existing' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.npmrc'), "min-release-age=3`n")
    [void](InvokePmsec $h $null @('enable','--tool','npm','--days','14'))
    $body = [System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))
    if ($body -notmatch '(?m)^min-release-age=14$') { $script:LastFail = "expected min-release-age=14, got: $body"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '--tool restricts which tools get written' {
  $h = NewHome
  try {
    [void](InvokePmsec $h $null @('enable','--tool','npm,bun'))
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
    [void](InvokePmsec $h @{ APPDATA = $appdata; PMSEC_FAKE_SCOPES = "windows|$h|win32" } @('enable','--tool','uv'))
    return (AssertMatch 'uv key' '(?m)^exclude-newer = "3 days"$' ([System.IO.File]::ReadAllText((PathJoin $appdata 'uv' 'uv.toml'))))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'Windows mise path uses LOCALAPPDATA' {
  $h = NewHome
  try {
    $local = PathJoin $h 'AppData' 'Local'
    [void](InvokePmsec $h @{ LOCALAPPDATA = $local; PMSEC_FAKE_SCOPES = "windows|$h|win32" } @('enable','--tool','mise'))
    return (AssertMatch 'mise key' '(?m)^minimum_release_age = "3d"$' ([System.IO.File]::ReadAllText((PathJoin $local 'mise' 'config.toml'))))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'Windows scope ignores XDG_CONFIG_HOME for uv' {
  $h = NewHome
  try {
    $xdg = PathJoin $h 'xdg'
    $appdata = PathJoin $h 'AppData' 'Roaming'
    [void](InvokePmsec $h @{ XDG_CONFIG_HOME = $xdg; APPDATA = $appdata; PMSEC_FAKE_SCOPES = "windows|$h|win32" } @('enable','--tool','uv'))
    if (Test-Path -LiteralPath (PathJoin $xdg 'uv' 'uv.toml')) { $script:LastFail = 'uv leaked into XDG_CONFIG_HOME on win32 scope'; return $false }
    return (Test-Path -LiteralPath (PathJoin $appdata 'uv' 'uv.toml'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '--json emits parseable JSON for check' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('check','--json')
    $data = $null
    try { $data = $r.Out | ConvertFrom-Json } catch { $script:LastFail = "json parse failed: $_`n$($r.Out)"; return $false }
    if ($data.ok -ne $false) { $script:LastFail = "expected ok=false, got $($data.ok)"; return $false }
    if ($data.bundleDays -ne 3) { $script:LastFail = "expected bundleDays=3, got $($data.bundleDays)"; return $false }
    if ($data.rows.Count -ne 7) { $script:LastFail = "expected 7 rows, got $($data.rows.Count)"; return $false }
    $names = ($data.rows | ForEach-Object { $_.tool }) -join ','
    if ($names -ne 'npm,pnpm,yarn,bun,cargo,mise,uv') { $script:LastFail = "row order: $names"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'bun enable inserts key inside existing [install] section' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.bunfig.toml'), "[install]`nregistry = ""https://x/""`n")
    [void](InvokePmsec $h $null @('enable','--tool','bun'))
    return (AssertFileEq '.bunfig' "[install]`nminimumReleaseAge = 259200`nregistry = ""https://x/""`n" (Join-Path $h '.bunfig.toml'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'bun enable creates [install] section if missing' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.bunfig.toml'), "telemetry = false`n")
    [void](InvokePmsec $h $null @('enable','--tool','bun'))
    return (AssertFileEq '.bunfig' "telemetry = false`n`n[install]`nminimumReleaseAge = 259200`n" (Join-Path $h '.bunfig.toml'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'yarn check parses npmMinimalAgeGate days correctly' {
  $h = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h '.yarnrc.yml'), "npmMinimalAgeGate: ""14d""`nenableHardenedMode: true`n")
    $r = InvokePmsec $h $null @('check','--json','--tool','yarn')
    $data = $r.Out | ConvertFrom-Json
    if ($data.ok -ne $true) { $script:LastFail = "expected ok=true"; return $false }
    if ($data.rows[0].days -ne 14) { $script:LastFail = "expected 14 days, got $($data.rows[0].days)"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'pnpm check normalizes minutes to days' {
  $h = NewHome
  try {
    [void](New-Item -ItemType Directory -Force -Path (PathJoin $h '.config' 'pnpm'))
    [System.IO.File]::WriteAllText((PathJoin $h '.config' 'pnpm' 'rc'), "minimum-release-age=20160`n")
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
    [void](InvokePmsec $h $null @('enable','--tool','npm'))
    [void](InvokePmsec $h $null @('disable','--tool','npm'))
    [void](InvokePmsec $h $null @('enable','--tool','npm'))
    return (AssertFileEq '.npmrc.bak' "registry=https://original/`n" (Join-Path $h '.npmrc.bak'))
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'enable rejects positional arg with exit 2' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('enable','7')
    if ($r.Code -ne 2) { $script:LastFail = "expected exit 2, got $($r.Code)`nstderr: $($r.Err)"; return $false }
    return ($r.Err -match 'unexpected argument: 7')
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'hardening extras roundtrip (check / enable / disable)' {
  $h = NewHome
  try {
    $pnpmrc = PathJoin $h '.config' 'pnpm' 'rc'
    [void](New-Item -ItemType Directory -Force -Path (PathJoin $h '.config' 'pnpm'))
    [System.IO.File]::WriteAllText($pnpmrc, "minimum-release-age=20160`n")
    $r = InvokePmsec $h $null @('check','--json','--tool','pnpm')
    if ($r.Code -ne 1) { $script:LastFail = "extras-missing exit $($r.Code)"; return $false }
    $data = $r.Out | ConvertFrom-Json
    if ($data.ok -ne $false) { $script:LastFail = "extras-missing ok != false"; return $false }
    if ($data.rows[0].extras.Count -ne 3) { $script:LastFail = "expected 3 extras, got $($data.rows[0].extras.Count)"; return $false }
    [void](InvokePmsec $h $null @('enable','--tool','pnpm'))
    $body = [System.IO.File]::ReadAllText($pnpmrc)
    if ($body -notmatch '(?m)^trust-policy=no-downgrade$') { $script:LastFail = "trust-policy not written: $body"; return $false }
    if ($body -notmatch '(?m)^block-exotic-subdeps=true$') { $script:LastFail = "block-exotic-subdeps not written: $body"; return $false }
    if ($body -notmatch '(?m)^strict-dep-builds=true$') { $script:LastFail = "strict-dep-builds not written: $body"; return $false }
    $r2 = InvokePmsec $h $null @('check','--json','--tool','pnpm')
    if ($r2.Code -ne 0) { $script:LastFail = "after-enable exit $($r2.Code)"; return $false }
    if (($r2.Out | ConvertFrom-Json).ok -ne $true) { $script:LastFail = "after-enable ok != true"; return $false }
    [void](InvokePmsec $h $null @('disable','--tool','pnpm'))
    $after = [System.IO.File]::ReadAllText($pnpmrc)
    if ($after -match 'trust-policy') { $script:LastFail = "trust-policy not removed: $after"; return $false }
    if ($after -match 'block-exotic-subdeps') { $script:LastFail = "block-exotic-subdeps not removed: $after"; return $false }
    if ($after -match 'strict-dep-builds') { $script:LastFail = "strict-dep-builds not removed: $after"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '--days N overrides bundle cooldown for enable and check' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('enable','--days','7')
    if ($r.Code -ne 0) { $script:LastFail = "enable --days 7 exit $($r.Code)"; return $false }
    $npm = [System.IO.File]::ReadAllText((Join-Path $h '.npmrc'))
    if ($npm -notmatch '(?m)^min-release-age=7$') { $script:LastFail = "min-release-age not 7: $npm"; return $false }
    $pnpm = [System.IO.File]::ReadAllText((PathJoin $h '.config' 'pnpm' 'rc'))
    if ($pnpm -notmatch '(?m)^minimum-release-age=10080$') { $script:LastFail = "minimum-release-age not 10080: $pnpm"; return $false }
    $uv = [System.IO.File]::ReadAllText((Join-Path $h '.config/uv/uv.toml'))
    if ($uv -notmatch 'exclude-newer = "7 days"') { $script:LastFail = "uv not 7 days: $uv"; return $false }
    $bun = [System.IO.File]::ReadAllText((Join-Path $h '.bunfig.toml'))
    if ($bun -notmatch 'minimumReleaseAge = 604800') { $script:LastFail = "bun not 604800: $bun"; return $false }

    $r2 = InvokePmsec $h $null @('check','--json','--days','7')
    if ($r2.Code -ne 0) { $script:LastFail = "check --days 7 exit $($r2.Code)"; return $false }
    if (($r2.Out | ConvertFrom-Json).bundleDays -ne 7) { $script:LastFail = "bundleDays != 7"; return $false }

    $r3 = InvokePmsec $h $null @('check')
    if ($r3.Code -ne 0) { $script:LastFail = "default check exit $($r3.Code)"; return $false }

    $r4 = InvokePmsec $h $null @('check','--days','30')
    if ($r4.Code -ne 1) { $script:LastFail = "stricter check should fail, got $($r4.Code)"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T '--days rejects non-positive integers with exit 2' {
  $h = NewHome
  try {
    foreach ($bad in @('0','-1','abc','')) {
      $r = InvokePmsec $h $null @('enable','--days',$bad)
      if ($r.Code -ne 2) { $script:LastFail = "--days '$bad' expected exit 2 got $($r.Code)"; return $false }
    }
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

T 'pnpm 11 default-enforces missing block-exotic-subdeps' {
  $h = NewHome
  try {
    $pnpmrcDir = PathJoin $h 'AppData' 'Local' 'pnpm' 'config'
    [void](New-Item -ItemType Directory -Force -Path $pnpmrcDir)
    [System.IO.File]::WriteAllText((Join-Path $pnpmrcDir 'rc'), "minimum-release-age=4320`n")
    # Default-enforcement detection runs the local pnpm binary, so it only
    # fires on the Windows host scope.
    $r = InvokePmsec $h @{ PMSEC_FAKE_SCOPES = "windows|$h|win32"; PMSEC_PNPM_VERSION = '11.0.0' } @('check','--json','--tool','pnpm')
    if ($r.Code -ne 1) { $script:LastFail = "expected exit 1 (trust-policy still missing) got $($r.Code)`n$($r.Out)"; return $false }
    $data = $r.Out | ConvertFrom-Json
    $beSub = $data.rows[0].extras | Where-Object { $_.key -eq 'block-exotic-subdeps' }
    $trust = $data.rows[0].extras | Where-Object { $_.key -eq 'trust-policy' }
    if (-not $beSub.ok) { $script:LastFail = "block-exotic-subdeps ok must be true`n$($r.Out)"; return $false }
    if (-not $beSub.defaultEnforced) { $script:LastFail = "block-exotic-subdeps defaultEnforced must be true`n$($r.Out)"; return $false }
    if ($null -ne $beSub.configured) { $script:LastFail = "block-exotic-subdeps configured must be null`n$($r.Out)"; return $false }
    if ($trust.ok) { $script:LastFail = "trust-policy ok must be false`n$($r.Out)"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

T 'pnpm <11 still flags missing block-exotic-subdeps' {
  $h = NewHome
  try {
    $pnpmrcDir = PathJoin $h 'AppData' 'Local' 'pnpm' 'config'
    [void](New-Item -ItemType Directory -Force -Path $pnpmrcDir)
    [System.IO.File]::WriteAllText((Join-Path $pnpmrcDir 'rc'), "minimum-release-age=4320`n")
    $r = InvokePmsec $h @{ PMSEC_FAKE_SCOPES = "windows|$h|win32"; PMSEC_PNPM_VERSION = '10.26.0' } @('check','--json','--tool','pnpm')
    if ($r.Out -match '"defaultEnforced"') { $script:LastFail = "pnpm 10 must not emit defaultEnforced`n$($r.Out)"; return $false }
    $data = $r.Out | ConvertFrom-Json
    $beSub = $data.rows[0].extras | Where-Object { $_.key -eq 'block-exotic-subdeps' }
    if ($beSub.ok) { $script:LastFail = "pnpm 10 should report ok=false`n$($r.Out)"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

# ---------- WSL / multi-scope ----------

T 'multi-scope enable writes both host and WSL configs' {
  $h1 = NewHome
  $h2 = NewHome
  try {
    $appdata = PathJoin $h1 'AppData' 'Roaming'
    $local   = PathJoin $h1 'AppData' 'Local'
    $scopes  = "windows|$h1|win32;wsl-Ubuntu|$h2|linux"
    $r = InvokePmsec $h1 @{ PMSEC_FAKE_SCOPES = $scopes; APPDATA = $appdata; LOCALAPPDATA = $local } @('enable')
    if ($r.Code -ne 0) { $script:LastFail = "enable exit $($r.Code)`n$($r.Out)"; return $false }
    if ($r.Out -notmatch '\[windows\]')     { $script:LastFail = "missing [windows] header`n$($r.Out)"; return $false }
    if ($r.Out -notmatch '\[wsl-Ubuntu\]')  { $script:LastFail = "missing [wsl-Ubuntu] header`n$($r.Out)"; return $false }
    $ok = $true
    $ok = $ok -and (Test-Path -LiteralPath (Join-Path $h1 '.npmrc'))
    $ok = $ok -and (Test-Path -LiteralPath (PathJoin $appdata 'uv' 'uv.toml'))
    $ok = $ok -and (Test-Path -LiteralPath (PathJoin $local 'mise' 'config.toml'))
    $ok = $ok -and (Test-Path -LiteralPath (Join-Path $h2 '.npmrc'))
    $ok = $ok -and (Test-Path -LiteralPath (PathJoin $h2 '.config' 'uv' 'uv.toml'))
    $ok = $ok -and (Test-Path -LiteralPath (PathJoin $h2 '.config' 'mise' 'config.toml'))
    if (-not $ok) { $script:LastFail = "files missing across scopes`n$($r.Out)" }
    return $ok
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $h1
    Remove-Item -Recurse -Force -LiteralPath $h2
  }
}

T '--no-wsl skips linux scopes when fakes are present' {
  $h1 = NewHome
  $h2 = NewHome
  try {
    $appdata = PathJoin $h1 'AppData' 'Roaming'
    $scopes  = "windows|$h1|win32;wsl-Ubuntu|$h2|linux"
    $r = InvokePmsec $h1 @{ PMSEC_FAKE_SCOPES = $scopes; APPDATA = $appdata } @('enable','--no-wsl','--tool','npm')
    if ($r.Code -ne 0) { $script:LastFail = "exit $($r.Code)`n$($r.Out)"; return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $h1 '.npmrc'))) { $script:LastFail = 'host .npmrc not written'; return $false }
    if (Test-Path -LiteralPath (Join-Path $h2 '.npmrc'))         { $script:LastFail = 'wsl .npmrc unexpectedly written'; return $false }
    return $true
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $h1
    Remove-Item -Recurse -Force -LiteralPath $h2
  }
}

T 'PMSEC_NO_WSL=1 env var skips linux scopes' {
  $h1 = NewHome
  $h2 = NewHome
  try {
    $scopes  = "windows|$h1|win32;wsl-Ubuntu|$h2|linux"
    $r = InvokePmsec $h1 @{ PMSEC_FAKE_SCOPES = $scopes; PMSEC_NO_WSL = '1' } @('enable','--tool','npm')
    if ($r.Code -ne 0) { $script:LastFail = "exit $($r.Code)`n$($r.Out)"; return $false }
    if (-not (Test-Path -LiteralPath (Join-Path $h1 '.npmrc'))) { $script:LastFail = 'host .npmrc not written'; return $false }
    if (Test-Path -LiteralPath (Join-Path $h2 '.npmrc'))         { $script:LastFail = 'wsl .npmrc unexpectedly written'; return $false }
    return $true
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $h1
    Remove-Item -Recurse -Force -LiteralPath $h2
  }
}

T 'check JSON includes scope on every row across scopes' {
  $h1 = NewHome
  $h2 = NewHome
  try {
    $scopes = "windows|$h1|win32;wsl-Ubuntu|$h2|linux"
    $r = InvokePmsec $h1 @{ PMSEC_FAKE_SCOPES = $scopes } @('check','--json','--tool','npm')
    $data = $r.Out | ConvertFrom-Json
    if ($data.rows.Count -ne 2) { $script:LastFail = "expected 2 rows, got $($data.rows.Count)`n$($r.Out)"; return $false }
    $labels = ($data.rows | ForEach-Object { $_.scope }) -join ','
    if ($labels -ne 'windows,wsl-Ubuntu') { $script:LastFail = "scope order: $labels"; return $false }
    return $true
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $h1
    Remove-Item -Recurse -Force -LiteralPath $h2
  }
}

T 'multi-scope disable removes from both scopes' {
  $h1 = NewHome
  $h2 = NewHome
  try {
    [System.IO.File]::WriteAllText((Join-Path $h1 '.npmrc'), "min-release-age=3`naudit-level=high`nregistry=https://r/`n")
    [System.IO.File]::WriteAllText((Join-Path $h2 '.npmrc'), "min-release-age=3`naudit-level=high`nregistry=https://r2/`n")
    $scopes = "windows|$h1|win32;wsl-Ubuntu|$h2|linux"
    $r = InvokePmsec $h1 @{ PMSEC_FAKE_SCOPES = $scopes } @('disable','--tool','npm')
    if ($r.Code -ne 0) { $script:LastFail = "disable exit $($r.Code)`n$($r.Out)"; return $false }
    $ok = $true
    $ok = $ok -and (AssertFileEq 'h1 .npmrc' "registry=https://r/`n"  (Join-Path $h1 '.npmrc'))
    $ok = $ok -and (AssertFileEq 'h2 .npmrc' "registry=https://r2/`n" (Join-Path $h2 '.npmrc'))
    return $ok
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $h1
    Remove-Item -Recurse -Force -LiteralPath $h2
  }
}

T 'single-scope output has no scope header (back-compat)' {
  $h = NewHome
  try {
    $r = InvokePmsec $h $null @('enable','--tool','npm')
    if ($r.Out -match '(?m)^\[') { $script:LastFail = "unexpected scope header in single-scope output`n$($r.Out)"; return $false }
    return $true
  } finally { Remove-Item -Recurse -Force -LiteralPath $h }
}

# ---------- summary ----------

Write-Host ""
Write-Host "$($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) { exit 1 }
exit 0
