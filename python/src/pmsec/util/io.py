from __future__ import annotations

import os
import secrets
import stat
from pathlib import Path


def _is_symlink(path: Path) -> bool:
    try:
        return stat.S_ISLNK(path.lstat().st_mode)
    except FileNotFoundError:
        return False


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


# Permission errors propagate to the caller, which prints a chown hint. pmsec
# never escalates privileges itself: an unwritable config under HOME is an
# operator decision (or a symptom worth seeing), not something to sudo past.
def write_atomic(path: Path, text: str, *, backup: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and _is_symlink(path):
        raise OSError(f"refusing to write through symlink {path}")
    if backup and path.exists():
        bak = path.with_suffix(path.suffix + ".bak")
        if not bak.exists():
            # A dangling symlink fails exists(); os.replace would swap the link
            # itself, but refuse so a planted link is visible, not silently clobbered.
            if _is_symlink(bak):
                raise OSError(f"refusing to write backup through symlink {bak}")
            _atomic_replace(bak, path.read_text("utf-8-sig"))
    _atomic_replace(path, text)
