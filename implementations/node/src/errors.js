"use strict";

/**
 * MAP v1.1 error codes, exception class, and precedence logic.
 *
 * Spec reference: §6 (Errors).
 *
 * Error precedence is load-bearing for conformance — when multiple violations
 * apply, we MUST report the highest-precedence one.  The ordering below is
 * normative and fixed by §6.2.
 */

// ── Error codes (9 total, ordered by precedence) ──────────
// Names match the spec verbatim.  Grep-friendly across implementations.
const ERR_CANON_HDR   = "ERR_CANON_HDR";    // bad 5-byte header
const ERR_CANON_MCF   = "ERR_CANON_MCF";    // malformed MCF structure
const ERR_SCHEMA      = "ERR_SCHEMA";        // bad shape, BOM, BIND-into-LIST, etc.
const ERR_TYPE        = "ERR_TYPE";          // unsupported type (null, float)
const ERR_UTF8        = "ERR_UTF8";          // invalid UTF-8 or surrogates
const ERR_DUP_KEY     = "ERR_DUP_KEY";      // duplicate MAP key
const ERR_KEY_ORDER   = "ERR_KEY_ORDER";     // keys not in memcmp order
const ERR_LIMIT_DEPTH = "ERR_LIMIT_DEPTH";  // exceeds MAX_DEPTH
const ERR_LIMIT_SIZE  = "ERR_LIMIT_SIZE";   // exceeds MAX_CANON_BYTES

// Precedence list — index 0 wins.  This ordering is normative per §6.2.
const PRECEDENCE = [
  ERR_CANON_HDR,
  ERR_CANON_MCF,
  ERR_SCHEMA,
  ERR_TYPE,
  ERR_UTF8,
  ERR_DUP_KEY,
  ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH,
  ERR_LIMIT_SIZE,
];

const _precIndex = new Map(PRECEDENCE.map((code, idx) => [code, idx]));

/**
 * MAP processing error.  The `.code` property is one of the ERR_* constants
 * and is what conformance tests compare against.
 */
class MapError extends Error {
  constructor(code, msg) {
    super(msg || code);
    this.code = code;
    this.name = "MapError";
  }
}

/**
 * Given multiple detected violations, return the highest-precedence code.
 *
 * Implements the "reported-code rule" from §6.2.  Most code paths raise
 * immediately, but the JSON adapter sometimes needs to defer lower-priority
 * errors while scanning for higher-priority ones (e.g., dup keys deferred
 * so that ERR_TYPE from a null can surface first).
 */
function chooseReportedError(errors) {
  let best = errors[0];
  let bestIdx = _precIndex.get(best) ?? 10000;
  for (let i = 1; i < errors.length; i++) {
    const idx = _precIndex.get(errors[i]) ?? 10000;
    if (idx < bestIdx) {
      best = errors[i];
      bestIdx = idx;
    }
  }
  return best;
}

module.exports = {
  ERR_CANON_HDR,
  ERR_CANON_MCF,
  ERR_SCHEMA,
  ERR_TYPE,
  ERR_UTF8,
  ERR_DUP_KEY,
  ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH,
  ERR_LIMIT_SIZE,
  PRECEDENCE,
  MapError,
  chooseReportedError,
};
