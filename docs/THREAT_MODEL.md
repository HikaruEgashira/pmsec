# pmsec threat model

Last reviewed: 2026-11-07 (full source review of `node/`, `python/`, `bash/`,
`powershell/`, `conformance/`, `.github/workflows/`, `scripts/`).

## What pmsec is

pmsec writes cooldown and hardening keys into per-user package-manager config
files (`~/.npmrc`, pnpm `rc`/`config.yaml`, `.yarnrc.yml`, `.bunfig.toml`,
cargo `config.toml`, mise/aube/uv TOML, bundler YAML, composer JSON). It runs
once at install time, optionally re-runs under an orchestrator (Intune, SCCM,
cron as root with `PMSEC_HOME`), and offers `--check` as an audit gate.

It makes no network calls. Its only external interaction is spawning
`<tool> --version` from `PATH` to pick a config format.

## Assets

| Asset | Why it matters |
|---|---|
| The config files it edits | They already hold registry auth tokens (`//registry/:_authToken=`), proxy settings, and script policies. Corrupting them breaks installs; leaking them leaks tokens. |
| The `.bak` copy of each file | Same content as the original at first write. Created with mode 0600, never refreshed, never removed. |
| The cooldown value itself | pmsec's purpose. A silently wrong or unparseable value defeats `--check` as a gate. |
| Files outside the target home | Under root, any write that escapes the home is a privilege boundary crossing. |
| The release pipeline | Four ports are published to npm, PyPI, a bash script URL, and a PowerShell script URL that Intune downloads. |

## Trust boundaries and attacker models

### A. Unprivileged user running pmsec on their own home

No boundary. The user can already edit every file pmsec touches. Attacks here
are robustness problems (malformed existing config, BOM/CRLF, odd YAML),
not security problems. Covered by `conformance/`.

### B. Root or orchestrator writing into another user's home

This is the real boundary. `PMSEC_HOME` (bash, powershell) or an Intune
platform script makes a privileged process write into a directory controlled
by a less-privileged user. That user can plant symlinks, junctions, and
pre-existing files at any path pmsec will touch, before or between runs.

Required guarantees:

1. Never follow a user-controlled symlink on write. Checked at the config path
   and at the `.bak` path. All four ports refuse both.
2. Never let a symlinked parent directory redirect `mkdir -p` or the final
   rename outside the home. bash resolves the deepest existing ancestor
   physically and refuses if it leaves the physical home. node/python do not
   honor `PMSEC_HOME`, so this path does not exist for them (see F4).
3. Hand ownership back without following links (`chown -h`). bash only;
   powershell relies on Windows ACL inheritance.
4. Never escalate privileges on its own. pmsec prints a chown hint on
   `EACCES` and exits non-zero. It does not run `sudo` (see F1).

### C. Malicious or compromised tool on `PATH`

Version preflight runs `npm --version`, `pnpm --version`, etc. A compromised
binary already owns the user; pmsec adds nothing. Accepted.
`PMSEC_<TOOL>_VERSION` overrides the spawn for sandboxed environments.

### D. Compromised WSL distro (powershell port)

The Windows port writes into WSL homes through a UNC path derived from the
distro's `$HOME`. A compromised distro controls that path and can redirect
writes anywhere inside the distro filesystem. It cannot redirect them to the
Windows host. Accepted; `--no-wsl` / `PMSEC_NO_WSL=1` opts out.

### E. CI and release supply chain

- Release actions are pinned by commit SHA, `persist-credentials: false`,
  `permissions: {}` at the workflow level, trusted publishing (OIDC) for
  npm and PyPI. No long-lived publish tokens.
- `pull_request` jobs run on a self-hosted runner in a public repo. A fork PR
  executes arbitrary code on that machine. Open: #182.
- The Intune script downloads `pmsec.ps1` pinned to a commit SHA over HTTPS
  with no hash check. Integrity rests on GitHub's content-addressing plus
  TLS. Accepted for now; a SHA-256 check would also defend against a
  compromised GitHub account rewriting history, which SHA pinning alone
  does not prevent for a force-pushed branch (the pinned commit is immutable,
  but the script could be repointed).

## Findings from the 2026-11-07 review

Status wording: "patched locally" means the fix is committed on a local
branch and not yet merged to `main`; this document is published ahead of the
fix PR on purpose.

| ID | Severity | Ports | Issue | Status |
|---|---|---|---|---|
| F1 | Medium | node, python | On `EACCES`, `reclaim()` ran `sudo chown` unprompted. Unrequested privilege escalation that also hangs unattended runs on the sudo password prompt. bash/powershell never did this. | Patched locally: `reclaim` removed, ports now behave the same (print chown hint, exit non-zero). |
| F2 | High | bash | Under root with `PMSEC_HOME`: `cp -p` followed a dangling symlink planted at `.bak`; `chown` without `-h` followed links; `mkdir -p` and the rename followed a user-controlled symlinked parent (`~/.config -> /etc`). | Patched locally: refuse symlink at `.bak`, `chown -h`, physical-path guard on the deepest existing ancestor when `id -u` is 0 and the path is lexically under the home. |
| F3 | Medium | node, python | Non-numeric `min-release-age` in `.npmrc` (e.g. `abc`): node reported `days: null` but `ok: true` and exit 0 (`--check` bypass) and `enable` would have written `NaN`; python raised `ValueError`. bash and powershell already reported null and failed. | Patched locally. New conformance cases `check_npm_non_numeric` and `enable_npm_non_numeric_replaced` pin the behavior across bash/node/python. |
| F4 | Low | node, python | `--doctor` reported `pmsecHomeSource: "PMSEC_HOME"` when the variable was set, though these ports ignore it and write to `HOME`. An operator would believe the redirection worked. | Patched locally: doctor always reports `HOME`, and a stderr warning is printed when `PMSEC_HOME` is set. Parity tracked in #183. |
| F5 | Infra | CI | `pull_request` on a self-hosted runner in a public repo. | Open: #182. |
| F6 | Low | powershell | `.bak` path was not checked for a reparse point; `Test-Path` on a dangling link is version-dependent and `Copy-Item` would write through a live one. | Patched locally (same guarantee as F2 for Windows). |

## Domain review: does what pmsec writes actually take effect? (2026-11-07)

The first pass above covered only how pmsec writes files. This pass checked
every key against the tool's current documentation and, where cheap, against
released binaries. Findings:

| ID | Severity | Ports | Issue | Status |
|---|---|---|---|---|
| F7 | High | all | Composer: pmsec wrote `config.minimum-release-age`. That key does not exist in any Composer release; Composer stores unknown config keys and ignores them, so `--check` passed while no cooldown was enforced. The real key is `config.policy.cooldown.period` (Composer 2.11.0, string `"N days"` or integer seconds). | Fixed in #185: writes the policy key, removes the dead one, adds a 2.11.0 preflight; conformance cases `check_composer_legacy_key_is_not_a_cooldown`, `enable_composer_replaces_legacy_key`, `check_composer_seconds_and_hours`. |
| F8 | High | all | uv: the preflight floor was 0.9.17 (relative `exclude-newer`), but the `[audit]` table pmsec also writes is rejected by uv 0.9.17 through 0.11.2 with a TOML parse error, which breaks every uv command on that machine. Verified against released binaries (0.11.2 fails, 0.11.3 accepts). | Fixed in #185: floor raised to 0.11.3, warning text says the whole file will not parse. |
| F9 | Medium | all | bun: pmsec always wrote `$HOME/.bunfig.toml`, but bun reads `$XDG_CONFIG_HOME/.bunfig.toml` *instead* when that variable is set. On such hosts (most Linux desktops, GitHub Actions) the written settings were inert and `--check` passed. | Fixed in #185. |
| F10 | Medium | all | npm: pmsec wrote `allow-git=root` and `allow-remote=root`. npm 12 defaults both to `none`, so the "hardening" loosened the default on the current major. | Fixed in #185: writes `none`; `root` now fails `--check`. |
| F11 | Low | all | Composer global config path: pmsec used `~/Library/Application Support/composer` on macOS and `~/.config/composer` on Linux. Composer uses neither rule: `COMPOSER_HOME`, else the first existing of `$XDG_CONFIG_HOME/composer` (only when any `XDG_*` variable is set or `/etc/xdg` exists) and `~/.composer`. On a default macOS install pmsec wrote a file Composer never reads. | Fixed in #185: mirrors `Factory::getHomeDir`. |
| F12 | Info | all | Several keys only restate current defaults (`allow-scripts-pin`, `dangerously-allow-all-scripts`, yarn `enableScripts` since 4.14, uv `index-strategy`, most mise verification flags, composer `secure-http` / `disable-tls`). They pin the default against a user-level change but add no new protection. `audit-level=high` only changes the `npm audit` exit code. | Documented in README; left in place as explicit pins. |

### Structural limits (not fixable in pmsec)

- **User-level config is the lowest-priority layer in every tool.** A
  repository file, an environment variable, or a CLI flag overrides each key
  pmsec writes. The single exception is mise `paranoid`, which mise refuses to
  read from project config. `pmsec --check` inspects the user-level file only
  and therefore reports OK while a cloned repo neutralises the baseline.
  Tracked as a feature request in #185 (project-scope check).
- **Lockfiles bypass cooldowns** in npm, yarn, bun, cargo, uv, bundler and
  composer. pnpm re-verifies unless `trustLockfile: true`. A poisoned lockfile
  in a cloned repo installs regardless of age.
- **Some install paths are not gated at all**: `cargo install`, `gem install`
  before RubyGems 4.1, `composer install`, `uv sync` with an existing lock,
  and any version whose registry metadata lacks a publish date.
- **Version detection gates correctness.** pnpm 11 ignores the INI `rc`
  file; pmsec writes both files but `--check` reads the `rc` file when
  `pnpm` is not on `PATH`, which can report OK for a file pnpm 11 ignores
  (#187). yarn 4.10.x mis-parsed the `d` suffix in `npmMinimalAgeGate`
  (yarnpkg/berry#6991); pmsec's floor is 4.10.0 (#186).

## Accepted risks

- `.bak` keeps a copy of registry tokens that were in the file at first write.
  It is created 0600 and never refreshed, so it can hold a token the user has
  since rotated out of the live file. `--disable` does not remove it.
  Rationale: the backup is the only recovery path for a config pmsec rewrote.
  Users who rotate tokens should delete `*.bak` themselves.
- Version preflight executes tools from `PATH` (boundary C).
- PowerShell `--doctor` creates and deletes a sentinel file to probe
  writability. Not strictly read-only.
- JSON output escapers do not escape control characters below 0x20 in
  values. A config file containing them produces invalid JSON in `--json`
  output. Robustness, not a security boundary: the reader is the user who
  owns the file.
- Temporary files use `O_EXCL` / `mktemp` with 0600 and are renamed into place.

## What is deliberately out of scope

- Protecting a user from themselves (boundary A).
- Detecting a compromised package manager binary (boundary C).
- The security of the package registries' own cooldown enforcement. pmsec
  only sets the client-side knob.

## Review checklist for future changes

Any change to a write path in any port must keep:

- symlink refusal at the target and at `.bak`,
- atomic replace via a 0600 temp file in the same directory,
- no privilege escalation and no network,
- identical observable behavior across ports, pinned by a conformance case.
