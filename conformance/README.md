# Conformance suite

Cross-implementation tests that drive each pmsec port (bash, node, python,
powershell) through the same declarative cases and assert byte-identical
behavior.

## Why this exists

CLAUDE.md requires the four implementations to stay in lock-step. Per-port
test suites cannot enforce that contract — drift slips through whenever a
suite is silent about a field, or asserts the same loose pattern that the
other suites do. This suite makes the contract executable: one case, one
expected JSON, one shape every port must produce.

## Layout

```
conformance/
├── run.py            # driver (Python ≥ 3.10, no deps)
└── cases/
    └── *.json        # declarative cases
```

Case schema:

```json
{
  "setup":         { "<rel-path>": "<file body>" },
  "pre":           [ ["pmsec", "args"], ... ],
  "args":          ["pmsec", "args"],
  "expected_exit": 0,
  "expected_json": { ... }
}
```

`<HOME>` in `expected_json` is replaced by the per-case temp dir before
comparison, so cases stay portable across runners.

## Running locally

```sh
python3 conformance/run.py --impl bash
python3 conformance/run.py --impl node
PYTHONPATH=python/src python3 conformance/run.py --impl python
pwsh    -NoProfile -Command "python3 conformance/run.py --impl powershell"
```

Add `--case <stem>` to run a single case (without the `.json` suffix).

## Adding a case

1. Drop a `cases/<name>.json` file describing setup, args, and expected JSON.
2. Run the four impls locally; if any port disagrees, fix the port — the
   case is the contract.
3. Commit the case alongside any port changes that satisfy it.
