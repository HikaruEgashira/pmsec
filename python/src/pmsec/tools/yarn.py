from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import yarnrc_path
from pmsec.util.version import detect_version, gte

NAME = "yarn"
KEY = "npmMinimalAgeGate"
DOCS = "https://yarnpkg.com/configuration/yarnrc#npmMinimalAgeGate"
MIN_BIN = (4, 10, 0)
SEP = ":"

_DURATION = re.compile(r'^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$', re.IGNORECASE)


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return yarnrc_path(env, home)


def preflight() -> dict:
    v = detect_version("yarn")
    if v is None:
        return {"ok": True, "message": None}
    if gte(v, MIN_BIN):
        return {"ok": True, "version": v[3], "message": None}
    msg = (
        f"yarn {v[3]} < {'.'.join(str(n) for n in MIN_BIN)}: "
        "npmMinimalAgeGate is silently ignored. Upgrade yarn (v4.10+) to enforce the cooldown."
    )
    return {"ok": True, "warn": True, "version": v[3], "message": msg}


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = _DURATION.match(value)
    if not m:
        return None
    n = int(m.group(1))
    return n * 7 if m.group(2).lower() in ("w", "week", "weeks") else n


def read(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, sep=SEP)
    return {"path": str(p), "configured": value, "days": _parse_days(value)}


def write(days: int, env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    before = p.read_text("utf-8") if p.exists() else ""
    after = set_key(before, KEY, f'{KEY}: "{days}d"', sep=SEP)
    write_atomic(p, after)
    return {"path": str(p), "before": before, "after": after}


def unset(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed = remove_key(before, KEY, sep=SEP)
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
