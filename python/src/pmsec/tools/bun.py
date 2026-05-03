from __future__ import annotations

from pathlib import Path

from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import bun_config_path
from pmsec.util.version import detect_version, gte

NAME = "bun"
KEY = "minimumReleaseAge"
SECTION = "install"
DOCS = "https://bun.com/docs/runtime/bunfig#install"
MIN_BIN = (1, 3, 0)


def path(env: dict[str, str], home: Path, platform: str) -> Path:
    return bun_config_path(env, home)


def preflight() -> dict:
    v = detect_version("bun")
    if v is None:
        return {"ok": True, "message": None}
    if gte(v, MIN_BIN):
        return {"ok": True, "version": v[3], "message": None}
    msg = (
        f"bun {v[3]} < {'.'.join(str(n) for n in MIN_BIN)}: "
        "minimumReleaseAge is silently ignored. Upgrade bun to enforce the cooldown."
    )
    return {"ok": True, "warn": True, "version": v[3], "message": msg}


def read(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, KEY, section=SECTION)
    seconds = None
    if value is not None:
        try:
            seconds = int(value)
        except ValueError:
            seconds = None
    days = None if seconds is None else seconds // 86400
    return {"path": str(p), "configured": value, "days": days}


def write(days: int, env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    before = p.read_text("utf-8") if p.exists() else ""
    after = set_key(before, KEY, f"{KEY} = {days * 86400}", section=SECTION)
    p.parent.mkdir(parents=True, exist_ok=True)
    bak = p.with_suffix(p.suffix + ".bak")
    if p.exists() and not bak.exists():
        bak.write_text(before, "utf-8")
    p.write_text(after, "utf-8")
    return {"path": str(p), "before": before, "after": after}


def unset(env: dict[str, str], home: Path, platform: str) -> dict:
    p = path(env, home, platform)
    if not p.exists():
        return {"path": str(p), "removed": False}
    before = p.read_text("utf-8")
    after, removed = remove_key(before, KEY, section=SECTION)
    if removed:
        bak = p.with_suffix(p.suffix + ".bak")
        if not bak.exists():
            bak.write_text(before, "utf-8")
        p.write_text(after, "utf-8")
    return {"path": str(p), "removed": removed}
