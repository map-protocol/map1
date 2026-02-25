"use strict";

/**
 * MAP v1.1 core — MCF encode/decode, UTF-8 validation, key ordering, MID.
 *
 * The six canonical types are:
 *   STRING  (0x01) — UTF-8 text, scalar code-points only
 *   BYTES   (0x02) — raw byte sequence
 *   LIST    (0x03) — ordered array of values
 *   MAP     (0x04) — sorted key/value pairs, string keys only
 *   BOOLEAN (0x05) — true or false, 1-byte payload (v1.1)
 *   INTEGER (0x06) — signed 64-bit, big-endian (v1.1)
 *
 * In JS, canonical model values are represented as:
 *   STRING  → string
 *   BYTES   → Buffer
 *   LIST    → Array
 *   MAP     → plain Object (keys are strings)
 *   BOOLEAN → boolean
 *   INTEGER → BigInt  (always BigInt internally, even for small values)
 */

const crypto = require("crypto");

const {
  CANON_HDR,
  INT64_MIN, INT64_MAX,
  MAX_CANON_BYTES, MAX_DEPTH,
  MAX_MAP_ENTRIES, MAX_LIST_ENTRIES,
  TAG_STRING, TAG_BYTES, TAG_LIST, TAG_MAP,
  TAG_BOOLEAN, TAG_INTEGER,
} = require("./constants");

const {
  MapError,
  ERR_CANON_HDR, ERR_CANON_MCF, ERR_DUP_KEY, ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE, ERR_SCHEMA, ERR_UTF8,
} = require("./errors");


function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}


// ── UTF-8 scalar validation (§3.4) ─────────────────────────
//
// "Scalar values only" = no surrogates (U+D800–U+DFFF).  Node's Buffer
// doesn't produce surrogates from valid UTF-8, but we check anyway because
// MAP requires fail-fast on any surrogate — even from adversarial input.

function validateUtf8Scalar(buf) {
  // First: verify the bytes are valid UTF-8.
  // Node's TextDecoder with fatal:true throws on invalid UTF-8.
  let str;
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    str = dec.decode(buf);
  } catch (_e) {
    throw new MapError(ERR_UTF8, "invalid utf-8");
  }

  // Second: reject surrogate code-points.
  // JS strings are UTF-16, so a lone surrogate in the decoded string
  // indicates the input somehow smuggled one through.
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i);
    if (cp >= 0xD800 && cp <= 0xDFFF) {
      throw new MapError(ERR_UTF8, `surrogate code-point U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
    }
    // Skip the low surrogate half of an astral pair
    if (cp > 0xFFFF) i++;
  }
}


// ── Key ordering (§3.5) ────────────────────────────────────
//
// THE single most critical fork surface in the whole spec.
// Ordering is raw unsigned-octet comparison (memcmp semantics), NOT
// Unicode code-point order, NOT locale collation, NOT UTF-16 order.
// Buffer.compare does unsigned-byte comparison, which is exactly what we need.

function keyCmp(a, b) {
  return Buffer.compare(a, b);
}

// TODO: benchmark Buffer.compare vs manual loop for typical key lengths
// (5–30 bytes) — V8 might inline the compare for short buffers.

function ensureSortedUnique(keys) {
  for (let i = 1; i < keys.length; i++) {
    const c = keyCmp(keys[i - 1], keys[i]);
    if (c === 0) throw new MapError(ERR_DUP_KEY, "duplicate key");
    if (c > 0) throw new MapError(ERR_KEY_ORDER, "key order violation");
  }
}


// ── MCF encode (§3.2) ──────────────────────────────────────

function writeU32BE(n) {
  if (n < 0 || n > 0xFFFFFFFF) {
    throw new MapError(ERR_CANON_MCF, "u32 out of range");
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n, 0);
  return buf;
}


/**
 * Encode a canonical-model value into MCF bytes.
 *
 * Depth tracks container nesting:
 *   - Root call at depth=0.
 *   - Entering MAP or LIST checks depth+1 vs MAX_DEPTH.
 *   - Scalars (STRING, BYTES, BOOLEAN, INTEGER) don't increment depth.
 */
function mcfEncodeValue(val, depth = 0) {
  // ── boolean MUST be checked before number ──────────────
  // In Python, bool is a subclass of int.  In JS, typeof true === "boolean"
  // so this isn't strictly needed for type safety, but keeping the guard
  // explicit avoids a whole class of subtle bugs if someone passes
  // Number(1) where they meant true.
  if (typeof val === "boolean") {
    return Buffer.from([TAG_BOOLEAN, val ? 0x01 : 0x00]);
  }

  // ── BigInt → INTEGER ──────────────────────────────────
  // We always represent INTEGER values as BigInt internally.
  // Range-check is defensive here — the adapter should have caught this,
  // but belt-and-suspenders matters for a canonical encoder.
  if (typeof val === "bigint") {
    if (val < INT64_MIN || val > INT64_MAX) {
      throw new MapError(ERR_SCHEMA, "integer out of int64 range");
    }
    const buf = Buffer.alloc(9);
    buf[0] = TAG_INTEGER;
    buf.writeBigInt64BE(val, 1);
    return buf;
  }

  if (typeof val === "string") {
    const raw = Buffer.from(val, "utf-8");
    validateUtf8Scalar(raw);
    return Buffer.concat([Buffer.from([TAG_STRING]), writeU32BE(raw.length), raw]);
  }

  if (Buffer.isBuffer(val)) {
    return Buffer.concat([Buffer.from([TAG_BYTES]), writeU32BE(val.length), val]);
  }

  if (Array.isArray(val)) {
    if (depth + 1 > MAX_DEPTH) {
      throw new MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH");
    }
    if (val.length > MAX_LIST_ENTRIES) {
      throw new MapError(ERR_LIMIT_SIZE, "list entry count exceeds limit");
    }
    const parts = [Buffer.from([TAG_LIST]), writeU32BE(val.length)];
    for (const item of val) {
      parts.push(mcfEncodeValue(item, depth + 1));
    }
    return Buffer.concat(parts);
  }

  // Plain object → MAP.  We don't check for null here because null
  // should have been caught by the adapter layer as ERR_TYPE.
  if (val !== null && typeof val === "object" && !Array.isArray(val) && !Buffer.isBuffer(val)) {
    if (depth + 1 > MAX_DEPTH) {
      throw new MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH");
    }
    const entries = Object.keys(val);
    if (entries.length > MAX_MAP_ENTRIES) {
      throw new MapError(ERR_LIMIT_SIZE, "map entry count exceeds limit");
    }

    // Collect keys as UTF-8 byte buffers, validate, then sort by memcmp.
    const items = [];
    for (const k of entries) {
      if (typeof k !== "string") {
        throw new MapError(ERR_SCHEMA, "map key must be a string");
      }
      const kb = Buffer.from(k, "utf-8");
      validateUtf8Scalar(kb);
      items.push({ kb, val: val[k] });
    }

    items.sort((a, b) => keyCmp(a.kb, b.kb));
    ensureSortedUnique(items.map(it => it.kb));

    const parts = [Buffer.from([TAG_MAP]), writeU32BE(items.length)];
    for (const { kb, val: v } of items) {
      // Keys are always STRING-tagged, even inside MAP entries.
      parts.push(Buffer.from([TAG_STRING]), writeU32BE(kb.length), kb);
      parts.push(mcfEncodeValue(v, depth + 1));
    }
    return Buffer.concat(parts);
  }

  throw new MapError(ERR_SCHEMA, `unsupported type: ${typeof val}`);
}

// TODO: for large descriptors, consider a streaming encoder that pipes
// chunks directly to a crypto.createHash("sha256") instead of building
// a full Buffer.  Roughly halves peak memory.


// ── MCF decode (§3.7 fast-path validation) ──────────────────

function readU32BE(buf, off) {
  if (off + 4 > buf.length) {
    throw new MapError(ERR_CANON_MCF, "truncated u32");
  }
  return [buf.readUInt32BE(off), off + 4];
}


function mcfDecodeOne(buf, off, depth) {
  if (off >= buf.length) {
    throw new MapError(ERR_CANON_MCF, "truncated tag");
  }
  const tag = buf[off];
  off += 1;

  if (tag === TAG_STRING) {
    let n;
    [n, off] = readU32BE(buf, off);
    if (off + n > buf.length) {
      throw new MapError(ERR_CANON_MCF, "truncated string payload");
    }
    const raw = buf.subarray(off, off + n);
    off += n;
    validateUtf8Scalar(raw);
    return [raw.toString("utf-8"), off];
  }

  if (tag === TAG_BYTES) {
    let n;
    [n, off] = readU32BE(buf, off);
    if (off + n > buf.length) {
      throw new MapError(ERR_CANON_MCF, "truncated bytes payload");
    }
    const val = Buffer.from(buf.subarray(off, off + n));
    off += n;
    return [val, off];
  }

  if (tag === TAG_LIST) {
    if (depth + 1 > MAX_DEPTH) {
      throw new MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH");
    }
    let count;
    [count, off] = readU32BE(buf, off);
    if (count > MAX_LIST_ENTRIES) {
      throw new MapError(ERR_LIMIT_SIZE, "list entry count exceeds limit");
    }
    const arr = [];
    for (let i = 0; i < count; i++) {
      let item;
      [item, off] = mcfDecodeOne(buf, off, depth + 1);
      arr.push(item);
    }
    return [arr, off];
  }

  if (tag === TAG_MAP) {
    if (depth + 1 > MAX_DEPTH) {
      throw new MapError(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH");
    }
    let count;
    [count, off] = readU32BE(buf, off);
    if (count > MAX_MAP_ENTRIES) {
      throw new MapError(ERR_LIMIT_SIZE, "map entry count exceeds limit");
    }

    const result = {};
    let prevKey = null;
    for (let i = 0; i < count; i++) {
      // Keys must be STRING-tagged (§3.2).
      if (off >= buf.length) {
        throw new MapError(ERR_CANON_MCF, "truncated map key tag");
      }
      if (buf[off] !== TAG_STRING) {
        throw new MapError(ERR_SCHEMA, "map key must be STRING");
      }
      let k;
      [k, off] = mcfDecodeOne(buf, off, depth + 1);
      if (typeof k !== "string") {
        throw new MapError(ERR_SCHEMA, "map key decoded to non-string");
      }
      const kb = Buffer.from(k, "utf-8");

      // Enforce ordering and uniqueness on the wire.
      if (prevKey !== null) {
        const c = keyCmp(prevKey, kb);
        if (c === 0) throw new MapError(ERR_DUP_KEY, "duplicate key in MCF");
        if (c > 0) throw new MapError(ERR_KEY_ORDER, "key order violation in MCF");
      }
      prevKey = kb;

      let v;
      [v, off] = mcfDecodeOne(buf, off, depth + 1);
      result[k] = v;
    }
    return [result, off];
  }

  // ── v1.1 types ───────────────────────────────────────────
  // BOOLEAN: exactly 1 payload byte, must be 0x00 or 0x01.
  // Anything else is a malformed encoding, not a type error.
  if (tag === TAG_BOOLEAN) {
    if (off >= buf.length) {
      throw new MapError(ERR_CANON_MCF, "truncated boolean payload");
    }
    const payload = buf[off];
    if (payload !== 0x00 && payload !== 0x01) {
      throw new MapError(ERR_CANON_MCF, `invalid boolean payload 0x${payload.toString(16).padStart(2, "0")}`);
    }
    return [payload === 0x01, off + 1];
  }

  // INTEGER: exactly 8 payload bytes, signed big-endian.
  if (tag === TAG_INTEGER) {
    if (off + 8 > buf.length) {
      throw new MapError(ERR_CANON_MCF, "truncated integer payload");
    }
    const val = buf.readBigInt64BE(off);
    return [val, off + 8];
  }

  throw new MapError(ERR_CANON_MCF, `unknown MCF tag 0x${tag.toString(16).padStart(2, "0")}`);
}


// ── Public helpers ──────────────────────────────────────────

/**
 * Encode a canonical-model value to CANON_BYTES = header + MCF.
 */
function canonBytesFromValue(val) {
  const body = mcfEncodeValue(val);
  const canon = Buffer.concat([CANON_HDR, body]);
  if (canon.length > MAX_CANON_BYTES) {
    throw new MapError(ERR_LIMIT_SIZE, "canon bytes exceed MAX_CANON_BYTES");
  }
  return canon;
}

/**
 * Compute MID from a canonical-model value.
 */
function midFromValue(val) {
  return "map1:" + sha256hex(canonBytesFromValue(val));
}

/**
 * Validate pre-built CANON_BYTES and return MID.
 *
 * This is the "fast-path" entry point (§3.7) — fully validates binary
 * structure but hashes input bytes directly instead of re-encoding.
 */
function midFromCanonBytes(canon) {
  if (!(canon instanceof Buffer || canon instanceof Uint8Array)) {
    throw new MapError(ERR_CANON_HDR, "canon_bytes must be a Buffer");
  }
  const buf = Buffer.isBuffer(canon) ? canon : Buffer.from(canon);

  if (buf.length > MAX_CANON_BYTES) {
    throw new MapError(ERR_LIMIT_SIZE, "canon bytes exceed MAX_CANON_BYTES");
  }

  // Check CANON_HDR
  if (buf.length < CANON_HDR.length || Buffer.compare(buf.subarray(0, CANON_HDR.length), CANON_HDR) !== 0) {
    throw new MapError(ERR_CANON_HDR, "bad CANON_HDR");
  }

  let off = CANON_HDR.length;
  let _val;
  [_val, off] = mcfDecodeOne(buf, off, 0);

  // §3.7(f): exactly one root value, then EOF — no trailing bytes allowed.
  if (off !== buf.length) {
    throw new MapError(ERR_CANON_MCF, "trailing bytes after MCF root");
  }

  return "map1:" + sha256hex(buf);
}

module.exports = {
  sha256hex,
  validateUtf8Scalar,
  keyCmp,
  mcfEncodeValue,
  mcfDecodeOne,
  canonBytesFromValue,
  midFromValue,
  midFromCanonBytes,
};
