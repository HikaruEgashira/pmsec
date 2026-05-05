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
# install
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1

# use
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 enable
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 enable --days 7
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 check
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 disable
```

The CLI surface is identical to the npm, PyPI, and bash distributions:

```
pmsec enable  [--tool TOOL[,TOOL]] [--days N] [--force] [--no-wsl] [--json]
pmsec check   [--tool TOOL[,TOOL]] [--days N] [--no-wsl] [--json]
pmsec disable [--tool TOOL[,TOOL]] [--no-wsl] [--json]
pmsec --version
```

`--no-wsl` (or `PMSEC_NO_WSL=1`) skips the WSL pass and only configures the
Windows host. Without it, `wsl.exe -l -q` enumerates installed distros and
each one gets the same hardening bundle written to `~/.npmrc`,
`~/.config/uv/uv.toml`, etc. inside the distro filesystem. Docker Desktop's
helper distros are skipped automatically.

When more than one scope is targeted, output is grouped under `[<scope>]`
headers (`[windows]`, `[wsl-Ubuntu]`, ...) and JSON results carry a `scope`
field on every row.

Supported tools, files, and units match the root `README.md`.

## Tests

```powershell
pwsh -File test/test.ps1
```

Tests inject scope lists via `PMSEC_FAKE_SCOPES="label|home|platform;..."`
to bypass real `wsl.exe` enumeration, then diff the on-disk shape against
the same bytes the node, python, and bash suites verify.
