from __future__ import annotations

from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.extras import apply_extras, read_extras, remove_extras
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import pnpm_config_path, pnpm_rc_path
from pmsec.util.version import detect_version, gte

NAME = "pnpm"
KEY = "minimum-release-age"
DOCS = "https://pnpm.io/settings#minimumreleaseage"
MIN_BIN = (10, 6, 0)
# pnpm >= 11 only reads pnpm-specific settings from the camelCase YAML config.
# We keep writing the kebab-case rc file for pnpm 10 and mirror every setting
# into config.yaml for pnpm 11+. read() switches files based on the detected
# major version so --check validates the config the running pnpm actually reads.
YAML_KEY = "minimumReleaseAge"
# `default_since_major`: pnpm major version where the value became the default.
# When detected, an absent line in the active config is still effectively in
# force, so read() reports it as ok with `defaultEnforced`.
EXTRAS = [
    {"key": "trust-policy", "yaml_key": "trustPolicy", "expected": "no-downgrade", "line": "trust-policy=no-downgrade", "yaml_line": "trustPolicy: no-downgrade"},
    {"key": "block-exotic-subdeps", "yaml_key": "blockExoticSubdeps", "expected": "true", "line": "block-exotic-subdeps=true", "yaml_line": "blockExoticSubdeps: true", "default_since_major": 11},
    {"key": "strict-dep-builds", "yaml_key": "strictDepBuilds", "expected": "true", "line": "strict-dep-builds=true", "yaml_line": "strictDepBuilds: true"},
    {"key": "verify-deps-before-run", "yaml_key": "verifyDepsBeforeRun", "expected": "error", "line": "verify-deps-before-run=error", "yaml_line": "verifyDepsBeforeRun: error"},
    {"key": "minimum-release-age-strict", "yaml_key": "minimumReleaseAgeStrict", "expected": "true", "line": "minimum-release-age-strict=true", "yaml_line": "minimumReleaseAgeStrict: true"},
    {"key": "dangerously-allow-all-builds", "yaml_key": "dangerouslyAllowAllBuilds", "expected": "false", "line": "dangerously-allow-all-builds=false", "yaml_line": "dangerouslyAllowAllBuilds: false"},
    {"key": "trust-lockfile", "yaml_key": "trustLockfile", "expected": "false", "line": "trust-lockfile=false", "yaml_line": "trustLockfile: false"},
    {"key": "minimum-release-age-ignore-missing-time", "yaml_key": "minimumReleaseAgeIgnoreMissingTime", "expected": "false", "line": "minimum-release-age-ignore-missing-time=false", "yaml_line": "minimumReleaseAgeIgnoreMissingTime: false"},
]


def _yaml_extras() -> list[dict]:
    rows = []
    for e in EXTRAS:
        row = {"key": e["yaml_key"], "expected": e["expected"], "line": e["yaml_line"], "sep": ":"}
        if e.get("default_since_major"):
            row["default_since_major"] = e["default_since_major"]
        rows.append(row)
    return rows


def path(ctx: Context) -> Path:
    return pnpm_rc_path(ctx.env, ctx.home, ctx.platform)


def config_path(ctx: Context) -> Path:
    return pnpm_config_path(ctx.env, ctx.home, ctx.platform)


# Cache `pnpm --version` for the lifetime of the process. preflight() and
# read() both want it; without memoization a single `pmsec check` spawns
# pnpm twice. Cache key is the override env value so tests with different
# `PMSEC_PNPM_VERSION` settings invalidate naturally.
_version_cache: tuple[str | None, tuple[int, int, int, str] | None] | None = None


def _pnpm_version(ctx: Context):
    global _version_cache
    override = ctx.env.get("PMSEC_PNPM_VERSION")
    if _version_cache is not None and _version_cache[0] == override:
        return _version_cache[1]
    v = detect_version("pnpm", env=ctx.env, override_key="PMSEC_PNPM_VERSION")
    _version_cache = (override, v)
    return v


def _active_config(ctx: Context) -> dict:
    v = _pnpm_version(ctx)
    if v is not None and v[0] >= 11:
        return {"path": config_path(ctx), "key": YAML_KEY, "sep": ":", "extras": _yaml_extras()}
    return {"path": path(ctx), "key": KEY, "sep": "=", "extras": EXTRAS}


def preflight(ctx: Context) -> dict:
    v = _pnpm_version(ctx)
    if v is None:
        return {"ok": True, "message": None}
    if gte(v, MIN_BIN):
        return {"ok": True, "version": v[3], "message": None}
    msg = (
        f"pnpm {v[3]} < {'.'.join(str(n) for n in MIN_BIN)}: "
        "minimum-release-age is silently ignored. Upgrade pnpm to enforce the cooldown."
    )
    return {"ok": True, "warn": True, "version": v[3], "message": msg}


def read(ctx: Context) -> dict:
    active = _active_config(ctx)
    p = active["path"]
    raw = p.read_text("utf-8") if p.exists() else ""
    value = read_key(raw, active["key"], sep=active["sep"])
    minutes = None
    if value is not None:
        try:
            minutes = int(value)
        except ValueError:
            minutes = None
    days = None if minutes is None else minutes // (60 * 24)
    v = _pnpm_version(ctx)
    defaults = {e["key"]: e["default_since_major"] for e in active["extras"] if e.get("default_since_major")}
    extras_rows = []
    for row in read_extras(raw, active["extras"]):
        d = defaults.get(row["key"])
        if row["configured"] is None and d and v is not None and v[0] >= d:
            row = {**row, "ok": True, "defaultEnforced": True}
        extras_rows.append(row)
    return {"path": str(p), "key": active["key"], "configured": value, "days": days, "extras": extras_rows}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    raw = p.read_text("utf-8") if p.exists() else ""
    text = apply_extras(set_key(raw, KEY, f"{KEY}={days * 24 * 60}"), EXTRAS)
    write_atomic(p, text)

    cp = config_path(ctx)
    yaml_raw = cp.read_text("utf-8") if cp.exists() else ""
    yaml = apply_extras(set_key(yaml_raw, YAML_KEY, f"{YAML_KEY}: {days * 24 * 60}", sep=":"), _yaml_extras())
    write_atomic(cp, yaml)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    removed = False
    if p.exists():
        before = p.read_text("utf-8")
        after, removed_cooldown = remove_key(before, KEY)
        after, removed_extras = remove_extras(after, EXTRAS)
        removed = removed_cooldown or removed_extras
        if removed:
            write_atomic(p, after)

    cp = config_path(ctx)
    if cp.exists():
        before = cp.read_text("utf-8")
        after, removed_cooldown = remove_key(before, YAML_KEY, sep=":")
        after, removed_extras = remove_extras(after, _yaml_extras())
        if removed_cooldown or removed_extras:
            removed = True
            write_atomic(cp, after)
    return {"path": str(p), "removed": removed}
