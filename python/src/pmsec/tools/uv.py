from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import uv_config_path
from pmsec.util.version import detect_version, gte

NAME = "uv"
KEY = "exclude-newer"
DOCS = "https://docs.astral.sh/uv/reference/settings/#exclude-newer"
MIN_BIN = (0, 9, 17)


def preflight() -> dict:
    v = detect_version("uv")
    if v is None:
        return {"ok": True, "message": None}
    if gte(v, MIN_BIN):
        return {"ok": True, "version": v[3], "message": None}
    msg = (
        f"uv {v[3]} < {'.'.join(str(n) for n in MIN_BIN)}: writing "
        f'exclude-newer = "N days" will break this uv until you `uv self update` '
        "(file will fail to parse)."
    )
    return {"ok": True, "warn": True, "version": v[3], "message": msg}

_DURATION = re.compile(r'^"\s*(\d+)\s*(day|days|d|week|weeks|w)\s*"$', re.IGNORECASE)


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return uv_config_path(env, home, platform)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = _DURATION.match(value)
    if not m:
        return None
    n = int(m.group(1))
    return n * 7 if m.group(2).lower() in ("week", "weeks", "w") else n


def read(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY)
    return {"path": str(p), "configured": value, "days": _parse_days(value)}


def write(days: int, env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    before = p.read_text("utf-8") if p.exists() else ""
    after = set_key(before, KEY, f'{KEY} = "{days} days"')
    write_atomic(p, after)
    return {"path": str(p), "before": before, "after": after}


def unset(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed = remove_key(before, KEY)
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
