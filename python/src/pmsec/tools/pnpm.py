from __future__ import annotations

from pathlib import Path

from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import npmrc_path
from pmsec.util.version import detect_version, gte

NAME = "pnpm"
KEY = "minimum-release-age"
DOCS = "https://pnpm.io/settings#minimumreleaseage"
MIN_BIN = (10, 6, 0)


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return npmrc_path(env, home)


def preflight() -> dict:
    v = detect_version("pnpm")
    if v is None:
        return {"ok": True, "message": None}
    if gte(v, MIN_BIN):
        return {"ok": True, "version": v[3], "message": None}
    msg = (
        f"pnpm {v[3]} < {'.'.join(str(n) for n in MIN_BIN)}: "
        "minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown."
    )
    return {"ok": True, "warn": True, "version": v[3], "message": msg}


def read(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY)
    minutes = None
    if value is not None:
        try:
            minutes = int(value)
        except ValueError:
            minutes = None
    days = None if minutes is None else minutes // (60 * 24)
    return {"path": str(p), "configured": value, "days": days}


def write(days: int, env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    before = p.read_text("utf-8") if p.exists() else ""
    after = set_key(before, KEY, f"{KEY}={days * 24 * 60}")
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
