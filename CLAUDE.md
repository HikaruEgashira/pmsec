## Core invariants

- `pmsec` is one CLI implemented in four ports: `node/`, `python/`, `bash/`, `powershell/`.
- User-visible behavior stays aligned across ports: commands, flags, JSON shape, exit codes, and file edits.
- The conformance suite is the contract. When behavior changes, update the affected ports and `conformance/` in the same change.
- `powershell/` is the only intentional exception: it is Windows-only, also configures WSL distros, and may expose Windows-scope features such as `--no-wsl` and multi-scope output.

## Change rules

- Treat the root `README.md` as the user-facing source of truth. If a public capability changes, update it in the same change.
- `pmsec` only edits user-global tool config. Never write project-local config as part of normal commands.
- Config writes must remain atomic so an interrupted run does not leave partial files.
- Adding or removing a supported tool is a cross-repo change: keep all ports, tests, and docs consistent.

## Release rule

- Releases are automation-owned. Do not publish packages or push release tags from a local clone.
