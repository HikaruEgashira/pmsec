import { join } from "node:path";
import { readSafe } from "./util/io.mjs";
import { readKey, hasTable } from "./util/lines.mjs";
import * as cargo from "./tools/cargo.mjs";
import * as mise from "./tools/mise.mjs";
import * as uv from "./tools/uv.mjs";

// Project-level configs that can weaken the user-level cooldown. `cooldown`
// is flagged when disabled (`= false`) or shorter than --days; any `excludes`
// key is flagged because it exempts packages from the cooldown entirely.
const RULES = [
  { tool: "cargo", file: ".cargo/config.toml", section: "registry", cooldown: cargo.key, parse: cargo.parseDays, excludes: [] },
  { tool: "mise", file: "mise.toml", section: "settings", cooldown: mise.key, parse: mise.parseDays, excludes: ["minimum_release_age_excludes"] },
  { tool: "uv", file: "uv.toml", section: null, cooldown: uv.key, parse: uv.parseDays, excludes: ["exclude-newer-package"] },
  { tool: "uv", file: "pyproject.toml", section: "tool.uv", cooldown: uv.key, parse: uv.parseDays, excludes: ["exclude-newer-package"] },
];

export async function scanProject(dir, tools, days) {
  const findings = [];
  for (const r of RULES) {
    if (!tools.includes(r.tool)) continue;
    const p = join(dir, r.file);
    const text = await readSafe(p);
    if (text === "") continue;
    const value = readKey(text, r.cooldown, { section: r.section });
    if (value !== null) {
      const n = r.parse(value);
      const issue = value === "false" ? "disabled" : n !== null && n < days ? "weakened" : null;
      if (issue) findings.push({ tool: r.tool, path: p, key: r.cooldown, configured: value, issue });
    }
    for (const k of r.excludes) {
      const v = readKey(text, k, { section: r.section });
      const table = r.section ? `${r.section}.${k}` : k;
      if (v !== null || hasTable(text, table)) {
        findings.push({ tool: r.tool, path: p, key: k, configured: v ?? `[${table}]`, issue: "excluded" });
      }
    }
  }
  return findings;
}
