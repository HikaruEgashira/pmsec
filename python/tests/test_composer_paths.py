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


def test_composer_path_defaults_to_application_support_on_macos():
    assert composer_config_path({}, Path("/Users/user"), "darwin") == Path("/Users/user/Library/Application Support/composer/config.json")


def test_composer_path_defaults_to_xdg_or_appdata():
    assert composer_config_path({}, Path("/home/user"), "linux") == Path("/home/user/.config/composer/config.json")
    assert composer_config_path({"APPDATA": "C:\\Users\\user\\AppData\\Roaming"}, Path("C:\\Users\\user"), "win32") == Path("C:\\Users\\user\\AppData\\Roaming/Composer/config.json")
