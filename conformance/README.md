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
  "setup": { "<rel-path>": "<file body>" },
  "pre": [["pmsec", "args"]],
  "args": ["pmsec", "args"],
  "expected_exit": 0,
  "expected_json": {}
}
```

`<HOME>` in `expected_json` is replaced with the case temp dir.

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
