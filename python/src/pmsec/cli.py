from __future__ import annotations

import argparse
import json
import os
import shlex
import sys
from pathlib import Path

from pmsec import __version__
from pmsec.tools import aube, bun, bundler, cargo, mise, npm, pnpm, uv, yarn
from pmsec.util.context import Context
from pmsec.util.paths import current_platform

TOOLS = [npm, pnpm, yarn, bun, cargo, mise, uv, bundler, aube]
# Default cooldown for the hardening bundle. Override per-invocation with
# `--days N`; the default tracks the safest value we'd recommend.
BUNDLE_DAYS = 1

USAGE_EPILOG = """\
examples:
  uvx pmsec
  uvx pmsec --days 7
  uvx pmsec --days 1 --force
  uvx pmsec --check
  uvx pmsec --disable --tool npm
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
            "bun, cargo, mise, uv, and bundler. Default action enables every "
            "safe-by-default key each tool exposes (cooldown, audit-level, "
            "trust-policy, hardened mode, attestation re-verification, ...). No knobs."
        ),
        epilog=USAGE_EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("-V", "--version", action="version", version=f"pmsec {__version__}")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="verify the bundle is in place (exit 1 if anything missing)")
    mode.add_argument("--disable", action="store_true", help="remove the hardening bundle from selected tools")
    mode.add_argument("--doctor", action="store_true", help="diagnose effective paths/owner/uid (read-only; for unattended-deployment debugging)")
    p.add_argument("--tool", help="comma-separated subset of tools (npm,pnpm,yarn,bun,cargo,mise,uv,bundler)")
    p.add_argument("--json", action="store_true", help="emit JSON output")
    p.add_argument("--days", type=_positive_int, default=BUNDLE_DAYS, help=f"cooldown days (default {BUNDLE_DAYS})")
    p.add_argument("--force", action="store_true", help="overwrite stricter existing cooldowns (otherwise enable is monotonic)")
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


def _preflight_warn(t, ctx: Context) -> str | None:
    pf = getattr(t, "preflight", None)
    if pf is None:
        return None
    result = pf(ctx)
    return result.get("message")


def _gather(targets, ctx: Context):
    rows = []
    for t in targets:
        r = t.read(ctx)
        rows.append({"tool": t.NAME, "key": t.KEY, "warn": _preflight_warn(t, ctx), **r})
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
            if e["ok"]:
                ex_status = "OK     "
            elif e["configured"] is None:
                ex_status = "MISSING"
            else:
                ex_status = "STALE  "
            if e.get("defaultEnforced"):
                ex_value = f"(default — runtime enforces {e['expected']})"
            else:
                ex_value = e["configured"] or "(unset)"
            out.append(f"{ex_status} {r['tool']:<4} {e['key']} = {ex_value}  [{r['path']}]")
    return "\n".join(out) + "\n"


def _check(args, targets, ctx: Context, out, err):
    rows = _gather(targets, ctx)
    failing_primary = [r for r in rows if r["days"] is None or r["days"] < args.days]
    failing_extras = [e for r in rows for e in r.get("extras", []) if not e["ok"]]
    ok = not failing_primary and not failing_extras
    if args.json:
        out.write(json.dumps({"bundleDays": args.days, "rows": rows, "ok": ok}, indent=2) + "\n")
    else:
        out.write(_render_human(rows, args.days))
    if failing_primary:
        err.write(f"pmsec: {len(failing_primary)} tool(s) below {args.days} days — run `pmsec`\n")
    if failing_extras:
        err.write(f"pmsec: {len(failing_extras)} hardening setting(s) not at safe value — run `pmsec`\n")
    return 0 if ok else 1


# `pmsec doctor` runs read-only and reports the same path resolution that
# enable/check/disable would do, plus identity (uid/euid) and parent-dir
# writability — the smallest set of facts an operator needs to diagnose
# "pmsec ran but wrote to nowhere" (root's $HOME) or "wrote a file no one
# can read" (chown failed under SIP/SELinux). Never mutates the filesystem.
def _probe_path(p: Path, uid: int | None) -> dict:
    parent = p.parent
    exists = p.exists()
    writable = False
    owner: int | None = None
    if exists:
        writable = os.access(str(p), os.W_OK)
        try:
            st = p.stat()
            owner = uid if uid is None else st.st_uid
        except OSError:
            pass
    parent_exists = parent.exists()
    # Walk up to the deepest existing ancestor — pmsec runs mkdir -p, so what
    # matters is whether that ancestor is writable, not the literal parent.
    probe = parent
    ancestor: Path | None = None
    while True:
        if probe.exists():
            ancestor = probe
            break
        if probe.parent == probe:
            break
        probe = probe.parent
    parent_writable = bool(ancestor) and os.access(str(ancestor), os.W_OK)
    return {
        "path": str(p),
        "parent": str(parent),
        "exists": exists,
        "writable": writable,
        "parentExists": parent_exists,
        "parentWritable": parent_writable,
        "owner": owner,
    }


def _doctor(args, targets, ctx: Context, out) -> int:
    is_posix = ctx.platform != "win32" and hasattr(os, "geteuid")
    uid = os.getuid() if is_posix else None
    euid = os.geteuid() if is_posix else uid
    try:
        import pwd
        username = pwd.getpwuid(euid).pw_name if is_posix and euid is not None else None
    except (ImportError, KeyError):
        username = None
    tools = []
    for t in targets:
        p = Path(t.path(ctx))
        probe = _probe_path(p, uid)
        tools.append({"tool": t.NAME, "key": t.KEY, **probe})
    # doctor.ok is intentionally narrow: parent must be writable as the
    # running uid. Everything else is informational.
    ok_flag = all(t["parentWritable"] for t in tools)
    pmsec_home = ctx.env.get("PMSEC_HOME")
    report = {
        "doctor": True,
        "version": __version__,
        "platform": ctx.platform,
        "uid": uid,
        "euid": euid,
        "username": username,
        "home": str(ctx.home),
        "pmsecHome": pmsec_home,
        "pmsecHomeSource": "PMSEC_HOME" if pmsec_home else "HOME",
        "tools": tools,
        "ok": ok_flag,
    }
    if args.json:
        out.write(json.dumps(report, indent=2) + "\n")
        return 0 if ok_flag else 1
    out.write(f"pmsec {__version__}  doctor\n")
    out.write(f"  platform   : {ctx.platform}\n")
    if is_posix:
        suffix = f" ({username})" if username else ""
        out.write(f"  uid/euid   : {uid}/{euid}{suffix}\n")
    out.write(f"  HOME       : {ctx.home}\n")
    out.write(f"  PMSEC_HOME : {pmsec_home or '(unset — using HOME)'}\n\n")
    for t in tools:
        flag = "ok    " if t["parentWritable"] else "BLOCK "
        owner_suffix = f" (uid={t['owner']})" if t["exists"] and t["owner"] is not None else ""
        out.write(f"{flag} {t['tool']:<4} {t['path']}{owner_suffix}\n")
        if not t["parentWritable"]:
            out.write(f"         no writable ancestor for {t['parent']}\n")
    if not ok_flag:
        uid_label = uid if uid is not None else "(non-POSIX)"
        out.write(f"\npmsec doctor: at least one parent directory is not writable as uid {uid_label}.\n")
    return 0 if ok_flag else 1


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


def _enable(args, targets, ctx: Context, out, err):
    results = []
    failures = []
    warnings = []
    requested = args.days
    force = args.force
    for t in targets:
        warn = _preflight_warn(t, ctx)
        if warn:
            warnings.append({"tool": t.NAME, "warn": warn})
        try:
            if force:
                effective, kept = requested, False
            else:
                current = t.read(ctx)
                current_days = current.get("days") or 0
                effective = max(current_days, requested)
                kept = current_days >= requested and current_days > 0
            r = t.write(effective, ctx)
            results.append({"tool": t.NAME, "path": r["path"], "days": effective, "requested": requested, "kept": kept, "forced": force, "ok": True, "warn": warn})
        except OSError as exc:
            msg = _explain_fs_error(exc, t.NAME)
            failures.append(msg)
            results.append({"tool": t.NAME, "path": getattr(exc, "filename", None), "days": requested, "requested": requested, "kept": False, "forced": force, "ok": False, "error": msg, "warn": warn})
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


def _disable(args, targets, ctx: Context, out, err):
    results = []
    failures = []
    for t in targets:
        try:
            r = t.unset(ctx)
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
    ctx = Context(env=env, home=home, platform=platform)
    if args.check:
        return _check(args, targets, ctx, out, err)
    if args.disable:
        return _disable(args, targets, ctx, out, err)
    if args.doctor:
        return _doctor(args, targets, ctx, out)
    return _enable(args, targets, ctx, out, err)
