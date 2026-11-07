from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pmsec.util.paths import composer_config_path  # noqa: E402


def test_composer_path_honors_composer_home_on_every_platform():
    for platform in ("linux", "darwin", "win32"):
        assert composer_config_path({"COMPOSER_HOME": "/custom/composer"}, Path("/home/user"), platform) == Path("/custom/composer/config.json")


def test_composer_path_honors_xdg_on_linux_and_macos():
    for platform in ("linux", "darwin"):
        assert composer_config_path({"XDG_CONFIG_HOME": "/xdg"}, Path("/home/user"), platform) == Path("/xdg/composer/config.json")


# Composer's Factory::getHomeDir switches to XDG when *any* XDG_* variable is
# present, and then prefers $XDG_CONFIG_HOME/composer (default ~/.config/composer).
def test_composer_path_any_xdg_variable_selects_dot_config():
    assert composer_config_path({"XDG_SESSION_TYPE": "tty"}, Path("/home/user"), "linux") == Path("/home/user/.config/composer/config.json")


# Composer never uses Application Support on macOS, and macOS has no /etc/xdg.
def test_composer_path_defaults_to_dot_composer_on_macos():
    assert composer_config_path({}, Path("/Users/user"), "darwin") == Path("/Users/user/.composer/config.json")


def test_composer_path_prefers_existing_dir(tmp_path):
    (tmp_path / ".composer").mkdir()
    assert composer_config_path({"XDG_CONFIG_HOME": str(tmp_path / ".config")}, tmp_path, "linux") == tmp_path / ".composer" / "config.json"


def test_composer_path_uses_appdata_on_windows():
    assert composer_config_path({"APPDATA": "C:\\Users\\user\\AppData\\Roaming"}, Path("C:\\Users\\user"), "win32") == Path("C:\\Users\\user\\AppData\\Roaming/Composer/config.json")
