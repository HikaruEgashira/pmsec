from __future__ import annotations

from pathlib import Path

from pmsec.util.extras import apply_extras, read_extras, remove_extras
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import pnpm_rc_path
from pmsec.util.version import detect_version, gte

NAME = "pnpm"
KEY = "minimum-release-age"
DOCS = "https://pnpm.io/settings#minimumreleaseage"
MIN_BIN = (10, 6, 0)
# `default_since_major`: pnpm major version where the value became the default.
# When detected, an absent line in the rc file is still effectively in force,
# so `read()` reports it as ok with `defaultEnforced: True`.
EXTRAS = [
    {"key": "trust-policy", "expected": "no-downgrade", "line": "trust-policy=no-downgrade"},
    {"key": "block-exotic-subdeps", "expected": "true", "line": "block-exotic-subdeps=true", "default_since_major": 11},
    {"key": "strict-dep-builds", "expected": "true", "line": "strict-dep-builds=true"},
]


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return pnpm_rc_path(env, home, platform)


def _pnpm_version(env: dict[str, str] | None):
    return detect_version("pnpm", env=env, override_key="PMSEC_PNPM_VERSION")


def preflight(env: dict[str, str] | None = None) -> dict:
    v = _pnpm_version(env)
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
    v = _pnpm_version(env)
    defaults = {e["key"]: e["default_since_major"] for e in EXTRAS if e.get("default_since_major")}
    extras_rows = []
    for row in read_extras(raw, EXTRAS):
        d = defaults.get(row["key"])
        if row["configured"] is None and d and v is not None and v[0] >= d:
            row = {**row, "ok": True, "defaultEnforced": True}
        extras_rows.append(row)
    return {"path": str(p), "configured": value, "days": days, "extras": extras_rows}


def write(days: int, env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = apply_extras(set_key(raw, KEY, f"{KEY}={days * 24 * 60}"), EXTRAS)
    write_atomic(p, text)
    return {"path": str(p)}


def unset(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed_cooldown = remove_key(before, KEY)
    after, removed_extras = remove_extras(after, EXTRAS)
    removed = removed_cooldown or removed_extras
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
