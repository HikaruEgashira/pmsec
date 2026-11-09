from __future__ import annotations

from pmsec.util.lines import read_key, remove_key, set_key


def read_extras(raw: str, extras: list[dict]) -> list[dict]:
    rows = []
    for e in extras:
        cur = read_key(raw, e["key"], sep=e.get("sep", "="), section=e.get("section"))
        safe_values = e.get("safeValues", [e["expected"]])
        rows.append({
            "key": e["key"],
            "configured": cur,
            "expected": e["expected"],
            "ok": cur is not None and cur in safe_values,
        })
    return rows


def apply_extras(text: str, extras: list[dict], ctx=None) -> str:
    # Keep an existing safe value (e.g. a stricter one) unless ctx.force is set.
    force = bool(getattr(ctx, "force", False))
    out = text
    for e in extras:
        cur = read_key(out, e["key"], sep=e.get("sep", "="), section=e.get("section"))
        if not force and cur is not None and cur in e.get("safeValues", [e["expected"]]):
            continue
        out = set_key(out, e["key"], e["line"], sep=e.get("sep", "="), section=e.get("section"))
    return out


def remove_extras(text: str, extras: list[dict]) -> tuple[str, bool]:
    out = text
    removed = False
    for e in extras:
        out, r = remove_key(out, e["key"], sep=e.get("sep", "="), section=e.get("section"))
        if r:
            removed = True
    return out, removed
