from __future__ import annotations

import os
import secrets
import shlex
import stat
import subprocess
import sys
from pathlib import Path


def _is_perm_err(exc: BaseException) -> bool:
    return isinstance(exc, PermissionError)


def _is_symlink(path: Path) -> bool:
    try:
        return stat.S_ISLNK(path.lstat().st_mode)
    except FileNotFoundError:
        return False


def _under_home(path: Path, home: Path) -> bool:
    try:
        target = path.resolve(strict=False)
        root = home.resolve(strict=False)
    except OSError:
        return False
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def _reclaim(path: Path, home: Path, err) -> bool:
    if sys.platform == "win32" or not hasattr(os, "geteuid"):
        return False
    if not path.exists():
        return False
    if _is_symlink(path):
        err.write(f"pmsec: refusing to chown symlink {path}; remove or replace it manually.\n")
        return False
    if not _under_home(path, home):
        err.write(f"pmsec: refusing to chown {path} outside HOME ({home}); fix ownership manually.\n")
        return False
    quoted = shlex.quote(str(path))
    err.write(
        f"pmsec: {path} not writable; running `sudo chown -h $(id -u):$(id -g) {quoted}`. "
        "You may be prompted for your password.\n"
    )
    err.flush()
    r = subprocess.run(["sudo", "chown", "-h", f"{os.geteuid()}:{os.getegid()}", str(path)])
    return r.returncode == 0


def _atomic_replace(path: Path, text: str) -> None:
    parent = path.parent
    tmp = parent / f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp"
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except OSError:
                    pass
        except BaseException:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            raise
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        raise


def write_atomic(path: Path, text: str, *, backup: bool = True, home: Path | None = None, err=sys.stderr) -> None:
    home = Path.home() if home is None else home
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and _is_symlink(path):
        raise OSError(f"refusing to write through symlink {path}")
    if backup and path.exists():
        bak = path.with_suffix(path.suffix + ".bak")
        if not bak.exists():
            try:
                _atomic_replace(bak, path.read_text("utf-8"))
            except OSError as exc:
                if not _is_perm_err(exc) or not _reclaim(bak if bak.exists() else path, home, err):
                    raise
                _atomic_replace(bak, path.read_text("utf-8"))
    try:
        _atomic_replace(path, text)
    except OSError as exc:
        if not _is_perm_err(exc) or not _reclaim(path, home, err):
            raise
        _atomic_replace(path, text)
