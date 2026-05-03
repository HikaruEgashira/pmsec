# pmsec installer (PowerShell 5.1+)
#
# Usage:
#   irm https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/install.ps1))) -Version 0.3.0
#
# Env overrides:
#   $env:PMSEC_HOME       install root      (default: $HOME\.pmsec)
#   $env:PMSEC_BIN_DIR    shim directory    (default: $HOME\.local\bin)
#   $env:PMSEC_REGISTRY   npm registry base (default: https://registry.npmjs.org)

[CmdletBinding()]
param(
  [string]$Version = 'latest'
)

$ErrorActionPreference = 'Stop'

$NpmPkg     = 'pmsec'
$Registry   = if ($env:PMSEC_REGISTRY) { $env:PMSEC_REGISTRY.TrimEnd('/') } else { 'https://registry.npmjs.org' }
$InstallDir = if ($env:PMSEC_HOME)     { $env:PMSEC_HOME }    else { Join-Path $HOME '.pmsec' }
$BinDir     = if ($env:PMSEC_BIN_DIR)  { $env:PMSEC_BIN_DIR } else { Join-Path $HOME '.local\bin' }

function Die($msg) { Write-Error "pmsec: $msg"; exit 1 }
function Need($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Die "'$cmd' is required" }
}

Need 'node'
Need 'tar'

$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 20) { Die "node >= 20 required (have $(node -v))" }

# Resolve metadata
$metaUrl = "$Registry/$NpmPkg/$Version"
try {
  $meta = Invoke-RestMethod -Uri $metaUrl -UseBasicParsing
} catch {
  Die "failed to fetch $metaUrl ($_)"
}

$tarballUrl       = $meta.dist.tarball
$integrity        = $meta.dist.integrity
$resolvedVersion  = $meta.version
if (-not $tarballUrl) { Die 'registry response missing dist.tarball' }

$tmp = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ("pmsec-" + [System.Guid]::NewGuid()))
try {
  $tgz = Join-Path $tmp 'pmsec.tgz'
  Invoke-WebRequest -Uri $tarballUrl -OutFile $tgz -UseBasicParsing

  # Verify SHA-512 integrity ("sha512-<base64>")
  if ($integrity -and $integrity.StartsWith('sha512-')) {
    $expected = $integrity.Substring(7)
    $sha512 = [System.Security.Cryptography.SHA512]::Create()
    try {
      $stream = [System.IO.File]::OpenRead($tgz)
      try { $hash = $sha512.ComputeHash($stream) } finally { $stream.Dispose() }
    } finally { $sha512.Dispose() }
    $got = [Convert]::ToBase64String($hash)
    if ($expected -ne $got) { Die "integrity mismatch (expected $expected got $got)" }
  } else {
    Write-Warning 'pmsec: registry returned no integrity hash, skipping verification'
  }

  # Stage and swap
  $stage = New-Item -ItemType Directory -Path (Join-Path $tmp 'stage')
  & tar -xzf $tgz -C $stage --strip-components=1
  if ($LASTEXITCODE -ne 0) { Die 'tar extraction failed' }

  if (Test-Path $InstallDir) {
    Get-ChildItem -Path $InstallDir -Force | Remove-Item -Recurse -Force
  } else {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  }
  Get-ChildItem -Path $stage -Force | Move-Item -Destination $InstallDir -Force
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$cliPath = Join-Path $InstallDir 'bin\cli.mjs'

# .cmd shim for cmd.exe / generic PATH lookup
$cmdShim = "@echo off`r`nnode `"$cliPath`" %*`r`n"
Set-Content -Path (Join-Path $BinDir 'pmsec.cmd') -Value $cmdShim -NoNewline -Encoding ASCII

# .ps1 shim for PowerShell
$psShim = @"
#!/usr/bin/env pwsh
& node "$cliPath" @args
exit `$LASTEXITCODE
"@
Set-Content -Path (Join-Path $BinDir 'pmsec.ps1') -Value $psShim -Encoding UTF8

Write-Host "pmsec $resolvedVersion installed"
Write-Host "  files: $InstallDir"
Write-Host "  shim:  $(Join-Path $BinDir 'pmsec.cmd')"

$pathDirs = $env:Path -split ';'
if ($pathDirs -notcontains $BinDir) {
  Write-Host ""
  Write-Host "pmsec: $BinDir is not on PATH. Add it for the current user with:"
  Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$BinDir;`" + [Environment]::GetEnvironmentVariable('Path','User'), 'User')"
}
