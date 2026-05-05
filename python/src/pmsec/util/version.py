from __future__ import annotations

import re
import subprocess


def _parse(s: str | None) -> tuple[int, int, int, str] | None:
    if not s:
        return None
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", s)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(0)


# `env[override_key]` ("X.Y.Z" or "none") forces the result without spawning the
# real binary — used by tests to make pnpm 11 default-enforcement behavior
# deterministic regardless of what's installed locally.
def detect_version(
    bin_name: str,
    args: list[str] | None = None,
    *,
    env: dict[str, str] | None = None,
    override_key: str | None = None,
) -> tuple[int, int, int, str] | None:
    if env is not None and override_key:
        o = env.get(override_key)
        if o == "none":
            return None
        if o:
            p = _parse(o)
            if p is not None:
                return p
    args = args or ["--version"]
    try:
        out = subprocess.run([bin_name, *args], capture_output=True, text=True, timeout=5)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    return _parse(out.stdout)


def gte(v: tuple[int, int, int, str] | None, target: tuple[int, int, int]) -> bool | None:
    if v is None:
        return None
    if v[0] != target[0]:
        return v[0] > target[0]
    if v[1] != target[1]:
        return v[1] > target[1]
    return v[2] >= target[2]


def build_preflight(name: str, min_bin: tuple[int, int, int], suffix: str):
    # ctx is accepted for signature uniformity with pnpm.preflight; this
    # helper detects against the local PATH and ignores ctx.
    def _pf(_ctx=None) -> dict:
        v = detect_version(name)
        if v is None:
            return {"ok": True, "message": None}
        if gte(v, min_bin):
            return {"ok": True, "version": v[3], "message": None}
        return {
            "ok": True, "warn": True, "version": v[3],
            "message": f"{name} {v[3]} < {'.'.join(str(n) for n in min_bin)}: {suffix}",
        }
    return _pf
