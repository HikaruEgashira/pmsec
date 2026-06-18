# pmsec (Python)

Python CLI for the same pmsec contract as the root project.

```bash
uvx pmsec
uvx pmsec --check
uvx pmsec --disable
```

Bootstrap through indexes that already enforce cooldowns:

```bash
uvx --index https://pypi.org/simple --exclude-newer-package pmsec=2099-01-01 pmsec --check
npx --registry=https://registry.npmjs.org/ --min-release-age=0 pmsec --check
```

## Usage

| Command | Result |
| --- | --- |
| `pmsec` | Writes the hardening bundle. |
| `pmsec --check` | Exits 1 when any selected tool is below policy. |
| `pmsec --disable` | Removes pmsec-managed keys only. |
| `pmsec --doctor` | Prints read-only path, ownership, and writability diagnostics. |
| `pmsec --version` | Prints the version. |

Options: `--tool npm,pnpm,yarn,bun,cargo,mise,uv,bundler,aube`, `--days N`,
`--force`, `--json`.

See the root README for the full key table.

## License

MIT
