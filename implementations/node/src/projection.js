"use strict";

/**
 * MAP v1.1 projection — FULL and BIND modes.
 *
 * FULL (§2.2): identity function on the descriptor MAP.
 * BIND (§2.3): select specific fields by RFC 6901 JSON Pointer paths,
 *              producing a minimal enclosing MAP structure.
 *
 * BIND is where most of the complexity lives.  The spec has five pointer-set
 * rules (a–e) plus four structural rules (1–4) that interact in non-obvious
 * ways.  Comments below reference specific spec rules so implementers can
 * trace each branch to normative text.
 */

const { MapError, ERR_SCHEMA } = require("./errors");


// ── RFC 6901 JSON Pointer parsing ─────────────────────────
// Tilde escaping: "~0" → "~" and "~1" → "/".  Order matters — decode
// character-by-character to avoid the ~01 trap (if you replace ~1 first,
// "~01" becomes "~/" instead of "/1"... wait, no, it's the other way:
// replace ~1 then ~0 turns "~01" into "~/" then "//").  Just go char by char.

function parsePointer(ptr) {
  // "" (empty string) → [] (whole-document pointer, rule 2.3.e).
  if (ptr === "") return [];

  if (!ptr.startsWith("/")) {
    throw new MapError(ERR_SCHEMA, "pointer must start with '/'");
  }

  const parts = ptr.split("/").slice(1);
  const tokens = [];

  for (const raw of parts) {
    let decoded = "";
    let i = 0;
    while (i < raw.length) {
      if (raw[i] !== "~") {
        decoded += raw[i];
        i++;
        continue;
      }
      // Must have a character after ~
      if (i + 1 >= raw.length) {
        throw new MapError(ERR_SCHEMA, "dangling ~ in pointer");
      }
      const nxt = raw[i + 1];
      if (nxt === "0") {
        decoded += "~";
      } else if (nxt === "1") {
        decoded += "/";
      } else {
        throw new MapError(ERR_SCHEMA, `bad ~${nxt} escape in pointer`);
      }
      i += 2;
    }
    tokens.push(decoded);
  }
  return tokens;
}


// ── FULL projection (§2.2) ────────────────────────────────

function fullProject(descriptor) {
  return descriptor;
}


// ── BIND projection (§2.3) ────────────────────────────────

/**
 * Select fields from descriptor by JSON Pointer paths.
 *
 * Implements all normative rules from §2.3:
 *   (a) Parse every pointer per RFC 6901
 *   (b) Reject duplicate pointers
 *   (c) Unmatched pointer handling (fail-closed unless zero match)
 *   (d) Subsumption of overlapping pointers
 *   (e) Empty pointer "" = FULL-equivalent
 *   (1) Omit siblings at each MAP level
 *   (2) Minimal enclosing structure
 *   (3) No match → empty MAP
 *   (4) LIST traversal is forbidden (ERR_SCHEMA)
 *
 * @param {Object} descriptor - The input descriptor (must be a MAP/object).
 * @param {string[]} pointers - RFC 6901 pointer strings.
 * @returns {Object} The projected MAP.
 */
function bindProject(descriptor, pointers) {
  // Root must be a MAP.
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor) || Buffer.isBuffer(descriptor)) {
    throw new MapError(ERR_SCHEMA, "BIND root must be a MAP");
  }

  // Rule (b): no duplicate pointer strings.
  if (new Set(pointers).size !== pointers.length) {
    throw new MapError(ERR_SCHEMA, "duplicate pointers");
  }

  // Rule (a): parse all pointers up front.  Parse failures are caught
  // before any descriptor traversal starts.
  const parsed = pointers.map(ptr => ({ ptr, tokens: parsePointer(ptr) }));

  // Walk each pointer to determine match status.
  const matchedPaths = [];
  let anyMatch = false;
  let anyUnmatched = false;

  for (const { ptr, tokens } of parsed) {
    // Rule (e): empty pointer always matches the MAP root.
    if (ptr === "") {
      anyMatch = true;
      continue;
    }

    let cur = descriptor;
    let ok = true;
    for (const tok of tokens) {
      // Rule (4): LIST traversal is forbidden.
      if (Array.isArray(cur)) {
        throw new MapError(ERR_SCHEMA, "BIND cannot traverse LIST");
      }
      if (cur === null || typeof cur !== "object" || !(tok in cur)) {
        ok = false;
        break;
      }
      cur = cur[tok];
    }

    if (ok) {
      anyMatch = true;
      matchedPaths.push(tokens);
    } else {
      anyUnmatched = true;
    }
  }

  // Rule (c): unmatched pointer handling.
  if (!anyMatch) {
    return {};  // Rule (3): all pointers unmatched → empty MAP
  }
  if (anyUnmatched) {
    // At least one matched but another didn't → fail-closed.
    throw new MapError(ERR_SCHEMA, "unmatched pointer in set");
  }

  // Rule (e): if any pointer is "", result is the full descriptor.
  if (parsed.some(p => p.ptr === "")) {
    return descriptor;
  }

  // Rule (d): discard subsumed pointers (P1 is prefix of P2 → P2 is redundant).
  function isSubsumed(toks) {
    for (const other of matchedPaths) {
      if (other.length < toks.length) {
        let prefix = true;
        for (let i = 0; i < other.length; i++) {
          if (other[i] !== toks[i]) { prefix = false; break; }
        }
        if (prefix) return true;
      }
    }
    return false;
  }

  const effective = matchedPaths.filter(t => !isSubsumed(t));

  // Build projected tree — rule (1) omit-siblings, rule (2) minimal structure.
  const projected = {};

  for (const toks of effective) {
    // Walk original descriptor to find the leaf value.
    let cur = descriptor;
    for (const tok of toks) {
      if (Array.isArray(cur)) {
        throw new MapError(ERR_SCHEMA, "BIND cannot traverse LIST");
      }
      if (cur === null || typeof cur !== "object") {
        throw new MapError(ERR_SCHEMA, "cannot traverse non-MAP");
      }
      cur = cur[tok];
    }
    const leafValue = cur;

    // Walk the projected tree, creating nested objects as needed.
    let target = projected;
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (i === toks.length - 1) {
        target[tok] = leafValue;
      } else {
        if (!(tok in target)) {
          target[tok] = {};
        }
        const nxt = target[tok];
        if (typeof nxt !== "object" || Array.isArray(nxt) || nxt === null) {
          throw new MapError(ERR_SCHEMA, "BIND path conflict");
        }
        target = nxt;
      }
    }
  }

  return projected;
}

module.exports = {
  parsePointer,
  fullProject,
  bindProject,
};
