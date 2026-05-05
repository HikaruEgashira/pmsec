import { spawnSync } from "node:child_process";

function parseSemver(s) {
  const m = String(s || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] };
}

// `env[overrideKey]` ("X.Y.Z" or "none") forces the result without spawning the
// real binary — used by tests to make pnpm 11 default-enforcement behavior
// deterministic regardless of what's installed locally.
export function detectVersion(bin, args = ["--version"], { env, overrideKey } = {}) {
  if (env && overrideKey) {
    const o = env[overrideKey];
    if (o === "none") return null;
    if (o) {
      const p = parseSemver(o);
      if (p) return p;
    }
  }
  try {
    const res = spawnSync(bin, args, { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
    if (res.status !== 0) return null;
    return parseSemver(res.stdout);
  } catch { return null; }
}

export function gte(v, target) {
  if (!v) return null;
  const [a, b, c] = target;
  if (v.major !== a) return v.major > a;
  if (v.minor !== b) return v.minor > b;
  return v.patch >= c;
}

export function buildPreflight(name, minBin, suffix) {
  return () => {
    const v = detectVersion(name);
    if (v === null) return { ok: true, message: null };
    if (gte(v, minBin)) return { ok: true, version: v.raw, message: null };
    return { ok: true, warn: true, version: v.raw,
      message: `${name} ${v.raw} < ${minBin.join(".")}: ${suffix}` };
  };
}
