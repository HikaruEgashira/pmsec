// `--check --project [DIR]`: read-only scan of project-level package-manager
// configs for keys that weaken the user-level baseline pmsec installs.
// Rules are evaluated in table order; the last occurrence of a key wins.
import { readFileSync } from "node:fs";

export const RULES = [
  { tool: "npm", file: ".npmrc", fmt: "ini", key: "min-release-age", reason: "zero-cooldown" },
  { tool: "npm", file: ".npmrc", fmt: "ini", key: "ignore-scripts", reason: "scripts-enabled", bad: "false" },
  { tool: "npm", file: ".npmrc", fmt: "ini", key: "strict-allow-scripts", reason: "scripts-enabled", bad: "false" },
  { tool: "npm", file: ".npmrc", fmt: "ini", key: "dangerously-allow-all-scripts", reason: "scripts-enabled", bad: "true" },
  { tool: "npm", file: ".npmrc", fmt: "ini", key: "min-release-age-exclude", reason: "exclusion-list" },
  { tool: "pnpm", file: "pnpm-workspace.yaml", fmt: "yaml", key: "minimumReleaseAge", reason: "zero-cooldown" },
  { tool: "pnpm", file: "pnpm-workspace.yaml", fmt: "yaml", key: "dangerouslyAllowAllBuilds", reason: "scripts-enabled", bad: "true" },
  { tool: "pnpm", file: "pnpm-workspace.yaml", fmt: "yaml", key: "minimumReleaseAgeExclude", reason: "exclusion-list" },
  { tool: "yarn", file: ".yarnrc.yml", fmt: "yaml", key: "npmMinimalAgeGate", reason: "zero-cooldown" },
  { tool: "yarn", file: ".yarnrc.yml", fmt: "yaml", key: "enableScripts", reason: "scripts-enabled", bad: "true" },
  { tool: "yarn", file: ".yarnrc.yml", fmt: "yaml", key: "npmPreapprovedPackages", reason: "exclusion-list" },
  { tool: "bun", file: "bunfig.toml", fmt: "toml", section: "install", key: "minimumReleaseAge", reason: "zero-cooldown" },
  { tool: "bun", file: "bunfig.toml", fmt: "toml", section: "install", key: "minimumReleaseAgeExcludes", reason: "exclusion-list" },
  { tool: "cargo", file: ".cargo/config.toml", fmt: "toml", section: "registry", key: "global-min-publish-age", reason: "zero-cooldown" },
  { tool: "mise", file: "mise.toml", fmt: "toml", section: "settings", key: "minimum_release_age", reason: "zero-cooldown" },
  { tool: "mise", file: "mise.toml", fmt: "toml", section: "settings", key: "minimum_release_age_excludes", reason: "exclusion-list" },
  { tool: "uv", file: "uv.toml", fmt: "toml", section: "", key: "exclude-newer", reason: "zero-cooldown" },
  { tool: "uv", file: "uv.toml", fmt: "toml", section: "", key: "exclude-newer-package", reason: "exclusion-list" },
  { tool: "uv", file: "pyproject.toml", fmt: "toml", section: "tool.uv", key: "exclude-newer", reason: "zero-cooldown" },
  { tool: "uv", file: "pyproject.toml", fmt: "toml", section: "tool.uv", key: "exclude-newer-package", reason: "exclusion-list" },
];

function clean(v, fmt) {
  let s = v.replace(/\r$/, "");
  if (fmt !== "ini") s = s.replace(/\s+#.*$/, "");
  s = s.trim();
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) s = s.slice(1, -1);
  return s;
}

// Returns the last value of `key` or null. yaml: top-level only; toml: table `want` only ("" = root).
export function findKey(text, fmt, key, want = "") {
  let found = null;
  let section = "";
  for (const line of text.replace(/^\uFEFF/, "").split("\n")) {
    if (fmt === "toml") {
      const h = /^\s*\[([^\]]*)\]/.exec(line);
      if (h) { section = h[1].trim(); continue; }
      if (section !== want) continue;
    }
    const m = fmt === "ini" ? /^\s*([^=\s]+?)(?:\[\])?\s*=(.*)$/.exec(line)
      : fmt === "yaml" ? /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(line)
      : /^\s*([A-Za-z0-9_-]+)\s*=(.*)$/.exec(line);
    if (m && m[1] === key) found = clean(m[2], fmt);
  }
  return found;
}

export function weakens(rule, value) {
  if (value === null) return false;
  if (rule.reason === "zero-cooldown") return value.toLowerCase() === "false" || /^0+(\.0+)?\s*[A-Za-z]*$/.test(value);
  if (rule.reason === "scripts-enabled") return value.toLowerCase() === rule.bad;
  return true;
}

// Plain concatenation (no normalization) so every port reports the same path.
export function projectPath(dir, file) {
  return dir === "." ? file : `${dir.replace(/\/+$/, "")}/${file}`;
}

export function scanProject(dir, only) {
  const rows = [];
  const cache = new Map();
  for (const rule of RULES) {
    if (only && !only.includes(rule.tool)) continue;
    const p = projectPath(dir, rule.file);
    if (!cache.has(p)) {
      let text = null;
      try { text = readFileSync(p, "utf8"); } catch {}
      cache.set(p, text);
    }
    const text = cache.get(p);
    if (text === null) continue;
    const value = findKey(text, rule.fmt, rule.key, rule.section ?? "");
    if (weakens(rule, value)) rows.push({ tool: rule.tool, key: rule.key, path: p, configured: value, reason: rule.reason });
  }
  return rows;
}
