"use strict";

/**
 * @map-protocol/map1 — MAP v1.1 Node.js implementation.
 *
 * Compute deterministic identifiers (MIDs) for structured descriptors
 * using the MAP v1 canonical format.
 *
 * Quick start:
 *   const { midFull } = require("@map-protocol/map1");
 *   midFull({ action: "deploy", target: "prod", version: "2.1.0" });
 *   // => 'map1:02f660092e372c2da0f87cefdecd1de9476eba39be2222b30637ba72178c5e7e'
 *
 * v1.1 adds BOOLEAN and INTEGER types.  Booleans and integers are now
 * distinct from their string representations:
 *   midFull({ active: true }) !== midFull({ active: "true" })  // true
 *
 * INTEGER values must be passed as BigInt:
 *   midFull({ count: 42n })
 */

const { SPEC_VERSION, INT64_MIN, INT64_MAX, CANON_HDR } = require("./constants");
const {
  sha256hex,
  canonBytesFromValue,
  midFromValue,
  midFromCanonBytes,
} = require("./core");
const {
  MapError,
  ERR_CANON_HDR, ERR_CANON_MCF, ERR_SCHEMA, ERR_TYPE,
  ERR_UTF8, ERR_DUP_KEY, ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE,
  chooseReportedError,
} = require("./errors");
const {
  jsonStrictParseWithDups,
  jsonToCanonValue,
} = require("./json-adapter");
const { fullProject, bindProject } = require("./projection");


// ── Core API ──────────────────────────────────────────────

/**
 * Compute a MID over the full descriptor (FULL projection).
 *
 * Accepts any canonical-model value: object, array, string, Buffer, boolean, BigInt.
 * Keys must be strings.  Booleans encode as BOOLEAN, BigInts as INTEGER.
 *
 * @param {any} descriptor - The descriptor value.
 * @returns {string} The MID string ("map1:...").
 */
function midFull(descriptor) {
  const val = fullProject(descriptor);
  return midFromValue(val);
}

/**
 * Compute a MID over selected fields (BIND projection).
 *
 * @param {Object} descriptor - The descriptor MAP (must be an object).
 * @param {string[]} pointers - RFC 6901 JSON Pointer strings.
 * @returns {string} The MID string.
 */
function midBind(descriptor, pointers) {
  const val = bindProject(descriptor, pointers);
  return midFromValue(val);
}

/**
 * Return CANON_BYTES (header + MCF) for the full descriptor.
 *
 * @param {any} descriptor
 * @returns {Buffer}
 */
function canonicalBytesFull(descriptor) {
  const val = fullProject(descriptor);
  return canonBytesFromValue(val);
}

/**
 * Return CANON_BYTES for selected fields (BIND projection).
 *
 * @param {Object} descriptor
 * @param {string[]} pointers
 * @returns {Buffer}
 */
function canonicalBytesBind(descriptor, pointers) {
  const val = bindProject(descriptor, pointers);
  return canonBytesFromValue(val);
}


// ── JSON-STRICT API ──────────────────────────────────────
// These take raw UTF-8 bytes and run the full JSON-STRICT pipeline:
// BOM rejection, surrogate detection, duplicate-key detection, type mapping.

/**
 * Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + FULL).
 *
 * @param {Buffer} raw - Raw UTF-8 JSON bytes.
 * @returns {string} The MID string.
 */
function midFullJson(raw) {
  const { value, dupFound } = jsonStrictParseWithDups(raw);
  const val = jsonToCanonValue(value);
  const canon = canonBytesFromValue(val);
  // Raise dup_key only if no higher-precedence error already fired.
  if (dupFound) {
    throw new MapError(ERR_DUP_KEY, "duplicate key in JSON");
  }
  return "map1:" + sha256hex(canon);
}

/**
 * Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + BIND).
 *
 * @param {Buffer} raw - Raw UTF-8 JSON bytes.
 * @param {string[]} pointers - RFC 6901 JSON Pointer strings.
 * @returns {string} The MID string.
 */
function midBindJson(raw, pointers) {
  const { value, dupFound } = jsonStrictParseWithDups(raw);
  const val = jsonToCanonValue(value);
  const proj = bindProject(val, pointers);
  const canon = canonBytesFromValue(proj);
  if (dupFound) {
    throw new MapError(ERR_DUP_KEY, "duplicate key in JSON");
  }
  return "map1:" + sha256hex(canon);
}


// ── Convenience: prepare() ──────────────────────────────────

/**
 * Normalize a JS object for MID computation.
 *
 * Handles common cases where JS native types don't map cleanly to MAP:
 *   - number (float) → string with explicit precision
 *   - number (integer) → BigInt (range-checked)
 *   - null/undefined → omitted (or throws if omitNulls=false)
 *   - boolean → passed through
 *   - string → passed through
 *   - BigInt → range-checked
 *   - object/array → recursively prepared
 *
 * Does NOT compute a MID.  Feed the result to midFull().
 *
 * @param {Object} descriptor
 * @param {{ floatPrecision?: number, omitNulls?: boolean }} [opts]
 * @returns {Object}
 */
function prepare(descriptor, opts = {}) {
  const fp = opts.floatPrecision ?? 6;
  const omitNulls = opts.omitNulls ?? true;
  return _prepareValue(descriptor, fp, omitNulls);
}

function _prepareValue(val, fp, omitNulls) {
  if (val === null || val === undefined) {
    if (omitNulls) return undefined;  // caller skips
    throw new MapError(ERR_TYPE, "prepare: null value");
  }

  if (typeof val === "object" && !Array.isArray(val) && !Buffer.isBuffer(val)) {
    const out = {};
    for (const k of Object.keys(val)) {
      if (typeof k !== "string") {
        throw new MapError(ERR_SCHEMA, "prepare: key must be string");
      }
      const prepared = _prepareValue(val[k], fp, omitNulls);
      if (prepared !== undefined) {
        out[k] = prepared;
      }
    }
    return out;
  }

  if (Array.isArray(val)) {
    const result = [];
    for (const item of val) {
      const prepared = _prepareValue(item, fp, omitNulls);
      if (prepared !== undefined) result.push(prepared);
    }
    return result;
  }

  if (typeof val === "boolean") return val;

  // BigInt passes through with range check
  if (typeof val === "bigint") {
    if (val < INT64_MIN || val > INT64_MAX) {
      throw new MapError(ERR_TYPE, `prepare: integer ${val} outside int64 range`);
    }
    return val;
  }

  // JS number: check if it's an integer that fits in int64
  if (typeof val === "number") {
    if (Number.isInteger(val) && val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) {
      // Safe integer — convert to BigInt for canonical encoding
      return BigInt(val);
    }
    // Float or unsafe integer — encode as string with requested precision
    return val.toFixed(fp);
  }

  if (typeof val === "string") return val;
  if (Buffer.isBuffer(val)) return val;

  throw new MapError(ERR_SCHEMA, `prepare: unsupported type ${typeof val}`);
}


module.exports = {
  // Version
  SPEC_VERSION,

  // Core API
  midFull,
  midBind,
  canonicalBytesFull,
  canonicalBytesBind,

  // JSON-STRICT API
  midFullJson,
  midBindJson,

  // Fast-path
  midFromCanonBytes,

  // Convenience
  prepare,

  // Exception class
  MapError,

  // Error codes
  ERR_CANON_HDR,
  ERR_CANON_MCF,
  ERR_SCHEMA,
  ERR_TYPE,
  ERR_UTF8,
  ERR_DUP_KEY,
  ERR_KEY_ORDER,
  ERR_LIMIT_DEPTH,
  ERR_LIMIT_SIZE,

  // Utilities (for advanced use)
  chooseReportedError,
};
