from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import cargo_config_path

NAME = "cargo"
KEY = "minimum-release-age"
SECTION = "install"
DOCS = "https://rust-lang.github.io/rfcs/3801-package-cooldown.html"
EXTRAS: list[dict] = []

# Stabilized resolver cooldown (cargo >= 1.100). It tracks `--days` like the
# primary key, so it is handled here rather than as a fixed-value extra.
PUBLISH_AGE_KEY = "global-min-publish-age"
PUBLISH_AGE_SECTION = "registry"


def path(ctx: Context) -> Path:
    return cargo_config_path(ctx.env, ctx.home)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = re.match(r'^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$', value, re.IGNORECASE)
    if not m:
        return None
    n = int(m.group(1))
    return n * 7 if re.match(r"^(w|weeks?)$", m.group(2), re.IGNORECASE) else n


def _parse_publish_age_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = re.match(r'^"\s*(\d+)\s*(days?|weeks?|months?)\s*"$', value, re.IGNORECASE)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2).lower()
    if unit.startswith("week"):
        return n * 7
    if unit.startswith("month"):
        return n * 30
    return n


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, section=SECTION)
    days = _parse_days(value)
    cur = read_key(raw, PUBLISH_AGE_KEY, section=PUBLISH_AGE_SECTION)
    want = days if days is not None else 1
    cur_days = _parse_publish_age_days(cur)
    extras = [{
        "key": PUBLISH_AGE_KEY,
        "configured": cur,
        "expected": f'"{want} days"',
        "ok": cur_days is not None and cur_days >= want,
    }]
    return {"path": str(p), "configured": value, "days": days, "extras": extras}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = set_key(raw, KEY, f'{KEY} = "{days}d"', section=SECTION)
    text = set_key(text, PUBLISH_AGE_KEY, f'{PUBLISH_AGE_KEY} = "{days} days"', section=PUBLISH_AGE_SECTION)
    write_atomic(p, text)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed_cooldown = remove_key(before, KEY, section=SECTION)
    after, removed_age = remove_key(after, PUBLISH_AGE_KEY, section=PUBLISH_AGE_SECTION)
    removed = removed_cooldown or removed_age
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
