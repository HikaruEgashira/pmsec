from __future__ import annotations

from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.extras import apply_extras, read_extras, remove_extras
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import aube_config_path

NAME = "aube"
KEY = "minimumReleaseAge"
DOCS = "https://aube.jdx.dev/"
EXTRAS = [
    {"key": "paranoid", "expected": "true", "line": "paranoid = true"},
]


def path(ctx: Context) -> Path:
    return aube_config_path(ctx.env, ctx.home, ctx.platform)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        n = int(value)
    except ValueError:
        return None
    if n <= 0:
        return None
    return round(n / 1440)


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY)
    return {"path": str(p), "configured": value, "days": _parse_days(value), "extras": read_extras(raw, EXTRAS)}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = apply_extras(set_key(raw, KEY, f"{KEY} = {days * 1440}"), EXTRAS)
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
