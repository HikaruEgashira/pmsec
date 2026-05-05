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
