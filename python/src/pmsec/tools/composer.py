from __future__ import annotations

import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.io import write_atomic
from pmsec.util.jsonconf import read_json_key, remove_json_key, set_json_key
from pmsec.util.paths import composer_config_path
from pmsec.util.version import build_preflight

NAME = "composer"
# Composer's cooldown lives under the unified policy block (Composer >= 2.11):
#   {"config": {"policy": {"cooldown": {"period": "7 days"}}}}
# `config.minimum-release-age` was never a Composer key; earlier pmsec
# releases wrote it and Composer silently ignored it. It is removed on write.
KEY = "policy.cooldown.period"
SECTION = "config"
DOCS = "https://getcomposer.org/doc/06-config.md#policy"
MIN_BIN = (2, 11, 0)
COOLDOWN_PATH = ["config", "policy", "cooldown", "period"]
EXTRAS = [
    {"key": "allow-plugins", "expected": "false", "line": "false", "path": ["config", "allow-plugins"]},
    {"key": "secure-http", "expected": "true", "line": "true", "path": ["config", "secure-http"]},
    {"key": "disable-tls", "expected": "false", "line": "false", "path": ["config", "disable-tls"]},
    {"key": "abandoned", "expected": '"fail"', "line": '"fail"', "path": ["config", "audit", "abandoned"]},
]

# Keys written by pmsec < 2026.11.5 that Composer never read.
LEGACY_KEYS = ["minimum-release-age", "min-release-age", "minimum_release_age", "minimumReleaseAge"]

_UNIT_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400, "week": 604800}


def path(ctx: Context) -> Path:
    return composer_config_path(ctx.env, ctx.home, ctx.platform)


preflight = build_preflight(NAME, MIN_BIN,
    "config.policy.cooldown is silently ignored. Upgrade Composer to enforce the cooldown.")


def _parse_days(value: str | None) -> int | None:
    """Composer: "<n> second|minute|hour|day|week[s]" or an integer number of
    seconds (a bare numeric string counts as seconds too). Partial days floor."""
    if value is None:
        return None
    v = str(value).strip().strip('"').strip()
    m = re.match(r"^(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?)$", v, re.IGNORECASE)
    if m:
        unit = m.group(2).lower().rstrip("s")
        return int(m.group(1)) * _UNIT_SECONDS[unit] // 86400
    if not re.fullmatch(r"[0-9]+", v):
        return None
    return int(v) // 86400


def read(ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8-sig") if p.exists() else ""
    configured = read_json_key(raw, COOLDOWN_PATH)
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


def _drop_legacy(text: str) -> tuple[str, bool]:
    removed = False
    for k in LEGACY_KEYS:
        text, r = remove_json_key(text, ["config", k])
        removed = removed or r
    return text, removed


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8-sig") if p.exists() else ""
    text, _ = _drop_legacy(raw)
    text = set_json_key(text, COOLDOWN_PATH, f'"{days} days"')
    for e in EXTRAS:
        text = set_json_key(text, e["path"], e["line"])
    write_atomic(p, text)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    if not p.exists():
        return {"path": str(p), "removed": False}
    text = p.read_text("utf-8-sig")
    text, removed = remove_json_key(text, COOLDOWN_PATH)
    text, r = _drop_legacy(text)
    removed = removed or r
    for e in EXTRAS:
        text, r = remove_json_key(text, e["path"])
        removed = removed or r
    if removed:
        write_atomic(p, text)
    return {"path": str(p), "removed": removed}
