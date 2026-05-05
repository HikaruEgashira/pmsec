# pmsec (PowerShell)

PowerShell port of [pmsec](https://github.com/HikaruEgashira/pmsec) for Windows
hosts where the npm and PyPI distributions are not the most natural fit.
Targets Windows PowerShell 5.1 and PowerShell 7+.

```powershell
# install — production: replace `main` with a commit SHA so rollouts are reproducible.
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1

# use
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 enable
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 check
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 disable
```

The CLI surface is identical to the npm, PyPI, and bash distributions:

```
pmsec enable  [--tool TOOL[,TOOL]] [--days N] [--force] [--json]
pmsec check   [--tool TOOL[,TOOL]] [--days N] [--json]
pmsec disable [--tool TOOL[,TOOL]] [--json]
pmsec --version
```

Supported tools, files, and units match the root `README.md`.

## MDM deployment (Intune)

`pmsec` writes per-user config files. Intune scripts and remediations run as
`SYSTEM` by default, where `$env:USERPROFILE` resolves to
`C:\Windows\system32\config\systemprofile` — not the logged-in user's profile.
Two options:

**1. Run in the logged-on user's context.** In the Intune script settings
toggle "Run this script using the logged-on credentials" to `Yes`. No further
work needed: pmsec falls back to `$env:USERPROFILE` of the calling user.

**2. Stay as SYSTEM and target a specific profile.** Resolve the active user's
profile yourself and pass it via `PMSEC_HOME`:

```powershell
# Intune remediation script (runs as SYSTEM).
$user = (Get-CimInstance Win32_ComputerSystem).UserName  # DOMAIN\user
$sam  = ($user -split '\\')[-1]
$prof = (Get-CimInstance Win32_UserProfile |
         Where-Object { $_.LocalPath -like "*\$sam" -and -not $_.Special }).LocalPath
if (-not $prof) { exit 1 }   # nobody logged in — let Intune retry later

$env:PMSEC_HOME = $prof
& "$PSScriptRoot\pmsec.ps1" enable
& "$PSScriptRoot\pmsec.ps1" check
exit $LASTEXITCODE
```

Intune detection scripts treat exit `0` as compliant and any other code as
"needs remediation" — that maps directly onto `pmsec check`.

## Environment overrides

| variable | effect |
|----------|--------|
| `PMSEC_HOME` | Home dir to operate on (overrides `$env:USERPROFILE` / `$env:HOME`). |
| `NPM_CONFIG_USERCONFIG` | Override the npm/pnpm config file path. |
| `YARN_RC_FILENAME` | Override the yarn config file path. |
| `BUN_CONFIG_FILE` | Override the bun config file path. |
| `CARGO_HOME` | Override the cargo dir; pmsec writes `$CARGO_HOME\config.toml`. |
| `MISE_GLOBAL_CONFIG_FILE` | Override the mise config file path. |
| `UV_CONFIG_FILE` | Override the uv config file path. |

## Tests

```powershell
pwsh -File test/test.ps1
```

Each test runs `pmsec.ps1` as a child process under a fresh `$env:HOME` /
`$env:USERPROFILE`, with all pmsec-relevant env vars cleared, then diffs the
on-disk config against the same expected bytes the node, python, and bash
suites verify.
