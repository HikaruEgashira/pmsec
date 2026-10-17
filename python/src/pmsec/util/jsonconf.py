from __future__ import annotations

import re

_MEMBER_RE = re.compile(r'^\s*"([^"]+)"\s*:')
_VALUE_RE = re.compile(r'^\s*"[^"]+"\s*:\s*(.*?)\s*,?\s*$')


def _normalize_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        current = ""
        in_string = False
        escaped = False
        for i, ch in enumerate(line):
            if in_string:
                current += ch
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                current += ch
            elif ch in ("{", ","):
                current += ch
                if line[i + 1:].strip() != "":
                    out.append(current)
                    current = ""
            elif ch == "}":
                if current.strip() != "":
                    out.append(current)
                    current = ""
                current += ch
            else:
                current += ch
        if current.strip() != "" or not out:
            out.append(current)
    return out


def _scan_depth(line: str, depth: int) -> int:
    in_string = False
    escaped = False
    for ch in line:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
    return depth


def _depth_maps(lines: list[str]) -> tuple[list[int], list[int]]:
    start, end = [], []
    depth = 0
    for line in lines:
        start.append(depth)
        depth = _scan_depth(line, depth)
        end.append(depth)
    return start, end


def _root_range(lines: list[str], dm):
    open_idx = -1
    for i, line in enumerate(lines):
        if "{" in line:
            open_idx = i
            break
    if open_idx < 0:
        return None
    base = dm[0][open_idx]
    if dm[1][open_idx] == base:
        close = open_idx
    else:
        close = -1
        for i in range(open_idx + 1, len(lines)):
            if dm[1][i] == base:
                close = i
                break
    if close < 0:
        return None
    return {"open": open_idx, "close": close, "start": open_idx + 1, "end": close, "depth": base + 1}


def _find_member(lines: list[str], dm, rng: dict, key: str) -> int:
    for i in range(rng["start"], rng["end"]):
        if dm[0][i] != rng["depth"]:
            continue
        m = _MEMBER_RE.match(lines[i])
        if m and m.group(1) == key:
            return i
    return -1


def _object_range(lines: list[str], dm, path: list[str]):
    current = _root_range(lines, dm)
    if current is None:
        return None
    for key in path:
        idx = _find_member(lines, dm, current, key)
        if idx < 0:
            return None
        open_idx = -1
        for i in range(idx, current["end"]):
            if "{" in lines[i]:
                open_idx = i
                break
        if open_idx < 0:
            return None
        base = dm[0][idx]
        if dm[1][open_idx] == base:
            close = open_idx
        else:
            close = -1
            for i in range(open_idx + 1, current["end"]):
                if dm[1][i] == base:
                    close = i
                    break
        if close < 0:
            return None
        current = {"open": open_idx, "close": close, "start": open_idx + 1, "end": close, "depth": base + 1}
    return current


def _indent(level: int) -> str:
    return "  " * level


def _last_content_line(lines: list[str], rng: dict) -> int:
    for i in range(rng["end"] - 1, rng["start"] - 1, -1):
        if lines[i].strip():
            return i
    return -1


def _ensure_comma(lines: list[str], rng: dict) -> None:
    last = _last_content_line(lines, rng)
    if last >= 0 and not re.search(r",\s*$", lines[last]):
        lines[last] += ","


def _expand_empty_object(lines: list[str], rng: dict) -> list[str]:
    if rng["open"] != rng["close"]:
        return lines
    line = lines[rng["open"]]
    open_idx = line.find("{")
    close_idx = line.rfind("}")
    if open_idx < 0 or close_idx < open_idx:
        return lines
    head = line[:open_idx + 1]
    tail = line[close_idx + 1:]
    level = rng["depth"] - 1
    lines[rng["open"]] = head
    lines.insert(rng["open"] + 1, f"{_indent(level)}}}{tail}")
    return lines


def _insert_object(lines: list[str], parent: list[str], key: str) -> list[str]:
    dm = _depth_maps(lines)
    rng = _object_range(lines, dm, parent)
    if rng is None:
        return lines
    if rng["open"] == rng["close"]:
        lines = _expand_empty_object(lines, rng)
        dm = _depth_maps(lines)
        rng = _object_range(lines, dm, parent)
        if rng is None:
            return lines
    _ensure_comma(lines, rng)
    level = rng["depth"]
    member_indent = _indent(level)
    lines[rng["end"]:rng["end"]] = [f'{member_indent}"{key}": {{', f"{member_indent}}}"]
    return lines


def _ensure_object(lines: list[str], path: list[str]) -> list[str]:
    dm = _depth_maps(lines)
    if _object_range(lines, dm, path) is not None:
        return lines
    if not path:
        return ["{", "}"]
    lines = _ensure_object(lines, path[:-1])
    return _insert_object(lines, path[:-1], path[-1])


def _set_key_in_range(lines: list[str], rng: dict, key: str, value: str) -> list[str]:
    dm = _depth_maps(lines)
    idx = _find_member(lines, dm, rng, key)
    member_indent = _indent(rng["depth"])
    if idx >= 0:
        m = re.match(r'^(\s*"[^"]+"\s*:\s*)(.*?)(\s*,)?\s*$', lines[idx])
        comma = "," if m and m.group(3) else ""
        prefix = m.group(1) if m else f'{member_indent}"{key}": '
        lines[idx] = f"{prefix}{value}{comma}"
        return lines
    if rng["open"] == rng["close"]:
        lines = _expand_empty_object(lines, rng)
        rng = {**rng, "start": rng["open"] + 1, "end": rng["open"] + 1, "close": rng["open"] + 1}
    _ensure_comma(lines, rng)
    lines.insert(rng["end"], f'{member_indent}"{key}": {value}')
    return lines


def read_json_key(text: str, path: list[str]) -> str | None:
    lines = _normalize_lines((text or "").splitlines())
    dm = _depth_maps(lines)
    rng = _object_range(lines, dm, path[:-1])
    if rng is None:
        return None
    idx = _find_member(lines, dm, rng, path[-1])
    if idx < 0:
        return None
    m = _VALUE_RE.match(lines[idx])
    return m.group(1) if m else None


def set_json_key(text: str, path: list[str], value: str) -> str:
    lines = ["{", "}"] if text == "" else _normalize_lines(text.rstrip("\n").split("\n"))
    if _root_range(lines, _depth_maps(lines)) is None:
        lines = ["{", "}"]
    lines = _ensure_object(lines, path[:-1])
    dm = _depth_maps(lines)
    rng = _object_range(lines, dm, path[:-1])
    if rng is None:
        return text
    lines = _set_key_in_range(lines, rng, path[-1], value)
    return "\n".join(lines) + "\n"


def remove_json_key(text: str, path: list[str]) -> tuple[str, bool]:
    lines = [] if text == "" else _normalize_lines(text.rstrip("\n").split("\n"))
    dm = _depth_maps(lines)
    rng = _object_range(lines, dm, path[:-1])
    if rng is None:
        return text, False
    idx = _find_member(lines, dm, rng, path[-1])
    if idx < 0:
        return text, False
    del lines[idx]
    dm2 = _depth_maps(lines)
    rng2 = _object_range(lines, dm2, path[:-1])
    if rng2 is not None:
        has_later = any(dm2[0][i] == rng2["depth"] for i in range(idx, rng2["end"]))
        if not has_later:
            prev = _last_content_line(lines, rng2)
            if prev >= 0:
                lines[prev] = re.sub(r",\s*$", "", lines[prev])
    out = "\n".join(lines)
    if lines:
        out += "\n"
    return out, True
