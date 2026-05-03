from __future__ import annotations

import os
from pathlib import Path


def npmrc_path(env: dict[str, str], home: Path) -> Path:
    if "NPM_CONFIG_USERCONFIG" in env:
        return Path(env["NPM_CONFIG_USERCONFIG"])
    return home / ".npmrc"


def bun_config_path(env: dict[str, str], home: Path) -> Path:
    if "BUN_CONFIG_FILE" in env:
        return Path(env["BUN_CONFIG_FILE"])
    return home / ".bunfig.toml"


def yarnrc_path(env: dict[str, str], home: Path) -> Path:
    if "YARN_RC_FILENAME" in env:
        return Path(env["YARN_RC_FILENAME"])
    return home / ".yarnrc.yml"


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
    return "win32" if os.name == "nt" else "linux"
