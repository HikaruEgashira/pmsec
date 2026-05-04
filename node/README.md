# pmsec (Node)

Cross-platform CLI that inspects and applies install-time cooldown settings
(npm `min-release-age`, pnpm `minimum-release-age`, yarn `npmMinimalAgeGate`,
bun `minimumReleaseAge`, cargo `minimum-release-age`, mise `minimum_release_age`,
uv `exclude-newer`) so freshly-published, possibly-malicious packages can't
land in your machine within hours of upload.

## Install

```bash
npx pmsec check --min 7
npx pmsec set 7
npx pmsec unset
```

```bash
uvx pmsec check --min 7
uvx pmsec set 7
uvx pmsec unset
```

If your environment already enforces cooldown (or routes through a proxy
registry), bootstrap pmsec by overriding just for that call:

```bash
npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec check
uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec check
```

Zero-config install-time supply-chain hardening (cooldown + audit-level + trust-policy + …) across npm, pnpm, yarn, bun, cargo, mise, uv. Zero runtime dependencies, ESM, requires Node 22+.

## Commands

| Command | Description |
| --- | --- |
| `pmsec check [--min N]` | Read each tool's config; exit 1 if any tool is below `N` days or unset. |
| `pmsec set <DAYS>` | Write `DAYS`-day cooldown to every selected tool. Always proceeds; if the runtime is too old to honor the key, prints a `⚠` line under the success line. |
| `pmsec unset` | Remove only the cooldown key from each config (other keys preserved). |
| `pmsec --version` | Print the installed pmsec version. |

Options: `--tool npm,pnpm,yarn,bun,cargo,mise,uv`, `--json`.

When the target file is owned by another user (typical: `~/.npmrc` left
root-owned by an old `sudo npm config set`), the write fails with `EACCES`
and pmsec prints the exact `chown` command needed to restore ownership —
re-run after applying it. pmsec never escalates privileges itself.

See the [project README](https://github.com/HikaruEgashira/pmsec) for the
full table of keys, units, paths, and environment overrides.

## License

MIT
