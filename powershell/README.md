# pmsec (PowerShell)

Windows-only port for Windows PowerShell 5.1 and PowerShell 7+. Native macOS
and Linux `pwsh` hosts are unsupported; use bash, node, or python there.

By default the script hardens Windows plus each installed WSL distro. Docker
Desktop helper distros are skipped.

```powershell
$dest = "$env:USERPROFILE\bin\pmsec.ps1"
New-Item (Split-Path $dest) -ItemType Directory -Force | Out-Null
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 -OutFile $dest

powershell -ExecutionPolicy Bypass -File $dest
powershell -ExecutionPolicy Bypass -File $dest --check
powershell -ExecutionPolicy Bypass -File $dest --disable
```

Uses the built-in `powershell.exe`; `pwsh` works when PowerShell 7+ is
installed. Pin `main` to a commit SHA for reproducible rollouts.

```
pmsec            [--tool TOOL[,TOOL]] [--days N] [--force] [--no-wsl] [--json]
pmsec --check    [--tool TOOL[,TOOL]] [--days N] [--no-wsl] [--json]
pmsec --disable  [--tool TOOL[,TOOL]] [--no-wsl] [--json]
pmsec --doctor   [--tool TOOL[,TOOL]] [--no-wsl] [--json]
pmsec --version
```

`--no-wsl` or `PMSEC_NO_WSL=1` skips WSL. Multi-scope output is grouped as
`[windows]`, `[wsl-<distro>]`; JSON rows include `scope`.

## Intune daily deployment (Windows + WSL)

Upload [`intune-platform-script.ps1`](intune-platform-script.ps1) as the
Platform Script. No command or script arguments are required: the wrapper
downloads `pmsec.ps1`, registers the daily task itself, and runs pmsec without
requiring a special payload version. The downloaded payload is pinned by
`$pmsecCommit` to make rollouts reproducible. To deploy an update, change it to
the tested commit SHA and upload the wrapper to Intune again.

Set **Run this script using the logged on credentials** to **Yes** and **Run
script in 64 bit PowerShell Host** to **Yes**. WSL distributions are registered
per Windows user, so a task created as `SYSTEM` cannot reach the logged-on
user's distros.

The wrapper applies pmsec immediately, stores the script at
`%LOCALAPPDATA%\pmsec\pmsec.ps1`, and creates or updates the `pmsec daily`
scheduled task. It runs every day at 12:00 local time as the same user, includes
Windows and WSL by default, starts when next available after a missed run, and
does not stop on battery power. Re-running the Intune script updates both the
persistent copy and the existing task.

To remove only the schedule:

```powershell
Unregister-ScheduledTask -TaskName 'pmsec daily' -Confirm:$false
```

## SYSTEM-Orchestrated Runs

`pmsec` writes per-user config. Prefer running in the logged-on user's context.
If the orchestrator must run as `SYSTEM`, set `PMSEC_HOME` to the target
profile.

```powershell
$user = (Get-CimInstance Win32_ComputerSystem).UserName
if (-not $user) { exit 1 }
$sam = ($user -split '\\')[-1]
$prof = (Get-CimInstance Win32_UserProfile |
  Where-Object { $_.LocalPath -like "*\$sam" -and -not $_.Special }).LocalPath
if (-not $prof) { exit 1 }

$env:PMSEC_HOME = $prof
& "$PSScriptRoot\pmsec.ps1"
& "$PSScriptRoot\pmsec.ps1" --check
exit $LASTEXITCODE
```

Read-only diagnostics:

```powershell
& "$PSScriptRoot\pmsec.ps1" --doctor --json
```

`--doctor` reports resolved user, home paths, config paths, ownership, and
parent writability for Windows and WSL scopes. `WriteAtomic <step>` failures
identify the failing step.

## Environment

| Variable | Effect |
| --- | --- |
| `PMSEC_HOME` | Home dir to operate on. |
| `PMSEC_NO_WSL` | Skip WSL when set to `1`. |
| `NPM_CONFIG_USERCONFIG` | npm/pnpm config path. |
| `YARN_RC_FILENAME` | yarn config path. |
| `BUN_CONFIG_FILE` | bun config path. |
| `CARGO_HOME` | cargo home; writes `$CARGO_HOME\config.toml`. |
| `MISE_GLOBAL_CONFIG_FILE` | mise config path. |
| `UV_CONFIG_FILE` | uv config path. |
| `AUBE_CONFIG_FILE` | aube config path. |

## Tests

```powershell
pwsh -File test/test.ps1
```

Tests use `PMSEC_FAKE_SCOPES="label|home|platform;..."` to avoid real WSL
enumeration.
