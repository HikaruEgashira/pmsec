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


def _euid() -> int | None:
    return os.geteuid() if hasattr(os, "geteuid") else None


def _within(child: Path, parent: Path) -> bool:
    return child == parent or parent in child.parents


# Under root, a user-planted symlinked directory (`~/.config -> /etc`) would
# make mkdir/replace act on the link target. Refuse when a path lexically
# inside the target home resolves physically outside it. Paths already
# outside the home (operator-set CARGO_HOME etc.) pass through unchanged.
def _root_dir_guard(directory: Path, home: Path) -> None:
    if not _within(directory, home):
        return
    try:
        home_phys = home.resolve(strict=True)
    except OSError:
        return
    # The leaf may not exist yet; resolve the deepest existing ancestor, since
    # that is where mkdir would follow a link.
    probe = directory
    while not probe.is_dir() and probe != home and probe != probe.parent:
        probe = probe.parent
    try:
        probe_phys = probe.resolve(strict=True)
    except OSError:
        return
    if not _within(probe_phys, home_phys):
        raise OSError(f"refusing to write under {directory}: it resolves to {probe_phys}, outside {home_phys}")


def _chown(p: Path, uid: int, gid: int) -> None:
    try:
        # follow_symlinks=False: a link swapped in after our checks cannot
        # redirect a root chown at a file outside the user's home.
        os.chown(p, uid, gid, follow_symlinks=False)
    except OSError as exc:
        sys.stderr.write(f"pmsec: warning: chown {uid}:{gid} {p} failed ({exc}); file may be unreadable for the user\n")


# Hand the written file (and dirs we created) back to the home owner when
# running as root. chown failures warn instead of failing: the config is in
# place, the operator just needs to fix ownership.
def _handback(path: Path, bak: Path, top_created: Path | None, home: Path) -> None:
    try:
        st = home.stat()
    except OSError:
        return
    _chown(path, st.st_uid, st.st_gid)
    if bak.exists() or _is_symlink(bak):
        _chown(bak, st.st_uid, st.st_gid)
    if top_created is not None and top_created.is_dir():
        _chown(top_created, st.st_uid, st.st_gid)
        for root, dirs, files in os.walk(top_created):
            for name in dirs + files:
                _chown(Path(root) / name, st.st_uid, st.st_gid)


# Permission errors propagate to the caller, which prints a chown hint. pmsec
# never escalates privileges itself: an unwritable config under HOME is an
# operator decision (or a symptom worth seeing), not something to sudo past.
# `home` is the target profile (PMSEC_HOME or HOME); under euid 0 it drives
# the physical-path guard and the ownership handback.
def write_atomic(path: Path, text: str, *, backup: bool = True, home: Path | None = None) -> None:
    as_root = home is not None and _euid() == 0
    top_created: Path | None = None
    if as_root:
        _root_dir_guard(path.parent, home)
        if not path.parent.is_dir():
            # Only chown ancestors we actually create, never an existing dir.
            top_created = path.parent
            while top_created.parent != top_created and top_created != home and not top_created.parent.is_dir():
                top_created = top_created.parent
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and _is_symlink(path):
        raise OSError(f"refusing to write through symlink {path}")
    bak = path.with_suffix(path.suffix + ".bak")
    if backup and path.exists():
        if not bak.exists():
            # A dangling symlink fails exists(); os.replace would swap the link
            # itself, but refuse so a planted link is visible, not silently clobbered.
            if _is_symlink(bak):
                raise OSError(f"refusing to write backup through symlink {bak}")
            _atomic_replace(bak, path.read_text("utf-8-sig"))
    _atomic_replace(path, text)
    if as_root:
        _handback(path, bak, top_created, home)
