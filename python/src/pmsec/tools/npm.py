from __future__ import annotations

from pathlib import Path

from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import npmrc_path
from pmsec.util.version import detect_version, gte

NAME = "npm"
KEY = "min-release-age"
DOCS = "https://docs.npmjs.com/cli/v11/using-npm/config#min-release-age"
MIN_BIN = (11, 10, 0)


def preflight() -> dict:
    v = detect_version("npm")
    if v is None:
        return {"ok": True, "message": None}
    if gte(v, MIN_BIN):
        return {"ok": True, "version": v[3], "message": None}
    msg = (
        f"npm {v[3]} < {'.'.join(str(n) for n in MIN_BIN)}: "
        "min-release-age is silently ignored. Upgrade npm to enforce the cooldown."
    )
    return {"ok": True, "warn": True, "version": v[3], "message": msg}


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return npmrc_path(env, home)


def read(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY)
    days = None if value is None else int(value)
    return {"path": str(p), "configured": value, "days": days}


def write(days: int, env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    before = p.read_text("utf-8") if p.exists() else ""
    after = set_key(before, KEY, f"{KEY}={days}")
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
