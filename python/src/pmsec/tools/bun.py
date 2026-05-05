from __future__ import annotations

from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import bun_config_path
from pmsec.util.version import build_preflight

NAME = "bun"
KEY = "minimumReleaseAge"
SECTION = "install"
DOCS = "https://bun.com/docs/runtime/bunfig#install"
MIN_BIN = (1, 3, 0)
EXTRAS: list[dict] = []

preflight = build_preflight(
    NAME, MIN_BIN,
    "minimumReleaseAge is silently ignored. Upgrade bun to enforce the cooldown.",
)


def path(ctx: Context) -> Path:
    return bun_config_path(ctx.env, ctx.home)


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, section=SECTION)
    seconds = None
    if value is not None:
        try:
            seconds = int(value)
        except ValueError:
            seconds = None
    days = None if seconds is None else seconds // 86400
    return {"path": str(p), "configured": value, "days": days, "extras": []}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    write_atomic(p, set_key(raw, KEY, f"{KEY} = {days * 86400}", section=SECTION))
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed = remove_key(before, KEY, section=SECTION)
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
