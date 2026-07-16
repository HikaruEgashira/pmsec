from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.extras import apply_extras, read_extras, remove_extras
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import yarnrc_path
from pmsec.util.version import build_preflight

NAME = "yarn"
KEY = "npmMinimalAgeGate"
DOCS = "https://yarnpkg.com/configuration/yarnrc#npmMinimalAgeGate"
MIN_BIN = (4, 10, 0)
SEP = ":"
EXTRAS = [
    {"key": "enableHardenedMode", "expected": "true", "line": "enableHardenedMode: true", "sep": SEP},
    {"key": "enableScripts", "expected": "false", "line": "enableScripts: false", "sep": SEP},
    {"key": "approvedGitRepositories", "expected": "[]", "line": "approvedGitRepositories: []", "sep": SEP},
]

_DURATION = re.compile(r'^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$', re.IGNORECASE)

preflight = build_preflight(
    NAME, MIN_BIN,
    "npmMinimalAgeGate is silently ignored. Upgrade yarn (v4.10+) to enforce the cooldown.",
)


def path(ctx: Context) -> Path:
    return yarnrc_path(ctx.env, ctx.home)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = _DURATION.match(value)
    if not m:
        return None
    n = int(m.group(1))
    return n * 7 if m.group(2).lower() in ("w", "week", "weeks") else n


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, sep=SEP)
    return {"path": str(p), "configured": value, "days": _parse_days(value), "extras": read_extras(raw, EXTRAS)}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = apply_extras(set_key(raw, KEY, f'{KEY}: "{days}d"', sep=SEP), EXTRAS)
    write_atomic(p, text)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed_cooldown = remove_key(before, KEY, sep=SEP)
    after, removed_extras = remove_extras(after, EXTRAS)
    removed = removed_cooldown or removed_extras
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
