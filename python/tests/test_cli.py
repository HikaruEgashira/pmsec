from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pmsec.cli import main  # noqa: E402


def env_for(home: Path, **overrides: str) -> dict[str, str]:
    # Hide the host pnpm/bundler by default so version-aware behavior (pnpm 11
    # default enforcement, bundler preflight warnings) doesn't depend on what's
    # installed on the test machine.
    base = {
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "PMSEC_PNPM_VERSION": "none",
        "PMSEC_BUNDLER_VERSION": "none",
    }
    base.update(overrides)
    return base


def run(argv, home, platform="linux", **env_overrides):
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, env=env_for(home, **env_overrides), home=home, platform=platform, out=out, err=err)
    return code, out.getvalue(), err.getvalue()


# Catches a class of formatting bug where the human-readable output
# leaks unresolved placeholders ({N}) because of a string-construction
# mistake. Walks every code path that emits a formatted line.
def test_human_output_has_no_unresolved_placeholders(tmp_path):
    scenarios = [
        ("enable", lambda h: None, ["--tool", "npm", "--days", "7"]),
        ("keep", lambda h: (h / ".npmrc").write_text("min-release-age=99\n"), ["--tool", "npm"]),
        ("upgrade", lambda h: (h / ".npmrc").write_text("min-release-age=3\n"), ["--tool", "npm", "--days", "7"]),
        ("check_fail", lambda h: None, ["--check"]),
        ("check_pass", lambda h: run([], h), ["--check"]),
        ("disable", lambda h: run(["--tool", "npm"], h), ["--disable", "--tool", "npm"]),
    ]
    for name, setup, argv in scenarios:
        h = tmp_path / name
        h.mkdir()
        setup(h)
        _, out, err = run(argv, h)
        assert not re.search(r"\{[0-9]+\}", out + err), f"{name} leaked placeholder: {out}{err}"


def test_default_invocation_writes_bundle_for_every_tool(tmp_path):
    code, _, _ = run([], tmp_path)
    assert code == 0
    npmrc = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=1" in npmrc
    assert "audit-level=high" in npmrc
    assert "allow-git=root" in npmrc
    assert "allow-remote=root" in npmrc
    assert "minimum-release-age" not in npmrc, "pnpm keys must not leak into .npmrc"
    pnpmrc = (tmp_path / ".config" / "pnpm" / "rc").read_text()
    assert "minimum-release-age=1440" in pnpmrc
    assert "trust-policy=no-downgrade" in pnpmrc
    assert "block-exotic-subdeps=true" in pnpmrc
    assert "strict-dep-builds=true" in pnpmrc
    assert 'exclude-newer = "1 days"' in (tmp_path / ".config" / "uv" / "uv.toml").read_text()
    bunfig = (tmp_path / ".bunfig.toml").read_text()
    assert "[install]" in bunfig
    assert "minimumReleaseAge = 86400" in bunfig
    yarnrc = (tmp_path / ".yarnrc.yml").read_text()
    assert 'npmMinimalAgeGate: "1d"' in yarnrc
    assert "enableHardenedMode: true" in yarnrc
    assert "enableScripts: false" in yarnrc
    mise = (tmp_path / ".config" / "mise" / "config.toml").read_text()
    assert "[settings]" in mise
    assert 'minimum_release_age = "1d"' in mise
    assert "paranoid = true" in mise
    bundle = (tmp_path / ".bundle" / "config").read_text()
    assert 'BUNDLE_COOLDOWN: "1"' in bundle


def test_check_passes_after_default_enable(tmp_path):
    run([], tmp_path)
    code, _, _ = run(["--check"], tmp_path)
    assert code == 0


def test_check_fails_when_bundle_missing(tmp_path):
    code, out, _ = run(["--check"], tmp_path)
    assert code == 1
    for tool in ("npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv", "bundler"):
        assert f"MISSING {tool}" in out


def test_disable_preserves_other_keys(tmp_path):
    (tmp_path / ".npmrc").write_text(
        "registry=https://r/\nmin-release-age=3\n"
    )
    pnpm_dir = tmp_path / ".config" / "pnpm"
    pnpm_dir.mkdir(parents=True)
    (pnpm_dir / "rc").write_text("minimum-release-age=4320\nstore-dir=/tmp/pstore\n")
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
    run(["--disable"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == "registry=https://r/\n"
    assert (pnpm_dir / "rc").read_text() == "store-dir=/tmp/pstore\n"
    assert (uv_dir / "uv.toml").read_text() == 'index-strategy = "unsafe-best-match"\n'
    assert (tmp_path / ".bunfig.toml").read_text() == '[install]\nregistry = "https://x/"\n'
    assert (tmp_path / ".yarnrc.yml").read_text() == 'npmRegistryServer: "https://r/"\n'


def test_enable_upgrades_weak_existing_value(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=3\nregistry=https://r/\n")
    run(["--tool", "npm", "--days", "7"], tmp_path)
    assert (tmp_path / ".npmrc").read_text() == (
        "min-release-age=7\nregistry=https://r/\naudit-level=high\nallow-git=root\nallow-remote=root\n"
    )


def test_enable_preserves_stricter_existing_cooldown(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=99\nregistry=https://r/\n")
    code, out, _ = run(["--tool", "npm"], tmp_path)
    assert code == 0
    assert re.search(r"^keep\s+npm\s+\[[^\]]+\]\s+\(kept existing 99d \S+ \d+d\)", out, re.M)
    assert (tmp_path / ".npmrc").read_text() == (
        "min-release-age=99\nregistry=https://r/\naudit-level=high\nallow-git=root\nallow-remote=root\n"
    )


def test_enable_force_overwrites_stricter_existing(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=99\n")
    code, _, _ = run(["--tool", "npm", "--days", "1", "--force"], tmp_path)
    assert code == 0
    text = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=1" in text


def test_enable_days_upgrades_when_request_exceeds_existing(tmp_path):
    (tmp_path / ".npmrc").write_text("min-release-age=3\n")
    run(["--tool", "npm", "--days", "14"], tmp_path)
    text = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=14" in text


def test_tool_filter(tmp_path):
    run(["--tool", "npm,bun"], tmp_path)
    assert (tmp_path / ".npmrc").exists()
    assert (tmp_path / ".bunfig.toml").exists()
    assert not (tmp_path / ".config" / "uv" / "uv.toml").exists()


def test_windows_uv_path(tmp_path):
    appdata = tmp_path / "AppData" / "Roaming"
    out, err = io.StringIO(), io.StringIO()
    main(["--tool", "uv"], env={"APPDATA": str(appdata)}, home=tmp_path, platform="win32", out=out, err=err)
    assert (appdata / "uv" / "uv.toml").read_text().splitlines()[0] == 'exclude-newer = "1 days"'


def test_check_json(tmp_path):
    _, out, _ = run(["--check", "--json"], tmp_path)
    data = json.loads(out)
    assert data["ok"] is False
    assert data["bundleDays"] == 1
    assert len(data["rows"]) == 8
    assert [r["tool"] for r in data["rows"]] == ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv", "bundler"]


def test_bun_section_insert(tmp_path):
    (tmp_path / ".bunfig.toml").write_text('[install]\nregistry = "https://x/"\n')
    run(["--tool", "bun"], tmp_path)
    text = (tmp_path / ".bunfig.toml").read_text()
    assert text.startswith("[install]\nminimumReleaseAge = 86400\nregistry =")


def test_bun_creates_section_if_missing(tmp_path):
    (tmp_path / ".bunfig.toml").write_text("telemetry = false\n")
    run(["--tool", "bun"], tmp_path)
    text = (tmp_path / ".bunfig.toml").read_text()
    assert text == "telemetry = false\n\n[install]\nminimumReleaseAge = 86400\n"


def test_yarn_check_parses_days(tmp_path):
    (tmp_path / ".yarnrc.yml").write_text(
        'npmMinimalAgeGate: "14d"\nenableHardenedMode: true\nenableScripts: false\n'
    )
    _, out, _ = run(["--check", "--json", "--tool", "yarn"], tmp_path)
    data = json.loads(out)
    assert data["ok"] is True
    assert data["rows"][0]["days"] == 14


def test_bundler_enable_preserves_unrelated_keys(tmp_path):
    bundle_dir = tmp_path / ".bundle"
    bundle_dir.mkdir()
    (bundle_dir / "config").write_text('---\nBUNDLE_PATH: "vendor/bundle"\n')
    run(["--tool", "bundler", "--days", "7"], tmp_path)
    text = (bundle_dir / "config").read_text()
    assert 'BUNDLE_COOLDOWN: "7"' in text
    assert 'BUNDLE_PATH: "vendor/bundle"' in text


def test_bundler_check_parses_days(tmp_path):
    bundle_dir = tmp_path / ".bundle"
    bundle_dir.mkdir()
    (bundle_dir / "config").write_text('---\nBUNDLE_COOLDOWN: "14"\n')
    _, out, _ = run(["--check", "--json", "--tool", "bundler"], tmp_path)
    data = json.loads(out)
    assert data["ok"] is True
    assert data["rows"][0]["days"] == 14


def test_bundler_user_config_override(tmp_path):
    cfg = tmp_path / "custom-bundle-config"
    run(["--tool", "bundler"], tmp_path, BUNDLE_USER_CONFIG=str(cfg))
    assert 'BUNDLE_COOLDOWN: "1"' in cfg.read_text()


def test_pnpm_check_normalizes_minutes(tmp_path):
    pnpm_dir = tmp_path / ".config" / "pnpm"
    pnpm_dir.mkdir(parents=True)
    (pnpm_dir / "rc").write_text("minimum-release-age=20160\n")
    _, out, _ = run(["--check", "--json", "--tool", "pnpm"], tmp_path)
    data = json.loads(out)
    assert data["rows"][0]["days"] == 14


def test_bak_created_once(tmp_path):
    (tmp_path / ".npmrc").write_text("registry=https://original/\n")
    run(["--tool", "npm"], tmp_path)
    run(["--disable", "--tool", "npm"], tmp_path)
    run(["--tool", "npm"], tmp_path)
    assert (tmp_path / ".npmrc.bak").read_text() == "registry=https://original/\n"


def test_hardening_extras_roundtrip(tmp_path):
    pnpm_dir = tmp_path / ".config" / "pnpm"
    pnpm_dir.mkdir(parents=True)
    pnpmrc = pnpm_dir / "rc"
    pnpmrc.write_text("minimum-release-age=20160\n")
    code, out, _ = run(["--check", "--json", "--tool", "pnpm"], tmp_path)
    data = json.loads(out)
    assert code == 1
    assert len(data["rows"][0]["extras"]) == 3
    assert all(not e["ok"] for e in data["rows"][0]["extras"])

    run(["--tool", "pnpm"], tmp_path)
    text = pnpmrc.read_text()
    assert "trust-policy=no-downgrade" in text
    assert "block-exotic-subdeps=true" in text
    assert "strict-dep-builds=true" in text

    code, out, _ = run(["--check", "--json", "--tool", "pnpm"], tmp_path)
    assert code == 0
    assert json.loads(out)["ok"] is True

    run(["--disable", "--tool", "pnpm"], tmp_path)
    after = pnpmrc.read_text()
    assert "trust-policy" not in after
    assert "block-exotic-subdeps" not in after
    assert "strict-dep-builds" not in after
    assert "minimum-release-age" not in after


def test_pnpm_11_default_enforced_block_exotic_subdeps(tmp_path):
    # Cooldown present, but extras lines absent. Under pnpm 11 the runtime
    # still blocks exotic subdeps by default, so check must report it as OK
    # rather than MISSING (trust-policy stays MISSING — no default change).
    pnpm_dir = tmp_path / ".config" / "pnpm"
    pnpm_dir.mkdir(parents=True)
    (pnpm_dir / "rc").write_text("minimum-release-age=4320\n")
    code, out, _ = run(["--check", "--json", "--tool", "pnpm"], tmp_path, PMSEC_PNPM_VERSION="11.0.0")
    data = json.loads(out)
    extras = {e["key"]: e for e in data["rows"][0]["extras"]}
    assert extras["block-exotic-subdeps"]["ok"] is True
    assert extras["block-exotic-subdeps"]["defaultEnforced"] is True
    assert extras["block-exotic-subdeps"]["configured"] is None
    assert extras["trust-policy"]["ok"] is False
    assert code == 1


def test_pnpm_pre11_still_flags_block_exotic_subdeps(tmp_path):
    pnpm_dir = tmp_path / ".config" / "pnpm"
    pnpm_dir.mkdir(parents=True)
    (pnpm_dir / "rc").write_text("minimum-release-age=4320\n")
    _, out, _ = run(["--check", "--json", "--tool", "pnpm"], tmp_path, PMSEC_PNPM_VERSION="10.26.0")
    extras = {e["key"]: e for e in json.loads(out)["rows"][0]["extras"]}
    assert extras["block-exotic-subdeps"]["ok"] is False
    assert extras["block-exotic-subdeps"].get("defaultEnforced", False) is False


def test_days_flag_overrides_bundle_cooldown(tmp_path):
    code, _, _ = run(["--days", "7"], tmp_path)
    assert code == 0
    npmrc = (tmp_path / ".npmrc").read_text()
    assert "min-release-age=7" in npmrc
    pnpmrc = (tmp_path / ".config" / "pnpm" / "rc").read_text()
    assert "minimum-release-age=10080" in pnpmrc
    assert 'exclude-newer = "7 days"' in (tmp_path / ".config" / "uv" / "uv.toml").read_text()
    assert "minimumReleaseAge = 604800" in (tmp_path / ".bunfig.toml").read_text()

    code, out, _ = run(["--check", "--json", "--days", "7"], tmp_path)
    assert code == 0
    assert json.loads(out)["bundleDays"] == 7

    code, _, _ = run(["--check"], tmp_path)
    assert code == 0

    code, _, _ = run(["--check", "--days", "30"], tmp_path)
    assert code == 1


@pytest.mark.parametrize("bad", ["0", "-1", "abc"])
def test_days_rejects_invalid(tmp_path, bad):
    with pytest.raises(SystemExit) as exc:
        run(["--days", bad], tmp_path)
    assert exc.value.code == 2


def test_check_disable_mutually_exclusive(tmp_path):
    with pytest.raises(SystemExit) as exc:
        run(["--check", "--disable"], tmp_path)
    assert exc.value.code == 2


@pytest.mark.parametrize("flag", ["--version", "-V"])
def test_version_flag_prints_package_version(tmp_path, capsys, flag):
    from pmsec import __version__
    with pytest.raises(SystemExit) as exc:
        run([flag], tmp_path)
    assert exc.value.code == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == f"pmsec {__version__}"


def test_doctor_json_reports_per_tool_writability(tmp_path):
    code, out, _ = run(["--doctor", "--json"], tmp_path)
    data = json.loads(out)
    assert data["doctor"] is True
    assert data["ok"] is True
    assert code == 0
    # All eight tools surfaced in stable order with the writability quintet.
    tools = [t["tool"] for t in data["tools"]]
    assert tools == ["npm", "pnpm", "yarn", "bun", "cargo", "mise", "uv", "bundler"]
    for t in data["tools"]:
        for key in ("path", "parent", "exists", "writable", "parentExists", "parentWritable", "owner"):
            assert key in t, f"{t['tool']} missing {key}"
        assert t["parentWritable"] is True, f"{t['tool']} parent should be writable in fresh tmp_path"
    assert data["pmsecHomeSource"] == "HOME"


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission semantics; Windows ignores chmod for non-execute bits")
def test_doctor_blocks_when_parent_not_writable(tmp_path):
    blocked = tmp_path / "ro" / ".npmrc"
    blocked.parent.mkdir()
    # Drop write permission on the parent dir; doctor must report BLOCK.
    blocked.parent.chmod(0o500)
    try:
        code, out, _ = run(["--doctor", "--json", "--tool", "npm"],
                           tmp_path / "ro", NPM_CONFIG_USERCONFIG=str(blocked))
        data = json.loads(out)
        assert data["ok"] is False
        assert code == 1
        assert data["tools"][0]["parentWritable"] is False
    finally:
        blocked.parent.chmod(0o700)


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission semantics; Windows ignores chmod for non-execute bits")
def test_explain_fs_error_emits_chown_hint_for_permission_denied(tmp_path):
    # Make ~/.npmrc unwritable (owned by root would be ideal but we can't
    # sudo in tests). Setting the file readonly + parent dir readonly
    # produces PermissionError during atomic rename, which the explainer
    # should turn into a chown hint.
    (tmp_path / ".npmrc").write_text("registry=https://r/\n")
    (tmp_path / ".npmrc").chmod(0o400)
    (tmp_path).chmod(0o500)
    try:
        code, _, err = run(["--tool", "npm"], tmp_path)
        assert code == 1
        assert "Check file ownership" in err or "PermissionError" in err
    finally:
        (tmp_path).chmod(0o700)
        (tmp_path / ".npmrc").chmod(0o600)
