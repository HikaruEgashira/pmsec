from __future__ import annotations

import re

# TOML tables may carry a trailing comment, inner whitespace, quoted names, or be [[arrays]].
_SECTION = re.compile(r"^\s*\[\[?[^\[\]]+\]\]?\s*(#.*)?$")
_HEADER = re.compile(r"^\s*\[([^\[\]]+)\]\s*(#.*)?$")
_KEY = r"(\"[^\"]*\"|'[^']*'|[A-Za-z0-9_.\-]+)"
# YAML nests by indentation, so only unindented `key:` lines are top-level.
_INDENT = {"=": r"^\s*", ":": r"^"}
_ENTRY = {sep: re.compile(rf"{_INDENT[sep]}{_KEY}\s*{sep}") for sep in ("=", ":")}
_FULL = {sep: re.compile(rf"{_INDENT[sep]}{_KEY}\s*{sep}\s*(.*?)\s*$") for sep in ("=", ":")}
_MULTILINE = re.compile(r'"""|\'\'\'')
_CLOSE = {'"': '"', "'": "'", "{": "}"}


def _unquote(s: str) -> str:
    return s[1:-1] if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'" else s


def _header_name(line: str) -> str | None:
    m = _HEADER.match(line)
    return ".".join(_unquote(p.strip()) for p in m.group(1).split(".")) if m else None


def _line_key(line: str, sep: str) -> str | None:
    m = _ENTRY[sep].match(line)
    return _unquote(m.group(1)) if m else None


def _line_value(line: str, sep: str) -> str | None:
    """Value after the separator with any trailing comment removed."""
    m = _FULL[sep].match(line)
    if not m:
        return None
    v = m.group(2)
    close = _CLOSE.get(v[:1])
    if close:
        end = v.find(close, 1)
        if end >= 0:
            return v[: end + 1]
    return re.sub(r"\s+#.*$", "", v)


def _scan_view(lines: list[str]) -> list[str]:
    """Copy of `lines` with the body of TOML multi-line strings blanked.

    Text inside them is then never taken for a header or key. Indices stay aligned.
    """
    out: list[str] = []
    open_: str | None = None
    for line in lines:
        inside = open_ is not None
        for m in _MULTILINE.finditer(line):
            if open_ is None:
                open_ = m.group(0)
            elif open_ == m.group(0):
                open_ = None
        out.append("" if inside else line)
    return out


def _range_for_section(lines: list[str], section: str | None) -> tuple[int, int] | None:
    if section is None:
        for i, line in enumerate(lines):
            if _SECTION.match(line):
                return 0, i
        return 0, len(lines)
    start = -1
    for i, line in enumerate(lines):
        if _header_name(line) == section:
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


def _resolve(lines: list[str], key: str, sep: str, section: str | None) -> tuple[str, str | None, int, str]:
    """Return (key, section, inline_idx, head).

    TOML forbids `a.b = x` under [s] when [s.a] exists or `a` is an inline table,
    so target the subtable, or report the inline-table line to edit in place.
    """
    # A table defined at the root through dotted keys (`s.k = v`) or an inline
    # table (`s = { ... }`) cannot also get a [s] header, so keep editing it there.
    if section and sep == "=" and _range_for_section(lines, section) is None:
        _, end = _range_for_section(lines, None)
        for i in range(end):
            k = _line_key(lines[i], sep) or ""
            if k.startswith(f"{section}."):
                return f"{section}.{key}", None, -1, ""
            if k == section and (_line_value(lines[i], sep) or "").startswith("{"):
                return key, None, i, section
    if section and sep == "=" and "." in key:
        head, rest = key.split(".", 1)
        if _range_for_section(lines, f"{section}.{head}") is not None:
            return rest, f"{section}.{head}", -1, ""
        rng = _range_for_section(lines, section)
        if rng is not None:
            i = _index_of_key(lines, rng, head, sep)
            if i >= 0 and (_line_value(lines[i], sep) or "").startswith("{"):
                return rest, section, i, head
    return key, section, -1, ""


def _inline_pairs(line: str) -> list[str]:
    v = _line_value(line, "=") or "{"
    body = (v[1:-1] if v.endswith("}") else v[1:]).strip()
    return [p.strip() for p in body.split(",") if p.strip()] if body else []


def _inline_line(line: str, head: str, pairs: list[str]) -> str:
    indent = re.match(r"^\s*", line).group(0)
    inner = f" {', '.join(pairs)} " if pairs else ""
    return f"{indent}{head} = {{{inner}}}"


def _index_first_section(lines: list[str]) -> int:
    for i, line in enumerate(lines):
        if _SECTION.match(line):
            return i
    return -1


def read_key(text: str, key: str, *, sep: str = "=", section: str | None = None) -> str | None:
    lines = _scan_view(text.splitlines())
    key, section, inline, _ = _resolve(lines, key, sep, section)
    if inline >= 0:
        for p in _inline_pairs(lines[inline]):
            if _line_key(p, sep) == key:
                return _line_value(p, sep)
        return None
    rng = _range_for_section(lines, section)
    if rng is None:
        return None
    i = _index_of_key(lines, rng, key, sep)
    return None if i < 0 else _line_value(lines[i], sep)


def set_key(text: str, key: str, value_line: str, *, sep: str = "=", section: str | None = None) -> str:
    trailing = text.endswith("\n") or text == ""
    lines = [] if text == "" else text.rstrip("\n").split("\n")
    orig = key
    scan = _scan_view(lines)
    key, section, inline, head = _resolve(scan, key, sep, section)
    if key != orig:
        value_line = key + value_line[len(orig):]
    if inline >= 0:
        pairs = _inline_pairs(lines[inline])
        at = next((n for n, p in enumerate(pairs) if _line_key(p, sep) == key), -1)
        if at >= 0:
            pairs[at] = value_line
        else:
            pairs.append(value_line)
        lines[inline] = _inline_line(lines[inline], head, pairs)
        return "\n".join(lines) + "\n"
    rng = _range_for_section(scan, section)
    if rng is None:
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend([f"[{section}]", value_line])
    else:
        idx = _index_of_key(scan, rng, key, sep)
        if idx >= 0:
            lines[idx] = value_line
        elif section:
            lines[rng[0]:rng[0]] = [value_line]
        else:
            first_sec = _index_first_section(scan)
            # Reuse the blank line that already separates the root keys from the first table.
            if first_sec < 0:
                lines.append(value_line)
            elif first_sec > 0 and lines[first_sec - 1] == "":
                lines[first_sec - 1:first_sec - 1] = [value_line]
            else:
                lines[first_sec:first_sec] = [value_line, ""]
    out = "\n".join(lines)
    if trailing or lines:
        out += "\n"
    return out


def remove_key(text: str, key: str, *, sep: str = "=", section: str | None = None) -> tuple[str, bool]:
    trailing = text.endswith("\n")
    lines = [] if text == "" else text.rstrip("\n").split("\n")
    scan = _scan_view(lines)
    key, section, inline, head = _resolve(scan, key, sep, section)
    if inline >= 0:
        pairs = _inline_pairs(lines[inline])
        kept = [p for p in pairs if _line_key(p, sep) != key]
        if len(kept) == len(pairs):
            return text, False
        lines[inline] = _inline_line(lines[inline], head, kept)
        return "\n".join(lines) + ("\n" if trailing else ""), True
    rng = _range_for_section(scan, section)
    if rng is None:
        return text, False
    idx = _index_of_key(scan, rng, key, sep)
    if idx < 0:
        return text, False
    del lines[idx]
    if idx < len(lines) and lines[idx] == "":
        del lines[idx]
    out = "\n".join(lines)
    if trailing and lines:
        out += "\n"
    return out, True
