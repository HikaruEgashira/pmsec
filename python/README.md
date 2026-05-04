# pmsec (Python)

Zero-config install-time supply-chain hardening for npm, pnpm, yarn, bun,
cargo, mise, and uv. One command flips on every safe-by-default knob each
package manager exposes — install cooldown, signature trust policy, lockfile
re-verification, build-script attestation, and more.

## Install

```bash
uvx pmsec enable
uvx pmsec check
uvx pmsec disable
```

```bash
npx pmsec enable
npx pmsec check
npx pmsec disable
```

If your environment already enforces cooldown (or routes through a proxy
index), bootstrap pmsec by overriding just for that call:

```bash
uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec check
npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec check
```

## Supported tools

npm, pnpm, yarn 4+, bun, cargo (RFC #3801), mise, uv

## Commands

| Command | Description |
| --- | --- |
| `pmsec enable` | Write the hardening bundle (3-day cooldown + per-tool extras) to every selected tool's user config |
| `pmsec check` | Read each tool's config; exit 1 if any row is missing or below the bundled value |
| `pmsec disable` | Remove every key the bundle set; other keys in the file are preserved |
| `pmsec --version` | Print the installed pmsec version |

Options: `--tool npm,pnpm,yarn,bun,cargo,mise,uv`, `--days N` (override the 3-day default), `--force` (overwrite stricter existing cooldowns; default is monotonic), `--json`.

See the [project README](https://github.com/HikaruEgashira/pmsec) for the full
table of keys, units, paths, and overrides.

## License

MIT
