from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pmsec.cli import main  # noqa: E402


def env_for(home: Path) -> dict[str, str]:
    return {"HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config")}


def run(argv, home, platform="linux"):
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, env=env_for(home), home=home, platform=platform, out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def test_set_then_check_passes(tmp_path):
    code, _, _ = run(["set", "7"], tmp_path)
    assert code == 0
    assert "min-release-age=7" in (tmp_path / ".npmrc").read_text()
    assert 'exclude-newer = "7 days"' in (tmp_path / ".config" / "uv" / "uv.toml").read_text()
    code, _, _ = run(["check", "--min", "7"], tmp_path)
    assert code == 0


def test_check_fails_when_missing(tmp_path):
    code, out, _ = run(["check"], tmp_path)
    assert code == 1
    assert "MISSING npm" in out
    assert "MISSING uv" in out


def test_unset_preserves_other_keys(tmp_path):
    (tmp_path / ".npmrc").write_text("registry=https://registry.npmjs.org/\nmin-release-age=7\n")
    uv_dir = tmp_path / ".config" / "uv"
    uv_dir.mkdir(parents=True)
    (uv_dir / "uv.toml").write_text('exclude-newer = "7 days"\nindex-strategy = "unsafe-best-match"\n')
    run(["unset"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == "registry=https://registry.npmjs.org/\n"
    assert (uv_dir / "uv.toml").read_text() == 'index-strategy = "unsafe-best-match"\n'


def test_set_replaces_existing_value(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=3\nregistry=https://r/\n")
    run(["set", "10"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == "min-release-age=10\nregistry=https://r/\n"


def test_tool_filter(tmp_path):
    run(["set", "7", "--tool", "npm"], tmp_path)
    assert (tmp_path / ".npmrc").exists()
    assert not (tmp_path / ".config" / "uv" / "uv.toml").exists()


def test_windows_uv_path(tmp_path):
    appdata = tmp_path / "AppData" / "Roaming"
    out, err = io.StringIO(), io.StringIO()
    main(["set", "7", "--tool", "uv"], env={"APPDATA": str(appdata)}, home=tmp_path, platform="win32", out=out, err=err)
    assert (appdata / "uv" / "uv.toml").read_text().splitlines()[0] == 'exclude-newer = "7 days"'


def test_check_json(tmp_path):
    _, out, _ = run(["check", "--json"], tmp_path)
    data = json.loads(out)
    assert data["ok"] is False
    assert len(data["rows"]) == 2


def test_set_rejects_zero(tmp_path):
    with pytest.raises(SystemExit):
        run(["set", "0"], tmp_path)
