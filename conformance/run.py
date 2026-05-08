#!/usr/bin/env python3
"""Cross-implementation conformance runner.

Drives one of the four pmsec implementations (bash, node, python, powershell)
through every case in conformance/cases/*.json and asserts that the resulting
JSON output, exit code, and on-disk file shape match the declared expectations.

Because every case is a single source of truth, a passing run on each impl
proves byte-equivalent behavior across the four ports — the lock-step mandate
in CLAUDE.md is enforced by tests instead of by review discipline.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CASES_DIR = Path(__file__).resolve().parent / "cases"


def build_cmd(impl: str, args: list[str]) -> list[str]:
    if impl == "bash":
        return ["bash", str(REPO / "bash" / "pmsec"), *args]
    if impl == "node":
        return ["node", str(REPO / "node" / "bin" / "cli.mjs"), *args]
    if impl == "python":
        return [sys.executable, "-m", "pmsec", *args]
    if impl == "powershell":
        return ["pwsh", "-NoProfile", "-File", str(REPO / "powershell" / "pmsec.ps1"), *args]
    raise SystemExit(f"unknown impl: {impl}")


def env_for(impl: str, home: Path) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "PMSEC_PNPM_VERSION": "none",
    }
    if impl == "python":
        env["PYTHONPATH"] = str(REPO / "python" / "src")
    if impl == "powershell":
        env["PMSEC_FAKE_SCOPES"] = f"test|{home}|linux"
    return env


def normalize(obj, home: Path):
    """Replace tmpdir paths with the literal token <HOME> so cases are portable."""
    home_s = str(home)
    if isinstance(obj, str):
        return obj.replace(home_s, "<HOME>")
    if isinstance(obj, list):
        return [normalize(v, home) for v in obj]
    if isinstance(obj, dict):
        return {k: normalize(v, home) for k, v in obj.items()}
    return obj


def run_case(impl: str, case_path: Path) -> tuple[bool, str]:
    case = json.loads(case_path.read_text())
    home = Path(tempfile.mkdtemp(prefix="pmsec-conf-"))
    try:
        for rel, body in case.get("setup", {}).items():
            target = home / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body)
        for step in case.get("pre", []):
            subprocess.run(build_cmd(impl, step), env=env_for(impl, home), cwd=REPO, check=False, capture_output=True)
        proc = subprocess.run(
            build_cmd(impl, case["args"]),
            env=env_for(impl, home), cwd=REPO, capture_output=True, text=True,
        )
        if proc.returncode != case.get("expected_exit", 0):
            return False, f"exit {proc.returncode} != expected {case.get('expected_exit', 0)}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        # uv prints a single-line resolution notice on first run; strip leading
        # non-JSON noise before parsing.
        stdout = proc.stdout
        m = re.search(r"[\{\[]", stdout)
        if not m:
            return False, f"no JSON found in stdout:\n{stdout}"
        try:
            actual = json.loads(stdout[m.start():])
        except json.JSONDecodeError as e:
            return False, f"invalid JSON: {e}\n{stdout}"
        actual_norm = normalize(actual, home)
        expected = case["expected_json"]
        if actual_norm != expected:
            return False, "JSON mismatch:\n  expected: " + json.dumps(expected, sort_keys=True) + "\n  actual:   " + json.dumps(actual_norm, sort_keys=True)
        return True, ""
    finally:
        shutil.rmtree(home, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--impl", required=True, choices=["bash", "node", "python", "powershell"])
    ap.add_argument("--case", help="run only the named case (without .json)")
    args = ap.parse_args()
    cases = sorted(CASES_DIR.glob("*.json"))
    if args.case:
        cases = [c for c in cases if c.stem == args.case]
        if not cases:
            print(f"no case named {args.case}", file=sys.stderr)
            return 2
    failed = 0
    for case in cases:
        ok, msg = run_case(args.impl, case)
        status = "PASS" if ok else "FAIL"
        print(f"[{args.impl:10s}] {status} {case.stem}")
        if not ok:
            print(msg)
            failed += 1
    print(f"\n{len(cases) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
