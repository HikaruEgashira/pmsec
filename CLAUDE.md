## Repository layout

`pmsec` ships the same CLI from four implementations that must stay in lock-step:

- `node/` — published as `pmsec` on npm, ESM, zero runtime deps, Node ≥ 22.
- `python/` — published as `pmsec` on PyPI, hatchling build, Python ≥ 3.10.
- `bash/` — single-file `pmsec` script for unix-like environments without npm/uv/python; bash 3.2+ and coreutils only. Distributed by raw download.
- `powershell/` — single-file `pmsec.ps1` script for Windows hosts. Targets Windows PowerShell 5.1 and PowerShell 7+. **Windows-only**: the script also reaches into every installed WSL distro via `\\wsl$\<distro>\...` and applies the same hardening inside each (skip with `--no-wsl` / `PMSEC_NO_WSL=1`). Non-Windows pwsh (macOS / native Linux) is not supported. Distributed by raw download.

The public surface (`pmsec enable | check | disable`, `--tool`, `--days N`, `--json`, exit codes, output format) is **mirrored** across all four. When changing CLI behavior, update every implementation and every test suite in the same change. The PowerShell port additionally accepts `--no-wsl` and emits `[<scope>]` headers / `scope` JSON fields when more than one scope is targeted — these are powershell-specific extensions and need not be ported.

## Release workflow

Releases are **fully automated**: every push to `main` that passes CI triggers a release. No manual version bumping or dispatch is required.

1. Push to `main` (directly or via PR merge).
2. `pmsec ci` runs the full test matrix.
3. On success, `pmsec release` (`workflow_run` trigger) auto-increments the patch version from the latest `pmsec-node-v*` tag, runs `scripts/bump.sh` to update all five version declarations (`node/package.json`, `python/pyproject.toml`, `python/uv.lock`, `bash/pmsec`, `powershell/pmsec.ps1`), commits, tags (`pmsec-node-v*` / `pmsec-py-v*`), pushes, and dispatches the npm / PyPI publish workflows.

The version bump commit is pushed with `GITHUB_TOKEN`, which does not re-trigger workflows, so no release loop occurs. The publish workflows reject any dispatch whose actor is not `github-actions[bot]`, so direct manual dispatch cannot publish. Do not push release tags from a local clone, or `npm publish` / `uv publish` locally. A `workflow_dispatch` trigger is available on `pmsec-release.yml` as an emergency re-run mechanism. The bash and PowerShell ports have no registry; users `curl` / `Invoke-WebRequest` the script from a tagged GitHub raw URL.

For major or minor version bumps, run `bash scripts/bump.sh <ver>` manually before pushing — the release workflow detects that the in-tree version already exceeds the latest tag and uses it as-is.

## Architecture

The node and python implementations share the same shape:

```
cli.(mjs|py)            # arg parsing, command dispatch, human/JSON rendering, fs-error explainer
tools/<tool>.(mjs|py)   # one module per package manager, exports name/key + read/write/unset/preflight
util/paths               # per-tool config file location (env override → XDG/APPDATA → $HOME)
util/lines               # key=value editing for `.npmrc`-style files
util/io                  # atomic write (tmpfile + rename)
util/version             # `<tool> --version` parsing + semver comparison for preflight gating
```

The bash and PowerShell implementations collapse the same shape into one self-contained script each (`bash/pmsec`, `powershell/pmsec.ps1`) — sectioned with banner comments matching `paths`, `lines`, `io`, `version`, `tools`, and `cli` — to keep raw-download distribution viable. Tests live in `bash/test/test.sh` and `powershell/test/test.ps1`.

Adding a new package manager means: (1) add a `tools/<tool>` module on **all four** sides exporting the same shape, (2) register it in the `TOOLS` array (`cli.(mjs|py)`, top of `bash/pmsec`, top of `powershell/pmsec.ps1`), (3) add coverage in every test suite, (4) document the key/path in the root `README.md`.

### Per-tool module contract

Node (`tools/*.mjs`) exports: `name`, `key`, `docs`, `minBin`, `path(ctx)`, `read(ctx)`, `write(days, ctx)`, `unset(ctx)`, optional `preflight(ctx)`. `ctx` is `{ env, home, platform }` constructed once in `cli.mjs` and threaded through every call.

Python (`tools/*.py`) exposes the same as module-level: `NAME`, `KEY`, `DOCS`, `MIN_BIN`, `path(ctx)`, `read(ctx)`, `write(days, ctx)`, `unset(ctx)`, optional `preflight(ctx)`. `ctx` is `pmsec.util.context.Context` (frozen dataclass with `env`, `home`, `platform`). Functions return plain dicts (`{path, configured, days}` etc.) so `cli.py` can treat all tools uniformly.

Bash exposes per-tool metadata via the `tool_path`, `tool_key`, `tool_section`, `tool_sep`, `tool_read`, `tool_write`, `tool_unset`, `tool_preflight` dispatchers in `bash/pmsec` — adding a tool means extending each dispatcher's `case` plus a `path_<tool>` helper.

PowerShell mirrors that with `ToolPath`, `ToolKey`, `ToolSection`, `ToolSep`, `ToolRead`, `ToolWrite`, `ToolUnset`, `ToolPreflight` dispatchers and `Get-<Tool>Path` helpers in `powershell/pmsec.ps1`.

`read` / `write` / `unset` always operate on the user's global config file. They never mutate project-local configs. Writes go through `writeAtomic` / `write_atomic` (write to sibling tmpfile, rename) so a crash never leaves a partial config.
