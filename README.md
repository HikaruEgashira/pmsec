<h1 align="center">pmsec</h1>

<p align="center">
  Zero-config install-time hardening for npm / pnpm / yarn / bun / cargo / mise / uv.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pmsec">npm</a> · <a href="https://pypi.org/project/pmsec/">PyPI</a> · <a href="bash/">bash</a> · <a href="powershell/">PowerShell</a>
</p>

```bash
npx pmsec check
npx pmsec enable
```

```bash
uvx pmsec check
uvx pmsec enable
```

```bash
curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/bash/pmsec \
  -o /usr/local/bin/pmsec && chmod +x /usr/local/bin/pmsec
pmsec enable
```

```powershell
# Windows only
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 enable
```

> Bootstrap: pmsec eats its own
>
> ```bash
> npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec check
> uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec check
> ```

## Supported Package Managers

| tool  | config file                          | key                                | value          | what it does                                                                                                  | min version          |
|-------|--------------------------------------|------------------------------------|----------------|---------------------------------------------------------------------------------------------------------------|----------------------|
| npm   | `~/.npmrc`                           | `min-release-age`                  | `1`            | filters out package versions younger than 1 day at install time                                               | npm ≥ 11.10.0        |
| npm   | `~/.npmrc`                           | `audit-level`                      | `high`         | `npm install` / `npm audit` exit non-zero on high+critical advisories. Install behavior unchanged.            | npm ≥ 6.4.0          |
| pnpm  | `~/.config/pnpm/rc`                  | `minimum-release-age`              | `1440` (min)   | filters out package versions younger than 1 day                                                               | pnpm ≥ 10.6.0        |
| pnpm  | `~/.config/pnpm/rc`                  | `trust-policy`                     | `no-downgrade` | refuses installs whose signature / provenance evidence is weaker than the previously installed version        | pnpm ≥ 10.21.0       |
| pnpm  | `~/.config/pnpm/rc`                  | `block-exotic-subdeps`             | `true`         | rejects transitive deps resolved from git/tarball URLs (direct git deps still work). Default since pnpm 11.0.0 — pmsec still writes the line so the protection survives a downgrade to 10.x. | pnpm ≥ 10.26.0 (default ≥ 11.0.0) |
| pnpm  | `~/.config/pnpm/rc`                  | `strict-dep-builds`                | `true`         | turns pnpm's default warning for unreviewed lifecycle scripts into a hard install error. Combined with pnpm 10+'s default-deny, no transitive `postinstall` runs unless the package is in `pnpm.allowBuilds` (per-project `package.json`). | pnpm ≥ 10.3.0        |
| yarn  | `~/.yarnrc.yml`                      | `npmMinimalAgeGate`                | `"1d"`         | filters out package versions younger than 1 day                                                               | yarn ≥ 4.10.0        |
| yarn  | `~/.yarnrc.yml`                      | `enableHardenedMode`               | `true`         | re-queries the registry on install to confirm lockfile resolutions still match remote (anti-lockfile-poisoning)| yarn ≥ 4.0.0         |
| bun   | `~/.bunfig.toml`                     | `[install].minimumReleaseAge`      | `86400` (sec)  | filters out package versions younger than 1 day                                                               | bun ≥ 1.3.0          |
| cargo | `$CARGO_HOME/config.toml`            | `[install].minimum-release-age`    | `"1d"`         | filters out crate versions younger than 1 day                                                                 | cargo ≥ 1.94.0       |
| mise  | `~/.config/mise/config.toml`         | `[settings].minimum_release_age`   | `"1d"`         | filters out tool versions younger than 1 day                                                                  | mise ≥ 2026.4.22     |
| mise  | `~/.config/mise/config.toml`         | `[settings].paranoid`              | `true`         | re-verifies SLSA / cosign / minisign / GitHub attestations even when lockfile checksums match                 | mise (any current)\* |
| uv    | `~/.config/uv/uv.toml`               | `exclude-newer`                    | `"1 days"`     | filters out package versions published after `now − 1 day`                                                    | uv ≥ 0.9.17          |

\* `paranoid` predates mise's published per-setting version metadata; no precise floor is documented. Any actively maintained mise honors it.

bun, cargo, and uv have no extras: bun's script-execution defense lives in per-project `package.json`, cargo build scripts can't be disabled at config level, and uv's defaults (`index-strategy=first-index`, `keyring-provider=disabled`, `allow-insecure-host=[]`) are already safe.

[MIT](LICENSE)
