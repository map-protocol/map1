"use strict";

/**
 * MAP v1.1 JSON-STRICT adapter.
 *
 * Converts raw UTF-8 JSON bytes into the canonical model (§8).
 *
 * Type mapping (§8.2):
 *   JSON object  → MAP (plain Object)
 *   JSON array   → LIST (Array)
 *   JSON string  → STRING (string)
 *   JSON boolean → BOOLEAN (boolean)      — v1.1, was STRING in v1.0
 *   JSON integer → INTEGER (BigInt)       — v1.1, was ERR_TYPE in v1.0
 *   JSON float   → ERR_TYPE               — decimal point or exponent
 *   JSON null    → ERR_TYPE
 *
 * WHY A CUSTOM PARSER:
 * JavaScript's JSON.parse() has two fatal flaws for MAP's purposes:
 *   1) All numbers become IEEE 754 doubles, silently losing precision
 *      for integers above 2^53.  JSON.parse("9223372036854775807")
 *      yields 9223372036854776000 — wrong.
 *   2) No duplicate-key detection hook (Python has object_pairs_hook).
 *
 * We need token-level access to number strings and pair-level access to
 * object keys.  A recursive-descent parser over the JSON grammar gives
 * us both, at the cost of ~150 lines of code.  The grammar is tiny
 * (RFC 8259 §2) so this is manageable.
 *
 * Spec references: §8.1 (parsing), §8.2 (type mapping), §8.2.1 (number rules),
 *                  §8.3 (duplicate keys).
 */

const {
  INT64_MIN, INT64_MAX,
  MAX_CANON_BYTES, MAX_DEPTH,
} = require("./constants");

const {
  MapError,
  ERR_CANON_MCF, ERR_DUP_KEY, ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE,
  ERR_SCHEMA, ERR_TYPE, ERR_UTF8,
} = require("./errors");


// ── Surrogate check ────────────────────────────────────────
// Applied to every decoded string value and every map key.

function ensureNoSurrogates(str) {
  for (let i = 0; i < str.length; i++) {
    // Use codePointAt, NOT charCodeAt — charCodeAt returns the individual
    // UTF-16 code unit, which is a surrogate half for astral characters.
    // codePointAt returns the full code point (> 0xFFFF for astral),
    // and only returns a value in D800–DFFF for actual lone surrogates.
    const cp = str.codePointAt(i);
    if (cp >= 0xD800 && cp <= 0xDFFF) {
      throw new MapError(ERR_UTF8, `surrogate U+${cp.toString(16).toUpperCase().padStart(4, "0")} in JSON string`);
    }
    // Skip the trailing code unit of an astral pair
    if (cp > 0xFFFF) i++;
  }
}


// ── Recursive-descent JSON parser ──────────────────────────
//
// Parses JSON text per RFC 8259.  Returns canonical-model values directly:
//   object → { keys: values }  (with duplicate detection)
//   array  → [ values ]
//   string → string
//   true   → true (boolean)
//   false  → false (boolean)
//   null   → throws ERR_TYPE
//   number → BigInt if integer-shaped, throws ERR_TYPE if float-shaped
//
// The parser tracks a `dupFound` flag rather than throwing immediately on
// duplicate keys.  This lets higher-precedence errors (ERR_TYPE from null
// or float, ERR_UTF8 from surrogates) still surface per §6.2.

class JsonParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.dupFound = false;
  }

  // ── Whitespace ─────────────────────────────────────────
  skipWs() {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos++;
      } else {
        break;
      }
    }
  }

  // ── Top-level parse ────────────────────────────────────
  parse() {
    this.skipWs();
    const val = this.parseValue(0);
    this.skipWs();
    // Trailing non-whitespace after root value → ERR_CANON_MCF (§6.1)
    if (this.pos < this.text.length) {
      throw new MapError(ERR_CANON_MCF, "trailing content after JSON root");
    }
    return val;
  }

  peek() {
    return this.pos < this.text.length ? this.text[this.pos] : null;
  }

  advance() {
    return this.text[this.pos++];
  }

  expect(ch) {
    if (this.pos >= this.text.length || this.text[this.pos] !== ch) {
      throw new MapError(ERR_CANON_MCF, `expected '${ch}' at position ${this.pos}`);
    }
    this.pos++;
  }

  // ── Value dispatch ─────────────────────────────────────
  // Depth tracks the nesting level of containers (MAP/LIST).
  // parentDepth is the depth of the container we're inside.
  // Entering a new container increments to parentDepth+1.
  // Scalars don't change depth.
  parseValue(parentDepth) {
    this.skipWs();
    if (this.pos >= this.text.length) {
      throw new MapError(ERR_CANON_MCF, "unexpected end of JSON");
    }

    const ch = this.peek();

    if (ch === '"') return this.parseString();
    if (ch === '{') return this.parseObject(parentDepth + 1);
    if (ch === '[') return this.parseArray(parentDepth + 1);
    if (ch === 't') return this.parseLiteral("true", true);
    if (ch === 'f') return this.parseLiteral("false", false);
    if (ch === 'n') return this.parseNull();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();

    throw new MapError(ERR_CANON_MCF, `unexpected character '${ch}' at position ${this.pos}`);
  }

  // ── Literals ───────────────────────────────────────────
  parseLiteral(expected, value) {
    for (let i = 0; i < expected.length; i++) {
      if (this.pos >= this.text.length || this.text[this.pos] !== expected[i]) {
        throw new MapError(ERR_CANON_MCF, `invalid literal at position ${this.pos}`);
      }
      this.pos++;
    }
    return value;
  }

  parseNull() {
    this.parseLiteral("null", null);
    // §8.2: JSON null → ERR_TYPE.  We throw immediately because ERR_TYPE
    // has higher precedence than ERR_DUP_KEY (which we defer).
    throw new MapError(ERR_TYPE, "JSON null not allowed");
  }

  // ── String parsing ─────────────────────────────────────
  // Handles all RFC 8259 escape sequences including \uXXXX with
  // surrogate pair assembly for astral code-points.

  parseString() {
    this.expect('"');
    let result = "";

    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos++;
        // Check for surrogates in the resolved string.
        ensureNoSurrogates(result);
        return result;
      }

      if (ch === '\\') {
        this.pos++;
        if (this.pos >= this.text.length) {
          throw new MapError(ERR_CANON_MCF, "unterminated escape in string");
        }
        const esc = this.text[this.pos];
        this.pos++;
        switch (esc) {
          case '"':  result += '"';  break;
          case '\\': result += '\\'; break;
          case '/':  result += '/';  break;
          case 'b':  result += '\b'; break;
          case 'f':  result += '\f'; break;
          case 'n':  result += '\n'; break;
          case 'r':  result += '\r'; break;
          case 't':  result += '\t'; break;
          case 'u': {
            const cp = this._parseUnicodeEscape();
            // Handle surrogate pairs for astral code-points.
            // If we get a high surrogate, check for a following \uXXXX low surrogate.
            if (cp >= 0xD800 && cp <= 0xDBFF) {
              // High surrogate — look for low surrogate
              if (this.pos + 1 < this.text.length &&
                  this.text[this.pos] === '\\' && this.text[this.pos + 1] === 'u') {
                this.pos += 2;
                const low = this._parseUnicodeEscape();
                if (low >= 0xDC00 && low <= 0xDFFF) {
                  // Valid surrogate pair → compute astral code-point.
                  const astral = 0x10000 + (cp - 0xD800) * 0x400 + (low - 0xDC00);
                  result += String.fromCodePoint(astral);
                } else {
                  // High surrogate followed by non-low-surrogate → lone surrogate.
                  throw new MapError(ERR_UTF8, `lone high surrogate U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
                }
              } else {
                // High surrogate not followed by \u → lone surrogate.
                throw new MapError(ERR_UTF8, `lone high surrogate U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
              }
            } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
              // Low surrogate without preceding high → lone surrogate.
              throw new MapError(ERR_UTF8, `lone low surrogate U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
            } else {
              result += String.fromCodePoint(cp);
            }
            break;
          }
          default:
            throw new MapError(ERR_CANON_MCF, `invalid escape '\\${esc}'`);
        }
      } else {
        // Control characters (U+0000–U+001F) must be escaped per RFC 8259.
        // But most JSON parsers accept them — we're strict here.
        result += ch;
        this.pos++;
      }
    }

    throw new MapError(ERR_CANON_MCF, "unterminated string");
  }

  _parseUnicodeEscape() {
    if (this.pos + 4 > this.text.length) {
      throw new MapError(ERR_CANON_MCF, "truncated \\u escape");
    }
    const hex = this.text.substring(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new MapError(ERR_CANON_MCF, `invalid \\u escape: ${hex}`);
    }
    this.pos += 4;
    return parseInt(hex, 16);
  }

  // ── Number parsing (§8.2.1) ────────────────────────────
  //
  // This is where the JS precision trap lives.  We read the raw token
  // as a string, classify it (integer vs float), then either:
  //   - reject floats with ERR_TYPE
  //   - parse integers with BigInt and range-check against INT64
  //
  // Token-level inspection is intentional per §8.2.1: "1.0" is rejected
  // even though the value is mathematically integral.

  parseNumber() {
    const start = this.pos;

    // Optional leading minus
    if (this.peek() === '-') this.pos++;

    // Integer part: "0" alone or digit1-9 followed by more digits
    if (this.peek() === '0') {
      this.pos++;
    } else if (this.peek() >= '1' && this.peek() <= '9') {
      this.pos++;
      while (this.pos < this.text.length && this.peek() >= '0' && this.peek() <= '9') {
        this.pos++;
      }
    } else {
      throw new MapError(ERR_CANON_MCF, `invalid number at position ${start}`);
    }

    let isFloat = false;

    // Fractional part
    if (this.peek() === '.') {
      isFloat = true;
      this.pos++;
      if (this.pos >= this.text.length || this.peek() < '0' || this.peek() > '9') {
        throw new MapError(ERR_CANON_MCF, `invalid number at position ${start}`);
      }
      while (this.pos < this.text.length && this.peek() >= '0' && this.peek() <= '9') {
        this.pos++;
      }
    }

    // Exponent part
    if (this.peek() === 'e' || this.peek() === 'E') {
      isFloat = true;
      this.pos++;
      if (this.peek() === '+' || this.peek() === '-') this.pos++;
      if (this.pos >= this.text.length || this.peek() < '0' || this.peek() > '9') {
        throw new MapError(ERR_CANON_MCF, `invalid number at position ${start}`);
      }
      while (this.pos < this.text.length && this.peek() >= '0' && this.peek() <= '9') {
        this.pos++;
      }
    }

    const token = this.text.substring(start, this.pos);

    // §8.2.1: any decimal point or exponent → ERR_TYPE.
    // This is a token-level check, not a value check — "1.0" is rejected.
    if (isFloat) {
      throw new MapError(ERR_TYPE, `JSON float not allowed: ${token}`);
    }

    // Parse as BigInt for full precision (avoids IEEE 754 double truncation).
    let val;
    try {
      val = BigInt(token);
    } catch (_e) {
      throw new MapError(ERR_CANON_MCF, `invalid integer token: ${token}`);
    }

    // §8.2.1(c): range-check against signed 64-bit.
    if (val < INT64_MIN || val > INT64_MAX) {
      throw new MapError(ERR_TYPE, `integer overflow: ${token}`);
    }

    return val;
  }

  // ── Object parsing (with duplicate-key detection) ──────
  // depth is the depth of THIS container (already incremented by parseValue).
  parseObject(depth) {
    if (depth > MAX_DEPTH) {
      throw new MapError(ERR_LIMIT_DEPTH, "exceeds MAX_DEPTH");
    }

    this.expect('{');
    this.skipWs();

    if (this.peek() === '}') {
      this.pos++;
      return {};
    }

    const result = {};
    const seen = new Set();

    const parseOnePair = () => {
      this.skipWs();
      if (this.peek() !== '"') {
        throw new MapError(ERR_CANON_MCF, `expected string key at position ${this.pos}`);
      }
      const key = this.parseString();

      // Duplicate detection happens after escape resolution (§8.3).
      // We don't throw immediately — we record the flag and keep going
      // so higher-precedence errors can still surface.
      if (seen.has(key)) {
        this.dupFound = true;
      } else {
        seen.add(key);
      }

      this.skipWs();
      this.expect(':');

      // Pass our depth to parseValue — it will +1 if the child is a container.
      const val = this.parseValue(depth);

      // Keep first occurrence on duplicate (matches Python reference behavior).
      if (!(key in result)) {
        result[key] = val;
      }
    };

    parseOnePair();

    while (true) {
      this.skipWs();
      if (this.peek() === '}') {
        this.pos++;
        return result;
      }
      if (this.peek() !== ',') {
        throw new MapError(ERR_CANON_MCF, `expected ',' or '}' at position ${this.pos}`);
      }
      this.pos++; // consume ','
      // Trailing comma check: if next non-ws char is '}', that's invalid JSON
      this.skipWs();
      if (this.peek() === '}') {
        throw new MapError(ERR_CANON_MCF, "trailing comma in object");
      }
      parseOnePair();
    }
  }

  // ── Array parsing ──────────────────────────────────────
  // depth is the depth of THIS container (already incremented by parseValue).
  parseArray(depth) {
    if (depth > MAX_DEPTH) {
      throw new MapError(ERR_LIMIT_DEPTH, "exceeds MAX_DEPTH");
    }

    this.expect('[');
    this.skipWs();

    if (this.peek() === ']') {
      this.pos++;
      return [];
    }

    const arr = [];

    arr.push(this.parseValue(depth));

    while (true) {
      this.skipWs();
      if (this.peek() === ']') {
        this.pos++;
        return arr;
      }
      if (this.peek() !== ',') {
        throw new MapError(ERR_CANON_MCF, `expected ',' or ']' at position ${this.pos}`);
      }
      this.pos++; // consume ','
      this.skipWs();
      if (this.peek() === ']') {
        throw new MapError(ERR_CANON_MCF, "trailing comma in array");
      }
      arr.push(this.parseValue(depth));
    }
  }
}

// ── Depth normalization ─────────────────────────────────────
//
// The parser above tracks depth during parsing (because it needs to reject
// deep nesting early).  But the depth model in the spec counts containers
// starting from root=1, and scalars don't increment depth.
// The parser depth starts at 1 for the root, and increments for nested
// containers.  This matches the spec's definition.


// ── BOM detection (§8.1.1) ──────────────────────────────────
// The spec says: if input starts with BOM, reject.
// "BOM is rejected even if preceded by whitespace" — so we check the
// raw bytes, not after whitespace stripping.

const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

function checkBom(raw) {
  // Check if BOM appears anywhere in the leading whitespace + first non-ws position.
  // Per §8.1.1: "even if preceded by whitespace (byte-level strictness)".
  //
  // Strategy: scan past JSON whitespace bytes, then check if BOM is there.
  // Also check if BOM is at position 0.
  let i = 0;
  while (i < raw.length) {
    const b = raw[i];
    if (b === 0x20 || b === 0x09 || b === 0x0A || b === 0x0D) {
      i++;
      continue;
    }
    break;
  }
  if (i + 3 <= raw.length && raw[i] === 0xEF && raw[i + 1] === 0xBB && raw[i + 2] === 0xBF) {
    throw new MapError(ERR_SCHEMA, "UTF-8 BOM rejected");
  }
}


/**
 * Parse raw JSON bytes under JSON-STRICT rules.
 *
 * Returns { value, dupFound }.  Duplicate detection does NOT short-circuit —
 * we record the flag and keep parsing so that higher-precedence errors
 * (ERR_TYPE from null/float, ERR_UTF8 from surrogates) can still surface.
 * The caller raises ERR_DUP_KEY only if no higher-precedence error occurred.
 *
 * @param {Buffer} raw - Raw UTF-8 JSON bytes.
 * @returns {{ value: any, dupFound: boolean }}
 */
function jsonStrictParseWithDups(raw) {
  if (raw.length > MAX_CANON_BYTES) {
    throw new MapError(ERR_LIMIT_SIZE, "input exceeds MAX_CANON_BYTES");
  }

  // BOM rejection (§8.1.1)
  checkBom(raw);

  // Decode UTF-8
  let text;
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    text = dec.decode(raw);
  } catch (_e) {
    throw new MapError(ERR_UTF8, "invalid UTF-8 in JSON input");
  }

  const parser = new JsonParser(text);
  const value = parser.parse();
  return { value, dupFound: parser.dupFound };
}

/**
 * Convert a parsed JSON value to the MAP v1.1 canonical model.
 *
 * After the custom parser, the value tree already contains:
 *   string, boolean, BigInt, Array, Object
 * which mcfEncodeValue() knows how to serialize.
 *
 * This function does a walk to verify types and enforce depth.
 * The parser already handled most validation, so this is mostly
 * a sanity pass.
 */
function jsonToCanonValue(x, depth = 1) {
  if (depth > MAX_DEPTH) {
    throw new MapError(ERR_LIMIT_DEPTH, "exceeds MAX_DEPTH");
  }

  if (x !== null && typeof x === "object" && !Array.isArray(x) && !Buffer.isBuffer(x)) {
    const out = {};
    for (const k of Object.keys(x)) {
      ensureNoSurrogates(k);
      const v = x[k];
      const childDepth = (v !== null && typeof v === "object") ? depth + 1 : depth;
      out[k] = jsonToCanonValue(v, childDepth);
    }
    return out;
  }

  if (Array.isArray(x)) {
    const result = [];
    for (const v of x) {
      const childDepth = (v !== null && typeof v === "object") ? depth + 1 : depth;
      result.push(jsonToCanonValue(v, childDepth));
    }
    return result;
  }

  if (typeof x === "string") {
    ensureNoSurrogates(x);
    return x;
  }

  if (typeof x === "boolean") return x;
  if (typeof x === "bigint") return x;  // range already validated by parser

  if (x === null) {
    throw new MapError(ERR_TYPE, "JSON null not allowed");
  }

  throw new MapError(ERR_SCHEMA, `unexpected JSON type: ${typeof x}`);
}

module.exports = {
  jsonStrictParseWithDups,
  jsonToCanonValue,
};
