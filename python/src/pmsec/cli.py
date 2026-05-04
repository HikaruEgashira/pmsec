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
DEFAULT_MIN = 7

USAGE_EPILOG = """\
examples:
  uvx pmsec check --min 7
  uvx pmsec set 7
  uvx pmsec unset --tool npm
"""


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pmsec",
        description="Inspect and apply install-time cooldown for npm, pnpm, yarn, bun, cargo, mise, and uv.",
        epilog=USAGE_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("-V", "--version", action="version", version=f"pmsec {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--tool", help="comma-separated subset of tools (npm,pnpm,yarn,bun,cargo,mise,uv)")
    common.add_argument("--json", action="store_true", help="emit JSON output")

    c = sub.add_parser("check", parents=[common], help="inspect cooldown settings")
    c.add_argument("--min", type=int, default=DEFAULT_MIN, help=f"minimum days (default {DEFAULT_MIN})")

    s = sub.add_parser("set", parents=[common], help="apply cooldown")
    s.add_argument("days", type=int, help="cooldown in days (must be > 0)")

    sub.add_parser("unset", parents=[common], help="remove cooldown")

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
        rows.append({"tool": t.NAME, "key": t.KEY, "warn": _preflight_warn(t), **r})
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
    return "\n".join(out) + "\n"


def _check(args, targets, env, home, platform, out, err):
    rows = _gather(targets, env, home, platform)
    failing = [r for r in rows if r["days"] is None or r["days"] < args.min]
    if args.json:
        out.write(json.dumps({"min": args.min, "rows": rows, "ok": not failing}, indent=2) + "\n")
    else:
        out.write(_render_human(rows, args.min))
    if failing:
        err.write(f"pmsec: {len(failing)} tool(s) below {args.min} days\n")
        return 1
    return 0


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


def _set(args, targets, env, home, platform, out, err):
    if args.days <= 0:
        err.write("pmsec: set requires integer DAYS > 0\n")
        return 2
    results = []
    failures = []
    warnings = []
    for t in targets:
        warn = _preflight_warn(t)
        if warn:
            warnings.append({"tool": t.NAME, "warn": warn})
        try:
            r = t.write(args.days, env, home, platform)
            results.append({"tool": t.NAME, "path": r["path"], "days": args.days, "ok": True, "warn": warn})
        except OSError as exc:
            msg = _explain_fs_error(exc, t.NAME)
            failures.append(msg)
            results.append({"tool": t.NAME, "path": getattr(exc, "filename", None), "days": args.days, "ok": False, "error": msg, "warn": warn})
    if args.json:
        out.write(json.dumps({"set": args.days, "results": results, "warnings": warnings, "ok": not failures}, indent=2) + "\n")
    else:
        for r in results:
            if r["ok"]:
                out.write(f"set  {r['tool']:<4} {r['days']} days  [{r['path']}]\n")
                if r.get("warn"):
                    out.write(f"     ⚠ {r['warn']}\n")
            else:
                out.write(f"FAIL {r['tool']:<4} {r['error']}\n")
    for msg in failures:
        err.write(f"pmsec: {msg}\n")
    if warnings:
        err.write(f"pmsec: {len(warnings)} tool(s) configured but runtime may silently ignore the cooldown — see ⚠ above\n")
    return 1 if failures else 0


def _unset(args, targets, env, home, platform, out, err):
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
                out.write(f"FAIL {r['tool']:<4} {r['error']}\n")
            else:
                tag = "rm  " if r["removed"] else "skip"
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
    if args.command == "set":
        return _set(args, targets, env, home, platform, out, err)
    if args.command == "unset":
        return _unset(args, targets, env, home, platform, out, err)
    return 2
