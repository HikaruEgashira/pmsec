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


def test_set_writes_every_supported_tool_config(tmp_path):
    code, _, _ = run(["set", "7"], tmp_path)
    assert code == 0
    assert "min-release-age=7" in (tmp_path / ".npmrc").read_text()
    assert "minimum-release-age=10080" in (tmp_path / ".npmrc").read_text()
    assert 'exclude-newer = "7 days"' in (tmp_path / ".config" / "uv" / "uv.toml").read_text()
    bunfig = (tmp_path / ".bunfig.toml").read_text()
    assert "[install]" in bunfig
    assert "minimumReleaseAge = 604800" in bunfig
    assert 'npmMinimalAgeGate: "7d"' in (tmp_path / ".yarnrc.yml").read_text()
    mise = (tmp_path / ".config" / "mise" / "config.toml").read_text()
    assert "[settings]" in mise
    assert 'minimum_release_age = "7d"' in mise


def test_check_passes_after_set(tmp_path):
    run(["set", "7"], tmp_path)
    code, _, _ = run(["check", "--min", "7"], tmp_path)
    assert code == 0


def test_check_fails_when_missing(tmp_path):
    code, out, _ = run(["check"], tmp_path)
    assert code == 1
    for tool in ("npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv"):
        assert f"MISSING {tool}" in out


def test_unset_preserves_other_keys(tmp_path):
    (tmp_path / ".npmrc").write_text(
        "registry=https://r/\nmin-release-age=7\nminimum-release-age=10080\n"
    )
    uv_dir = tmp_path / ".config" / "uv"
    uv_dir.mkdir(parents=True)
    (uv_dir / "uv.toml").write_text(
        'exclude-newer = "7 days"\nindex-strategy = "unsafe-best-match"\n'
    )
    (tmp_path / ".bunfig.toml").write_text(
        '[install]\nminimumReleaseAge = 604800\nregistry = "https://x/"\n'
    )
    (tmp_path / ".yarnrc.yml").write_text(
        'npmMinimalAgeGate: "7d"\nnpmRegistryServer: "https://r/"\n'
    )
    run(["unset"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == "registry=https://r/\n"
    assert (uv_dir / "uv.toml").read_text() == 'index-strategy = "unsafe-best-match"\n'
    assert (tmp_path / ".bunfig.toml").read_text() == '[install]\nregistry = "https://x/"\n'
    assert (tmp_path / ".yarnrc.yml").read_text() == 'npmRegistryServer: "https://r/"\n'


def test_set_replaces_existing_value(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=3\nregistry=https://r/\n")
    run(["set", "10", "--tool", "npm"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == "min-release-age=10\nregistry=https://r/\n"


def test_tool_filter(tmp_path):
    run(["set", "7", "--tool", "npm,bun"], tmp_path)
    assert (tmp_path / ".npmrc").exists()
    assert (tmp_path / ".bunfig.toml").exists()
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
    assert len(data["rows"]) == 7
    assert [r["tool"] for r in data["rows"]] == ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv"]


def test_set_rejects_zero(tmp_path):
    with pytest.raises(SystemExit):
        run(["set", "0"], tmp_path)


def test_bun_section_insert(tmp_path):
    (tmp_path / ".bunfig.toml").write_text('[install]\nregistry = "https://x/"\n')
    run(["set", "7", "--tool", "bun"], tmp_path)
    text = (tmp_path / ".bunfig.toml").read_text()
    assert text.startswith("[install]\nminimumReleaseAge = 604800\nregistry =")


def test_bun_creates_section_if_missing(tmp_path):
    (tmp_path / ".bunfig.toml").write_text("telemetry = false\n")
    run(["set", "7", "--tool", "bun"], tmp_path)
    text = (tmp_path / ".bunfig.toml").read_text()
    assert text == "telemetry = false\n\n[install]\nminimumReleaseAge = 604800\n"


def test_yarn_check_parses_days(tmp_path):
    (tmp_path / ".yarnrc.yml").write_text('npmMinimalAgeGate: "14d"\n')
    _, out, _ = run(["check", "--json", "--tool", "yarn", "--min", "7"], tmp_path)
    data = json.loads(out)
    assert data["ok"] is True
    assert data["rows"][0]["days"] == 14


def test_pnpm_check_normalizes_minutes(tmp_path):
    (tmp_path / ".npmrc").write_text("minimum-release-age=20160\n")
    _, out, _ = run(["check", "--json", "--tool", "pnpm"], tmp_path)
    data = json.loads(out)
    assert data["rows"][0]["days"] == 14


def test_bak_created_once(tmp_path):
    (tmp_path / ".npmrc").write_text("registry=https://original/\n")
    run(["set", "7", "--tool", "npm"], tmp_path)
    run(["set", "10", "--tool", "npm"], tmp_path)
    assert (tmp_path / ".npmrc.bak").read_text() == "registry=https://original/\n"


@pytest.mark.parametrize("flag", ["--version", "-V"])
def test_version_flag_prints_package_version(tmp_path, capsys, flag):
    from pmsec import __version__
    with pytest.raises(SystemExit) as exc:
        run([flag], tmp_path)
    assert exc.value.code == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == f"pmsec {__version__}"
