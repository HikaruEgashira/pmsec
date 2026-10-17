from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.io import write_atomic
from pmsec.util.jsonconf import read_json_key, remove_json_key, set_json_key
from pmsec.util.paths import composer_config_path

NAME = "composer"
KEY = "minimum-release-age"
SECTION = "config"
DOCS = "https://getcomposer.org/doc/06-config.md#minimum-release-age"
EXTRAS = [
    {"key": "allow-plugins", "expected": "false", "line": "false", "path": ["config", "allow-plugins"]},
    {"key": "secure-http", "expected": "true", "line": "true", "path": ["config", "secure-http"]},
    {"key": "disable-tls", "expected": "false", "line": "false", "path": ["config", "disable-tls"]},
    {"key": "abandoned", "expected": '"fail"', "line": '"fail"', "path": ["config", "audit", "abandoned"]},
]

# Composer is newer than most tools in the bundle; accept the shorter npm
# spelling too so a config written by hand is still recognized.
PRIMARY_ALIASES = [KEY, "min-release-age", "minimum_release_age", "minimumReleaseAge"]


def path(ctx: Context) -> Path:
    return composer_config_path(ctx.env, ctx.home, ctx.platform)


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    v = str(value).strip().strip('"').strip()
    m = re.match(r"^(\d+)\s*(d|days?|w|weeks?)$", v, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        return n * 7 if re.match(r"^(w|weeks?)$", m.group(2), re.IGNORECASE) else n
    if not re.match(r"^\d+$", v):
        return None
    n = int(v)
    # Large values are seconds or minutes (the units Composer uses for its
    # other time settings); small values are days.
    if n >= 86400:
        return n // 86400
    if n >= 1440 and n % 1440 == 0:
        return n // 1440
    return n


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    configured = None
    for candidate in PRIMARY_ALIASES:
        configured = read_json_key(raw, ["config", candidate])
        if configured is not None:
            break
    extras = []
    for e in EXTRAS:
        cur = read_json_key(raw, e["path"])
        safe_values = e.get("safeValues", [e["expected"]])
        extras.append({
            "key": e["key"],
            "configured": cur,
            "expected": e["expected"],
            "ok": cur is not None and cur in safe_values,
        })
    return {"path": str(p), "configured": configured, "days": _parse_days(configured), "extras": extras}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = set_json_key(raw, ["config", KEY], str(days))
    for e in EXTRAS:
        text = set_json_key(text, e["path"], e["line"])
    write_atomic(p, text)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    text = before
    removed = False
    for candidate in PRIMARY_ALIASES:
        text, r = remove_json_key(text, ["config", candidate])
        removed = removed or r
    for e in EXTRAS:
        text, r = remove_json_key(text, e["path"])
        removed = removed or r
    if removed:
        write_atomic(p, text)
    return {"path": str(p), "removed": removed}
