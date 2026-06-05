#!/usr/bin/env pwsh
# pmsec — zero-config install-time supply-chain hardening for
# npm / pnpm / yarn / bun / cargo / mise / uv / bundler. `enable` writes the cooldown
# plus every safe-by-default key the tool exposes (audit-level, trust-policy,
# hardened mode, attestation re-verification, ...). `--days N` overrides the
# default cooldown.
# PowerShell port. Windows-only: targets Windows PowerShell 5.1 and
# PowerShell 7+ on Windows. The script also reaches into every installed
# WSL distribution and applies the same hardening to the Linux-side
# config files (skip with `--no-wsl` or `PMSEC_NO_WSL=1`). Non-Windows
# pwsh hosts are not supported — use the bash, node, or python port.
# License: MIT.
# SPDX-License-Identifier: MIT
# NOTE: deliberately no param() block. Adding [CmdletBinding] or any
# [Parameter()] attribute makes this script an advanced function, which
# silently exposes the common parameters (-Verbose, -Debug, ...). PowerShell
# accepts unique prefixes, so `pmsec -V` would bind to `-Verbose` instead of
# reaching us as the `--version` short flag. Reading $args directly bypasses
# parameter binding entirely.
$Argv = $args

$ErrorActionPreference = 'Stop'
$script:PmsecVersion = '0.11.0'
# Default cooldown for the hardening bundle. Override per-invocation with
# `--days N`; the default tracks the safest value we'd recommend.
$script:BundleDays = 1
$script:Tools = @('npm','pnpm','yarn','bun','cargo','mise','uv','bundler')

# ---------- scope / platform / paths ----------

# A scope is @{ Label; Home; Platform } where Platform is 'win32' (the
# Windows host) or 'linux' (a WSL distribution accessed via UNC path).
# CmdEnable / CmdCheck / CmdDisable iterate scopes and assign $script:Scope
# so the path/IO helpers below resolve against the active scope.
$script:Scope = $null

function Get-PmsecPlatform {
  if ($script:Scope) { return $script:Scope.Platform }
  return 'win32'
}

# Pmsec ignores PowerShell's session-static $HOME so tests can override paths
# via $env:USERPROFILE / $env:PMSEC_HOME at runtime. Honored only outside an
# active scope (i.e., for raw helpers, not for per-scope file operations).
function Get-PmsecHome {
  if ($script:Scope) { return $script:Scope.Home }
  if ($env:PMSEC_HOME) { return $env:PMSEC_HOME }
  if ($env:USERPROFILE) { return $env:USERPROFILE }
  return $HOME
}

# Env-var overrides for tool config paths only apply when writing to the
# Windows host. For a WSL scope the relevant binary lives inside the distro
# and reads its own env, so we use the in-distro default location instead.
function Get-NpmrcPath {
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:NPM_CONFIG_USERCONFIG) { return $env:NPM_CONFIG_USERCONFIG }
  return (Join-Path (Get-PmsecHome) '.npmrc')
}
# pnpm reads its global rc separately from ~/.npmrc; writing pnpm-only keys
# here keeps npm from warning (and, in npm 12, erroring) about unknown user
# config. pnpm respects XDG_CONFIG_HOME on every OS.
function Get-PnpmRcPath {
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:PMSEC_PNPM_CONFIG_FILE) { return $env:PMSEC_PNPM_CONFIG_FILE }
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:XDG_CONFIG_HOME) { return (PathJoin $env:XDG_CONFIG_HOME 'pnpm' 'rc') }
  if ((Get-PmsecPlatform) -eq 'win32') {
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { PathJoin (Get-PmsecHome) 'AppData' 'Local' }
    return (PathJoin $base 'pnpm' 'config' 'rc')
  }
  # WSL scopes: use Linux default (XDG_CONFIG_HOME isn't propagated through \\wsl$).
  return (PathJoin (Get-PmsecHome) '.config' 'pnpm' 'rc')
}
# PathJoin keeps the first segment as a base path and joins each subsequent
# argument's components through Join-Path so the platform separator wins
# even when the input string itself contains a foreign separator.
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

function Get-UvPath {
  if ((Get-PmsecPlatform) -eq 'win32') {
    if ($env:UV_CONFIG_FILE) { return $env:UV_CONFIG_FILE }
    $base = if ($env:APPDATA) { $env:APPDATA } else { PathJoin (Get-PmsecHome) 'AppData' 'Roaming' }
    return (PathJoin $base 'uv' 'uv.toml')
  }
  return (PathJoin (Get-PmsecHome) '.config' 'uv' 'uv.toml')
}
function Get-BunPath {
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:BUN_CONFIG_FILE) { return $env:BUN_CONFIG_FILE }
  return (PathJoin (Get-PmsecHome) '.bunfig.toml')
}
function Get-YarnPath {
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:YARN_RC_FILENAME) { return $env:YARN_RC_FILENAME }
  return (PathJoin (Get-PmsecHome) '.yarnrc.yml')
}
function Get-CargoPath {
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:CARGO_HOME) { return (PathJoin $env:CARGO_HOME 'config.toml') }
  return (PathJoin (Get-PmsecHome) '.cargo' 'config.toml')
}
function Get-MisePath {
  if ((Get-PmsecPlatform) -eq 'win32') {
    if ($env:MISE_GLOBAL_CONFIG_FILE) { return $env:MISE_GLOBAL_CONFIG_FILE }
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { PathJoin (Get-PmsecHome) 'AppData' 'Local' }
    return (PathJoin $base 'mise' 'config.toml')
  }
  return (PathJoin (Get-PmsecHome) '.config' 'mise' 'config.toml')
}
# Bundler's global config. BUNDLE_USER_CONFIG points at the file directly;
# BUNDLE_USER_HOME points at the home dir (config = <home>/config). Both
# default to ~/.bundle, matching bundler's own resolution order.
function Get-BundlerPath {
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:BUNDLE_USER_CONFIG) { return $env:BUNDLE_USER_CONFIG }
  if ((Get-PmsecPlatform) -eq 'win32' -and $env:BUNDLE_USER_HOME) { return (PathJoin $env:BUNDLE_USER_HOME 'config') }
  return (PathJoin (Get-PmsecHome) '.bundle' 'config')
}

# ---------- scope discovery ----------

# Build the list of scopes pmsec writes to:
#   1. The Windows host (always present).
#   2. Each installed WSL distribution, accessed via the `\\wsl$\<distro>\...`
#      UNC path so we can write to the in-distro filesystem from Windows.
#
# Tests bypass real WSL enumeration via PMSEC_FAKE_SCOPES, formatted as
# `label|home|platform;label|home|platform`. When set it fully replaces the
# scope list — no host scope is appended automatically.
function Get-PmsecScopes([bool]$IncludeWsl) {
  if ($env:PMSEC_FAKE_SCOPES) {
    $list = New-Object System.Collections.Generic.List[hashtable]
    foreach ($spec in ($env:PMSEC_FAKE_SCOPES -split ';')) {
      if ([string]::IsNullOrWhiteSpace($spec)) { continue }
      $parts = $spec -split '\|', 3
      if ($parts.Count -lt 3) { continue }
      $entry = @{ Label = $parts[0]; Home = $parts[1]; Platform = $parts[2] }
      # Treat any non-win32 fake scope as a stand-in for a WSL distro so
      # --no-wsl / PMSEC_NO_WSL=1 has the same effect under test.
      if (-not $IncludeWsl -and $entry.Platform -ne 'win32') { continue }
      $list.Add($entry)
    }
    return ,$list.ToArray()
  }
  $hostHome = if ($env:PMSEC_HOME) { $env:PMSEC_HOME } elseif ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  $list = New-Object System.Collections.Generic.List[hashtable]
  $list.Add(@{ Label = 'windows'; Home = $hostHome; Platform = 'win32' })
  if ($IncludeWsl) {
    foreach ($d in (Get-WslDistros)) { $list.Add($d) }
  }
  return ,$list.ToArray()
}

# Enumerate WSL distros via wsl.exe. `wsl.exe -l -q` historically emits
# UTF-16LE; WSL 0.64+ honors $env:WSL_UTF8=1, so set that for the duration
# of the call. Skip docker-desktop helper distros — they have no useful
# user $HOME and writing to them would surprise the user.
function Get-WslDistros {
  if (-not (Get-Command wsl.exe -ErrorAction Ignore)) { return ,@() }
  $list = New-Object System.Collections.Generic.List[hashtable]
  $prevUtf8 = $env:WSL_UTF8
  $prevEnc = [Console]::OutputEncoding
  try {
    $env:WSL_UTF8 = '1'
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $raw = & wsl.exe -l -q 2>$null
  } catch {
    $raw = @()
  } finally {
    [Console]::OutputEncoding = $prevEnc
    if ($null -eq $prevUtf8) { Remove-Item Env:WSL_UTF8 -ErrorAction Ignore } else { $env:WSL_UTF8 = $prevUtf8 }
  }
  foreach ($line in $raw) {
    $name = ([string]$line).Trim() -replace "`0",''
    if ($name -eq '' -or $name -match '^docker-desktop') { continue }
    try {
      $home = (& wsl.exe -d $name -- sh -c 'printf %s "$HOME"' 2>$null) | Out-String
    } catch { continue }
    $home = ([string]$home).Trim()
    if ($home -eq '' -or -not $home.StartsWith('/')) { continue }
    $unc = '\\wsl$\' + $name + ($home -replace '/', '\')
    $list.Add(@{ Label = "wsl-$name"; Home = $unc; Platform = 'linux' })
  }
  return ,$list.ToArray()
}

# ---------- line buffer ----------
# Mirrors node/src/util/lines.mjs. LinesBuf is an ArrayList of strings; the
# rendered file is buf joined by \n with a trailing \n iff non-empty.

$script:LinesBuf = [System.Collections.ArrayList]::new()

function LinesLoad([string]$Path) {
  $script:LinesBuf = [System.Collections.ArrayList]::new()
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $raw = [System.IO.File]::ReadAllText($Path)
  if ($raw -eq '') { return }
  $normalized = $raw -replace "`r`n", "`n"
  if ($normalized.EndsWith("`n")) { $normalized = $normalized.Substring(0, $normalized.Length - 1) }
  foreach ($p in ($normalized -split "`n")) { [void]$script:LinesBuf.Add($p) }
}

function LinesDump {
  if ($script:LinesBuf.Count -eq 0) { return '' }
  return (($script:LinesBuf -join "`n") + "`n")
}

function LinesIsSection([string]$Line) {
  return ($Line -match '^\s*\[[^\]]+\]\s*$')
}

function LinesEntryKey([string]$Line, [string]$Sep) {
  if ($Sep -eq ':') {
    if ($Line -match '^\s*([A-Za-z0-9_.\-]+)\s*:') { return $Matches[1] }
  } else {
    if ($Line -match '^\s*([A-Za-z0-9_.\-]+)\s*=') { return $Matches[1] }
  }
  return $null
}

function LinesSectionRange([string]$Section) {
  $n = $script:LinesBuf.Count
  if ([string]::IsNullOrEmpty($Section)) {
    for ($i = 0; $i -lt $n; $i++) {
      if (LinesIsSection $script:LinesBuf[$i]) { return ,@(0, $i) }
    }
    return ,@(0, $n)
  }
  $header = "[$Section]"
  $start = -1
  for ($i = 0; $i -lt $n; $i++) {
    if ($script:LinesBuf[$i].Trim() -eq $header) { $start = $i + 1; break }
  }
  if ($start -lt 0) { return $null }
  $end = $n
  for ($i = $start; $i -lt $n; $i++) {
    if (LinesIsSection $script:LinesBuf[$i]) { $end = $i; break }
  }
  return ,@($start, $end)
}

function LinesIndexOfKey([string]$Key, [string]$Sep, [int]$Start, [int]$End) {
  for ($i = $Start; $i -lt $End; $i++) {
    $k = LinesEntryKey $script:LinesBuf[$i] $Sep
    if ($k -eq $Key) { return $i }
  }
  return -1
}

function LinesFirstSectionIdx {
  $n = $script:LinesBuf.Count
  for ($i = 0; $i -lt $n; $i++) {
    if (LinesIsSection $script:LinesBuf[$i]) { return $i }
  }
  return -1
}

function LinesReadKey([string]$Key, [string]$Sep = '=', [string]$Section = '') {
  $range = LinesSectionRange $Section
  if ($null -eq $range) { return $null }
  $idx = LinesIndexOfKey $Key $Sep $range[0] $range[1]
  if ($idx -lt 0) { return $null }
  $line = $script:LinesBuf[$idx]
  if ($Sep -eq ':') {
    if ($line -match '^\s*[A-Za-z0-9_.\-]+\s*:\s*(.*?)\s*$') { return $Matches[1] }
  } else {
    if ($line -match '^\s*[A-Za-z0-9_.\-]+\s*=\s*(.*?)\s*$') { return $Matches[1] }
  }
  return $null
}

function LinesSetKey([string]$Key, [string]$ValueLine, [string]$Sep = '=', [string]$Section = '') {
  $n = $script:LinesBuf.Count
  $range = LinesSectionRange $Section
  if ($null -eq $range) {
    if ($n -gt 0 -and $script:LinesBuf[$n-1] -ne '') { [void]$script:LinesBuf.Add('') }
    [void]$script:LinesBuf.Add("[$Section]")
    [void]$script:LinesBuf.Add($ValueLine)
    return
  }
  $idx = LinesIndexOfKey $Key $Sep $range[0] $range[1]
  if ($idx -ge 0) {
    $script:LinesBuf[$idx] = $ValueLine
    return
  }
  if (-not [string]::IsNullOrEmpty($Section)) {
    $script:LinesBuf.Insert($range[0], $ValueLine)
    return
  }
  $first = LinesFirstSectionIdx
  if ($first -lt 0) {
    [void]$script:LinesBuf.Add($ValueLine)
  } else {
    $script:LinesBuf.Insert($first, '')
    $script:LinesBuf.Insert($first, $ValueLine)
  }
}

function LinesRemoveKey([string]$Key, [string]$Sep = '=', [string]$Section = '') {
  $range = LinesSectionRange $Section
  if ($null -eq $range) { return $false }
  $idx = LinesIndexOfKey $Key $Sep $range[0] $range[1]
  if ($idx -lt 0) { return $false }
  $script:LinesBuf.RemoveAt($idx)
  if ($idx -lt $script:LinesBuf.Count -and $script:LinesBuf[$idx] -eq '') {
    $script:LinesBuf.RemoveAt($idx)
  }
  return $true
}

# ---------- atomic write ----------

function WriteAtomic([string]$Path, [string]$Content) {
  # Wrap each step (mkdir / refuse-symlink / backup-copy / body-write /
  # rename) so failures throw with a `WriteAtomic <step>` prefix. AV/EDR
  # tends to block the rename, while UNC ACLs flip the body-write — a
  # labeled exception lets the deployment operator skip straight to the right
  # check (Defender exclusion vs. \\wsl$ ACL vs. the Linux side's mode
  # bits) without re-running the script under tracing.
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    try {
      [void](New-Item -ItemType Directory -Force -Path $dir)
    } catch {
      throw "WriteAtomic mkdir failed for ${dir}: $($_.Exception.Message)"
    }
  }
  # Mirror the bash port: refuse to follow a symlink (or junction/reparse point
  # on Windows). The unattended-deployment threat model includes a malicious
  # user planting a link that pmsec, possibly running elevated under an
  # orchestrator (Intune, SCCM, GPO, …), would otherwise resolve.
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw "refusing to write through symlink/reparse point $Path"
    }
  }
  $bak = "$Path.bak"
  if ((Test-Path -LiteralPath $Path -PathType Leaf) -and -not (Test-Path -LiteralPath $bak)) {
    try {
      Copy-Item -LiteralPath $Path -Destination $bak
    } catch {
      throw "WriteAtomic backup-copy failed for ${bak}: $($_.Exception.Message)"
    }
  }
  $tmp = "$Path." + [guid]::NewGuid().ToString('N').Substring(0,8) + '.tmp'
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  try {
    try {
      [System.IO.File]::WriteAllText($tmp, $Content, $utf8NoBom)
    } catch {
      throw "WriteAtomic body-write failed for ${tmp}: $($_.Exception.Message)"
    }
    try {
      Move-Item -LiteralPath $tmp -Destination $Path -Force
    } catch {
      throw "WriteAtomic rename failed for ${Path}: $($_.Exception.Message)"
    }
  } catch {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction Ignore
    throw
  }
}

# ---------- version detection ----------

# `PMSEC_<TOOL>_VERSION` ("X.Y.Z" or "none") forces the result without spawning
# the real binary — used by tests to make pnpm 11 default-enforcement behavior
# deterministic regardless of what's installed locally.
function VersionOverrideEnvVar([string]$Bin) {
  switch ($Bin) {
    'npm'   { 'PMSEC_NPM_VERSION' }
    'pnpm'  { 'PMSEC_PNPM_VERSION' }
    'yarn'  { 'PMSEC_YARN_VERSION' }
    'bun'   { 'PMSEC_BUN_VERSION' }
    'cargo' { 'PMSEC_CARGO_VERSION' }
    'mise'  { 'PMSEC_MISE_VERSION' }
    'uv'    { 'PMSEC_UV_VERSION' }
    'bundler' { 'PMSEC_BUNDLER_VERSION' }
    default { '' }
  }
}

function VersionDetect([string]$Bin) {
  $var = VersionOverrideEnvVar $Bin
  if ($var) {
    $ovr = [Environment]::GetEnvironmentVariable($var)
    if ($ovr -eq 'none') { return $null }
    if ($ovr -and $ovr -match '(\d+)\.(\d+)\.(\d+)') {
      return @{ Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Patch = [int]$Matches[3]; Raw = $Matches[0] }
    }
  }
  if (-not (Get-Command $Bin -ErrorAction Ignore)) { return $null }
  try { $out = & $Bin --version 2>$null } catch { return $null }
  $text = ($out | Out-String)
  if ($text -match '(\d+)\.(\d+)\.(\d+)') {
    return @{ Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Patch = [int]$Matches[3]; Raw = $Matches[0] }
  }
  return $null
}

function VersionGte($V, [int[]]$Target) {
  if ($V.Major -ne $Target[0]) { return $V.Major -gt $Target[0] }
  if ($V.Minor -ne $Target[1]) { return $V.Minor -gt $Target[1] }
  return $V.Patch -ge $Target[2]
}

# ---------- per-tool metadata ----------

function ToolPath([string]$Tool) {
  switch ($Tool) {
    'npm'   { return Get-NpmrcPath }
    'pnpm'  { return Get-PnpmRcPath }
    'yarn'  { return Get-YarnPath }
    'bun'   { return Get-BunPath }
    'cargo' { return Get-CargoPath }
    'mise'  { return Get-MisePath }
    'uv'    { return Get-UvPath }
    'bundler' { return Get-BundlerPath }
  }
}
function ToolKey([string]$Tool) {
  switch ($Tool) {
    'npm'   { 'min-release-age' }
    'pnpm'  { 'minimum-release-age' }
    'yarn'  { 'npmMinimalAgeGate' }
    'bun'   { 'minimumReleaseAge' }
    'cargo' { 'minimum-release-age' }
    'mise'  { 'minimum_release_age' }
    'uv'    { 'exclude-newer' }
    'bundler' { 'BUNDLE_COOLDOWN' }
  }
}
function ToolSection([string]$Tool) {
  switch ($Tool) {
    'bun'   { 'install' }
    'cargo' { 'install' }
    'mise'  { 'settings' }
    default { '' }
  }
}
function ToolSep([string]$Tool) {
  if ($Tool -eq 'yarn' -or $Tool -eq 'bundler') { return ':' }
  return '='
}

# Per-tool hardening extras: emit array of hashtables describing fixed-value
# keys to write alongside the cooldown on `enable`, remove on `disable`, and
# validate on `check`. Each entry: Key, Expected, Line, Sep, Section.
function ToolExtras([string]$Tool) {
  switch ($Tool) {
    'npm' {
      return ,@(
        @{ Key = 'audit-level'; Expected = 'high'; Line = 'audit-level=high'; Sep = '='; Section = '' },
        @{ Key = 'allow-git'; Expected = 'root'; Line = 'allow-git=root'; Sep = '='; Section = '' },
        @{ Key = 'allow-remote'; Expected = 'root'; Line = 'allow-remote=root'; Sep = '='; Section = '' }
      )
    }
    'pnpm' {
      # DefaultSinceMajor: pnpm 11 made block-exotic-subdeps the default, so a
      # missing line is still in force under pnpm >= 11.
      return ,@(
        @{ Key = 'trust-policy'; Expected = 'no-downgrade'; Line = 'trust-policy=no-downgrade'; Sep = '='; Section = '' },
        @{ Key = 'block-exotic-subdeps'; Expected = 'true'; Line = 'block-exotic-subdeps=true'; Sep = '='; Section = ''; DefaultSinceMajor = 11 },
        @{ Key = 'strict-dep-builds'; Expected = 'true'; Line = 'strict-dep-builds=true'; Sep = '='; Section = '' }
      )
    }
    'yarn' {
      return ,@(
        @{ Key = 'enableHardenedMode'; Expected = 'true'; Line = 'enableHardenedMode: true'; Sep = ':'; Section = '' },
        @{ Key = 'enableScripts'; Expected = 'false'; Line = 'enableScripts: false'; Sep = ':'; Section = '' }
      )
    }
    'mise' {
      return ,@(
        @{ Key = 'paranoid'; Expected = 'true'; Line = 'paranoid = true'; Sep = '='; Section = 'settings' }
      )
    }
    default { return ,@() }
  }
}

# ---------- per-tool: read / write / unset ----------

function ParseDaysDw([string]$Value, [bool]$ExtraUnits = $false) {
  $v = $Value.Trim('"').Trim()
  if ($v -match '^(\d+)\s*([A-Za-z]+)$') {
    $n = [int]$Matches[1]
    $u = $Matches[2].ToLower()
    if (@('d','day','days') -contains $u) { return $n }
    if (@('w','week','weeks') -contains $u) { return $n * 7 }
    if ($ExtraUnits) {
      if (@('m','month','months') -contains $u) { return $n * 30 }
      if (@('y','year','years') -contains $u) { return $n * 365 }
    }
  }
  return $null
}

function ParseDaysMise([string]$Value) { ParseDaysDw $Value $true }

function ParseDaysUv([string]$Value) {
  if ($Value -match '^"\s*(\d+)\s*(day|days|d|week|weeks|w)\s*"$') {
    $n = [int]$Matches[1]
    $u = $Matches[2].ToLower()
    if (@('week','weeks','w') -contains $u) { return $n * 7 }
    return $n
  }
  return $null
}

function ToolRead([string]$Tool) {
  $key = ToolKey $Tool
  $sep = ToolSep $Tool
  $section = ToolSection $Tool
  $path = ToolPath $Tool
  LinesLoad $path
  $val = LinesReadKey $key $sep $section
  $days = $null
  if ($null -ne $val) {
    switch ($Tool) {
      'npm'   { if ($val -match '^\d+$') { $days = [int]$val } }
      'pnpm'  { if ($val -match '^\d+$') { $days = [int][math]::Floor([int]$val / 1440.0) } }
      'bun'   { if ($val -match '^\d+$') { $days = [int][math]::Floor([int]$val / 86400.0) } }
      'yarn'  { $days = ParseDaysDw $val }
      'cargo' { $days = ParseDaysDw $val }
      'mise'  { $days = ParseDaysMise $val }
      'uv'    { $days = ParseDaysUv $val }
      'bundler' { if ($val.Trim('"').Trim() -match '^\d+$') { $days = [int]$val.Trim('"').Trim() } }
    }
  }
  $extras = New-Object System.Collections.Generic.List[hashtable]
  $toolVersion = $null
  # Version detection runs the local binary; only meaningful for the host
  # scope. For a WSL scope we'd have to shell into the distro and that's
  # not worth the complexity for the default-enforcement heuristic.
  if ($Tool -eq 'pnpm' -and (Get-PmsecPlatform) -eq 'win32') { $toolVersion = VersionDetect 'pnpm' }
  foreach ($e in (ToolExtras $Tool)) {
    $cur = LinesReadKey $e.Key $e.Sep $e.Section
    $ok = ($null -ne $cur -and $cur -eq $e.Expected)
    $defaultEnforced = $false
    if (-not $ok -and $null -eq $cur -and $e.ContainsKey('DefaultSinceMajor') -and $null -ne $toolVersion) {
      if ($toolVersion.Major -ge [int]$e.DefaultSinceMajor) {
        $ok = $true; $defaultEnforced = $true
      }
    }
    $extras.Add(@{
      Key = $e.Key; Configured = $cur; Expected = $e.Expected
      Ok = $ok; DefaultEnforced = $defaultEnforced
    })
  }
  return @{ Path = $path; Configured = $val; Days = $days; Extras = $extras }
}

function ToolWriteValueLine([string]$Tool, [int]$Days) {
  $key = ToolKey $Tool
  switch ($Tool) {
    'npm'   { return "$key=$Days" }
    'pnpm'  { return ("$key=" + ($Days * 1440)) }
    'yarn'  { return ('{0}: "{1}d"' -f $key, $Days) }
    'bun'   { return ("$key = " + ($Days * 86400)) }
    'cargo' { return ('{0} = "{1}d"' -f $key, $Days) }
    'mise'  { return ('{0} = "{1}d"' -f $key, $Days) }
    'uv'    { return ('{0} = "{1} days"' -f $key, $Days) }
    'bundler' { return ('{0}: "{1}"' -f $key, $Days) }
  }
}

function ToolWrite([string]$Tool, [int]$Days) {
  $path = ToolPath $Tool
  $line = ToolWriteValueLine $Tool $Days
  LinesLoad $path
  LinesSetKey (ToolKey $Tool) $line (ToolSep $Tool) (ToolSection $Tool)
  foreach ($e in (ToolExtras $Tool)) {
    LinesSetKey $e.Key $e.Line $e.Sep $e.Section
  }
  WriteAtomic $path (LinesDump)
  return @{ Path = $path }
}

function ToolUnset([string]$Tool) {
  $path = ToolPath $Tool
  LinesLoad $path
  $removed = [bool](LinesRemoveKey (ToolKey $Tool) (ToolSep $Tool) (ToolSection $Tool))
  foreach ($e in (ToolExtras $Tool)) {
    if (LinesRemoveKey $e.Key $e.Sep $e.Section) { $removed = $true }
  }
  if ($removed) { WriteAtomic $path (LinesDump) }
  return @{ Path = $path; Removed = $removed }
}

function ToolPreflight([string]$Tool) {
  # Preflight runs the binary on the local PATH. That maps to a Windows
  # install only — for a WSL scope we'd have to detect inside the distro,
  # which we punt on. Users still get the warning surfaced for the host.
  if ((Get-PmsecPlatform) -ne 'win32') { return $null }
  $min = $null; $msg = $null
  switch ($Tool) {
    'npm'  { $min = @(11,10,0);   $msg = 'min-release-age is silently ignored. Upgrade npm to enforce the cooldown.' }
    'pnpm' { $min = @(10,6,0);    $msg = 'minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown.' }
    'yarn' { $min = @(4,10,0);    $msg = 'npmMinimalAgeGate is silently ignored. Upgrade yarn (v4.10+) to enforce the cooldown.' }
    'bun'  { $min = @(1,3,0);     $msg = 'minimumReleaseAge is silently ignored. Upgrade bun to enforce the cooldown.' }
    'mise' { $min = @(2026,4,22); $msg = 'setting was named install_before before 2026.4.22 and minimum_release_age is silently ignored on older mise. Upgrade mise (`mise self-update`) to enforce the cooldown.' }
    'uv'   { $min = @(0,9,17);    $msg = 'writing exclude-newer = "N days" will break this uv until you `uv self update` (file will fail to parse).' }
    'bundler' { $min = @(4,0,13); $msg = 'BUNDLE_COOLDOWN is silently ignored. Upgrade bundler (v4.0.13+) to enforce the cooldown.' }
    default { return $null }  # cargo: no min version gate (ships with rustup)
  }
  $v = VersionDetect $Tool
  if ($null -eq $v) { return $null }
  if (VersionGte $v $min) { return $null }
  return ('{0} {1} < {2}: {3}' -f $Tool, $v.Raw, ($min -join '.'), $msg)
}

# ---------- JSON helpers ----------

function JsonString([string]$S) {
  if ($null -eq $S) { return 'null' }
  $e = $S
  $e = $e -replace '\\', '\\'
  $e = $e -replace '"', '\"'
  $e = $e -replace "`n", '\n'
  $e = $e -replace "`r", '\r'
  $e = $e -replace "`t", '\t'
  return '"' + $e + '"'
}

function JsonStrOrNull($S) {
  if ($null -eq $S) { return 'null' }
  return (JsonString ([string]$S))
}
function JsonIntOrNull($N) {
  if ($null -eq $N) { return 'null' }
  return [string][int]$N
}
function JsonBool([bool]$B) { if ($B) { 'true' } else { 'false' } }

# ---------- output streams ----------

function StdOut([string]$S) { [Console]::Out.WriteLine($S) }
function StdOutNoNewline([string]$S) { [Console]::Out.Write($S) }
function StdErr([string]$S) { [Console]::Error.WriteLine($S) }

# Built dynamically because (a) Windows PowerShell 5.1 does not parse the
# `u{XXXX} unicode escape, and (b) PS 5.1 reads .ps1 source as Windows-1252
# by default — so a literal em-dash or ⚠ in source ends up mojibake.
$script:WarnGlyph = [string][char]0x26A0
$script:EmDash    = [string][char]0x2014

function Pad4([string]$S) {
  if ($S.Length -ge 4) { return $S }
  return $S.PadRight(4)
}

# ---------- CLI ----------

function PrintUsage {
@"
pmsec [options]

Zero-config install-time supply-chain hardening across npm, pnpm, yarn,
bun, cargo, mise, uv, bundler. Default action enables every safe-by-default
key each tool exposes (cooldown, audit-level, trust-policy, hardened mode,
attestation re-verification, ...). No knobs.

Options:
  --check               Verify the bundle is in place (exit 1 if anything missing)
  --disable             Remove the hardening bundle from selected tools
  --doctor              Diagnose effective paths/owner/uid (read-only; for unattended-deployment debugging)
  --tool TOOL[,TOOL]    Restrict to specific tools (npm,pnpm,yarn,bun,cargo,mise,uv,bundler)
  --days N              Override cooldown days (default 1)
  --force               Overwrite stricter existing cooldowns (otherwise enable is monotonic)
  --no-wsl              Skip the WSL pass; only configure the Windows host
  --json                Emit JSON output
  -V, --version         Show version
  -h, --help            Show this help

Examples:
  pmsec
  pmsec --days 7
  pmsec --days 1 --force
  pmsec --check
  pmsec --disable --tool npm

Environment:
  PMSEC_HOME              Home dir to operate on (overrides `$env:USERPROFILE`
                          / `$env:HOME`). Set this when running as SYSTEM via
                          an orchestrator (Intune, SCCM, GPO, scheduled task,
                          RMM, …) so configs land in the real user's profile.
  NPM_CONFIG_USERCONFIG   Override the npm/pnpm config file path.
  YARN_RC_FILENAME        Override the yarn config file path.
  BUN_CONFIG_FILE         Override the bun config file path.
  CARGO_HOME              Override the cargo dir; pmsec writes `$CARGO_HOME\config.toml`.
  MISE_GLOBAL_CONFIG_FILE Override the mise config file path.
  UV_CONFIG_FILE          Override the uv config file path.
  XDG_CONFIG_HOME         Override the XDG config root (affects mise, uv on linux/mac).
"@
}

function ParseDays($Raw) {
  $n = 0
  if (-not [int]::TryParse([string]$Raw, [ref]$n) -or $n -lt 1) {
    throw "--days must be a positive integer (got ""$Raw"")"
  }
  return $n
}

function ParseArgs($Argv) {
  $opts = @{
    Mode = 'enable'
    Json = $false; Only = $null; Days = $script:BundleDays; Force = $false
    NoWsl = ($env:PMSEC_NO_WSL -eq '1')
    Help = $false; Version = $false
  }
  $modeSet = $false
  $positional = New-Object System.Collections.Generic.List[string]
  $i = 0
  $n = if ($null -eq $Argv) { 0 } else { $Argv.Count }
  while ($i -lt $n) {
    $a = $Argv[$i]
    if ($a -eq '-h' -or $a -eq '--help') { $opts.Help = $true }
    elseif ($a -eq '-V' -or $a -eq '--version') { $opts.Version = $true }
    elseif ($a -eq '--json') { $opts.Json = $true }
    elseif ($a -eq '--force') { $opts.Force = $true }
    elseif ($a -eq '--no-wsl') { $opts.NoWsl = $true }
    elseif ($a -eq '--check') {
      if ($modeSet -and $opts.Mode -ne 'check') { throw '--check, --disable, and --doctor are mutually exclusive' }
      $opts.Mode = 'check'; $modeSet = $true
    }
    elseif ($a -eq '--disable') {
      if ($modeSet -and $opts.Mode -ne 'disable') { throw '--check, --disable, and --doctor are mutually exclusive' }
      $opts.Mode = 'disable'; $modeSet = $true
    }
    elseif ($a -eq '--doctor') {
      if ($modeSet -and $opts.Mode -ne 'doctor') { throw '--check, --disable, and --doctor are mutually exclusive' }
      $opts.Mode = 'doctor'; $modeSet = $true
    }
    elseif ($a -eq '--tool') { $i++; $opts.Only = $Argv[$i] -split ',' }
    elseif ($a -like '--tool=*') { $opts.Only = $a.Substring(7) -split ',' }
    elseif ($a -eq '--days') { $i++; $opts.Days = ParseDays $Argv[$i] }
    elseif ($a -like '--days=*') { $opts.Days = ParseDays $a.Substring(7) }
    elseif ($a.StartsWith('-')) { throw "unknown flag: $a" }
    else { $positional.Add($a) }
    $i++
  }
  if ($positional.Count -gt 0) { throw "unexpected argument: $($positional[0])" }
  return $opts
}

function SelectTools($Only) {
  if ($null -eq $Only -or $Only.Count -eq 0) { return $script:Tools }
  $found = New-Object System.Collections.Generic.List[string]
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($n in $Only) {
    $n = $n.Trim()
    if ($n -eq '') { continue }
    if ($script:Tools -contains $n) { $found.Add($n) } else { $missing.Add($n) }
  }
  if ($missing.Count -gt 0) {
    throw "unknown tool(s): $([string]::Join(',', $missing))"
  }
  return $found.ToArray()
}

function CmdCheck($Targets, [bool]$Json, [int]$Days, [array]$Scopes) {
  $rows = New-Object System.Collections.Generic.List[hashtable]
  $failing = 0
  $failingExtras = 0
  foreach ($scope in $Scopes) {
    $script:Scope = $scope
    foreach ($t in $Targets) {
      $r = ToolRead $t
      $warn = ToolPreflight $t
      if ($null -eq $r.Days -or $r.Days -lt $Days) { $failing++ }
      foreach ($e in $r.Extras) { if (-not $e.Ok) { $failingExtras++ } }
      $rows.Add(@{
        Scope = $scope.Label
        Tool = $t; Key = (ToolKey $t); Path = $r.Path
        Configured = $r.Configured; Days = $r.Days; Warn = $warn
        Extras = $r.Extras
      })
    }
  }
  $script:Scope = $null
  $multiScope = $Scopes.Count -gt 1
  if ($Json) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('{')
    [void]$sb.AppendLine("  ""bundleDays"": $Days,")
    [void]$sb.AppendLine('  "rows": [')
    for ($i = 0; $i -lt $rows.Count; $i++) {
      $r = $rows[$i]
      $cfg     = JsonStrOrNull $r.Configured
      $daysCol = JsonIntOrNull $r.Days
      $warn    = JsonStrOrNull $r.Warn
      $extrasJson = '['
      $first = $true
      foreach ($e in $r.Extras) {
        if (-not $first) { $extrasJson += ', ' }
        $first = $false
        $extraEntry = "{""key"": $(JsonString $e.Key), ""configured"": $(JsonStrOrNull $e.Configured), ""expected"": $(JsonString $e.Expected), ""ok"": $(JsonBool $e.Ok)"
        if ($e.DefaultEnforced) { $extraEntry += ', "defaultEnforced": true' }
        $extraEntry += '}'
        $extrasJson += $extraEntry
      }
      $extrasJson += ']'
      $scopePrefix = if ($multiScope) { """scope"": $(JsonString $r.Scope), " } else { '' }
      $entry = "    {$scopePrefix""tool"": $(JsonString $r.Tool), ""key"": $(JsonString $r.Key), ""path"": $(JsonString $r.Path), ""configured"": $cfg, ""days"": $daysCol, ""warn"": $warn, ""extras"": $extrasJson}"
      if ($i -lt $rows.Count - 1) { $entry += ',' }
      [void]$sb.AppendLine($entry)
    }
    [void]$sb.AppendLine('  ],')
    [void]$sb.AppendLine("  ""ok"": $(JsonBool ($failing -eq 0 -and $failingExtras -eq 0))")
    [void]$sb.Append('}')
    StdOut $sb.ToString()
  } else {
    $lastScope = ''
    foreach ($r in $rows) {
      if ($multiScope -and $r.Scope -ne $lastScope) {
        StdOut ('[' + $r.Scope + ']')
        $lastScope = $r.Scope
      }
      $status = if ($null -eq $r.Days) { 'MISSING' } elseif ($r.Days -lt $Days) { 'STALE  ' } else { 'OK     ' }
      $disp = if ($null -eq $r.Configured) { '(unset)' } else { $r.Configured }
      StdOut ('{0} {1} {2} = {3}  [{4}]' -f $status, (Pad4 $r.Tool), $r.Key, $disp, $r.Path)
      if ($r.Warn) { StdOut ('       ' + $script:WarnGlyph + ' ' + $r.Warn) }
      foreach ($e in $r.Extras) {
        $exStatus = if ($e.Ok) { 'OK     ' } elseif ($null -eq $e.Configured) { 'MISSING' } else { 'STALE  ' }
        $exDisp = if ($e.DefaultEnforced) { "(default $($script:EmDash) runtime enforces $($e.Expected))" }
                  elseif ($null -eq $e.Configured) { '(unset)' }
                  else { $e.Configured }
        StdOut ('{0} {1} {2} = {3}  [{4}]' -f $exStatus, (Pad4 $r.Tool), $e.Key, $exDisp, $r.Path)
      }
    }
  }
  if ($failing -gt 0) { StdErr ("pmsec: $failing tool(s) below $Days days " + $script:EmDash + " run ``pmsec``") }
  if ($failingExtras -gt 0) { StdErr ("pmsec: $failingExtras hardening setting(s) not at safe value " + $script:EmDash + " run ``pmsec``") }
  if ($failing -gt 0 -or $failingExtras -gt 0) { return 1 }
  return 0
}

function ExplainFsError([string]$Tool, $ErrorRec) {
  # Mirror node's explainFsError. UnauthorizedAccessException covers
  # EACCES/EPERM, and IOException with HResult 0x80070013 covers a
  # read-only volume. AV/EDR blocks surface as IOException too but we
  # keep those generic because the right remediation is "investigate
  # Defender/Sophos logs", not a CLI hint. Path comes from the
  # WriteAtomic step prefix we added; we extract it for the hint.
  #
  # Built with simple string concatenation only — Windows PowerShell 5.1
  # is finicky about embedded backticks and apostrophes inside expandable
  # strings, so we side-step interpolation entirely.
  $msg = $ErrorRec.Exception.Message
  $exType = $ErrorRec.Exception.GetType().FullName
  $extracted = ''
  # Match `for <path>: <reason>` where `<path>` may contain a Windows drive
  # letter (`C:\…`). `(.+?): [^:]` lets us greedily-but-non-globally consume
  # everything up to the FINAL `: ` separator the WriteAtomic prefix uses.
  if ($msg -match 'for (.+?): [^:]') { $extracted = $Matches[1] }
  if ($exType -eq 'System.UnauthorizedAccessException' -or $msg -match 'Access to the path .* is denied') {
    if ($extracted) {
      $hint = 'cannot write ' + $extracted + ' (UnauthorizedAccessException). Run Get-Acl on the path to inspect the owner; if owned by SYSTEM/Administrators, run pmsec elevated or fix the ACL'
    } else {
      $hint = 'access denied'
    }
    return $Tool + ': ' + $hint + '. [' + $msg + ']'
  }
  if ($ErrorRec.Exception -is [System.IO.IOException] -and $ErrorRec.Exception.HResult -eq -2147024864) {
    return $Tool + ': ' + $extracted + ' is read-only or shared (IOException). [' + $msg + ']'
  }
  return $Tool + ': ' + $msg
}

function CmdEnable($Targets, [bool]$Json, [int]$Days, [bool]$Force, [array]$Scopes) {
  $results = New-Object System.Collections.Generic.List[hashtable]
  $failures = New-Object System.Collections.Generic.List[string]
  $warnCount = 0
  foreach ($scope in $Scopes) {
    $script:Scope = $scope
    foreach ($t in $Targets) {
      $warn = ToolPreflight $t
      if ($warn) { $warnCount++ }
      $err = $null
      $path = ToolPath $t
      if ($Force) {
        $effective = $Days; $kept = $false
      } else {
        $current = ToolRead $t
        $curDays = if ($null -eq $current.Days) { 0 } else { [int]$current.Days }
        if ($curDays -ge $Days -and $curDays -gt 0) {
          $effective = $curDays; $kept = $true
        } else {
          $effective = $Days; $kept = $false
        }
      }
      try {
        $w = ToolWrite $t $effective
        $path = $w.Path
      } catch {
        $err = ExplainFsError $t $_
        $failures.Add($err)
      }
      $results.Add(@{
        Scope = $scope.Label
        Tool = $t; Path = $path; Days = $effective; Requested = $Days; Kept = $kept
        Forced = [bool]$Force
        Ok = ($null -eq $err); Warn = $warn; Error = $err
      })
    }
  }
  $script:Scope = $null
  $multiScope = $Scopes.Count -gt 1
  if ($Json) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('{')
    [void]$sb.AppendLine('  "enabled": true,')
    [void]$sb.AppendLine("  ""bundleDays"": $Days,")
    [void]$sb.AppendLine('  "results": [')
    for ($i = 0; $i -lt $results.Count; $i++) {
      $r = $results[$i]
      $scopePrefix = if ($multiScope) { """scope"": $(JsonString $r.Scope), " } else { '' }
      $entry = "    {$scopePrefix""tool"": $(JsonString $r.Tool), ""path"": $(JsonString $r.Path), ""days"": $($r.Days), ""requested"": $($r.Requested), ""kept"": $(JsonBool $r.Kept), ""forced"": $(JsonBool $r.Forced), ""ok"": $(JsonBool $r.Ok), ""warn"": $(JsonStrOrNull $r.Warn)"
      if ($r.Error) { $entry += ", ""error"": $(JsonString $r.Error)" }
      $entry += '}'
      if ($i -lt $results.Count - 1) { $entry += ',' }
      [void]$sb.AppendLine($entry)
    }
    [void]$sb.AppendLine('  ],')
    [void]$sb.Append('  "warnings": [')
    $first = $true
    foreach ($r in $results) {
      if ($r.Warn) {
        if (-not $first) { [void]$sb.Append(',') }
        $first = $false
        $warnScope = if ($multiScope) { """scope"": $(JsonString $r.Scope), " } else { '' }
        [void]$sb.Append("`n    {$warnScope""tool"": $(JsonString $r.Tool), ""warn"": $(JsonString $r.Warn)}")
      }
    }
    if (-not $first) { [void]$sb.Append("`n  ") }
    [void]$sb.AppendLine('],')
    [void]$sb.AppendLine("  ""ok"": $(JsonBool ($failures.Count -eq 0))")
    [void]$sb.Append('}')
    StdOut $sb.ToString()
  } else {
    $lastScope = ''
    foreach ($r in $results) {
      if ($multiScope -and $r.Scope -ne $lastScope) {
        StdOut ('[' + $r.Scope + ']')
        $lastScope = $r.Scope
      }
      if ($r.Ok) {
        if ($r.Kept) {
          StdOut (('keep    {0} [{1}]  (kept existing {2}d ' + [string][char]0x2265 + ' {3}d)') -f (Pad4 $r.Tool), $r.Path, $r.Days, $r.Requested)
        } else {
          StdOut ('enable  {0} [{1}]' -f (Pad4 $r.Tool), $r.Path)
        }
        if ($r.Warn) { StdOut ('     ' + $script:WarnGlyph + ' ' + $r.Warn) }
      } else {
        StdOut ('FAIL    {0} {1}' -f (Pad4 $r.Tool), $r.Error)
      }
    }
  }
  foreach ($f in $failures) { StdErr "pmsec: $f" }
  if ($warnCount -gt 0) {
    StdErr ('pmsec: ' + $warnCount + ' tool(s) configured but runtime may silently ignore the cooldown ' + $script:EmDash + ' see ' + $script:WarnGlyph + ' above')
  }
  if ($failures.Count -gt 0) { return 1 }
  return 0
}

function CmdDisable($Targets, [bool]$Json, [array]$Scopes) {
  $results = New-Object System.Collections.Generic.List[hashtable]
  $failures = New-Object System.Collections.Generic.List[string]
  foreach ($scope in $Scopes) {
    $script:Scope = $scope
    foreach ($t in $Targets) {
      $err = $null
      $path = ToolPath $t
      $removed = $false
      try {
        $u = ToolUnset $t
        $path = $u.Path
        $removed = [bool]$u.Removed
      } catch {
        $err = ExplainFsError $t $_
        $failures.Add($err)
      }
      $results.Add(@{
        Scope = $scope.Label
        Tool = $t; Path = $path; Removed = $removed
        Ok = ($null -eq $err); Error = $err
      })
    }
  }
  $script:Scope = $null
  $multiScope = $Scopes.Count -gt 1
  if ($Json) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('{')
    [void]$sb.AppendLine('  "results": [')
    for ($i = 0; $i -lt $results.Count; $i++) {
      $r = $results[$i]
      $entry = "    {""scope"": $(JsonString $r.Scope), ""tool"": $(JsonString $r.Tool), ""path"": $(JsonString $r.Path), ""removed"": $(JsonBool $r.Removed), ""ok"": $(JsonBool $r.Ok)"
      if ($r.Error) { $entry += ", ""error"": $(JsonString $r.Error)" }
      $entry += '}'
      if ($i -lt $results.Count - 1) { $entry += ',' }
      [void]$sb.AppendLine($entry)
    }
    [void]$sb.AppendLine('  ],')
    [void]$sb.AppendLine("  ""ok"": $(JsonBool ($failures.Count -eq 0))")
    [void]$sb.Append('}')
    StdOut $sb.ToString()
  } else {
    $lastScope = ''
    foreach ($r in $results) {
      if ($multiScope -and $r.Scope -ne $lastScope) {
        StdOut ('[' + $r.Scope + ']')
        $lastScope = $r.Scope
      }
      if (-not $r.Ok) {
        StdOut ('FAIL    {0} {1}' -f (Pad4 $r.Tool), $r.Error)
      } elseif ($r.Removed) {
        StdOut ('disable {0} [{1}]' -f (Pad4 $r.Tool), $r.Path)
      } else {
        StdOut ('skip    {0} [{1}]' -f (Pad4 $r.Tool), $r.Path)
      }
    }
  }
  foreach ($f in $failures) { StdErr "pmsec: $f" }
  if ($failures.Count -gt 0) { return 1 }
  return 0
}

# `pmsec --doctor` runs read-only and reports the same path resolution that
# enable/check/disable would do, plus identity (uid/euid where applicable) and
# parent-dir writability — the smallest set of facts an operator needs to
# diagnose "pmsec ran but wrote to nowhere" or "wrote a file no one can read"
# (e.g. AV/EDR blocking the rename, or a UNC ACL flip on a WSL distro). Never
# mutates the filesystem.
function ProbePath([string]$Path) {
  $parent = Split-Path -Parent $Path
  $exists = Test-Path -LiteralPath $Path -PathType Leaf
  $writable = $false
  $owner = $null
  if ($exists) {
    try {
      $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
      $fs.Dispose()
      $writable = $true
    } catch { $writable = $false }
    try { $owner = (Get-Acl -LiteralPath $Path).Owner } catch { $owner = $null }
  }
  $parentExists = $false
  if ($parent) { $parentExists = Test-Path -LiteralPath $parent -PathType Container }
  # Walk up to the deepest existing ancestor — pmsec runs New-Item -Force, so
  # what matters is whether that ancestor is writable, not the literal parent.
  $probe = $parent
  $ancestor = $null
  while ($probe) {
    if (Test-Path -LiteralPath $probe -PathType Container) { $ancestor = $probe; break }
    $next = Split-Path -Parent $probe
    if (-not $next -or $next -eq $probe) { break }
    $probe = $next
  }
  $parentWritable = $false
  if ($ancestor) {
    # Best-effort: try creating a sentinel file under the ancestor. This costs
    # one syscall and reflects what New-Item would actually do, including ACL
    # nuances on UNC paths to WSL.
    $sentinel = Join-Path $ancestor (".pmsec-doctor." + [guid]::NewGuid().ToString('N').Substring(0,8) + '.tmp')
    try {
      [System.IO.File]::WriteAllBytes($sentinel, [byte[]]@())
      Remove-Item -LiteralPath $sentinel -Force -ErrorAction Ignore
      $parentWritable = $true
    } catch { $parentWritable = $false }
  }
  return @{
    Path = $Path; Parent = $parent
    Exists = $exists; Writable = $writable
    ParentExists = $parentExists; ParentWritable = $parentWritable
    Owner = $owner
  }
}

function CmdDoctor($Targets, [bool]$Json, [array]$Scopes) {
  $rows = New-Object System.Collections.Generic.List[hashtable]
  foreach ($scope in $Scopes) {
    $script:Scope = $scope
    foreach ($t in $Targets) {
      $p = ToolPath $t
      $probe = ProbePath $p
      $rows.Add(@{
        Scope = $scope.Label
        Tool = $t; Key = (ToolKey $t)
        Path = $probe.Path; Parent = $probe.Parent
        Exists = $probe.Exists; Writable = $probe.Writable
        ParentExists = $probe.ParentExists; ParentWritable = $probe.ParentWritable
        Owner = $probe.Owner
      })
    }
  }
  $script:Scope = $null
  $okFlag = $true
  foreach ($r in $rows) { if (-not $r.ParentWritable) { $okFlag = $false } }
  $multiScope = $Scopes.Count -gt 1
  $username = $null
  try { $username = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name } catch {}
  $isAdmin = $false
  try {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($id)
    $isAdmin = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {}
  $pmsecHome = $env:PMSEC_HOME
  $pmsecHomeSrc = if ($pmsecHome) { 'PMSEC_HOME' } elseif ($env:USERPROFILE) { 'USERPROFILE' } else { 'HOME' }
  $homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  if ($Json) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('{')
    [void]$sb.AppendLine('  "doctor": true,')
    [void]$sb.AppendLine("  ""version"": $(JsonString $script:PmsecVersion),")
    [void]$sb.AppendLine('  "platform": "win32",')
    [void]$sb.AppendLine("  ""username"": $(JsonStrOrNull $username),")
    [void]$sb.AppendLine("  ""isAdministrator"": $(JsonBool $isAdmin),")
    [void]$sb.AppendLine("  ""home"": $(JsonString $homePath),")
    [void]$sb.AppendLine("  ""pmsecHome"": $(JsonStrOrNull $pmsecHome),")
    [void]$sb.AppendLine("  ""pmsecHomeSource"": $(JsonString $pmsecHomeSrc),")
    [void]$sb.AppendLine('  "tools": [')
    for ($i = 0; $i -lt $rows.Count; $i++) {
      $r = $rows[$i]
      $entry = "    {""scope"": $(JsonString $r.Scope), ""tool"": $(JsonString $r.Tool), ""key"": $(JsonString $r.Key), ""path"": $(JsonString $r.Path), ""parent"": $(JsonString $r.Parent), ""exists"": $(JsonBool $r.Exists), ""writable"": $(JsonBool $r.Writable), ""parentExists"": $(JsonBool $r.ParentExists), ""parentWritable"": $(JsonBool $r.ParentWritable), ""owner"": $(JsonStrOrNull $r.Owner)}"
      if ($i -lt $rows.Count - 1) { $entry += ',' }
      [void]$sb.AppendLine($entry)
    }
    [void]$sb.AppendLine('  ],')
    [void]$sb.AppendLine("  ""ok"": $(JsonBool $okFlag)")
    [void]$sb.Append('}')
    StdOut $sb.ToString()
  } else {
    StdOut ("pmsec $($script:PmsecVersion)  doctor")
    StdOut '  platform   : win32'
    if ($username) { StdOut "  user       : $username (admin=$isAdmin)" } else { StdOut "  user       : (unknown) (admin=$isAdmin)" }
    StdOut "  HOME       : $homePath"
    if ($pmsecHome) { StdOut "  PMSEC_HOME : $pmsecHome" } else { StdOut "  PMSEC_HOME : (unset $($script:EmDash) using $pmsecHomeSrc)" }
    StdOut ''
    $lastScope = ''
    foreach ($r in $rows) {
      if ($multiScope -and $r.Scope -ne $lastScope) {
        StdOut ('[' + $r.Scope + ']')
        $lastScope = $r.Scope
      }
      $flag = if ($r.ParentWritable) { 'ok    ' } else { 'BLOCK ' }
      $ownerSuffix = if ($r.Exists -and $r.Owner) { " (owner=$($r.Owner))" } else { '' }
      StdOut ('{0} {1} {2}{3}' -f $flag, (Pad4 $r.Tool), $r.Path, $ownerSuffix)
      if (-not $r.ParentWritable) {
        StdOut ('         no writable ancestor for ' + $r.Parent)
      }
    }
    if (-not $okFlag) {
      StdOut ''
      StdErr "pmsec doctor: at least one parent directory is not writable for $username."
    }
  }
  if ($okFlag) { return 0 } else { return 1 }
}

# ---------- entry ----------

try {
  $opts = ParseArgs $Argv
} catch {
  StdErr "pmsec: $_"
  exit 2
}

if ($opts.Version) { Write-Output "pmsec $($script:PmsecVersion)"; exit 0 }
if ($opts.Help) { PrintUsage; exit 0 }

try {
  $targets = SelectTools $opts.Only
} catch {
  StdErr "pmsec: $_"
  exit 2
}

$scopes = Get-PmsecScopes (-not $opts.NoWsl)
if ($scopes.Count -eq 0) {
  StdErr 'pmsec: no scopes resolved (PMSEC_FAKE_SCOPES set but empty?)'
  exit 2
}

try {
  switch ($opts.Mode) {
    'check'   { exit (CmdCheck $targets $opts.Json $opts.Days $scopes) }
    'disable' { exit (CmdDisable $targets $opts.Json $scopes) }
    'doctor'  { exit (CmdDoctor $targets $opts.Json $scopes) }
    default   { exit (CmdEnable $targets $opts.Json $opts.Days $opts.Force $scopes) }
  }
} catch {
  StdErr "pmsec: $_"
  exit 1
}
