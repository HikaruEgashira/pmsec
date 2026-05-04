# pmsec (PowerShell)

PowerShell port of [pmsec](https://github.com/HikaruEgashira/pmsec) for Windows
hosts where the npm and PyPI distributions are not the most natural fit.
Targets Windows PowerShell 5.1 and PowerShell 7+.

```powershell
# install
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1

# use
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 check --min 7
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 set 7
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 unset
```

The CLI surface is identical to the npm, PyPI, and bash distributions:

```
pmsec check [--tool TOOL[,TOOL]] [--min DAYS] [--json]
pmsec set <DAYS>  [--tool TOOL[,TOOL]] [--json]
pmsec unset       [--tool TOOL[,TOOL]] [--json]
pmsec --version
```

Supported tools, files, and units match the root `README.md`.

## Tests

```powershell
pwsh -File test/test.ps1
```

Each test runs `pmsec.ps1` as a child process under a fresh `$env:HOME` /
`$env:USERPROFILE`, with all pmsec-relevant env vars cleared, then diffs the
on-disk config against the same expected bytes the node, python, and bash
suites verify.
