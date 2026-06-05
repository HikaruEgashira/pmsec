from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import bundle_config_path
from pmsec.util.version import build_preflight

NAME = "bundler"
KEY = "BUNDLE_COOLDOWN"
DOCS = "https://bundler.io/man/bundle-config.1.html"
MIN_BIN = (4, 0, 13)
EXTRAS: list[dict] = []
SEP = ":"

preflight = build_preflight(
    NAME, MIN_BIN,
    "BUNDLE_COOLDOWN is silently ignored. Upgrade bundler (v4.0.13+) to enforce the cooldown.",
)

# bundler stores the cooldown as a plain integer number of days, quoted in the
# YAML config (e.g. `BUNDLE_COOLDOWN: "7"`). Accept it with or without quotes.
_INT_DAYS = re.compile(r'^"?\s*(\d+)\s*"?$')


def path(ctx: Context) -> Path:
    return bundle_config_path(ctx.env, ctx.home)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = _INT_DAYS.match(value)
    return int(m.group(1)) if m else None


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, sep=SEP)
    return {"path": str(p), "configured": value, "days": _parse_days(value), "extras": []}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    write_atomic(p, set_key(raw, KEY, f'{KEY}: "{days}"', sep=SEP))
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed = remove_key(before, KEY, sep=SEP)
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
