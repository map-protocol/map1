// MAP v1.0 BIND projection (RFC 6901 JSON Pointers)

import { MapError, ERR_SCHEMA } from "./errors";

// ────────── JSON Pointer parsing (RFC 6901) ──────────

function parseJsonPointer(ptr: string): string[] {
  if (ptr === "") return [];
  if (!ptr.startsWith("/")) throw new MapError(ERR_SCHEMA, "pointer must start with /");
  const parts = ptr.split("/").slice(1);
  return parts.map(t => {
    let out = "";
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch !== "~") { out += ch; continue; }
      if (i + 1 >= t.length) throw new MapError(ERR_SCHEMA, "invalid ~ escape in pointer");
      const nxt = t[i + 1];
      if (nxt === "0") out += "~";
      else if (nxt === "1") out += "/";
      else throw new MapError(ERR_SCHEMA, "invalid ~ escape in pointer");
      i++;
    }
    return out;
  });
}

// ────────── BIND projection ──────────

export function bindProject(
  descriptor: Record<string, unknown>,
  pointers: string[],
): Record<string, unknown> {
  // Root must be MAP (object, not array)
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor)
  ) {
    throw new MapError(ERR_SCHEMA, "descriptor");
  }

  // Duplicate pointers → fail-closed
  const seen = new Set<string>();
  for (const p of pointers) {
    if (seen.has(p)) throw new MapError(ERR_SCHEMA, "duplicate pointers");
    seen.add(p);
  }

  // Parse all pointers (fail-closed on parse error)
  const parsed = pointers.map(p => ({ ptr: p, toks: parseJsonPointer(p) }));

  // Determine matches
  let anyMatch = false;
  let anyUnmatched = false;
  const matchedToks: string[][] = [];

  for (const { ptr, toks } of parsed) {
    if (ptr === "") { anyMatch = true; continue; } // empty pointer always matches MAP root
    let cur: unknown = descriptor;
    let ok = true;
    for (const tok of toks) {
      if (Array.isArray(cur)) throw new MapError(ERR_SCHEMA, "list traversal");
      if (!cur || typeof cur !== "object") { ok = false; break; }
      if (!(tok in (cur as Record<string, unknown>))) { ok = false; break; }
      cur = (cur as Record<string, unknown>)[tok];
    }
    if (ok) { anyMatch = true; matchedToks.push(toks); }
    else { anyUnmatched = true; }
  }

  // Unmatched pointers (fail-closed, with one exception)
  if (!anyMatch) return {};
  if (anyUnmatched) throw new MapError(ERR_SCHEMA, "unmatched pointer");

  // Empty pointer "" => FULL-equivalent over MAP root
  if (parsed.some(p => p.ptr === "")) return descriptor;

  // Overlapping pointers subsumption: discard those strictly within another
  function isSubsumed(toks: string[]): boolean {
    for (const other of matchedToks) {
      if (other.length < toks.length) {
        let same = true;
        for (let i = 0; i < other.length; i++) {
          if (toks[i] !== other[i]) { same = false; break; }
        }
        if (same) return true;
      }
    }
    return false;
  }
  const effective = matchedToks.filter(t => !isSubsumed(t));

  // Build projection
  const projected: Record<string, unknown> = {};
  for (const toks of effective) {
    let cur: unknown = descriptor;
    const path: string[] = [];
    for (const tok of toks) {
      if (Array.isArray(cur)) throw new MapError(ERR_SCHEMA, "list traversal");
      if (!cur || typeof cur !== "object") throw new MapError(ERR_SCHEMA, "cannot traverse");
      if (!(tok in (cur as Record<string, unknown>))) throw new MapError(ERR_SCHEMA, "cannot traverse");
      path.push(tok);
      cur = (cur as Record<string, unknown>)[tok];
    }
    let outCur: Record<string, unknown> = projected;
    for (let idx = 0; idx < path.length; idx++) {
      const tok = path[idx];
      if (idx === path.length - 1) {
        outCur[tok] = cur;
      } else {
        if (!(tok in outCur)) outCur[tok] = {};
        if (Array.isArray(outCur[tok])) throw new MapError(ERR_SCHEMA, "bind conflict");
        outCur = outCur[tok] as Record<string, unknown>;
      }
    }
  }
  return projected;
}
