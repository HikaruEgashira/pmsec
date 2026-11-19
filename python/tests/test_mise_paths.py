from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pmsec.tools.mise import supports_new_mode  # noqa: E402
from pmsec.util.paths import mise_layer_paths  # noqa: E402


def _v(a: int, b: int, c: int) -> tuple[int, int, int, str]:
    return a, b, c, f"{a}.{b}.{c}"


def test_mise_layer_paths_use_xdg_on_posix():
    for platform in ("linux", "darwin"):
        assert mise_layer_paths({"XDG_CONFIG_HOME": "/xdg"}, Path("/home/user"), platform) == {
            "mise_dir": Path("/xdg/mise"),
            "base_config": Path("/xdg/mise/config.toml"),
            "pmsec_config": Path("/xdg/mise/config.pmsec.toml"),
            "local_miserc": Path("/xdg/mise/miserc.toml"),
        }


def test_mise_layer_paths_default_to_dot_config():
    p = mise_layer_paths({}, Path("/home/user"), "linux")
    assert p["pmsec_config"] == Path("/home/user/.config/mise/config.pmsec.toml")


def test_mise_layer_paths_use_localappdata_on_win32():
    base = "C:\\Users\\user\\AppData\\Local"
    p = mise_layer_paths({"LOCALAPPDATA": base, "XDG_CONFIG_HOME": "/xdg"}, Path("C:\\Users\\user"), "win32")
    assert p["mise_dir"] == Path(base) / "mise"
    assert p["base_config"] == Path(base) / "mise" / "config.toml"
    assert p["pmsec_config"] == Path(base) / "mise" / "config.pmsec.toml"
    assert p["local_miserc"] == Path(base) / "mise" / "miserc.toml"
    home = Path("C:\\Users\\user")
    assert mise_layer_paths({}, home, "win32")["mise_dir"] == home / "AppData" / "Local" / "mise"


def test_mise_layer_paths_honor_mise_config_dir():
    for platform in ("linux", "darwin", "win32"):
        assert mise_layer_paths({"MISE_CONFIG_DIR": "/m"}, Path("/home/user"), platform)["pmsec_config"] == Path("/m/config.pmsec.toml")


def test_mise_new_mode_version_gate():
    assert supports_new_mode(_v(2026, 11, 0), {}) is True
    assert supports_new_mode(_v(2027, 1, 0), {}) is True
    assert supports_new_mode(_v(2026, 10, 9), {}) is False
    assert supports_new_mode(None, {}) is False


def test_mise_new_mode_disabled_by_global_config_file():
    assert supports_new_mode(_v(2026, 11, 0), {"MISE_GLOBAL_CONFIG_FILE": "/x/config.toml"}) is False
