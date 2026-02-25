"use strict";

/**
 * MAP v1.1 constants — canonical header, MCF type tags, and normative limits.
 *
 * Spec references: §3.2 (type tags), §4 (limits), §5.1 (CANON_HDR).
 */

const SPEC_VERSION = "1.1";

// 5-byte canonical header: ASCII "MAP1" + NUL terminator.
// The "1" is the major canon version, not the spec minor — it won't change
// until the canonical framing itself breaks compat.  See Appendix A6.
const CANON_HDR = Buffer.from("MAP1\x00", "ascii");

// ── MCF type tags (single byte each) ──────────────────────
// 0x01–0x04 unchanged from v1.0.
// 0x05–0x06 added in v1.1 to resolve boolean-string collision
// and let integers through instead of blanket-rejecting all numbers.
const TAG_STRING  = 0x01;
const TAG_BYTES   = 0x02;
const TAG_LIST    = 0x03;
const TAG_MAP     = 0x04;
const TAG_BOOLEAN = 0x05;  // payload 0x01 (true) or 0x00 (false)
const TAG_INTEGER = 0x06;  // signed int64 big-endian, always 8 bytes

// ── Signed 64-bit integer bounds ──────────────────────────
// JS numbers lose precision above 2^53, so we use BigInt for range checks.
// These are the canonical INT64 bounds from the spec.
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

// ── Normative safety limits (§4) ──────────────────────────
// Enforced before allocation to prevent DoS via oversized/deeply nested input.
const MAX_CANON_BYTES  = 1_048_576;   // 1 MiB
const MAX_DEPTH        = 32;
const MAX_MAP_ENTRIES  = 65_535;
const MAX_LIST_ENTRIES = 65_535;

module.exports = {
  SPEC_VERSION,
  CANON_HDR,
  TAG_STRING,
  TAG_BYTES,
  TAG_LIST,
  TAG_MAP,
  TAG_BOOLEAN,
  TAG_INTEGER,
  INT64_MIN,
  INT64_MAX,
  MAX_CANON_BYTES,
  MAX_DEPTH,
  MAX_MAP_ENTRIES,
  MAX_LIST_ENTRIES,
};
