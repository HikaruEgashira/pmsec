from __future__ import annotations

import re
import subprocess


def detect_version(bin_name: str, args: list[str] | None = None) -> tuple[int, int, int, str] | None:
    args = args or ["--version"]
    try:
        out = subprocess.run([bin_name, *args], capture_output=True, text=True, timeout=5)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", out.stdout or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(0)


def gte(v: tuple[int, int, int, str] | None, target: tuple[int, int, int]) -> bool | None:
    if v is None:
        return None
    if v[0] != target[0]:
        return v[0] > target[0]
    if v[1] != target[1]:
        return v[1] > target[1]
    return v[2] >= target[2]
