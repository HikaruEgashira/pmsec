from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import cargo_config_path

NAME = "cargo"
KEY = "minimum-release-age"
SECTION = "install"
DOCS = "https://rust-lang.github.io/rfcs/3801-package-cooldown.html"
EXTRAS: list[dict] = []


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return cargo_config_path(env, home)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = re.match(r'^"?\s*(\d+)\s*(d|days?|w|weeks?)\s*"?$', value, re.IGNORECASE)
    if not m:
        return None
    n = int(m.group(1))
    return n * 7 if re.match(r"^(w|weeks?)$", m.group(2), re.IGNORECASE) else n


def read(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, section=SECTION)
    return {"path": str(p), "configured": value, "days": _parse_days(value), "extras": []}


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
