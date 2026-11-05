// TOML tables may carry a trailing comment, inner whitespace, quoted names, or be [[arrays]].
const SECTION = /^\s*\[\[?[^\[\]]+\]\]?\s*(#.*)?$/;
const HEADER = /^\s*\[([^\[\]]+)\]\s*(#.*)?$/;
const KEY = String.raw`("[^"]*"|'[^']*'|[A-Za-z0-9_.\-]+)`;

function unquote(s) {
  return /^(".*"|'.*')$/.test(s) ? s.slice(1, -1) : s;
}

function headerName(line) {
  const m = line.match(HEADER);
  return m ? m[1].split(".").map(p => unquote(p.trim())).join(".") : null;
}

function entryKey(line, sep) {
  const m = line.match(new RegExp(String.raw`^\s*${KEY}\s*${sep}`));
  return m ? unquote(m[1]) : null;
}

// Value after the separator with any trailing comment removed.
function entryValue(line, sep) {
  const m = line.match(new RegExp(String.raw`^\s*${KEY}\s*${sep}\s*(.*?)\s*$`));
  if (!m) return null;
  const v = m[2];
  const close = { '"': '"', "'": "'", "{": "}" }[v[0]];
  if (close) {
    const end = v.indexOf(close, 1);
    if (end >= 0) return v.slice(0, end + 1);
  }
  return v.replace(/\s+#.*$/, "");
}

function rangeForSection(lines, section) {
  if (!section) {
    for (let i = 0; i < lines.length; i++) if (SECTION.test(lines[i])) return [0, i];
    return [0, lines.length];
  }
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerName(lines[i]) === section) { start = i + 1; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (SECTION.test(lines[i])) { end = i; break; }
  }
  return [start, end];
}

function indexOfKey(lines, range, key, sep) {
  for (let i = range[0]; i < range[1]; i++) if (entryKey(lines[i], sep) === key) return i;
  return -1;
}

// TOML forbids `a.b = x` under [s] when [s.a] exists or `a` is an inline table,
// so target the subtable, or report the inline-table line to edit in place.
function resolve(lines, key, sep, section) {
  if (section && sep === "=" && key.includes(".")) {
    const dot = key.indexOf(".");
    const head = key.slice(0, dot), rest = key.slice(dot + 1);
    const sub = `${section}.${head}`;
    if (rangeForSection(lines, sub) !== null) return { key: rest, section: sub };
    const range = rangeForSection(lines, section);
    if (range !== null) {
      const i = indexOfKey(lines, range, head, sep);
      if (i >= 0 && (entryValue(lines[i], sep) || "").startsWith("{")) return { key: rest, section, inline: i, head };
    }
  }
  return { key, section };
}

function inlinePairs(line) {
  const v = entryValue(line, "=");
  const body = v.slice(1, v.endsWith("}") ? -1 : undefined).trim();
  return body === "" ? [] : body.split(",").map(p => p.trim()).filter(Boolean);
}

function inlineLine(line, head, pairs) {
  const indent = line.match(/^\s*/)[0];
  return `${indent}${head} = {${pairs.length ? ` ${pairs.join(", ")} ` : ""}}`;
}

function indexOfFirstSection(lines) {
  for (let i = 0; i < lines.length; i++) if (SECTION.test(lines[i])) return i;
  return -1;
}

export function readKey(text, key, opts = {}) {
  const sep = opts.sep || "=";
  const lines = text.split(/\r?\n/);
  const r = resolve(lines, key, sep, opts.section || null);
  if (r.inline !== undefined) {
    const pair = inlinePairs(lines[r.inline]).find(p => entryKey(p, sep) === r.key);
    return pair ? entryValue(pair, sep) : null;
  }
  const range = rangeForSection(lines, r.section);
  if (range === null) return null;
  const i = indexOfKey(lines, range, r.key, sep);
  return i < 0 ? null : entryValue(lines[i], sep);
}

export function setKey(text, key, valueLine, opts = {}) {
  const sep = opts.sep || "=";
  const trailing = text.endsWith("\n") || text === "";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const r = resolve(lines, key, sep, opts.section || null);
  const section = r.section;
  if (r.key !== key) valueLine = r.key + valueLine.slice(key.length);
  if (r.inline !== undefined) {
    const pairs = inlinePairs(lines[r.inline]);
    const at = pairs.findIndex(p => entryKey(p, sep) === r.key);
    if (at >= 0) pairs[at] = valueLine; else pairs.push(valueLine);
    lines[r.inline] = inlineLine(lines[r.inline], r.head, pairs);
    return lines.join("\n") + "\n";
  }
  key = r.key;
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
  const r = resolve(lines, key, sep, opts.section || null);
  if (r.inline !== undefined) {
    const pairs = inlinePairs(lines[r.inline]);
    const kept = pairs.filter(p => entryKey(p, sep) !== r.key);
    if (kept.length === pairs.length) return { text, removed: false };
    lines[r.inline] = inlineLine(lines[r.inline], r.head, kept);
    return { text: lines.join("\n") + (trailing ? "\n" : ""), removed: true };
  }
  const range = rangeForSection(lines, r.section);
  if (range === null) return { text, removed: false };
  const idx = indexOfKey(lines, range, r.key, sep);
  if (idx < 0) return { text, removed: false };
  lines.splice(idx, 1);
  if (idx < lines.length && lines[idx] === "") lines.splice(idx, 1);
  return { text: lines.join("\n") + (trailing && lines.length ? "\n" : ""), removed: true };
}
