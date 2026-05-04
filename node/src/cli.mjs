import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import * as npm from "./tools/npm.mjs";
import * as pnpm from "./tools/pnpm.mjs";
import * as yarn from "./tools/yarn.mjs";
import * as bun from "./tools/bun.mjs";
import * as cargo from "./tools/cargo.mjs";
import * as mise from "./tools/mise.mjs";
import * as uv from "./tools/uv.mjs";

const TOOLS = [npm, pnpm, yarn, bun, cargo, mise, uv];
const DEFAULT_MIN = 7;
export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const USAGE = `pmsec <command> [options]

Commands:
  check                 Inspect cooldown settings (exit 1 if any tool below --min)
  set <DAYS>            Apply DAYS-day cooldown to all selected tools
  unset                 Remove cooldown settings from selected tools

Options:
  --tool TOOL[,TOOL]    Restrict to specific tools (npm,pnpm,yarn,bun,cargo,mise,uv)
  --min DAYS            Minimum acceptable days for check (default ${DEFAULT_MIN})
  --json                Emit JSON output
  -V, --version         Show version
  -h, --help            Show this help

Examples:
  npx pmsec check --min 7
  npx pmsec set 7
  npx pmsec unset --tool npm
`;

function parse(argv) {
  const opts = { command: null, days: null, min: DEFAULT_MIN, json: false, only: null, help: false, version: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-V" || a === "--version") opts.version = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--min") opts.min = Number(argv[++i]);
    else if (a.startsWith("--min=")) opts.min = Number(a.slice(6));
    else if (a === "--tool") opts.only = argv[++i].split(",");
    else if (a.startsWith("--tool=")) opts.only = a.slice(7).split(",");
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else positional.push(a);
  }
  opts.command = positional[0] ?? null;
  if (opts.command === "set") opts.days = Number(positional[1]);
  return opts;
}

function selectTools(only) {
  if (!only) return TOOLS;
  const found = TOOLS.filter(t => only.includes(t.name));
  const missing = only.filter(n => !TOOLS.some(t => t.name === n));
  if (missing.length) throw new Error(`unknown tool(s): ${missing.join(",")}`);
  return found;
}

function preflightWarn(t) {
  if (typeof t.preflight !== "function") return null;
  const pf = t.preflight();
  return pf?.message ?? null;
}

async function gatherStatus(targets, env, home, platform) {
  return Promise.all(targets.map(async t => {
    const r = await t.read(env, home, platform);
    return {
      tool: t.name, key: t.key, path: r.path,
      configured: r.configured, days: r.days,
      extras: r.extras ?? [],
      warn: preflightWarn(t)
    };
  }));
}

function renderHuman(rows, min) {
  const lines = [];
  for (const r of rows) {
    const status = r.days === null ? "MISSING" : r.days < min ? "STALE  " : "OK     ";
    const value = r.configured ?? "(unset)";
    const tail = r.warn ? `\n       ⚠ ${r.warn}` : "";
    lines.push(`${status} ${r.tool.padEnd(4)} ${r.key} = ${value}  [${r.path}]${tail}`);
    for (const e of r.extras) {
      const exStatus = e.configured === null ? "MISSING" : e.ok ? "OK     " : "STALE  ";
      const exValue = e.configured ?? "(unset)";
      lines.push(`${exStatus} ${r.tool.padEnd(4)} ${e.key} = ${exValue}  [${r.path}]`);
    }
  }
  return lines.join("\n") + "\n";
}

async function runCheck(targets, { min, json }, env, home, platform, out, err) {
  const rows = await gatherStatus(targets, env, home, platform);
  const failingPrimary = rows.filter(r => r.days === null || r.days < min);
  const failingExtras = rows.flatMap(r => r.extras.filter(e => !e.ok));
  const ok = failingPrimary.length === 0 && failingExtras.length === 0;
  if (json) out.write(JSON.stringify({ min, rows, ok }, null, 2) + "\n");
  else out.write(renderHuman(rows, min));
  if (failingPrimary.length) err.write(`pmsec: ${failingPrimary.length} tool(s) below ${min} days\n`);
  if (failingExtras.length) err.write(`pmsec: ${failingExtras.length} hardening setting(s) not at safe value\n`);
  return ok ? 0 : 1;
}

function shQuote(s) { return s ? `'${String(s).replace(/'/g, `'\\''`)}'` : ""; }

function explainFsError(e, tool) {
  if (e?.code === "EACCES" || e?.code === "EPERM") {
    const p = e.path ?? "";
    const q = shQuote(p);
    return `${tool}: cannot write ${p} (${e.code}). Check file ownership: \`ls -la ${q}\` — if owned by root, run \`sudo chown -h $(id -u):$(id -g) ${q}\`.`;
  }
  if (e?.code === "EROFS") return `${tool}: ${e.path ?? ""} is on a read-only filesystem (EROFS).`;
  return `${tool}: ${e?.message ?? e}`;
}

async function runSet(targets, days, json, env, home, platform, out, err) {
  if (!Number.isInteger(days) || days <= 0) {
    err.write(`pmsec: set requires integer DAYS > 0\n`);
    return 2;
  }
  const results = [];
  const failures = [];
  const warnings = [];
  for (const t of targets) {
    const warn = preflightWarn(t);
    if (warn) warnings.push({ tool: t.name, warn });
    try {
      const r = await t.write(days, env, home, platform);
      results.push({ tool: t.name, path: r.path, days, ok: true, warn });
    } catch (e) {
      failures.push({ tool: t.name, error: explainFsError(e, t.name) });
      results.push({ tool: t.name, path: e?.path ?? null, days, ok: false, error: explainFsError(e, t.name), warn });
    }
  }
  if (json) out.write(JSON.stringify({ set: days, results, warnings, ok: failures.length === 0 }, null, 2) + "\n");
  else for (const r of results) {
    if (r.ok) {
      const tail = r.warn ? `\n     ⚠ ${r.warn}` : "";
      out.write(`set  ${r.tool.padEnd(4)} ${r.days} days  [${r.path}]${tail}\n`);
    } else {
      out.write(`FAIL ${r.tool.padEnd(4)} ${r.error}\n`);
    }
  }
  for (const f of failures) err.write(`pmsec: ${f.error}\n`);
  if (warnings.length) err.write(`pmsec: ${warnings.length} tool(s) configured but runtime may silently ignore the cooldown — see ⚠ above\n`);
  return failures.length ? 1 : 0;
}

async function runUnset(targets, json, env, home, platform, out, err) {
  const results = [];
  const failures = [];
  for (const t of targets) {
    try {
      const r = await t.unset(env, home, platform);
      results.push({ tool: t.name, path: r.path, removed: r.removed, ok: true });
    } catch (e) {
      failures.push({ tool: t.name, error: explainFsError(e, t.name) });
      results.push({ tool: t.name, path: e?.path ?? null, removed: false, ok: false, error: explainFsError(e, t.name) });
    }
  }
  if (json) out.write(JSON.stringify({ results, ok: failures.length === 0 }, null, 2) + "\n");
  else for (const r of results) {
    if (!r.ok) out.write(`FAIL ${r.tool.padEnd(4)} ${r.error}\n`);
    else out.write(`${r.removed ? "rm  " : "skip"} ${r.tool.padEnd(4)} [${r.path}]\n`);
  }
  for (const f of failures) err.write(`pmsec: ${f.error}\n`);
  return failures.length ? 1 : 0;
}

export async function run(argv, {
  env = process.env,
  home = homedir(),
  platform = process.platform,
  out = process.stdout,
  err = process.stderr,
} = {}) {
  let opts;
  try { opts = parse(argv); }
  catch (e) { err.write(`pmsec: ${e.message}\n`); return 2; }
  if (opts.version) { out.write(`pmsec ${VERSION}\n`); return 0; }
  if (opts.help || !opts.command) { out.write(USAGE); return opts.help ? 0 : 2; }
  let targets;
  try { targets = selectTools(opts.only); }
  catch (e) { err.write(`pmsec: ${e.message}\n`); return 2; }
  try {
    if (opts.command === "check") return await runCheck(targets, opts, env, home, platform, out, err);
    if (opts.command === "set") return await runSet(targets, opts.days, opts.json, env, home, platform, out, err);
    if (opts.command === "unset") return await runUnset(targets, opts.json, env, home, platform, out, err);
    err.write(`pmsec: unknown command "${opts.command}"\n`);
    return 2;
  } catch (e) {
    err.write(`pmsec: ${e.message}\n`);
    return 1;
  }
}
