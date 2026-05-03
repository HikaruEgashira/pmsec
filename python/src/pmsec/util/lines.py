from __future__ import annotations

import re

_SECTION = re.compile(r"^\s*\[[^\]]+\]\s*$")
_KEY_EQ = re.compile(r"^\s*([A-Za-z0-9_.\-]+)\s*=")
_KEY_COLON = re.compile(r"^\s*([A-Za-z0-9_.\-]+)\s*:")
_FULL_EQ = re.compile(r"^\s*[A-Za-z0-9_.\-]+\s*=\s*(.*?)\s*$")
_FULL_COLON = re.compile(r"^\s*[A-Za-z0-9_.\-]+\s*:\s*(.*?)\s*$")


def _line_key(line: str, sep: str) -> str | None:
    pattern = _KEY_COLON if sep == ":" else _KEY_EQ
    m = pattern.match(line)
    return m.group(1) if m else None


def _range_for_section(lines: list[str], section: str | None) -> tuple[int, int] | None:
    if section is None:
        for i, line in enumerate(lines):
            if _SECTION.match(line):
                return 0, i
        return 0, len(lines)
    header = f"[{section}]"
    start = -1
    for i, line in enumerate(lines):
        if line.strip() == header:
            start = i + 1
            break
    if start < 0:
        return None
    end = len(lines)
    for i in range(start, len(lines)):
        if _SECTION.match(lines[i]):
            end = i
            break
    return start, end


def _index_of_key(lines: list[str], rng: tuple[int, int], key: str, sep: str) -> int:
    for i in range(rng[0], rng[1]):
        if _line_key(lines[i], sep) == key:
            return i
    return -1


def _index_first_section(lines: list[str]) -> int:
    for i, line in enumerate(lines):
        if _SECTION.match(line):
            return i
    return -1


def read_key(text: str, key: str, *, sep: str = "=", section: str | None = None) -> str | None:
    lines = text.splitlines()
    rng = _range_for_section(lines, section)
    if rng is None:
        return None
    i = _index_of_key(lines, rng, key, sep)
    if i < 0:
        return None
    pattern = _FULL_COLON if sep == ":" else _FULL_EQ
    m = pattern.match(lines[i])
    return m.group(1) if m else None


def set_key(text: str, key: str, value_line: str, *, sep: str = "=", section: str | None = None) -> str:
    trailing = text.endswith("\n") or text == ""
    lines = [] if text == "" else text.rstrip("\n").split("\n")
    rng = _range_for_section(lines, section)
    if rng is None:
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend([f"[{section}]", value_line])
    else:
        idx = _index_of_key(lines, rng, key, sep)
        if idx >= 0:
            lines[idx] = value_line
        elif section:
            lines[rng[0]:rng[0]] = [value_line]
        else:
            first_sec = _index_first_section(lines)
            if first_sec < 0:
                lines.append(value_line)
            else:
                lines[first_sec:first_sec] = [value_line, ""]
    out = "\n".join(lines)
    if trailing or lines:
        out += "\n"
    return out


def remove_key(text: str, key: str, *, sep: str = "=", section: str | None = None) -> tuple[str, bool]:
    trailing = text.endswith("\n")
    lines = [] if text == "" else text.rstrip("\n").split("\n")
    rng = _range_for_section(lines, section)
    if rng is None:
        return text, False
    idx = _index_of_key(lines, rng, key, sep)
    if idx < 0:
        return text, False
    del lines[idx]
    if idx < len(lines) and lines[idx] == "":
        del lines[idx]
    out = "\n".join(lines)
    if trailing and lines:
        out += "\n"
    return out, True
