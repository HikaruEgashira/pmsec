import { homedir } from "node:os";
import * as npm from "./tools/npm.mjs";
import * as pnpm from "./tools/pnpm.mjs";
import * as yarn from "./tools/yarn.mjs";
import * as bun from "./tools/bun.mjs";
import * as cargo from "./tools/cargo.mjs";
import * as mise from "./tools/mise.mjs";
import * as uv from "./tools/uv.mjs";

const TOOLS = [npm, pnpm, yarn, bun, cargo, mise, uv];
const DEFAULT_MIN = 7;

const USAGE = `pmsec <command> [options]

Commands:
  check                 Inspect cooldown settings (exit 1 if any tool below --min)
  set <DAYS>            Apply DAYS-day cooldown to all selected tools
  unset                 Remove cooldown settings from selected tools

Options:
  --tool TOOL[,TOOL]    Restrict to specific tools (npm,pnpm,yarn,bun,cargo,mise,uv)
  --min DAYS            Minimum acceptable days for check (default ${DEFAULT_MIN})
  --json                Emit JSON output
  -h, --help            Show this help

Examples:
  npx pmsec check --min 7
  npx pmsec set 7
  npx pmsec unset --tool npm
`;

function parse(argv) {
  const opts = { command: null, days: null, min: DEFAULT_MIN, json: false, only: null, help: false, force: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--min") opts.min = Number(argv[++i]);
    else if (a.startsWith("--min=")) opts.min = Number(a.slice(6));
    else if (a === "--tool") opts.only = argv[++i].split(",");
    else if (a.startsWith("--tool=")) opts.only = a.slice(7).split(",");
    else if (a === "--force") opts.force = true;
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

async function gatherStatus(targets, env, home, platform) {
  return Promise.all(targets.map(async t => {
    const r = await t.read(env, home, platform);
    return { tool: t.name, key: t.key, path: r.path, configured: r.configured, days: r.days };
  }));
}

function renderHuman(rows, min) {
  const lines = [];
  for (const r of rows) {
    const status = r.days === null ? "MISSING" : r.days < min ? "STALE  " : "OK     ";
    const value = r.configured ?? "(unset)";
    lines.push(`${status} ${r.tool.padEnd(4)} ${r.key} = ${value}  [${r.path}]`);
  }
  return lines.join("\n") + "\n";
}

async function runCheck(targets, { min, json }, env, home, platform, out, err) {
  const rows = await gatherStatus(targets, env, home, platform);
  const failing = rows.filter(r => r.days === null || r.days < min);
  if (json) out.write(JSON.stringify({ min, rows, ok: failing.length === 0 }, null, 2) + "\n");
  else out.write(renderHuman(rows, min));
  if (failing.length) err.write(`pmsec: ${failing.length} tool(s) below ${min} days\n`);
  return failing.length ? 1 : 0;
}

function explainFsError(e, tool) {
  if (e?.code === "EACCES" || e?.code === "EPERM") {
    return `${tool}: cannot write ${e.path ?? ""} (${e.code}). Check file ownership: \`ls -la ${e.path ?? ""}\` — if owned by root, run \`sudo chown $(id -u):$(id -g) ${e.path ?? ""}\`.`;
  }
  if (e?.code === "EROFS") return `${tool}: ${e.path ?? ""} is on a read-only filesystem (EROFS).`;
  return `${tool}: ${e?.message ?? e}`;
}

async function runSet(targets, days, json, force, env, home, platform, out, err) {
  if (!Number.isFinite(days) || days <= 0) throw new Error(`set requires DAYS > 0`);
  for (const t of targets) {
    if (typeof t.preflight !== "function") continue;
    const pf = t.preflight();
    if (pf.ok && pf.warn) err.write(`pmsec: ${t.name}: ${pf.message}\n`);
    if (pf.ok) continue;
    if (!force) throw new Error(`${t.name}: ${pf.message}`);
    err.write(`pmsec: ${t.name}: ${pf.message} (continuing due to --force)\n`);
  }
  const results = [];
  const failures = [];
  for (const t of targets) {
    try {
      const r = await t.write(days, env, home, platform);
      results.push({ tool: t.name, path: r.path, days, ok: true });
    } catch (e) {
      failures.push({ tool: t.name, error: explainFsError(e, t.name) });
      results.push({ tool: t.name, path: e?.path ?? null, days, ok: false, error: explainFsError(e, t.name) });
    }
  }
  if (json) out.write(JSON.stringify({ set: days, results, ok: failures.length === 0 }, null, 2) + "\n");
  else for (const r of results) {
    if (r.ok) out.write(`set  ${r.tool.padEnd(4)} ${r.days} days  [${r.path}]\n`);
    else out.write(`FAIL ${r.tool.padEnd(4)} ${r.error}\n`);
  }
  for (const f of failures) err.write(`pmsec: ${f.error}\n`);
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
  if (opts.help || !opts.command) { out.write(USAGE); return opts.help ? 0 : 2; }
  let targets;
  try { targets = selectTools(opts.only); }
  catch (e) { err.write(`pmsec: ${e.message}\n`); return 2; }
  try {
    if (opts.command === "check") return await runCheck(targets, opts, env, home, platform, out, err);
    if (opts.command === "set") return await runSet(targets, opts.days, opts.json, opts.force, env, home, platform, out, err);
    if (opts.command === "unset") return await runUnset(targets, opts.json, env, home, platform, out, err);
    err.write(`pmsec: unknown command "${opts.command}"\n`);
    return 2;
  } catch (e) {
    err.write(`pmsec: ${e.message}\n`);
    return 1;
  }
}
