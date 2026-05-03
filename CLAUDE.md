## Repository layout

`pmsec` ships the same CLI from two implementations that must stay in lock-step:

- `node/` — published as `@hikae/pmsec` on npm, ESM, zero runtime deps, Node ≥ 20.
- `python/` — published as `pmsec` on PyPI, hatchling build, Python ≥ 3.10.

The public surface (`pmsec check | set <DAYS> | unset`, `--tool`, `--json`, `--min`, exit codes, output format) is **mirrored** between the two. When changing CLI behavior, update both implementations and both test suites in the same change.

## Release workflow

Both packages use **trusted publishing via tag push**. Do not `npm publish` / `uv publish` locally.

## Architecture

Both implementations share the same shape:

```
cli.(mjs|py)            # arg parsing, command dispatch, human/JSON rendering, fs-error explainer
tools/<tool>.(mjs|py)   # one module per package manager, exports name/key + read/write/unset/preflight
util/paths               # per-tool config file location (env override → XDG/APPDATA → $HOME)
util/lines               # key=value editing for `.npmrc`-style files
util/io                  # atomic write (tmpfile + rename)
util/version             # `<tool> --version` parsing + semver comparison for preflight gating
```

Adding a new package manager means: (1) add a `tools/<tool>` module on **both** sides exporting the same shape, (2) register it in the `TOOLS` array in `cli.(mjs|py)`, (3) add coverage in both test suites, (4) document the key/path in the root `README.md`.

### Per-tool module contract

Node (`tools/*.mjs`) exports: `name`, `key`, `docs`, `minBin`, `path(env, home, platform?)`, `read(...)`, `write(days, ...)`, `unset(...)`, optional `preflight()`.

Python (`tools/*.py`) exposes the same as module-level: `NAME`, `KEY`, `DOCS`, `MIN_BIN`, `path()`, `read()`, `write()`, `unset()`, optional `preflight()`. Functions return plain dicts (`{path, configured, days}` etc.) so `cli.py` can treat all tools uniformly.

`read` / `write` / `unset` always operate on the user's global config file. They never mutate project-local configs. Writes go through `writeAtomic` / `write_atomic` (write to sibling tmpfile, rename) so a crash never leaves a partial config.
