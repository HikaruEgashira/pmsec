const SECTION = /^\s*\[[^\]]+\]\s*$/;

function entryKey(line, sep) {
  const re = sep === ":" ? /^\s*([A-Za-z0-9_.\-]+)\s*:/ : /^\s*([A-Za-z0-9_.\-]+)\s*=/;
  const m = line.match(re);
  return m ? m[1] : null;
}

function rangeForSection(lines, section) {
  if (!section) {
    for (let i = 0; i < lines.length; i++) if (SECTION.test(lines[i])) return [0, i];
    return [0, lines.length];
  }
  const header = `[${section}]`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) { start = i + 1; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (SECTION.test(lines[i])) { end = i; break; }
  }
  return [start, end];
}

// TOML forbids `a.b = x` under [s] when [s.a] exists, so target the subtable instead.
function resolve(lines, key, sep, section) {
  if (section && sep === "=" && key.includes(".")) {
    const dot = key.indexOf(".");
    const sub = `${section}.${key.slice(0, dot)}`;
    if (rangeForSection(lines, sub) !== null) return [key.slice(dot + 1), sub];
  }
  return [key, section];
}

function indexOfKey(lines, range, key, sep) {
  for (let i = range[0]; i < range[1]; i++) if (entryKey(lines[i], sep) === key) return i;
  return -1;
}

function indexOfFirstSection(lines) {
  for (let i = 0; i < lines.length; i++) if (SECTION.test(lines[i])) return i;
  return -1;
}

export function readKey(text, key, opts = {}) {
  const sep = opts.sep || "=";
  const lines = text.split(/\r?\n/);
  let section;
  [key, section] = resolve(lines, key, sep, opts.section || null);
  const range = rangeForSection(lines, section);
  if (range === null) return null;
  const i = indexOfKey(lines, range, key, sep);
  if (i < 0) return null;
  const re = sep === ":" ? /^\s*[A-Za-z0-9_.\-]+\s*:\s*(.*?)\s*$/ : /^\s*[A-Za-z0-9_.\-]+\s*=\s*(.*?)\s*$/;
  const m = lines[i].match(re);
  return m ? m[1] : null;
}

export function setKey(text, key, valueLine, opts = {}) {
  const sep = opts.sep || "=";
  const trailing = text.endsWith("\n") || text === "";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const orig = key;
  let section;
  [key, section] = resolve(lines, key, sep, opts.section || null);
  if (key !== orig) valueLine = key + valueLine.slice(orig.length);
  let range = rangeForSection(lines, section);
  if (range === null) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(`[${section}]`, valueLine);
  } else {
    const idx = indexOfKey(lines, range, key, sep);
    if (idx >= 0) {
      lines[idx] = valueLine;
    } else if (section) {
      lines.splice(range[0], 0, valueLine);
    } else {
      const firstSec = indexOfFirstSection(lines);
      if (firstSec < 0) lines.push(valueLine);
      else lines.splice(firstSec, 0, valueLine, "");
    }
  }
  return lines.join("\n") + (trailing || lines.length ? "\n" : "");
}

export function removeKey(text, key, opts = {}) {
  const sep = opts.sep || "=";
  const trailing = text.endsWith("\n");
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  let section;
  [key, section] = resolve(lines, key, sep, opts.section || null);
  const range = rangeForSection(lines, section);
  if (range === null) return { text, removed: false };
  const idx = indexOfKey(lines, range, key, sep);
  if (idx < 0) return { text, removed: false };
  lines.splice(idx, 1);
  if (idx < lines.length && lines[idx] === "") lines.splice(idx, 1);
  return { text: lines.join("\n") + (trailing && lines.length ? "\n" : ""), removed: true };
}
