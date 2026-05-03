from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _is_perm_err(exc: BaseException) -> bool:
    return isinstance(exc, PermissionError) or (isinstance(exc, OSError) and exc.errno in (1, 13))


def _reclaim(path: Path, err) -> bool:
    if sys.platform == "win32" or not hasattr(os, "geteuid"):
        return False
    target = path if path.exists() else path.parent
    err.write(
        f"pmsec: {path} not writable; running `sudo chown $(id -u):$(id -g) {target}`. "
        "You may be prompted for your password.\n"
    )
    err.flush()
    r = subprocess.run(["sudo", "chown", f"{os.geteuid()}:{os.getegid()}", str(target)])
    return r.returncode == 0


def write_atomic(path: Path, text: str, *, backup: bool = True, err=sys.stderr) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        if not _is_perm_err(exc) or not _reclaim(path.parent, err):
            raise
        path.parent.mkdir(parents=True, exist_ok=True)
    if backup and path.exists():
        bak = path.with_suffix(path.suffix + ".bak")
        if not bak.exists():
            try:
                bak.write_text(path.read_text("utf-8"), "utf-8")
            except OSError as exc:
                if not _is_perm_err(exc) or not _reclaim(bak, err):
                    raise
                bak.write_text(path.read_text("utf-8"), "utf-8")
    try:
        path.write_text(text, "utf-8")
    except OSError as exc:
        if not _is_perm_err(exc) or not _reclaim(path, err):
            raise
        path.write_text(text, "utf-8")
