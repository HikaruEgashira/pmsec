from __future__ import annotations

import os

from pmsec.tools import cargo, mise, uv
from pmsec.util.lines import has_table, read_key

# Project-level configs that can weaken the user-level cooldown. `cooldown`
# is flagged when disabled (`= false`) or shorter than --days; any `excludes`
# key is flagged because it exempts packages from the cooldown entirely.
RULES = [
    {"tool": "cargo", "file": ".cargo/config.toml", "section": "registry", "cooldown": cargo.KEY, "parse": cargo._parse_days, "excludes": []},
    {"tool": "mise", "file": "mise.toml", "section": "settings", "cooldown": mise.KEY, "parse": mise._parse_days, "excludes": ["minimum_release_age_excludes"]},
    {"tool": "uv", "file": "uv.toml", "section": None, "cooldown": uv.KEY, "parse": uv._parse_days, "excludes": ["exclude-newer-package"]},
    {"tool": "uv", "file": "pyproject.toml", "section": "tool.uv", "cooldown": uv.KEY, "parse": uv._parse_days, "excludes": ["exclude-newer-package"]},
]


def scan_project(directory: str, tools: list[str], days: int) -> list[dict]:
    findings = []
    for r in RULES:
        if r["tool"] not in tools:
            continue
        p = os.path.normpath(os.path.join(directory, r["file"]))
        if not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8-sig") as f:
            text = f.read()
        if text == "":
            continue
        value = read_key(text, r["cooldown"], section=r["section"])
        if value is not None:
            n = r["parse"](value)
            issue = "disabled" if value == "false" else "weakened" if n is not None and n < days else None
            if issue:
                findings.append({"tool": r["tool"], "path": p, "key": r["cooldown"], "configured": value, "issue": issue})
        for k in r["excludes"]:
            v = read_key(text, k, section=r["section"])
            table = f"{r['section']}.{k}" if r["section"] else k
            if v is not None or has_table(text, table):
                findings.append({"tool": r["tool"], "path": p, "key": k, "configured": v if v is not None else f"[{table}]", "issue": "excluded"})
    return findings
