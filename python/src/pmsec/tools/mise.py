from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import mise_config_path

NAME = "mise"
KEY = "minimum_release_age"
SECTION = "settings"
DOCS = "https://mise.jdx.dev/configuration/settings.html#minimum_release_age"

_DURATION = re.compile(
    r'^"?\s*(\d+)\s*(d|days?|w|weeks?|m|months?|y|years?)\s*"?$',
    re.IGNORECASE,
)


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return mise_config_path(env, home, platform)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = _DURATION.match(value)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2).lower()
    if unit in ("w", "week", "weeks"):
        return n * 7
    if unit in ("m", "month", "months"):
        return n * 30
    if unit in ("y", "year", "years"):
        return n * 365
    return n


def read(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, section=SECTION)
    return {"path": str(p), "configured": value, "days": _parse_days(value)}


def write(days: int, env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    before = p.read_text("utf-8") if p.exists() else ""
    after = set_key(before, KEY, f'{KEY} = "{days}d"', section=SECTION)
    write_atomic(p, after)
    return {"path": str(p), "before": before, "after": after}


def unset(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed = remove_key(before, KEY, section=SECTION)
    if removed:
        write_atomic(p, after)
    return {"path": str(p), "removed": removed}
