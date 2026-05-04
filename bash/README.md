# pmsec (bash)

Single-file bash port of [pmsec](https://github.com/HikaruEgashira/pmsec) for
environments where you do not have npm, uv, or python — only bash 3.2+ and
coreutils.

```bash
curl -fsSL https://raw.githubusercontent.com/HikaruEgashira/pmsec/main/bash/pmsec \
  -o /usr/local/bin/pmsec && chmod +x /usr/local/bin/pmsec

pmsec check --min 7
pmsec set 7
pmsec unset
```

The CLI surface is identical to the npm and PyPI distributions:

```
pmsec check [--tool TOOL[,TOOL]] [--min DAYS] [--json]
pmsec set <DAYS>  [--tool TOOL[,TOOL]] [--json]
pmsec unset       [--tool TOOL[,TOOL]] [--json]
pmsec --version
```

Supported tools, files, and units match the root `README.md`.

## Tests

```
bash test/test.sh
```

Each test runs `pmsec` under `env -i` against a throw-away `$HOME`, then diffs
the resulting on-disk config against the same expected bytes the node and
python suites verify.
