from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pmsec.cli import main  # noqa: E402


def env_for(home: Path, **overrides: str) -> dict[str, str]:
    # Hide the host pnpm by default so version-aware extras (pnpm 11 default
    # enforcement) don't depend on what's installed on the test machine.
    base = {"HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"), "PMSEC_PNPM_VERSION": "none"}
    base.update(overrides)
    return base


def run(argv, home, platform="linux", **env_overrides):
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, env=env_for(home, **env_overrides), home=home, platform=platform, out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def test_enable_writes_bundle_for_every_tool(tmp_path):
    code, _, _ = run(["enable"], tmp_path)
    assert code == 0
    npmrc = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=3" in npmrc
    assert "minimum-release-age=4320" in npmrc
    assert "audit-level=high" in npmrc
    assert "trust-policy=no-downgrade" in npmrc
    assert "block-exotic-subdeps=true" in npmrc
    assert 'exclude-newer = "3 days"' in (tmp_path / ".config" / "uv" / "uv.toml").read_text()
    bunfig = (tmp_path / ".bunfig.toml").read_text()
    assert "[install]" in bunfig
    assert "minimumReleaseAge = 259200" in bunfig
    yarnrc = (tmp_path / ".yarnrc.yml").read_text()
    assert 'npmMinimalAgeGate: "3d"' in yarnrc
    assert "enableHardenedMode: true" in yarnrc
    mise = (tmp_path / ".config" / "mise" / "config.toml").read_text()
    assert "[settings]" in mise
    assert 'minimum_release_age = "3d"' in mise
    assert "paranoid = true" in mise


def test_check_passes_after_enable(tmp_path):
    run(["enable"], tmp_path)
    code, _, _ = run(["check"], tmp_path)
    assert code == 0


def test_check_fails_when_bundle_missing(tmp_path):
    code, out, _ = run(["check"], tmp_path)
    assert code == 1
    for tool in ("npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv"):
        assert f"MISSING {tool}" in out


def test_disable_preserves_other_keys(tmp_path):
    (tmp_path / ".npmrc").write_text(
        "registry=https://r/\nmin-release-age=3\nminimum-release-age=4320\n"
    )
    uv_dir = tmp_path / ".config" / "uv"
    uv_dir.mkdir(parents=True)
    (uv_dir / "uv.toml").write_text(
        'exclude-newer = "3 days"\nindex-strategy = "unsafe-best-match"\n'
    )
    (tmp_path / ".bunfig.toml").write_text(
        '[install]\nminimumReleaseAge = 259200\nregistry = "https://x/"\n'
    )
    (tmp_path / ".yarnrc.yml").write_text(
        'npmMinimalAgeGate: "3d"\nnpmRegistryServer: "https://r/"\n'
    )
    run(["disable"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == "registry=https://r/\n"
    assert (uv_dir / "uv.toml").read_text() == 'index-strategy = "unsafe-best-match"\n'
    assert (tmp_path / ".bunfig.toml").read_text() == '[install]\nregistry = "https://x/"\n'
    assert (tmp_path / ".yarnrc.yml").read_text() == 'npmRegistryServer: "https://r/"\n'


def test_enable_upgrades_weak_existing_value(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=1\nregistry=https://r/\n")
    run(["enable", "--tool", "npm"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == (
        "min-release-age=3\nregistry=https://r/\naudit-level=high\n"
    )


def test_enable_preserves_stricter_existing_cooldown(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=99\nregistry=https://r/\n")
    code, out, _ = run(["enable", "--tool", "npm"], tmp_path)
    assert code == 0
    assert "keep" in out
    assert (tmp_path / ".npmrc").read_text() == (
        "min-release-age=99\nregistry=https://r/\naudit-level=high\n"
    )


def test_enable_force_overwrites_stricter_existing(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=99\n")
    code, _, _ = run(["enable", "--tool", "npm", "--days", "1", "--force"], tmp_path)
    assert code == 0
    text = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=1" in text


def test_enable_days_upgrades_when_request_exceeds_existing(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=3\n")
    run(["enable", "--tool", "npm", "--days", "14"], tmp_path)
    text = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=14" in text


def test_tool_filter(tmp_path):
    run(["enable", "--tool", "npm,bun"], tmp_path)
    assert (tmp_path / ".npmrc").exists()
    assert (tmp_path / ".bunfig.toml").exists()
    assert not (tmp_path / ".config" / "uv" / "uv.toml").exists()


def test_windows_uv_path(tmp_path):
    appdata = tmp_path / "AppData" / "Roaming"
    out, err = io.StringIO(), io.StringIO()
    main(["enable", "--tool", "uv"], env={"APPDATA": str(appdata)}, home=tmp_path, platform="win32", out=out, err=err)
    assert (appdata / "uv" / "uv.toml").read_text().splitlines()[0] == 'exclude-newer = "3 days"'


def test_check_json(tmp_path):
    _, out, _ = run(["check", "--json"], tmp_path)
    data = json.loads(out)
    assert data["ok"] is False
    assert data["bundleDays"] == 3
    assert len(data["rows"]) == 7
    assert [r["tool"] for r in data["rows"]] == ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv"]


def test_bun_section_insert(tmp_path):
    (tmp_path / ".bunfig.toml").write_text('[install]\nregistry = "https://x/"\n')
    run(["enable", "--tool", "bun"], tmp_path)
    text = (tmp_path / ".bunfig.toml").read_text()
    assert text.startswith("[install]\nminimumReleaseAge = 259200\nregistry =")


def test_bun_creates_section_if_missing(tmp_path):
    (tmp_path / ".bunfig.toml").write_text("telemetry = false\n")
    run(["enable", "--tool", "bun"], tmp_path)
    text = (tmp_path / ".bunfig.toml").read_text()
    assert text == "telemetry = false\n\n[install]\nminimumReleaseAge = 259200\n"


def test_yarn_check_parses_days(tmp_path):
    (tmp_path / ".yarnrc.yml").write_text(
        'npmMinimalAgeGate: "14d"\nenableHardenedMode: true\n'
    )
    _, out, _ = run(["check", "--json", "--tool", "yarn"], tmp_path)
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
    run(["enable", "--tool", "npm"], tmp_path)
    run(["disable", "--tool", "npm"], tmp_path)
    run(["enable", "--tool", "npm"], tmp_path)
    assert (tmp_path / ".npmrc.bak").read_text() == "registry=https://original/\n"


def test_hardening_extras_roundtrip(tmp_path):
    (tmp_path / ".npmrc").write_text("minimum-release-age=20160\n")
    code, out, _ = run(["check", "--json", "--tool", "pnpm"], tmp_path)
    data = json.loads(out)
    assert code == 1
    assert len(data["rows"][0]["extras"]) == 2
    assert all(not e["ok"] for e in data["rows"][0]["extras"])

    run(["enable", "--tool", "pnpm"], tmp_path)
    npmrc = (tmp_path / ".npmrc").read_text()
    assert "trust-policy=no-downgrade" in npmrc
    assert "block-exotic-subdeps=true" in npmrc

    code, out, _ = run(["check", "--json", "--tool", "pnpm"], tmp_path)
    assert code == 0
    assert json.loads(out)["ok"] is True

    run(["disable", "--tool", "pnpm"], tmp_path)
    after = (tmp_path / ".npmrc").read_text()
    assert "trust-policy" not in after
    assert "block-exotic-subdeps" not in after
    assert "minimum-release-age" not in after


def test_pnpm_11_default_enforced_block_exotic_subdeps(tmp_path):
    # Cooldown present, but extras lines absent. Under pnpm 11 the runtime
    # still blocks exotic subdeps by default, so check must report it as OK
    # rather than MISSING (trust-policy stays MISSING — no default change).
    (tmp_path / ".npmrc").write_text("minimum-release-age=4320\n")
    code, out, _ = run(["check", "--json", "--tool", "pnpm"], tmp_path, PMSEC_PNPM_VERSION="11.0.0")
    data = json.loads(out)
    extras = {e["key"]: e for e in data["rows"][0]["extras"]}
    assert extras["block-exotic-subdeps"]["ok"] is True
    assert extras["block-exotic-subdeps"]["defaultEnforced"] is True
    assert extras["block-exotic-subdeps"]["configured"] is None
    assert extras["trust-policy"]["ok"] is False
    assert code == 1


def test_pnpm_pre11_still_flags_block_exotic_subdeps(tmp_path):
    (tmp_path / ".npmrc").write_text("minimum-release-age=4320\n")
    _, out, _ = run(["check", "--json", "--tool", "pnpm"], tmp_path, PMSEC_PNPM_VERSION="10.26.0")
    extras = {e["key"]: e for e in json.loads(out)["rows"][0]["extras"]}
    assert extras["block-exotic-subdeps"]["ok"] is False
    assert extras["block-exotic-subdeps"].get("defaultEnforced", False) is False


def test_days_flag_overrides_bundle_cooldown(tmp_path):
    code, _, _ = run(["enable", "--days", "7"], tmp_path)
    assert code == 0
    npmrc = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=7" in npmrc
    assert "minimum-release-age=10080" in npmrc
    assert 'exclude-newer = "7 days"' in (tmp_path / ".config" / "uv" / "uv.toml").read_text()
    assert "minimumReleaseAge = 604800" in (tmp_path / ".bunfig.toml").read_text()

    code, out, _ = run(["check", "--json", "--days", "7"], tmp_path)
    assert code == 0
    assert json.loads(out)["bundleDays"] == 7

    code, _, _ = run(["check"], tmp_path)
    assert code == 0

    code, _, _ = run(["check", "--days", "30"], tmp_path)
    assert code == 1


@pytest.mark.parametrize("bad", ["0", "-1", "abc"])
def test_days_rejects_invalid(tmp_path, bad):
    with pytest.raises(SystemExit) as exc:
        run(["enable", "--days", bad], tmp_path)
    assert exc.value.code == 2


@pytest.mark.parametrize("flag", ["--version", "-V"])
def test_version_flag_prints_package_version(tmp_path, capsys, flag):
    from pmsec import __version__
    with pytest.raises(SystemExit) as exc:
        run([flag], tmp_path)
    assert exc.value.code == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == f"pmsec {__version__}"
