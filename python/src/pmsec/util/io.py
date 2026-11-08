from __future__ import annotations

import os
import secrets
import stat
import sys
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


def _is_root() -> bool:
    return hasattr(os, "geteuid") and os.geteuid() == 0


def _is_under(p: str, root: str) -> bool:
    return p == root or p.startswith(root.rstrip(os.sep) + os.sep)


def _top_missing(dir: Path, home: Path) -> Path | None:
    """The topmost ancestor of `dir` that mkdir is about to create, so the
    handback only touches dirs pmsec made, never an existing user-owned dir."""
    if dir.is_dir():
        return None
    top = dir
    while top.parent != top and top != home and not top.parent.is_dir():
        top = top.parent
    return top


def root_dir_guard(dir: Path, home: Path) -> None:
    """Under root, a user-planted symlinked directory (`~/.config -> /etc`)
    would make mkdir/replace act on the link target. Refuse when a path that is
    lexically inside the target home resolves physically outside it. Paths
    already outside the home (operator-set CARGO_HOME etc.) are the operator's
    choice and pass through unchanged."""
    dir = Path(os.path.abspath(dir))
    home = Path(os.path.abspath(home))
    if not _is_under(str(dir), str(home)):
        return
    try:
        home_phys = os.path.realpath(home, strict=True)
    except OSError:
        return
    # The leaf may not exist yet (mkdir creates it); resolve the deepest
    # existing ancestor, since that is where mkdir would follow a link.
    probe = dir
    while not probe.is_dir() and probe.parent != probe and probe != home:
        probe = probe.parent
    try:
        dir_phys = os.path.realpath(probe, strict=True)
    except OSError:
        return
    if _is_under(dir_phys, home_phys):
        return
    raise OSError(f"refusing to write under {dir}: it resolves to {dir_phys}, outside {home_phys}")


def _lchown_tree(p: Path, uid: int, gid: int) -> None:
    os.chown(p, uid, gid, follow_symlinks=False)
    if stat.S_ISDIR(p.lstat().st_mode):
        for child in p.iterdir():
            _lchown_tree(child, uid, gid)


def handback(path: Path, bak: Path, top_created: Path | None, home: Path, err=None) -> None:
    """Hand the freshly-written file (and dirs we created) back to the home
    owner. follow_symlinks=False never follows a link, so even a link swapped in
    after our own checks cannot redirect a root chown outside the user's home.
    A failed chown is a warning, not an error: the config is in place, but the
    operator needs to fix ownership or the user cannot read it."""
    err = sys.stderr if err is None else err
    try:
        st = os.stat(home)
    except OSError:
        return
    if not stat.S_ISDIR(st.st_mode):
        return
    uid, gid = st.st_uid, st.st_gid
    try:
        os.chown(path, uid, gid, follow_symlinks=False)
    except OSError as exc:
        err.write(f"pmsec: warning: chown {uid} {path} failed ({exc}); file may be unreadable for the user\n")
    if bak.exists():
        try:
            os.chown(bak, uid, gid, follow_symlinks=False)
        except OSError as exc:
            err.write(f"pmsec: warning: chown {uid} {bak} failed ({exc})\n")
    if top_created is not None and top_created.is_dir():
        try:
            _lchown_tree(top_created, uid, gid)
        except OSError as exc:
            err.write(f"pmsec: warning: chown -R {uid} {top_created} failed ({exc})\n")


# Permission errors propagate to the caller, which prints a chown hint. pmsec
# never escalates privileges itself: an unwritable config under HOME is an
# operator decision (or a symptom worth seeing), not something to sudo past.
# `home` is the target home (PMSEC_HOME or HOME); under root it enables the
# physical-path guard and the ownership handback.
def write_atomic(path: Path, text: str, *, backup: bool = True, home: Path | None = None) -> None:
    as_root = home is not None and _is_root()
    top_created = _top_missing(Path(os.path.abspath(path.parent)), Path(os.path.abspath(home))) if as_root else None
    if as_root:
        root_dir_guard(path.parent, home)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and _is_symlink(path):
        raise OSError(f"refusing to write through symlink {path}")
    bak = path.with_suffix(path.suffix + ".bak")
    # A dangling symlink fails exists(); os.replace would swap the link
    # itself, but refuse so a planted link is visible, not silently clobbered.
    if _is_symlink(bak):
        raise OSError(f"refusing to write backup through symlink {bak}")
    if as_root:
        root_dir_guard(path.parent, home)
    if backup and path.exists() and not bak.exists():
        _atomic_replace(bak, path.read_text("utf-8-sig"))
    _atomic_replace(path, text)
    if as_root:
        handback(path, bak, top_created, home)
