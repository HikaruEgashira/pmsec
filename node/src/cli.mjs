import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { shellQuote } from "./util/io.mjs";
import * as npm from "./tools/npm.mjs";
import * as pnpm from "./tools/pnpm.mjs";
import * as yarn from "./tools/yarn.mjs";
import * as bun from "./tools/bun.mjs";
import * as cargo from "./tools/cargo.mjs";
import * as mise from "./tools/mise.mjs";
import * as uv from "./tools/uv.mjs";

const TOOLS = [npm, pnpm, yarn, bun, cargo, mise, uv];
// Default cooldown for the hardening bundle. Override per-invocation with
// `--days N`; the default tracks the safest value we'd recommend.
const BUNDLE_DAYS = 3;
export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const USAGE = `pmsec <command> [options]

Zero-config install-time supply-chain hardening across npm, pnpm, yarn,
bun, cargo, mise, uv. \`set\` flips on every safe-by-default key each
tool exposes (cooldown, audit-level, trust-policy, hardened mode,
attestation re-verification, ...). No knobs.

Commands:
  enable                Apply the hardening bundle to all selected tools
  disable               Remove the hardening bundle from selected tools
  check                 Verify the bundle is in place (exit 1 if anything missing)

Options:
  --tool TOOL[,TOOL]    Restrict to specific tools (npm,pnpm,yarn,bun,cargo,mise,uv)
  --days N              Override cooldown days (default 3)
  --force               Overwrite stricter existing cooldowns (otherwise enable is monotonic)
  --json                Emit JSON output
  -V, --version         Show version
  -h, --help            Show this help

Examples:
  npx pmsec enable
  npx pmsec enable --days 7
  npx pmsec enable --days 1 --force
  npx pmsec check
  npx pmsec disable --tool npm
`;

function parseDays(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--days must be a positive integer (got "${raw}")`);
  return n;
}

function parse(argv) {
  const opts = { command: null, json: false, only: null, days: BUNDLE_DAYS, force: false, help: false, version: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-V" || a === "--version") opts.version = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--tool") opts.only = argv[++i].split(",");
    else if (a.startsWith("--tool=")) opts.only = a.slice(7).split(",");
    else if (a === "--days") opts.days = parseDays(argv[++i]);
    else if (a.startsWith("--days=")) opts.days = parseDays(a.slice(7));
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else positional.push(a);
  }
  opts.command = positional[0] ?? null;
  if (positional.length > 1) throw new Error(`unexpected argument: ${positional[1]}`);
  return opts;
}

function selectTools(only) {
  if (!only) return TOOLS;
  const found = TOOLS.filter(t => only.includes(t.name));
  const missing = only.filter(n => !TOOLS.some(t => t.name === n));
  if (missing.length) throw new Error(`unknown tool(s): ${missing.join(",")}`);
  return found;
}

function preflightWarn(t, ctx) {
  if (typeof t.preflight !== "function") return null;
  const pf = t.preflight(ctx);
  return pf?.message ?? null;
}

async function gatherStatus(targets, ctx) {
  return Promise.all(targets.map(async t => {
    const r = await t.read(ctx);
    return {
      tool: t.name, key: t.key, path: r.path,
      configured: r.configured, days: r.days,
      extras: r.extras ?? [],
      warn: preflightWarn(t, ctx)
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
      const exStatus = e.ok ? "OK     " : e.configured === null ? "MISSING" : "STALE  ";
      const exValue = e.defaultEnforced ? `(default — runtime enforces ${e.expected})` : (e.configured ?? "(unset)");
      lines.push(`${exStatus} ${r.tool.padEnd(4)} ${e.key} = ${exValue}  [${r.path}]`);
    }
  }
  return lines.join("\n") + "\n";
}

async function runCheck(targets, { json, days }, ctx, out, err) {
  const rows = await gatherStatus(targets, ctx);
  const failingPrimary = rows.filter(r => r.days === null || r.days < days);
  const failingExtras = rows.flatMap(r => r.extras.filter(e => !e.ok));
  const ok = failingPrimary.length === 0 && failingExtras.length === 0;
  if (json) out.write(JSON.stringify({ bundleDays: days, rows, ok }, null, 2) + "\n");
  else out.write(renderHuman(rows, days));
  if (failingPrimary.length) err.write(`pmsec: ${failingPrimary.length} tool(s) below ${days} days — run \`pmsec enable\`\n`);
  if (failingExtras.length) err.write(`pmsec: ${failingExtras.length} hardening setting(s) not at safe value — run \`pmsec enable\`\n`);
  return ok ? 0 : 1;
}

function explainFsError(e, tool) {
  if (e?.code === "EACCES" || e?.code === "EPERM") {
    const p = e.path ?? "";
    const q = p ? shellQuote(p) : "";
    return `${tool}: cannot write ${p} (${e.code}). Check file ownership: \`ls -la ${q}\` — if owned by root, run \`sudo chown -h $(id -u):$(id -g) ${q}\`.`;
  }
  if (e?.code === "EROFS") return `${tool}: ${e.path ?? ""} is on a read-only filesystem (EROFS).`;
  return `${tool}: ${e?.message ?? e}`;
}

async function runEnable(targets, json, days, force, ctx, out, err) {
  // Each tool writes a different config file; safe to run in parallel.
  // Promise.all preserves input order in the results array.
  const results = await Promise.all(targets.map(async t => {
    const warn = preflightWarn(t, ctx);
    try {
      let effective = days;
      let kept = false;
      if (!force) {
        const current = await t.read(ctx);
        const currentDays = current.days ?? 0;
        effective = Math.max(currentDays, days);
        kept = currentDays >= days && currentDays > 0;
      }
      const r = await t.write(effective, ctx);
      return { tool: t.name, path: r.path, days: effective, requested: days, kept, forced: force, ok: true, warn };
    } catch (e) {
      return { tool: t.name, path: e?.path ?? null, days, requested: days, kept: false, forced: force, ok: false, error: explainFsError(e, t.name), warn };
    }
  }));
  const failures = results.filter(r => !r.ok).map(r => ({ tool: r.tool, error: r.error }));
  const warnings = results.filter(r => r.warn).map(r => ({ tool: r.tool, warn: r.warn }));
  if (json) out.write(JSON.stringify({ enabled: true, bundleDays: days, results, warnings, ok: failures.length === 0 }, null, 2) + "\n");
  else for (const r of results) {
    if (r.ok) {
      const action = r.kept ? "keep   " : "enable ";
      const note = r.kept ? `  (kept existing ${r.days}d ≥ ${r.requested}d)` : "";
      const tail = r.warn ? `\n     ⚠ ${r.warn}` : "";
      out.write(`${action} ${r.tool.padEnd(4)} [${r.path}]${note}${tail}\n`);
    } else {
      out.write(`FAIL    ${r.tool.padEnd(4)} ${r.error}\n`);
    }
  }
  for (const f of failures) err.write(`pmsec: ${f.error}\n`);
  if (warnings.length) err.write(`pmsec: ${warnings.length} tool(s) configured but runtime may silently ignore the cooldown — see ⚠ above\n`);
  return failures.length ? 1 : 0;
}

async function runDisable(targets, json, ctx, out, err) {
  const results = await Promise.all(targets.map(async t => {
    try {
      const r = await t.unset(ctx);
      return { tool: t.name, path: r.path, removed: r.removed, ok: true };
    } catch (e) {
      return { tool: t.name, path: e?.path ?? null, removed: false, ok: false, error: explainFsError(e, t.name) };
    }
  }));
  const failures = results.filter(r => !r.ok).map(r => ({ tool: r.tool, error: r.error }));
  if (json) out.write(JSON.stringify({ results, ok: failures.length === 0 }, null, 2) + "\n");
  else for (const r of results) {
    if (!r.ok) out.write(`FAIL    ${r.tool.padEnd(4)} ${r.error}\n`);
    else out.write(`${r.removed ? "disable " : "skip    "} ${r.tool.padEnd(4)} [${r.path}]\n`);
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
  const ctx = { env, home, platform };
  try {
    if (opts.command === "check") return await runCheck(targets, opts, ctx, out, err);
    if (opts.command === "enable") return await runEnable(targets, opts.json, opts.days, opts.force, ctx, out, err);
    if (opts.command === "disable") return await runDisable(targets, opts.json, ctx, out, err);
    err.write(`pmsec: unknown command "${opts.command}"\n`);
    return 2;
  } catch (e) {
    err.write(`pmsec: ${e.message}\n`);
    return 1;
  }
}
