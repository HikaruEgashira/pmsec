from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.extras import apply_extras, read_extras, remove_extras
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import uv_config_path
from pmsec.util.version import build_preflight

NAME = "uv"
KEY = "exclude-newer"
DOCS = "https://docs.astral.sh/uv/reference/settings/#exclude-newer"
MIN_BIN = (0, 9, 17)
EXTRAS: list[dict] = [
    {"key": "index-strategy", "expected": '"first-index"', "line": 'index-strategy = "first-index"'},
]

preflight = build_preflight(
    NAME, MIN_BIN,
    'writing exclude-newer = "N days" will break this uv until you `uv self update` '
    "(file will fail to parse).",
)

_DURATION = re.compile(r'^"\s*(\d+)\s*(day|days|d|week|weeks|w)\s*"$', re.IGNORECASE)


def path(ctx: Context) -> Path:
    return uv_config_path(ctx.env, ctx.home, ctx.platform)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = _DURATION.match(value)
    if not m:
        return None
    n = int(m.group(1))
    return n * 7 if m.group(2).lower() in ("week", "weeks", "w") else n


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY)
    return {"path": str(p), "configured": value, "days": _parse_days(value), "extras": read_extras(raw, EXTRAS)}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    write_atomic(p, apply_extras(set_key(raw, KEY, f'{KEY} = "{days} days"'), EXTRAS))
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
