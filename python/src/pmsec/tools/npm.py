from __future__ import annotations

from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.extras import apply_extras, read_extras, remove_extras
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import npmrc_path
from pmsec.util.version import build_preflight

NAME = "npm"
KEY = "min-release-age"
DOCS = "https://docs.npmjs.com/cli/v11/using-npm/config#min-release-age"
MIN_BIN = (11, 10, 0)
EXTRAS = [
    {"key": "audit-level", "expected": "high", "line": "audit-level=high"},
    {"key": "allow-git", "expected": "root", "line": "allow-git=root"},
    {"key": "allow-remote", "expected": "root", "line": "allow-remote=root"},
    {"key": "allow-file", "expected": "root", "line": "allow-file=root"},
    {"key": "allow-directory", "expected": "root", "line": "allow-directory=root"},
]

preflight = build_preflight(
    NAME, MIN_BIN,
    "min-release-age is silently ignored. Upgrade npm to enforce the cooldown.",
)


def path(ctx: Context) -> Path:
    return npmrc_path(ctx.env, ctx.home)


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY)
    days = None if value is None else int(value)
    return {"path": str(p), "configured": value, "days": days, "extras": read_extras(raw, EXTRAS)}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = apply_extras(set_key(raw, KEY, f"{KEY}={days}"), EXTRAS)
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
