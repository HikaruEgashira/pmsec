# pmsec (Python)

`pmsec` is a cross-platform CLI that inspects and applies install-time cooldown
settings (e.g. npm `min-release-age`, uv `exclude-newer`) to mitigate
supply-chain attacks where malicious packages are typically detected and
removed within hours to days of publication.

## Install

```bash
uvx pmsec check --min 7
uvx pmsec set 7
uvx pmsec unset
```

## Supported tools

npm, pnpm, yarn 4+, bun, cargo (RFC #3801), mise, uv

## Commands

| Command | Description |
| --- | --- |
| `pmsec check [--min N]` | Read each tool's config; exit 1 if any tool is below `N` days or unset |
| `pmsec set <DAYS> [--force]` | Write `DAYS`-day cooldown to every selected tool |
| `pmsec unset` | Remove only the cooldown key from each config (other keys preserved) |

Options: `--tool npm,pnpm,yarn,bun,cargo,mise,uv`, `--json`.

See the [project README](https://github.com/HikaruEgashira/pmsec) for the full
table of keys, units, paths, and overrides.

## License

MIT
