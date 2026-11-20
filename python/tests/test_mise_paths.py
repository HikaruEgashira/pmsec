from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pmsec.util.paths import mise_layer_paths, mise_supports_new_mode  # noqa: E402


def test_mise_layer_paths_posix_honor_xdg():
    d = Path("/xdg/mise")
    assert mise_layer_paths({"XDG_CONFIG_HOME": "/xdg"}, Path("/home/user"), "linux") == {
        "mise_dir": d,
        "base_config": d / "config.toml",
        "pmsec_config": d / "config.pmsec.toml",
        "local_miserc": d / "miserc.local.toml",
    }
    assert mise_layer_paths({}, Path("/home/user"), "darwin")["mise_dir"] == Path("/home/user/.config/mise")


def test_mise_layer_paths_win32_use_localappdata_and_ignore_override():
    env = {"LOCALAPPDATA": "/la", "XDG_CONFIG_HOME": "/xdg", "MISE_GLOBAL_CONFIG_FILE": "/x.toml"}
    p = mise_layer_paths(env, Path("/home/user"), "win32")
    assert p["mise_dir"] == Path("/la/mise")
    assert p["pmsec_config"] == Path("/la/mise/config.pmsec.toml")
    assert mise_layer_paths({}, Path("/home/user"), "win32")["base_config"] == Path("/home/user/AppData/Local/mise/config.toml")


def test_mise_new_mode_version_gate():
    assert mise_supports_new_mode((2026, 11, 0, "2026.11.0"), {}) is True
    assert mise_supports_new_mode((2027, 1, 0, "2027.1.0"), {}) is True
    assert mise_supports_new_mode((2026, 10, 9, "2026.10.9"), {}) is False
    assert mise_supports_new_mode(None, {}) is False
    assert mise_supports_new_mode((2026, 11, 0, "2026.11.0"), {"MISE_GLOBAL_CONFIG_FILE": "/x.toml"}) is False
