# Conformance suite

Executable contract for bash, node, python, and powershell behavior.

```
conformance/
├── run.py
└── cases/*.json
```

Case shape:

```json
{
  "impls": ["bash", "node", "python"],
  "env": { "PMSEC_PNPM_VERSION": "11.0.0", "PMSEC_HOME": "<HOME>" },
  "setup": { "<rel-path>": "<file body>" },
  "pre": [["pmsec", "args"]],
  "args": ["pmsec", "args"],
  "expected_exit": 0,
  "expected_json": {},
  "expected_files": { "<rel-path>": "<exact file body after run>" },
  "expected_absent": ["<rel-path that must not exist after run>"]
}
```

Optional `env` entries override the runner defaults for both `pre` and the
asserted invocation; `<HOME>` in their values expands to the case temp dir.
`<HOME>` in `expected_json` is replaced with the case temp dir. Optional
`impls` limits a case to the listed ports (default: all four); use it only for
intentional port differences such as the powershell scope model.

## Run

```sh
python3 conformance/run.py --impl bash
python3 conformance/run.py --impl node
PYTHONPATH=python/src python3 conformance/run.py --impl python
pwsh -NoProfile -Command "python3 conformance/run.py --impl powershell"
```

Use `--case <stem>` for one case.

## Add a Case

1. Add `cases/<name>.json`.
2. Run every implementation.
3. Fix the port, not the assertion, when behavior disagrees.
