from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import cargo_config_path
from pmsec.util.version import build_preflight

NAME = "cargo"
KEY = "global-min-publish-age"
SECTION = "registry"
DOCS = "https://doc.rust-lang.org/nightly/cargo/reference/config.html#registryglobal-min-publish-age"
MIN_BIN = (1, 100, 0)
EXTRAS: list[dict] = []
preflight = build_preflight(NAME, MIN_BIN, "global-min-publish-age is silently ignored. Upgrade cargo to enforce the cooldown.")

# pmsec <= 2026.10.1 wrote this key, but cargo never supported it. Remove it
# when we touch the file so users do not mistake it for an enforced setting.
LEGACY_KEY = "minimum-release-age"
LEGACY_SECTION = "install"


def path(ctx: Context) -> Path:
    return cargo_config_path(ctx.env, ctx.home)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = re.match(r'^"?\s*(\d+)\s*(d|days?|w|weeks?|months?)\s*"?$', value, re.IGNORECASE)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2).lower()
    if unit.startswith("week") or unit == "w":
        return n * 7
    if unit.startswith("month"):
        return n * 30
    return n


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, section=SECTION)
    return {"path": str(p), "configured": value, "days": _parse_days(value), "extras": []}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = set_key(raw, KEY, f'{KEY} = "{days} days"', section=SECTION)
    text, _ = remove_key(text, LEGACY_KEY, section=LEGACY_SECTION)
    write_atomic(p, text)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed_cooldown = remove_key(before, KEY, section=SECTION)
    after, removed_old = remove_key(after, LEGACY_KEY, section=LEGACY_SECTION)
    removed = removed_cooldown or removed_old
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
