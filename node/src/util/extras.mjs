// Per-tool "extras" are fixed-value hardening keys written alongside the main
// cooldown key on `set`, removed on `unset`, and validated on `check`.
// Each entry: { key, expected, line, sep?, section? } — `line` is the verbatim
// text to write (handles per-format quoting/typing); `expected` is the bare
// value compared against readKey output.
import { readKey, setKey, removeKey } from "./lines.mjs";

export function readExtras(raw, extras) {
  return extras.map(e => {
    const cur = readKey(raw, e.key, { sep: e.sep, section: e.section });
    return { key: e.key, configured: cur, expected: e.expected, ok: cur === e.expected };
  });
}

export function applyExtras(text, extras) {
  let out = text;
  for (const e of extras) {
    out = setKey(out, e.key, e.line, { sep: e.sep, section: e.section });
  }
  return out;
}

export function removeExtras(text, extras) {
  let out = text;
  let removed = false;
  for (const e of extras) {
    const r = removeKey(out, e.key, { sep: e.sep, section: e.section });
    if (r.removed) removed = true;
    out = r.text;
  }
  return { text: out, removed };
}
