#!/usr/bin/env pwsh
# pmsec — zero-config install-time supply-chain hardening for
# npm / pnpm / yarn / bun / cargo / mise / uv. `enable` writes the cooldown
# plus every safe-by-default key the tool exposes (audit-level, trust-policy,
# hardened mode, attestation re-verification, ...). `--days N` overrides the
# default cooldown.
# PowerShell port. Targets Windows PowerShell 5.1 and PowerShell 7+.
# License: MIT.
# NOTE: deliberately no param() block. Adding [CmdletBinding] or any
# [Parameter()] attribute makes this script an advanced function, which
# silently exposes the common parameters (-Verbose, -Debug, ...). PowerShell
# accepts unique prefixes, so `pmsec -V` would bind to `-Verbose` instead of
# reaching us as the `--version` short flag. Reading $args directly bypasses
# parameter binding entirely.
$Argv = $args

$ErrorActionPreference = 'Stop'
$script:PmsecVersion = '0.6.0'
# Default cooldown for the hardening bundle. Override per-invocation with
# `--days N`; the default tracks the safest value we'd recommend.
$script:BundleDays = 3
$script:Tools = @('npm','pnpm','yarn','bun','cargo','mise','uv')

# ---------- platform / paths ----------

function Get-PmsecPlatform {
  if ($env:PMSEC_PLATFORM) { return $env:PMSEC_PLATFORM }
  if ($env:OS -eq 'Windows_NT') { return 'win32' }
  if ($PSVersionTable.PSVersion.Major -ge 6 -and (Get-Variable -Name IsMacOS -ErrorAction Ignore) -and $IsMacOS) { return 'darwin' }
  return 'linux'
}

# Pmsec ignores PowerShell's session-static $HOME so tests can override paths
# via $env:HOME / $env:USERPROFILE / $env:PMSEC_HOME at runtime.
function Get-PmsecHome {
  if ($env:PMSEC_HOME) { return $env:PMSEC_HOME }
  $platform = Get-PmsecPlatform
  if ($platform -eq 'win32') {
    if ($env:USERPROFILE) { return $env:USERPROFILE }
  } else {
    if ($env:HOME) { return $env:HOME }
  }
  return $HOME
}

function Get-NpmrcPath {
  if ($env:NPM_CONFIG_USERCONFIG) { return $env:NPM_CONFIG_USERCONFIG }
  return (Join-Path (Get-PmsecHome) '.npmrc')
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
  if ($env:UV_CONFIG_FILE) { return $env:UV_CONFIG_FILE }
  if ((Get-PmsecPlatform) -eq 'win32') {
    $base = if ($env:APPDATA) { $env:APPDATA } else { PathJoin (Get-PmsecHome) 'AppData' 'Roaming' }
    return (PathJoin $base 'uv' 'uv.toml')
  }
  $base = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { PathJoin (Get-PmsecHome) '.config' }
  return (PathJoin $base 'uv' 'uv.toml')
}
function Get-BunPath {
  if ($env:BUN_CONFIG_FILE) { return $env:BUN_CONFIG_FILE }
  return (PathJoin (Get-PmsecHome) '.bunfig.toml')
}
function Get-YarnPath {
  if ($env:YARN_RC_FILENAME) { return $env:YARN_RC_FILENAME }
  return (PathJoin (Get-PmsecHome) '.yarnrc.yml')
}
function Get-CargoPath {
  if ($env:CARGO_HOME) { return (PathJoin $env:CARGO_HOME 'config.toml') }
  return (PathJoin (Get-PmsecHome) '.cargo' 'config.toml')
}
function Get-MisePath {
  if ($env:MISE_GLOBAL_CONFIG_FILE) { return $env:MISE_GLOBAL_CONFIG_FILE }
  if ((Get-PmsecPlatform) -eq 'win32') {
    $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { PathJoin (Get-PmsecHome) 'AppData' 'Local' }
    return (PathJoin $base 'mise' 'config.toml')
  }
  $base = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { PathJoin (Get-PmsecHome) '.config' }
  return (PathJoin $base 'mise' 'config.toml')
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
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    [void](New-Item -ItemType Directory -Force -Path $dir)
  }
  $bak = "$Path.bak"
  if ((Test-Path -LiteralPath $Path -PathType Leaf) -and -not (Test-Path -LiteralPath $bak)) {
    Copy-Item -LiteralPath $Path -Destination $bak
  }
  $tmp = "$Path." + [guid]::NewGuid().ToString('N').Substring(0,8) + '.tmp'
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tmp, $Content, $utf8NoBom)
  Move-Item -LiteralPath $tmp -Destination $Path -Force
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
    'pnpm'  { return Get-NpmrcPath }
    'yarn'  { return Get-YarnPath }
    'bun'   { return Get-BunPath }
    'cargo' { return Get-CargoPath }
    'mise'  { return Get-MisePath }
    'uv'    { return Get-UvPath }
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
  if ($Tool -eq 'yarn') { return ':' }
  return '='
}

# Per-tool hardening extras: emit array of hashtables describing fixed-value
# keys to write alongside the cooldown on `enable`, remove on `disable`, and
# validate on `check`. Each entry: Key, Expected, Line, Sep, Section.
function ToolExtras([string]$Tool) {
  switch ($Tool) {
    'npm' {
      return ,@(
        @{ Key = 'audit-level'; Expected = 'high'; Line = 'audit-level=high'; Sep = '='; Section = '' }
      )
    }
    'pnpm' {
      # DefaultSinceMajor: pnpm 11 made block-exotic-subdeps the default, so a
      # missing line is still in force under pnpm >= 11.
      return ,@(
        @{ Key = 'trust-policy'; Expected = 'no-downgrade'; Line = 'trust-policy=no-downgrade'; Sep = '='; Section = '' },
        @{ Key = 'block-exotic-subdeps'; Expected = 'true'; Line = 'block-exotic-subdeps=true'; Sep = '='; Section = ''; DefaultSinceMajor = 11 }
      )
    }
    'yarn' {
      return ,@(
        @{ Key = 'enableHardenedMode'; Expected = 'true'; Line = 'enableHardenedMode: true'; Sep = ':'; Section = '' }
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

function ParseDaysDw([string]$Value) {
  $v = $Value.Trim('"').Trim()
  if ($v -match '^(\d+)\s*([A-Za-z]+)$') {
    $n = [int]$Matches[1]
    $u = $Matches[2].ToLower()
    if (@('d','day','days') -contains $u) { return $n }
    if (@('w','week','weeks') -contains $u) { return $n * 7 }
  }
  return $null
}

function ParseDaysMise([string]$Value) {
  $v = $Value.Trim('"').Trim()
  if ($v -match '^(\d+)\s*([A-Za-z]+)$') {
    $n = [int]$Matches[1]
    $u = $Matches[2].ToLower()
    if (@('d','day','days') -contains $u) { return $n }
    if (@('w','week','weeks') -contains $u) { return $n * 7 }
    if (@('m','month','months') -contains $u) { return $n * 30 }
    if (@('y','year','years') -contains $u) { return $n * 365 }
  }
  return $null
}

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
    }
  }
  $extras = New-Object System.Collections.Generic.List[hashtable]
  $toolVersion = $null
  if ($Tool -eq 'pnpm') { $toolVersion = VersionDetect 'pnpm' }
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
  if ($Tool -eq 'cargo') { return $null }
  $v = VersionDetect $Tool
  if ($null -eq $v) { return $null }
  switch ($Tool) {
    'npm' {
      if (-not (VersionGte $v @(11,10,0))) {
        return ('npm {0} < 11.10.0: min-release-age is silently ignored. Upgrade npm to enforce the cooldown.' -f $v.Raw)
      }
    }
    'pnpm' {
      if (-not (VersionGte $v @(10,6,0))) {
        return ('pnpm {0} < 10.6.0: minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown.' -f $v.Raw)
      }
    }
    'yarn' {
      if (-not (VersionGte $v @(4,10,0))) {
        return ('yarn {0} < 4.10.0: npmMinimalAgeGate is silently ignored. Upgrade yarn (v4.10+) to enforce the cooldown.' -f $v.Raw)
      }
    }
    'bun' {
      if (-not (VersionGte $v @(1,3,0))) {
        return ('bun {0} < 1.3.0: minimumReleaseAge is silently ignored. Upgrade bun to enforce the cooldown.' -f $v.Raw)
      }
    }
    'mise' {
      if (-not (VersionGte $v @(2026,4,22))) {
        return ('mise {0} < 2026.4.22: setting was named install_before before 2026.4.22 and minimum_release_age is silently ignored on older mise. Upgrade mise (`mise self-update`) to enforce the cooldown.' -f $v.Raw)
      }
    }
    'uv' {
      if (-not (VersionGte $v @(0,9,17))) {
        return ('uv {0} < 0.9.17: writing exclude-newer = "N days" will break this uv until you `uv self update` (file will fail to parse).' -f $v.Raw)
      }
    }
  }
  return $null
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
pmsec <command> [options]

Zero-config install-time supply-chain hardening across npm, pnpm, yarn,
bun, cargo, mise, uv. ``enable`` flips on every safe-by-default key each
tool exposes (cooldown, audit-level, trust-policy, hardened mode,
attestation re-verification, ...). No knobs.

Commands:
  enable                Apply the hardening bundle to all selected tools
  disable               Remove the hardening bundle from selected tools
  check                 Verify the bundle is in place (exit 1 if anything missing)

Options:
  --tool TOOL[,TOOL]    Restrict to specific tools (npm,pnpm,yarn,bun,cargo,mise,uv)
  --days N              Override cooldown days (default 3)
  --force               Overwrite stricter existing cooldowns (otherwise enable is monotonic)
  --json                Emit JSON output
  -V, --version         Show version
  -h, --help            Show this help

Examples:
  pmsec enable
  pmsec enable --days 7
  pmsec enable --days 1 --force
  pmsec check
  pmsec disable --tool npm
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
    Command = ''
    Json = $false; Only = $null; Days = $script:BundleDays; Force = $false; Help = $false; Version = $false
  }
  $positional = New-Object System.Collections.Generic.List[string]
  $i = 0
  $n = if ($null -eq $Argv) { 0 } else { $Argv.Count }
  while ($i -lt $n) {
    $a = $Argv[$i]
    if ($a -eq '-h' -or $a -eq '--help') { $opts.Help = $true }
    elseif ($a -eq '-V' -or $a -eq '--version') { $opts.Version = $true }
    elseif ($a -eq '--json') { $opts.Json = $true }
    elseif ($a -eq '--force') { $opts.Force = $true }
    elseif ($a -eq '--tool') { $i++; $opts.Only = $Argv[$i] -split ',' }
    elseif ($a -like '--tool=*') { $opts.Only = $a.Substring(7) -split ',' }
    elseif ($a -eq '--days') { $i++; $opts.Days = ParseDays $Argv[$i] }
    elseif ($a -like '--days=*') { $opts.Days = ParseDays $a.Substring(7) }
    elseif ($a.StartsWith('-')) { throw "unknown flag: $a" }
    else { $positional.Add($a) }
    $i++
  }
  if ($positional.Count -gt 0) { $opts.Command = $positional[0] }
  if ($positional.Count -gt 1) { throw "unexpected argument: $($positional[1])" }
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

function CmdCheck($Targets, [bool]$Json, [int]$Days) {
  $rows = New-Object System.Collections.Generic.List[hashtable]
  $failing = 0
  $failingExtras = 0
  foreach ($t in $Targets) {
    $r = ToolRead $t
    $warn = ToolPreflight $t
    if ($null -eq $r.Days -or $r.Days -lt $Days) { $failing++ }
    foreach ($e in $r.Extras) { if (-not $e.Ok) { $failingExtras++ } }
    $rows.Add(@{
      Tool = $t; Key = (ToolKey $t); Path = $r.Path
      Configured = $r.Configured; Days = $r.Days; Warn = $warn
      Extras = $r.Extras
    })
  }
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
      $entry = "    {""tool"": $(JsonString $r.Tool), ""key"": $(JsonString $r.Key), ""path"": $(JsonString $r.Path), ""configured"": $cfg, ""days"": $daysCol, ""warn"": $warn, ""extras"": $extrasJson}"
      if ($i -lt $rows.Count - 1) { $entry += ',' }
      [void]$sb.AppendLine($entry)
    }
    [void]$sb.AppendLine('  ],')
    [void]$sb.AppendLine("  ""ok"": $(JsonBool ($failing -eq 0 -and $failingExtras -eq 0))")
    [void]$sb.Append('}')
    StdOut $sb.ToString()
  } else {
    foreach ($r in $rows) {
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
  if ($failing -gt 0) { StdErr ("pmsec: $failing tool(s) below $Days days " + $script:EmDash + " run ``pmsec enable``") }
  if ($failingExtras -gt 0) { StdErr ("pmsec: $failingExtras hardening setting(s) not at safe value " + $script:EmDash + " run ``pmsec enable``") }
  if ($failing -gt 0 -or $failingExtras -gt 0) { return 1 }
  return 0
}

function ExplainFsError([string]$Tool, $Err) {
  return ("$Tool" + ': ' + $Err.ToString())
}

function CmdEnable($Targets, [bool]$Json, [int]$Days, [bool]$Force) {
  $results = New-Object System.Collections.Generic.List[hashtable]
  $failures = New-Object System.Collections.Generic.List[string]
  $warnCount = 0
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
      Tool = $t; Path = $path; Days = $effective; Requested = $Days; Kept = $kept
      Ok = ($null -eq $err); Warn = $warn; Error = $err
    })
  }
  if ($Json) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('{')
    [void]$sb.AppendLine('  "enabled": true,')
    [void]$sb.AppendLine("  ""bundleDays"": $Days,")
    [void]$sb.AppendLine('  "results": [')
    for ($i = 0; $i -lt $results.Count; $i++) {
      $r = $results[$i]
      $entry = "    {""tool"": $(JsonString $r.Tool), ""path"": $(JsonString $r.Path), ""days"": $($r.Days), ""requested"": $($r.Requested), ""kept"": $(JsonBool $r.Kept), ""ok"": $(JsonBool $r.Ok), ""warn"": $(JsonStrOrNull $r.Warn)"
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
        [void]$sb.Append("`n    {""tool"": $(JsonString $r.Tool), ""warn"": $(JsonString $r.Warn)}")
      }
    }
    if (-not $first) { [void]$sb.Append("`n  ") }
    [void]$sb.AppendLine('],')
    [void]$sb.AppendLine("  ""ok"": $(JsonBool ($failures.Count -eq 0))")
    [void]$sb.Append('}')
    StdOut $sb.ToString()
  } else {
    foreach ($r in $results) {
      if ($r.Ok) {
        if ($r.Kept) {
          StdOut ('keep    {0} [{1}]  (kept existing {2}d ' + [string][char]0x2265 + ' {3}d)' -f (Pad4 $r.Tool), $r.Path, $r.Days, $r.Requested)
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

function CmdDisable($Targets, [bool]$Json) {
  $results = New-Object System.Collections.Generic.List[hashtable]
  $failures = New-Object System.Collections.Generic.List[string]
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
      Tool = $t; Path = $path; Removed = $removed
      Ok = ($null -eq $err); Error = $err
    })
  }
  if ($Json) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('{')
    [void]$sb.AppendLine('  "results": [')
    for ($i = 0; $i -lt $results.Count; $i++) {
      $r = $results[$i]
      $entry = "    {""tool"": $(JsonString $r.Tool), ""path"": $(JsonString $r.Path), ""removed"": $(JsonBool $r.Removed), ""ok"": $(JsonBool $r.Ok)"
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
    foreach ($r in $results) {
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

# ---------- entry ----------

try {
  $opts = ParseArgs $Argv
} catch {
  StdErr "pmsec: $_"
  exit 2
}

if ($opts.Version) { Write-Output "pmsec $($script:PmsecVersion)"; exit 0 }
if ($opts.Help) { PrintUsage; exit 0 }
if ([string]::IsNullOrEmpty($opts.Command)) { PrintUsage; exit 2 }

try {
  $targets = SelectTools $opts.Only
} catch {
  StdErr "pmsec: $_"
  exit 2
}

try {
  switch ($opts.Command) {
    'check'   { exit (CmdCheck $targets $opts.Json $opts.Days) }
    'enable'  { exit (CmdEnable $targets $opts.Json $opts.Days $opts.Force) }
    'disable' { exit (CmdDisable $targets $opts.Json) }
    default   { StdErr ("pmsec: unknown command ""{0}""" -f $opts.Command); exit 2 }
  }
} catch {
  StdErr "pmsec: $_"
  exit 1
}
