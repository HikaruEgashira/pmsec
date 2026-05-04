from __future__ import annotations

import argparse
import json
import shlex
import sys
from pathlib import Path

from pmsec import __version__
from pmsec.tools import bun, cargo, mise, npm, pnpm, uv, yarn
from pmsec.util.paths import current_platform

TOOLS = [npm, pnpm, yarn, bun, cargo, mise, uv]
# Default cooldown for the hardening bundle. Override per-invocation with
# `--days N`; the default tracks the safest value we'd recommend.
BUNDLE_DAYS = 3

USAGE_EPILOG = """\
examples:
  uvx pmsec enable
  uvx pmsec enable --days 7
  uvx pmsec check
  uvx pmsec disable --tool npm
"""


def _positive_int(raw: str) -> int:
    try:
        n = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"--days must be a positive integer (got {raw!r})") from exc
    if n < 1:
        raise argparse.ArgumentTypeError(f"--days must be a positive integer (got {raw!r})")
    return n


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pmsec",
        description=(
            "Zero-config install-time supply-chain hardening for npm, pnpm, yarn, "
            "bun, cargo, mise, and uv. `enable` flips on every safe-by-default key "
            "each tool exposes (cooldown, audit-level, trust-policy, hardened mode, "
            "attestation re-verification, ...). No knobs."
        ),
        epilog=USAGE_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("-V", "--version", action="version", version=f"pmsec {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--tool", help="comma-separated subset of tools (npm,pnpm,yarn,bun,cargo,mise,uv)")
    common.add_argument("--json", action="store_true", help="emit JSON output")
    common.add_argument("--days", type=_positive_int, default=BUNDLE_DAYS, help=f"cooldown days (default {BUNDLE_DAYS})")

    sub.add_parser("enable", parents=[common], help="apply the hardening bundle")
    sub.add_parser("disable", parents=[common], help="remove the hardening bundle")
    sub.add_parser("check", parents=[common], help="verify the hardening bundle is in place")

    return p


def _select(only: str | None) -> list:
    if not only:
        return TOOLS
    names = [n.strip() for n in only.split(",") if n.strip()]
    found = [t for t in TOOLS if t.NAME in names]
    missing = [n for n in names if not any(t.NAME == n for t in TOOLS)]
    if missing:
        raise SystemExit(f"pmsec: unknown tool(s): {','.join(missing)}")
    return found


def _preflight_warn(t) -> str | None:
    pf = getattr(t, "preflight", None)
    if pf is None:
        return None
    result = pf()
    return result.get("message")


def _gather(targets, env, home, platform):
    rows = []
    for t in targets:
        r = t.read(env, home, platform)
        row = {"tool": t.NAME, "key": t.KEY, "warn": _preflight_warn(t), **r}
        row.setdefault("extras", [])
        rows.append(row)
    return rows


def _render_human(rows, min_days):
    out = []
    for r in rows:
        if r["days"] is None:
            status = "MISSING"
        elif r["days"] < min_days:
            status = "STALE  "
        else:
            status = "OK     "
        out.append(f"{status} {r['tool']:<4} {r['key']} = {r['configured'] or '(unset)'}  [{r['path']}]")
        if r.get("warn"):
            out.append(f"       ⚠ {r['warn']}")
        for e in r.get("extras", []):
            if e["configured"] is None:
                ex_status = "MISSING"
            elif e["ok"]:
                ex_status = "OK     "
            else:
                ex_status = "STALE  "
            out.append(f"{ex_status} {r['tool']:<4} {e['key']} = {e['configured'] or '(unset)'}  [{r['path']}]")
    return "\n".join(out) + "\n"


def _check(args, targets, env, home, platform, out, err):
    rows = _gather(targets, env, home, platform)
    failing_primary = [r for r in rows if r["days"] is None or r["days"] < args.days]
    failing_extras = [e for r in rows for e in r.get("extras", []) if not e["ok"]]
    ok = not failing_primary and not failing_extras
    if args.json:
        out.write(json.dumps({"bundleDays": args.days, "rows": rows, "ok": ok}, indent=2) + "\n")
    else:
        out.write(_render_human(rows, args.days))
    if failing_primary:
        err.write(f"pmsec: {len(failing_primary)} tool(s) below {args.days} days — run `pmsec enable`\n")
    if failing_extras:
        err.write(f"pmsec: {len(failing_extras)} hardening setting(s) not at safe value — run `pmsec enable`\n")
    return 0 if ok else 1


def _explain_fs_error(exc: BaseException, tool: str) -> str:
    if isinstance(exc, PermissionError):
        path = getattr(exc, "filename", "") or ""
        q = shlex.quote(path) if path else ""
        return (
            f"{tool}: cannot write {path} (PermissionError). "
            f"Check file ownership: `ls -la {q}` — if owned by root, "
            f"run `sudo chown -h $(id -u):$(id -g) {q}`."
        )
    if isinstance(exc, OSError) and exc.errno == 30:
        path = getattr(exc, "filename", "") or ""
        return f"{tool}: {path} is on a read-only filesystem (EROFS)."
    return f"{tool}: {exc}"


def _enable(args, targets, env, home, platform, out, err):
    results = []
    failures = []
    warnings = []
    requested = args.days
    for t in targets:
        warn = _preflight_warn(t)
        if warn:
            warnings.append({"tool": t.NAME, "warn": warn})
        try:
            current = t.read(env, home, platform)
            current_days = current.get("days") or 0
            effective = max(current_days, requested)
            kept = current_days >= requested and current_days > 0
            r = t.write(effective, env, home, platform)
            results.append({"tool": t.NAME, "path": r["path"], "days": effective, "requested": requested, "kept": kept, "ok": True, "warn": warn})
        except OSError as exc:
            msg = _explain_fs_error(exc, t.NAME)
            failures.append(msg)
            results.append({"tool": t.NAME, "path": getattr(exc, "filename", None), "days": requested, "requested": requested, "kept": False, "ok": False, "error": msg, "warn": warn})
    if args.json:
        out.write(json.dumps({"enabled": True, "bundleDays": requested, "results": results, "warnings": warnings, "ok": not failures}, indent=2) + "\n")
    else:
        for r in results:
            if r["ok"]:
                action = "keep   " if r["kept"] else "enable "
                note = f"  (kept existing {r['days']}d ≥ {r['requested']}d)" if r["kept"] else ""
                out.write(f"{action} {r['tool']:<4} [{r['path']}]{note}\n")
                if r.get("warn"):
                    out.write(f"     ⚠ {r['warn']}\n")
            else:
                out.write(f"FAIL    {r['tool']:<4} {r['error']}\n")
    for msg in failures:
        err.write(f"pmsec: {msg}\n")
    if warnings:
        err.write(f"pmsec: {len(warnings)} tool(s) configured but runtime may silently ignore the cooldown — see ⚠ above\n")
    return 1 if failures else 0


def _disable(args, targets, env, home, platform, out, err):
    results = []
    failures = []
    for t in targets:
        try:
            r = t.unset(env, home, platform)
            results.append({"tool": t.NAME, "path": r["path"], "removed": r["removed"], "ok": True})
        except OSError as exc:
            msg = _explain_fs_error(exc, t.NAME)
            failures.append(msg)
            results.append({"tool": t.NAME, "path": getattr(exc, "filename", None), "removed": False, "ok": False, "error": msg})
    if args.json:
        out.write(json.dumps({"results": results, "ok": not failures}, indent=2) + "\n")
    else:
        for r in results:
            if not r["ok"]:
                out.write(f"FAIL    {r['tool']:<4} {r['error']}\n")
            else:
                tag = "disable " if r["removed"] else "skip    "
                out.write(f"{tag} {r['tool']:<4} [{r['path']}]\n")
    for msg in failures:
        err.write(f"pmsec: {msg}\n")
    return 1 if failures else 0


def main(
    argv: list[str] | None = None,
    *,
    env: dict[str, str] | None = None,
    home: Path | None = None,
    platform: str | None = None,
    out=None,
    err=None,
) -> int:
    import os

    env = dict(os.environ) if env is None else env
    home = Path.home() if home is None else home
    platform = current_platform() if platform is None else platform
    out = sys.stdout if out is None else out
    err = sys.stderr if err is None else err

    args = _parser().parse_args(argv)
    targets = _select(args.tool)
    if args.command == "check":
        return _check(args, targets, env, home, platform, out, err)
    if args.command == "enable":
        return _enable(args, targets, env, home, platform, out, err)
    if args.command == "disable":
        return _disable(args, targets, env, home, platform, out, err)
    return 2
