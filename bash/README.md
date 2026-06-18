# pmsec (bash)

Single-file bash 3.2+ port for hosts without npm, uv, or python.

```bash
# Production: pin main to a commit SHA.
curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/bash/pmsec \
  -o /usr/local/bin/pmsec && chmod +x /usr/local/bin/pmsec

pmsec
pmsec --check
pmsec --disable
```

```
pmsec            [--tool TOOL[,TOOL]] [--days N] [--force] [--json]
pmsec --check    [--tool TOOL[,TOOL]] [--days N] [--json]
pmsec --disable  [--tool TOOL[,TOOL]] [--json]
pmsec --doctor   [--tool TOOL[,TOOL]] [--json]
pmsec --version
```

Supported tools and policy values match the root README.

## Root-Orchestrated Runs

`pmsec` writes per-user config. Under `root`, set `PMSEC_HOME` to the target
profile; files created by root are chowned back to that owner.

```bash
loggedInUser=$(stat -f%Su /dev/console)
loggedInHome=$(dscl . -read "/Users/$loggedInUser" NFSHomeDirectory | awk '{print $2}')

PMSEC_HOME="$loggedInHome" /usr/local/bin/pmsec
PMSEC_HOME="$loggedInHome" /usr/local/bin/pmsec --check
```

Read-only diagnostics:

```bash
PMSEC_HOME="$loggedInHome" /usr/local/bin/pmsec --doctor --json
```

`--doctor` reports effective ids, home paths, target config paths, ownership,
and parent writability. Tagged `write_atomic` failures identify the failing
step: `mkdir`, `mktemp`, `body-write`, or `rename`.

## Environment

| Variable | Effect |
| --- | --- |
| `PMSEC_HOME` | Home dir to operate on. |
| `NPM_CONFIG_USERCONFIG` | npm/pnpm config path. |
| `YARN_RC_FILENAME` | yarn config path. |
| `BUN_CONFIG_FILE` | bun config path. |
| `CARGO_HOME` | cargo home; writes `$CARGO_HOME/config.toml`. |
| `MISE_GLOBAL_CONFIG_FILE` | mise config path. |
| `UV_CONFIG_FILE` | uv config path. |
| `AUBE_CONFIG_FILE` | aube config path. |
| `XDG_CONFIG_HOME` | XDG root for mise, uv, and aube. |

## Tests

```bash
bash test/test.sh
```
