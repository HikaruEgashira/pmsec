from __future__ import annotations

import os
import sys
from pathlib import Path


def npmrc_path(env: dict[str, str], home: Path) -> Path:
    if "NPM_CONFIG_USERCONFIG" in env:
        return Path(env["NPM_CONFIG_USERCONFIG"])
    return home / ".npmrc"


def pnpm_rc_path(env: dict[str, str], home: Path, platform: str) -> Path:
    """pnpm reads its global rc separately from ~/.npmrc; writing pnpm-only
    keys here keeps npm from warning (and, in npm 12, erroring) about unknown
    user config. pnpm respects XDG_CONFIG_HOME on every OS."""
    if "PMSEC_PNPM_CONFIG_FILE" in env:
        return Path(env["PMSEC_PNPM_CONFIG_FILE"])
    if "XDG_CONFIG_HOME" in env:
        return Path(env["XDG_CONFIG_HOME"]) / "pnpm" / "rc"
    if platform == "darwin":
        return home / "Library" / "Preferences" / "pnpm" / "rc"
    if platform == "win32":
        base = Path(env["LOCALAPPDATA"]) if "LOCALAPPDATA" in env else home / "AppData" / "Local"
        return base / "pnpm" / "config" / "rc"
    return home / ".config" / "pnpm" / "rc"


def bun_config_path(env: dict[str, str], home: Path) -> Path:
    if "BUN_CONFIG_FILE" in env:
        return Path(env["BUN_CONFIG_FILE"])
    return home / ".bunfig.toml"


def yarnrc_path(env: dict[str, str], home: Path) -> Path:
    if "YARN_RC_FILENAME" in env:
        return Path(env["YARN_RC_FILENAME"])
    return home / ".yarnrc.yml"


def cargo_config_path(env: dict[str, str], home: Path) -> Path:
    if "CARGO_HOME" in env:
        return Path(env["CARGO_HOME"]) / "config.toml"
    return home / ".cargo" / "config.toml"


def bundle_config_path(env: dict[str, str], home: Path) -> Path:
    """Bundler's global config. BUNDLE_USER_CONFIG points at the file directly;
    BUNDLE_USER_HOME points at the home dir (config lives at <home>/config).
    Both default to ~/.bundle, matching bundler's own resolution order."""
    if "BUNDLE_USER_CONFIG" in env:
        return Path(env["BUNDLE_USER_CONFIG"])
    if "BUNDLE_USER_HOME" in env:
        return Path(env["BUNDLE_USER_HOME"]) / "config"
    return home / ".bundle" / "config"


def mise_config_path(env: dict[str, str], home: Path, platform: str) -> Path:
    if "MISE_GLOBAL_CONFIG_FILE" in env:
        return Path(env["MISE_GLOBAL_CONFIG_FILE"])
    if platform == "win32":
        base = Path(env["LOCALAPPDATA"]) if "LOCALAPPDATA" in env else home / "AppData" / "Local"
        return base / "mise" / "config.toml"
    base = Path(env["XDG_CONFIG_HOME"]) if "XDG_CONFIG_HOME" in env else home / ".config"
    return base / "mise" / "config.toml"


def uv_config_path(env: dict[str, str], home: Path, platform: str) -> Path:
    if "UV_CONFIG_FILE" in env:
        return Path(env["UV_CONFIG_FILE"])
    if platform == "win32":
        base = Path(env["APPDATA"]) if "APPDATA" in env else home / "AppData" / "Roaming"
        return base / "uv" / "uv.toml"
    base = Path(env["XDG_CONFIG_HOME"]) if "XDG_CONFIG_HOME" in env else home / ".config"
    return base / "uv" / "uv.toml"


def current_platform() -> str:
    if os.name == "nt":
        return "win32"
    if sys.platform == "darwin":
        return "darwin"
    return "linux"
