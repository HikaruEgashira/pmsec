<p align="center">
  <img src="docs/assets/banner.png" alt="pmsec: zero-config install-time hardening" width="100%">
</p>

<h1 align="center">pmsec</h1>

<p align="center">
  Zero-config install-time hardening for npm / pnpm / yarn / bun / cargo / mise / uv / bundler.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pmsec">npm</a> · <a href="https://pypi.org/project/pmsec/">PyPI</a> · <a href="bash/">bash</a> · <a href="powershell/">PowerShell</a>
</p>

```bash
npx pmsec
npx pmsec --check
```

```bash
uvx pmsec
uvx pmsec --check
```

```bash
curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/bash/pmsec \
  -o /usr/local/bin/pmsec && chmod +x /usr/local/bin/pmsec
pmsec
```

```powershell
# Windows only
Invoke-WebRequest `
  -Uri https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/powershell/pmsec.ps1 `
  -OutFile $env:USERPROFILE\bin\pmsec.ps1
pwsh -File $env:USERPROFILE\bin\pmsec.ps1
```

The default action enables the hardening bundle for every detected tool.
Pass `--check` to verify, `--disable` to remove. Common options:
`--tool npm,pnpm`, `--days 7`, `--force`, `--json`.

`pmsec --doctor` (read-only) prints the resolved per-tool config path,
running `uid`/`euid`, `HOME` / `PMSEC_HOME` source, parent-directory
writability, and the existing file's owner — the diagnostic to run from
any orchestrator (Jamf, Intune, Ansible, SCCM, Munki, GPO logon scripts,
Salt, …) when an enable run reports nothing visible to the user.
`pmsec --doctor --json` is consumable by any orchestrator that ingests a
JSON exit-code signal (Intune detection rule, Ansible `assert`, CI step).

> Bootstrap: pmsec eats its own
>
> ```bash
> npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec --check
> uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec --check
> ```

## Supported Package Managers

| tool  | config file                          | key                                | value          | what it does                                                                                                  | min version          |
|-------|--------------------------------------|------------------------------------|----------------|---------------------------------------------------------------------------------------------------------------|----------------------|
| npm   | `~/.npmrc`                           | `min-release-age`                  | `1`            | filters out package versions younger than 1 day at install time                                               | npm ≥ 11.10.0        |
| npm   | `~/.npmrc`                           | `audit-level`                      | `high`         | `npm install` / `npm audit` exit non-zero on high+critical advisories. Install behavior unchanged.            | npm ≥ 6.4.0          |
| npm   | `~/.npmrc`                           | `allow-git`                        | `root`         | blocks transitive git dependencies; only the root project may list git deps. Mitigates the vector where a git dep includes a malicious `.npmrc` that overrides the git executable path to execute arbitrary code at install time (bypasses `--ignore-scripts`). | npm ≥ 11.15.0        |
| npm   | `~/.npmrc`                           | `allow-remote`                     | `root`         | blocks transitive dependencies from declaring direct remote-tarball URLs (`https://…/pkg.tgz`); only the root project may do so. Prevents a compromised transitive package from pulling in a malicious payload via URL that bypasses registry integrity checks (no provenance, no checksum validation). | npm ≥ 11.15.0        |
| pnpm  | `~/.config/pnpm/rc`                  | `minimum-release-age`              | `1440` (min)   | filters out package versions younger than 1 day                                                               | pnpm ≥ 10.6.0        |
| pnpm  | `~/.config/pnpm/rc`                  | `trust-policy`                     | `no-downgrade` | refuses installs whose signature / provenance evidence is weaker than the previously installed version        | pnpm ≥ 10.21.0       |
| pnpm  | `~/.config/pnpm/rc`                  | `block-exotic-subdeps`             | `true`         | rejects transitive deps resolved from git/tarball URLs (direct git deps still work). Default since pnpm 11.0.0 — pmsec still writes the line so the protection survives a downgrade to 10.x. | pnpm ≥ 10.26.0 (default ≥ 11.0.0) |
| pnpm  | `~/.config/pnpm/rc`                  | `strict-dep-builds`                | `true`         | turns pnpm's default warning for unreviewed lifecycle scripts into a hard install error. Combined with pnpm 10+'s default-deny, no transitive `postinstall` runs unless the package is in `pnpm.allowBuilds` (per-project `package.json`). | pnpm ≥ 10.3.0        |
| yarn  | `~/.yarnrc.yml`                      | `npmMinimalAgeGate`                | `"1d"`         | filters out package versions younger than 1 day                                                               | yarn ≥ 4.10.0        |
| yarn  | `~/.yarnrc.yml`                      | `enableHardenedMode`               | `true`         | re-queries the registry on install to confirm lockfile resolutions still match remote (anti-lockfile-poisoning)| yarn ≥ 4.0.0         |
| yarn  | `~/.yarnrc.yml`                      | `enableScripts`                    | `false`        | prevents third-party `preinstall`/`postinstall` scripts from running — closes the install-script abuse vector (e.g. event-stream, node-ipc). Default since yarn 4.14.0; pmsec writes it explicitly to protect yarn 4.10–4.13 users and to pin the behavior against future default reversals. | yarn ≥ 4.0.0         |
| bun   | `~/.bunfig.toml`                     | `[install].minimumReleaseAge`      | `86400` (sec)  | filters out package versions younger than 1 day                                                               | bun ≥ 1.3.0          |
| cargo | `$CARGO_HOME/config.toml`            | `[install].minimum-release-age`    | `"1d"`         | filters out crate versions younger than 1 day                                                                 | cargo ≥ 1.94.0       |
| mise  | `~/.config/mise/config.toml`         | `[settings].minimum_release_age`   | `"1d"`         | filters out tool versions younger than 1 day                                                                  | mise ≥ 2026.4.22     |
| mise  | `~/.config/mise/config.toml`         | `[settings].paranoid`              | `true`         | re-verifies SLSA / cosign / minisign / GitHub attestations even when lockfile checksums match                 | mise (any current)\* |
| uv    | `~/.config/uv/uv.toml`               | `exclude-newer`                    | `"1 days"`     | filters out package versions published after `now − 1 day`                                                    | uv ≥ 0.9.17          |
| bundler | `~/.bundle/config`                 | `BUNDLE_COOLDOWN`                  | `"1"` (days)   | refuses to resolve to a gem version until it has been public for at least 1 day                               | bundler ≥ 4.0.13     |

[MIT](LICENSE)
