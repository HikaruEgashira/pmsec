# pmsec (bash)

Single-file bash port of [pmsec](https://github.com/HikaruEgashira/pmsec) for
environments where you do not have npm, uv, or python — only bash 3.2+ and
coreutils.

```bash
# Production: replace `main` with a commit SHA so rollouts are reproducible.
curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/bash/pmsec \
  -o /usr/local/bin/pmsec && chmod +x /usr/local/bin/pmsec

pmsec
pmsec --check
pmsec --disable
```

The CLI surface is identical to the npm and PyPI distributions:

```
pmsec            [--tool TOOL[,TOOL]] [--days N] [--force] [--json]
pmsec --check    [--tool TOOL[,TOOL]] [--days N] [--json]
pmsec --disable  [--tool TOOL[,TOOL]] [--json]
pmsec --version
```

Supported tools, files, and units match the root `README.md`.

## MDM deployment (Jamf, Ansible, ...)

`pmsec` writes per-user config files. When a Jamf policy runs as `root`, the
default `$HOME` is `/var/root`, not the logged-in user's home — so vanilla
`pmsec enable` would write configs no one will ever load.

Set `PMSEC_HOME` to redirect every per-tool path at the real user's home in
one shot. When pmsec runs as root, it also chowns the resulting files (and
any directories it created) back to that home's owner so the user can read
and edit them afterwards.

```bash
#!/usr/bin/env bash
# Jamf policy script (runs as root).
set -eu
loggedInUser=$(stat -f%Su /dev/console)
loggedInHome=$(dscl . -read "/Users/$loggedInUser" NFSHomeDirectory | awk '{print $2}')

PMSEC_HOME="$loggedInHome" /usr/local/bin/pmsec
PMSEC_HOME="$loggedInHome" /usr/local/bin/pmsec --check
```

`pmsec --check` exits `0` when every tool is at or above `--days` (default 1)
and every hardening extra is at the safe value, `1` otherwise — usable as a
Jamf Extension Attribute or Ansible `assert`.

### Debugging an MDM-side failure

When an enable run from Jamf / Ansible reports nothing visible to the user,
run the read-only diagnostic and inspect the output:

```bash
PMSEC_HOME="$loggedInHome" /usr/local/bin/pmsec --doctor --json
```

The JSON includes effective `uid`, `home`, `pmsecHome`, and per-tool
`{path, parent, exists, writable, parentExists, parentWritable, owner}`.
`ok: false` means at least one parent directory is not writable — the
common Jamf failure mode is `PMSEC_HOME` unset under `root`, which lands
configs in `/var/root` instead of the user's profile.

If `pmsec` still fails after `doctor` reports `ok: true`, the actual write
errors are now tagged: stderr lines begin with `pmsec: write_atomic <step>
failed for <path>: <reason>` (`mkdir`, `mktemp`, `body-write`, or
`rename`). `EACCES` failures additionally surface a `Check file ownership:
ls -la …` hint identifying the file to chown back to the user.

`chown` failures during the post-write hand-back (SIP, SELinux, TCC, NFS
mounts that don't honor ownership) are surfaced as
`pmsec: warning: chown <user> <path> failed (...)` — exit code stays `0`
because the bundle is in place, but the warning means the resulting file
is still root-owned and the user cannot edit it.

## Environment overrides

| variable | effect |
|----------|--------|
| `PMSEC_HOME` | Home dir to operate on (overrides `$HOME`). Files written as root are chowned back to this dir's owner. |
| `NPM_CONFIG_USERCONFIG` | Override the npm/pnpm config file path. |
| `YARN_RC_FILENAME` | Override the yarn config file path. |
| `BUN_CONFIG_FILE` | Override the bun config file path. |
| `CARGO_HOME` | Override the cargo dir; pmsec writes `$CARGO_HOME/config.toml`. |
| `MISE_GLOBAL_CONFIG_FILE` | Override the mise config file path. |
| `UV_CONFIG_FILE` | Override the uv config file path. |
| `XDG_CONFIG_HOME` | Override the XDG config root (affects mise, uv on linux/mac). |

## Tests

```
bash test/test.sh
```

Each test runs `pmsec` under `env -i` against a throw-away `$HOME`, then diffs
the resulting on-disk config against the same expected bytes the node and
python suites verify.
