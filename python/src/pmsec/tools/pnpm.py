from __future__ import annotations

from pathlib import Path

from pmsec.util.context import Context
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
    {"key": "verify-deps-before-run", "expected": "error", "line": "verify-deps-before-run=error"},
    {"key": "minimum-release-age-strict", "expected": "true", "line": "minimum-release-age-strict=true"},
]


def path(ctx: Context) -> Path:
    return pnpm_rc_path(ctx.env, ctx.home, ctx.platform)


# Cache `pnpm --version` for the lifetime of the process. preflight() and
# read() both want it; without memoization a single `pmsec check` spawns
# pnpm twice. Cache key is the override env value so tests with different
# `PMSEC_PNPM_VERSION` settings invalidate naturally.
_version_cache: tuple[str | None, tuple[int, int, int, str] | None] | None = None


def _pnpm_version(ctx: Context):
    global _version_cache
    override = ctx.env.get("PMSEC_PNPM_VERSION")
    if _version_cache is not None and _version_cache[0] == override:
        return _version_cache[1]
    v = detect_version("pnpm", env=ctx.env, override_key="PMSEC_PNPM_VERSION")
    _version_cache = (override, v)
    return v


def preflight(ctx: Context) -> dict:
    v = _pnpm_version(ctx)
    if v is None:
        return {"ok": True, "message": None}
    if gte(v, MIN_BIN):
        return {"ok": True, "version": v[3], "message": None}
    msg = (
        f"pnpm {v[3]} < {'.'.join(str(n) for n in MIN_BIN)}: "
        "minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown."
    )
    return {"ok": True, "warn": True, "version": v[3], "message": msg}


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY)
    minutes = None
    if value is not None:
        try:
            minutes = int(value)
        except ValueError:
            minutes = None
    days = None if minutes is None else minutes // (60 * 24)
    v = _pnpm_version(ctx)
    defaults = {e["key"]: e["default_since_major"] for e in EXTRAS if e.get("default_since_major")}
    extras_rows = []
    for row in read_extras(raw, EXTRAS):
        d = defaults.get(row["key"])
        if row["configured"] is None and d and v is not None and v[0] >= d:
            row = {**row, "ok": True, "defaultEnforced": True}
        extras_rows.append(row)
    return {"path": str(p), "configured": value, "days": days, "extras": extras_rows}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = apply_extras(set_key(raw, KEY, f"{KEY}={days * 24 * 60}"), EXTRAS)
    write_atomic(p, text)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed_cooldown = remove_key(before, KEY)
    after, removed_extras = remove_extras(after, EXTRAS)
    removed = removed_cooldown or removed_extras
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
