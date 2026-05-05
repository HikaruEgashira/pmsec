<h1 align="center">pmsec</h1>

<p align="center">
  Zero-config install-time hardening for npm / pnpm / yarn / bun / cargo / mise / uv.
</p>

<p align="center">
  One command flips on every safe-by-default supply-chain knob each package manager exposes:
  install cooldown, signature trust policy, lockfile re-verification, build-script attestation, and more.
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
# no npm/uv on the box? grab the bash port (production: pin a commit SHA):
curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/bash/pmsec \
  -o /usr/local/bin/pmsec && chmod +x /usr/local/bin/pmsec
pmsec enable
```

```powershell
# Windows? grab the PowerShell port (production: pin a commit SHA; also configures every installed WSL distro):
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 enable
```

> MDM (Jamf / Intune): set `PMSEC_HOME` to the logged-in user's home —
> see [`bash/README.md`](bash/README.md#mdm-deployment-jamf-ansible-) /
> [`powershell/README.md`](powershell/README.md#mdm-deployment-intune).

> Bootstrap: pmsec eats its own dog food — once a cooldown is in place,
> the very first install may be filtered out. Override just for that call:
>
> ```bash
> npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec check
> uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec check
> ```

## Supported Package Managers

Writes a fixed bundle of hardening keys to each tool's user-global config — a 1-day install cooldown plus every safe-by-default supply-chain knob the tool exposes. `disable` removes them; `check` exits non-zero if any row is missing or below the bundled value. The cooldown is opinionated but adjustable: pass `--days N` to `enable` / `check` to use a different threshold (e.g. `pmsec enable --days 7`). The extras have no knobs — pmsec is opinionated about what "hardened" means.

`enable` is monotonic by default: it never weakens an existing stricter setting. If your `~/.npmrc` already has `min-release-age=14`, `pmsec enable` (default 1) keeps the 14 and prints `keep`. To raise a tool past the bundle default, pass `--days N` — `pmsec enable --days 30` will upgrade weaker tools to 30 and leave anything ≥ 30 as is. Use `pmsec disable` if you actually want to remove the cooldown. To explicitly downgrade (e.g. relax temporarily), pass `--force`: `pmsec enable --days 1 --force` overwrites whatever was there.

Version floors below are strict: `≥ x.y.z` is the lowest release that actually honors the setting. On older versions, the line is silently ignored — `pmsec check` warns when it detects one for the cooldown keys it gates on (`min-release-age`, `minimum-release-age`, `npmMinimalAgeGate`, `minimumReleaseAge`, `minimum_release_age`, `exclude-newer`).

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
