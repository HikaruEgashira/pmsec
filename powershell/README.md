# pmsec (PowerShell)

Windows-only PowerShell port of [pmsec](https://github.com/HikaruEgashira/pmsec).
Runs on Windows PowerShell 5.1 and PowerShell 7+. **Non-Windows pwsh hosts
(macOS, native Linux) are not supported** — use the bash, node, or python
port instead.

In addition to hardening the Windows host, the script reaches into every
installed WSL distribution via `\\wsl$\<distro>\...` and applies the same
config inside each distro's filesystem. One invocation, hardened everywhere
your packages get installed.

```powershell
# install — production: replace `main` with a commit SHA so rollouts are reproducible.
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1

# use
pwsh -File $env:USERPROFILE\bin\pmsec.ps1
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 --days 7
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 --check
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 --disable
```

The CLI surface is identical to the npm, PyPI, and bash distributions:

```
pmsec            [--tool TOOL[,TOOL]] [--days N] [--force] [--no-wsl] [--json]
pmsec --check    [--tool TOOL[,TOOL]] [--days N] [--no-wsl] [--json]
pmsec --disable  [--tool TOOL[,TOOL]] [--no-wsl] [--json]
pmsec --version
```

`--no-wsl` (or `PMSEC_NO_WSL=1`) skips the WSL pass and only configures the
Windows host. Without it, `wsl.exe -l -q` enumerates installed distros and
each one gets the same hardening bundle written to `~/.npmrc`,
`~/.config/pnpm/rc`, `~/.config/uv/uv.toml`, etc. inside the distro filesystem. Docker Desktop's
helper distros are skipped automatically.

When more than one scope is targeted, output is grouped under `[<scope>]`
headers (`[windows]`, `[wsl-Ubuntu]`, ...) and JSON results carry a `scope`
field on every row.

Supported tools, files, and units match the root `README.md`.

## Running as SYSTEM against another user's profile

`pmsec` writes per-user config files. When an orchestrator (Intune, SCCM,
GPO startup script, Configuration Manager, third-party RMM, …) invokes the
script as `SYSTEM`, `$env:USERPROFILE` resolves to
`C:\Windows\system32\config\systemprofile` — not the logged-in user's
profile. Two options:

**1. Run in the logged-on user's context.** Most orchestrators expose a
toggle to invoke scripts as the calling user (Intune: "Run this script
using the logged-on credentials"; SCCM Configuration Items: "Run scripts
by using the logged on user credentials"; scheduled tasks: pick the user
account instead of `SYSTEM`). With that on, pmsec falls back to
`$env:USERPROFILE` of the calling user — no further work.

**2. Stay as SYSTEM and target a specific profile.** Resolve the active
user's profile yourself and pass it via `PMSEC_HOME`. The pattern is
orchestrator-agnostic — the snippet below works in Intune Proactive
Remediations, SCCM scripts, scheduled tasks, GPO startup scripts, or any
RMM agent that runs PowerShell as SYSTEM:

```powershell
# Runs as SYSTEM. Resolve the active interactive user, then hand off to pmsec.
$user = (Get-CimInstance Win32_ComputerSystem).UserName  # DOMAIN\user
if (-not $user) { exit 1 }   # nobody logged in — let the orchestrator retry later
$sam  = ($user -split '\\')[-1]
$prof = (Get-CimInstance Win32_UserProfile |
         Where-Object { $_.LocalPath -like "*\$sam" -and -not $_.Special }).LocalPath
if (-not $prof) { exit 1 }

$env:PMSEC_HOME = $prof
& "$PSScriptRoot\pmsec.ps1"
& "$PSScriptRoot\pmsec.ps1" --check
exit $LASTEXITCODE
```

`pmsec --check` exits `0` when compliant, `1` otherwise — that maps
directly onto Intune detection scripts, SCCM Configuration Item compliance
rules, scheduled-task return-code checks, or any other exit-code consumer.

### Debugging a failed deployment

When a deployment reports failure with no obvious cause, run the read-only
diagnostic in the same context (SYSTEM or user) and inspect the JSON:

```powershell
& "$PSScriptRoot\pmsec.ps1" --doctor --json
```

The output lists the resolved `username`, `isAdministrator`, `home`,
`pmsecHome`, and per-tool `{path, parent, exists, writable, parentExists,
parentWritable, owner}` for every scope (Windows host plus each WSL
distro). `ok: false` means at least one parent is not writable — typical
on SYSTEM when `PMSEC_HOME` is unset (the script falls back to
`systemprofile`) or when a UNC path to a stopped WSL distro fails.

If `pmsec` still fails after `doctor` reports `ok: true`, write errors are
now tagged: failures throw with a `WriteAtomic <step>` prefix
(`mkdir`, `backup-copy`, `body-write`, `rename`). AV/EDR commonly blocks
the `rename` step — that prefix narrows the investigation to a Defender /
Sophos exclusion. `UnauthorizedAccessException` failures additionally
surface a `Get-Acl` hint identifying the file to inspect.

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

Tests inject scope lists via `PMSEC_FAKE_SCOPES="label|home|platform;..."`
to bypass real `wsl.exe` enumeration, then diff the on-disk shape against
the same bytes the node, python, and bash suites verify.
