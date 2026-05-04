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
npx pmsec check --min 7
npx pmsec set 7
npx pmsec unset
npx pmsec --version
```

```bash
uvx pmsec check --min 7
uvx pmsec set 7
uvx pmsec unset
```

```bash
# no npm/uv on the box? grab the bash port:
curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/bash/pmsec \
  -o /usr/local/bin/pmsec && chmod +x /usr/local/bin/pmsec
pmsec check --min 7
```

```powershell
# Windows? grab the PowerShell port:
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1
pwsh -File $env:USERPROFILE\bin\pmsec.ps1 check --min 7
```

> Bootstrap: pmsec eats its own dog food — once a cooldown is in place,
> the very first install may be filtered out. Override just for that call:
>
> ```bash
> npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec check
> uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec check
> ```

## what `pmsec set <DAYS>` does

The cooldown column (`set <DAYS>` parameter) and the extra hardening keys are written together. `unset` removes both; `check` exits non-zero if any row is missing or below the expected value. There is no flag or command for "just the cooldown" or "just the extras" — pmsec is opinionated about what "hardened" means.

| tool  | config file                          | key                                                | value (`set 7`) | what it does                                                                                                  | min version     |
|-------|--------------------------------------|----------------------------------------------------|-----------------|---------------------------------------------------------------------------------------------------------------|-----------------|
| npm   | `~/.npmrc`                           | `min-release-age`                                  | `7`             | filters out package versions younger than 7 days at install time                                              | npm 11.10+      |
| npm   | `~/.npmrc`                           | `audit-level` *(extra)*                            | `high`          | `npm install` / `npm audit` exit non-zero on high+critical advisories. Install behavior unchanged.            | npm 6+          |
| pnpm  | `~/.npmrc`                           | `minimum-release-age`                              | `10080` (min)   | filters out package versions younger than 7 days                                                              | pnpm 10.6+      |
| pnpm  | `~/.npmrc`                           | `trust-policy` *(extra)*                           | `no-downgrade`  | refuses installs whose signature / provenance evidence is weaker than the previously installed version        | pnpm 10.21+     |
| pnpm  | `~/.npmrc`                           | `block-exotic-subdeps` *(extra)*                   | `true`          | rejects transitive deps resolved from git/tarball URLs (direct git deps still work)                           | pnpm 10.26+     |
| yarn  | `~/.yarnrc.yml`                      | `npmMinimalAgeGate`                                | `"7d"`          | filters out package versions younger than 7 days                                                              | yarn 4.10+      |
| yarn  | `~/.yarnrc.yml`                      | `enableHardenedMode` *(extra)*                     | `true`          | re-queries the registry on install to confirm lockfile resolutions still match remote (anti-lockfile-poisoning)| yarn 4+         |
| bun   | `~/.bunfig.toml`                     | `[install].minimumReleaseAge`                      | `604800` (sec)  | filters out package versions younger than 7 days                                                              | bun 1.3+        |
| cargo | `$CARGO_HOME/config.toml`            | `[install].minimum-release-age`                    | `"7d"`          | filters out crate versions younger than 7 days                                                                | —               |
| mise  | `~/.config/mise/config.toml`         | `[settings].minimum_release_age`                   | `"7d"`          | filters out tool versions younger than 7 days                                                                 | mise 2026.4.22+ |
| mise  | `~/.config/mise/config.toml`         | `[settings].paranoid` *(extra)*                    | `true`          | re-verifies SLSA / cosign / minisign / GitHub attestations even when lockfile checksums match                 | mise (recent)   |
| uv    | `~/.config/uv/uv.toml`               | `exclude-newer`                                    | `"7 days"`      | filters out package versions published after `now − 7 days`                                                   | uv 0.9.17+      |

bun, cargo, and uv have no extras: bun's script-execution defense lives in per-project `package.json`, cargo build scripts can't be disabled at config level, and uv's defaults (`index-strategy=first-index`, `keyring-provider=disabled`, `allow-insecure-host=[]`) are already safe.

[MIT](LICENSE)
