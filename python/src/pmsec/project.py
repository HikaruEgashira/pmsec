"""`--check --project [DIR]`: read-only scan of project-level package-manager
configs for keys that weaken the user-level baseline pmsec installs.
Rules are evaluated in table order; the last occurrence of a key wins."""

from __future__ import annotations

import re

RULES = [
    {"tool": "npm", "file": ".npmrc", "fmt": "ini", "key": "min-release-age", "reason": "zero-cooldown"},
    {"tool": "npm", "file": ".npmrc", "fmt": "ini", "key": "ignore-scripts", "reason": "scripts-enabled", "bad": "false"},
    {"tool": "npm", "file": ".npmrc", "fmt": "ini", "key": "strict-allow-scripts", "reason": "scripts-enabled", "bad": "false"},
    {"tool": "npm", "file": ".npmrc", "fmt": "ini", "key": "dangerously-allow-all-scripts", "reason": "scripts-enabled", "bad": "true"},
    {"tool": "npm", "file": ".npmrc", "fmt": "ini", "key": "min-release-age-exclude", "reason": "exclusion-list"},
    {"tool": "pnpm", "file": "pnpm-workspace.yaml", "fmt": "yaml", "key": "minimumReleaseAge", "reason": "zero-cooldown"},
    {"tool": "pnpm", "file": "pnpm-workspace.yaml", "fmt": "yaml", "key": "dangerouslyAllowAllBuilds", "reason": "scripts-enabled", "bad": "true"},
    {"tool": "pnpm", "file": "pnpm-workspace.yaml", "fmt": "yaml", "key": "minimumReleaseAgeExclude", "reason": "exclusion-list"},
    {"tool": "yarn", "file": ".yarnrc.yml", "fmt": "yaml", "key": "npmMinimalAgeGate", "reason": "zero-cooldown"},
    {"tool": "yarn", "file": ".yarnrc.yml", "fmt": "yaml", "key": "enableScripts", "reason": "scripts-enabled", "bad": "true"},
    {"tool": "yarn", "file": ".yarnrc.yml", "fmt": "yaml", "key": "npmPreapprovedPackages", "reason": "exclusion-list"},
    {"tool": "bun", "file": "bunfig.toml", "fmt": "toml", "key": "minimumReleaseAge", "reason": "zero-cooldown"},
    {"tool": "bun", "file": "bunfig.toml", "fmt": "toml", "key": "minimumReleaseAgeExcludes", "reason": "exclusion-list"},
]

_LINE = {
    "ini": re.compile(r"^\s*([^=\s]+?)(?:\[\])?\s*=(.*)$"),
    "yaml": re.compile(r"^([A-Za-z0-9_-]+)\s*:(.*)$"),
    "toml": re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=(.*)$"),
}


def _clean(v: str, fmt: str) -> str:
    s = v[:-1] if v.endswith("\r") else v
    if fmt != "ini":
        s = re.sub(r"\s+#.*$", "", s)
    s = s.strip()
    if len(s) >= 2 and s[0] in "\"'" and s[-1] == s[0]:
        s = s[1:-1]
    return s


def find_key(text: str, fmt: str, key: str) -> str | None:
    """Last value of `key` or None. yaml: top-level only; toml: [install] only."""
    found = None
    section = ""
    if text.startswith("\ufeff"):
        text = text[1:]
    for line in text.split("\n"):
        if fmt == "toml":
            h = re.match(r"^\s*\[([^\]]*)\]", line)
            if h:
                section = h.group(1).strip()
                continue
            if section != "install":
                continue
        m = _LINE[fmt].match(line)
        if m and m.group(1) == key:
            found = _clean(m.group(2), fmt)
    return found


def weakens(rule: dict, value: str | None) -> bool:
    if value is None:
        return False
    if rule["reason"] == "zero-cooldown":
        return re.fullmatch(r"0+(\.0+)?[A-Za-z]*", value) is not None
    if rule["reason"] == "scripts-enabled":
        return value.lower() == rule["bad"]
    return True


def project_path(d: str, file: str) -> str:
    # Plain concatenation (no normalization) so every port reports the same path.
    return file if d == "." else d.rstrip("/") + "/" + file


def scan_project(d: str, only: list[str] | None) -> list[dict]:
    rows = []
    cache: dict[str, str | None] = {}
    for rule in RULES:
        if only and rule["tool"] not in only:
            continue
        p = project_path(d, rule["file"])
        if p not in cache:
            try:
                with open(p, encoding="utf-8", newline="") as fh:
                    cache[p] = fh.read()
            except OSError:
                cache[p] = None
        text = cache[p]
        if text is None:
            continue
        value = find_key(text, rule["fmt"], rule["key"])
        if weakens(rule, value):
            rows.append({"tool": rule["tool"], "key": rule["key"], "path": p, "configured": value, "reason": rule["reason"]})
    return rows
