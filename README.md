<h1 align="center">pmsec</h1>

<p align="center">
  Install-time cooldown for npm / pnpm / yarn / bun / cargo / mise / uv.
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

> Bootstrap: pmsec itself is subject to cooldown, so the very first install
> may be filtered. Override just for that call
>
> ```bash
> npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec check
> uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec check
> ```

## supported tools

The cooldown key — what `pmsec set <DAYS>` writes and what `--min DAYS` checks against.

| tool  | config file                          | key                                     | min version    |
|-------|--------------------------------------|-----------------------------------------|----------------|
| npm   | `~/.npmrc`                           | `min-release-age`                       | npm 11.10+     |
| pnpm  | `~/.npmrc`                           | `minimum-release-age`                   | pnpm 10.6+     |
| yarn  | `~/.yarnrc.yml`                      | `npmMinimalAgeGate`                     | yarn 4.10+     |
| bun   | `~/.bunfig.toml`                     | `[install].minimumReleaseAge`           | bun 1.3+       |
| cargo | `$CARGO_HOME/config.toml`            | `[install].minimum-release-age`         | —              |
| mise  | `~/.config/mise/config.toml`         | `[settings].minimum_release_age`        | mise 2026.4.22+|
| uv    | `~/.config/uv/uv.toml`               | `exclude-newer`                         | uv 0.9.17+     |

## zero-config hardening

Applied alongside the cooldown on `set`, removed on `unset`, validated on `check`. No new flag, no new command — flipping the cooldown opts you into the rest of the bundle.

| tool | key                       | value          | what it does                                                                                          | min version    |
|------|---------------------------|----------------|-------------------------------------------------------------------------------------------------------|----------------|
| npm  | `audit-level`             | `high`         | makes `npm install` / `npm audit` exit non-zero on high or critical advisories. Install behavior is unchanged. | npm 6+         |
| pnpm | `trust-policy`            | `no-downgrade` | refuses to install a package whose signature/provenance evidence is weaker than the previously installed version. Fails closed only on regression. | pnpm 10.21+    |
| pnpm | `block-exotic-subdeps`    | `true`         | rejects transitive dependencies resolved from git or tarball URLs. Direct git/tarball deps still work — only sub-deps are restricted, closing a known supply-chain vector. | pnpm 10.26+    |
| yarn | `enableHardenedMode`      | `true`         | re-queries the registry on every install to confirm lockfile resolutions and checksums still match remote. Defends against lockfile poisoning. | yarn 4+        |
| mise | `[settings].paranoid`     | `true`         | re-verifies SLSA provenance, cosign / minisign signatures, and GitHub artifact attestations even when lockfile checksums match. Tools whose backends lack attestations fail closed. | mise (recent) |

bun, cargo, and uv have no globally-flippable safe-by-default key worth flipping today; `pmsec` writes nothing extra for them. (bun's script-execution defense lives in per-project `package.json`; cargo's build scripts cannot be disabled at config-file level; uv's `index-strategy=first-index` and friends are already the safe defaults.)

[MIT](LICENSE)
