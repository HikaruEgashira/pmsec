from __future__ import annotations

import re

_SECTION = re.compile(r"^\s*\[[^\]]+\]\s*$")
_KEY = re.compile(r"^\s*([A-Za-z0-9_.\-]+)\s*=")
_FULL = re.compile(r"^\s*[A-Za-z0-9_.\-]+\s*=\s*(.*?)\s*$")


def _line_key(line: str) -> str | None:
    m = _KEY.match(line)
    return m.group(1) if m else None


def _index_top_level(lines: list[str], key: str) -> int:
    for i, line in enumerate(lines):
        if _SECTION.match(line):
            return -1
        if _line_key(line) == key:
            return i
    return -1


def _index_first_section(lines: list[str]) -> int:
    for i, line in enumerate(lines):
        if _SECTION.match(line):
            return i
    return -1


def read_key(text: str, key: str) -> str | None:
    lines = text.splitlines()
    i = _index_top_level(lines, key)
    if i < 0:
        return None
    m = _FULL.match(lines[i])
    return m.group(1) if m else None


def set_key(text: str, key: str, value_line: str) -> str:
    trailing = text.endswith("\n") or text == ""
    lines = [] if text == "" else text.rstrip("\n").split("\n")
    idx = _index_top_level(lines, key)
    if idx >= 0:
        lines[idx] = value_line
    else:
        sec = _index_first_section(lines)
        if sec < 0:
            lines.append(value_line)
        else:
            lines[sec:sec] = [value_line, ""]
    out = "\n".join(lines)
    if trailing or lines:
        out += "\n"
    return out


def remove_key(text: str, key: str) -> tuple[str, bool]:
    trailing = text.endswith("\n")
    lines = [] if text == "" else text.rstrip("\n").split("\n")
    idx = _index_top_level(lines, key)
    if idx < 0:
        return text, False
    del lines[idx]
    if idx < len(lines) and lines[idx] == "":
        del lines[idx]
    out = "\n".join(lines)
    if trailing and lines:
        out += "\n"
    return out, True
