from __future__ import annotations

import json
import re
from pathlib import Path

from pmsec.util.context import Context
from pmsec.util.extras import apply_extras, read_extras, remove_extras
from pmsec.util.io import write_atomic
from pmsec.util.lines import read_key, remove_key, set_key
from pmsec.util.paths import mise_config_path, mise_layer_paths, mise_supports_new_mode
from pmsec.util.version import build_preflight, detect_version

NAME = "mise"
KEY = "minimum_release_age"
SECTION = "settings"
DOCS = "https://mise.jdx.dev/configuration/settings.html#minimum_release_age"
MIN_BIN = (2026, 4, 22)
EXTRAS = [
    {"key": "paranoid", "expected": "true", "line": "paranoid = true", "section": SECTION},
    {"key": "gpg_verify", "expected": "true", "line": "gpg_verify = true", "section": SECTION},
    {"key": "github_attestations", "expected": "true", "line": "github_attestations = true", "section": SECTION},
    {"key": "slsa", "expected": "true", "line": "slsa = true", "section": SECTION},
    {"key": "locked_verify_provenance", "expected": "true", "line": "locked_verify_provenance = true", "section": SECTION},
    {"key": "ruby.github_attestations", "expected": "true", "line": "ruby.github_attestations = true", "section": SECTION},
    {"key": "python.github_attestations", "expected": "true", "line": "python.github_attestations = true", "section": SECTION},
    {"key": "provenance_api_failures_fatal", "expected": "true", "line": "provenance_api_failures_fatal = true", "section": SECTION},
    {"key": "aqua.github_attestations", "expected": "true", "line": "aqua.github_attestations = true", "section": SECTION},
    {"key": "aqua.cosign", "expected": "true", "line": "aqua.cosign = true", "section": SECTION},
    {"key": "aqua.minisign", "expected": "true", "line": "aqua.minisign = true", "section": SECTION},
    {"key": "aqua.slsa", "expected": "true", "line": "aqua.slsa = true", "section": SECTION},
    {"key": "github.github_attestations", "expected": "true", "line": "github.github_attestations = true", "section": SECTION},
    {"key": "github.slsa", "expected": "true", "line": "github.slsa = true", "section": SECTION},
    {"key": "node.gpg_verify", "expected": "true", "line": "node.gpg_verify = true", "section": SECTION},
    {"key": "swift.gpg_verify", "expected": "true", "line": "swift.gpg_verify = true", "section": SECTION},
    {"key": "not_found_system_fallback", "expected": "false", "line": "not_found_system_fallback = false", "section": SECTION},
]

preflight = build_preflight(
    NAME, MIN_BIN,
    "setting was named install_before before 2026.4.22 and minimum_release_age is silently "
    "ignored on older mise. Upgrade mise (`mise self-update`) to enforce the cooldown.",
)

_DURATION = re.compile(
    r'^"?\s*(\d+)\s*(d|days?|w|weeks?|m|months?|y|years?)\s*"?$',
    re.IGNORECASE,
)


def _new_mode(ctx: Context) -> bool:
    # New mode (#194): managed keys live in config.pmsec.toml, loaded through
    # `env = ["pmsec"]` in miserc.local.toml, instead of the user's config.toml.
    v = detect_version("mise", env=ctx.env, override_key="PMSEC_MISE_VERSION")
    return mise_supports_new_mode(v, ctx.env)


def _layers(ctx: Context) -> dict[str, Path]:
    return mise_layer_paths(ctx.env, ctx.home, ctx.platform)


def path(ctx: Context) -> Path:
    if _new_mode(ctx):
        return _layers(ctx)["pmsec_config"]
    return mise_config_path(ctx.env, ctx.home, ctx.platform)


_ENV_LINE = re.compile(r"""^(\s*env\s*=\s*)(\[[^\]]*\]|"[^"]*"|'[^']*')(.*)$""")


def add_mise_env(text: str) -> str:
    """Add "pmsec" to the top-level `env` of a miserc file, keeping other entries."""
    lines = re.split(r"\r?\n", text)
    for i, line in enumerate(lines):
        if re.match(r"^\s*\[", line):
            break
        m = _ENV_LINE.match(line)
        if not m:
            continue
        items = [a if a or not b else b for a, b in re.findall(r'"([^"]*)"|\'([^\']*)\'', m.group(2))]
        if "pmsec" in items:
            return text
        items.append("pmsec")
        lines[i] = f"{m.group(1)}[{', '.join(json.dumps(x) for x in items)}]{m.group(3)}"
        return ("\r\n" if "\r\n" in text else "\n").join(lines)
    return set_key(text, "env", 'env = ["pmsec"]')


def _read_text(p: Path) -> str:
    return p.read_text("utf-8-sig") if p.exists() else ""


def _parse_days(value: str | None) -> int | None:
    if value is None:
        return None
    m = _DURATION.match(value)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2).lower()
    if unit in ("w", "week", "weeks"):
        return n * 7
    if unit in ("m", "month", "months"):
        return n * 30
    if unit in ("y", "year", "years"):
        return n * 365
    return n


def _read_layer(raw: str) -> dict:
    value = read_key(raw, KEY, section=SECTION)
    return {"configured": value, "days": _parse_days(value), "extras": read_extras(raw, EXTRAS)}


def _strip_managed(text: str) -> tuple[str, bool]:
    after, removed_cooldown = remove_key(text, KEY, section=SECTION)
    after, removed_extras = remove_extras(after, EXTRAS)
    return after, removed_cooldown or removed_extras


def read(ctx: Context) -> dict:
    p = path(ctx)
    cur = _read_layer(_read_text(p))
    if not _new_mode(ctx):
        return {"path": str(p), **cur}
    # Before migration the managed keys still sit in config.toml; report the
    # strictest cooldown so enable carries it into config.pmsec.toml.
    old = _read_layer(_read_text(_layers(ctx)["base_config"]))
    use_old = old["days"] is not None and (cur["days"] is None or old["days"] > cur["days"])
    merged = [o if e["configured"] is None else e for e, o in zip(cur["extras"], old["extras"])]
    src = old if use_old else cur
    return {"path": str(p), "configured": src["configured"], "days": src["days"], "extras": merged}


def write(days: int, ctx: Context) -> dict:
    p = path(ctx)
    text = apply_extras(set_key(_read_text(p), KEY, f'{KEY} = "{days}d"', section=SECTION), EXTRAS, ctx)
    write_atomic(p, text, home=ctx.home)
    if _new_mode(ctx):
        layers = _layers(ctx)
        rc = _read_text(layers["local_miserc"])
        next_rc = add_mise_env(rc)
        if next_rc != rc:
            write_atomic(layers["local_miserc"], next_rc, home=ctx.home)
        base, removed = _strip_managed(_read_text(layers["base_config"]))
        if removed:
            write_atomic(layers["base_config"], base, home=ctx.home)
    return {"path": str(p)}


def unset(ctx: Context) -> dict:
    p = path(ctx)
    targets = [p]
    if _new_mode(ctx):
        targets.append(_layers(ctx)["base_config"])
    removed = False
    for t in targets:
        if not t.exists():
            continue
        after, r = _strip_managed(t.read_text("utf-8-sig"))
        if r:
            write_atomic(t, after, home=ctx.home)
            removed = True
    return {"path": str(p), "removed": removed}
