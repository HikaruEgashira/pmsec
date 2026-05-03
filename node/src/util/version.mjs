import { spawnSync } from "node:child_process";

export function detectVersion(bin, args = ["--version"]) {
  try {
    const res = spawnSync(bin, args, { encoding: "utf8" });
    if (res.status !== 0) return null;
    const m = (res.stdout || "").match(/(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] };
  } catch { return null; }
}

export function gte(v, target) {
  if (!v) return null;
  const [a, b, c] = target;
  if (v.major !== a) return v.major > a;
  if (v.minor !== b) return v.minor > b;
  return v.patch >= c;
}
