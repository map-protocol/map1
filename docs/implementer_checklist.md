# Implementer Checklist

Building a MAP v1.1 implementation? Work through this list. Every item maps to a normative spec requirement. If you check all the boxes and pass all 95 vectors, congratulations-- you have a conforming implementation. If you check all the boxes and dont pass all 95 vectors, one of us has a bug. Lets find it.

## Canonical Header

- [ ] CANON_HDR is exactly 5 bytes: `MAP1\x00` (ASCII "MAP1" + NUL terminator)
- [ ] Decoding: reject any input that doesn't start with these 5 bytes (`ERR_CANON_HDR`)

## Type Tags

- [ ] STRING: tag `0x01`, followed by 4-byte big-endian length, then UTF-8 bytes
- [ ] BYTES: tag `0x02`, followed by 4-byte big-endian length, then raw bytes
- [ ] LIST: tag `0x03`, followed by 4-byte big-endian count, then `count` encoded values
- [ ] MAP: tag `0x04`, followed by 4-byte big-endian count, then `count` key-value pairs (key is always STRING-encoded, value is any type)
- [ ] BOOLEAN: tag `0x05`, followed by a single byte: `0x01` for true, `0x00` for false
- [ ] INTEGER: tag `0x06`, followed by 8 bytes: signed 64-bit big-endian

## STRING Encoding

- [ ] Length prefix is the byte length of the UTF-8 encoding, not the character count
- [ ] Empty string is valid: tag `0x01` + `0x00000000`
- [ ] Embedded NUL bytes (`\x00`) in strings are legal and preserved
- [ ] No Unicode normalization -- encode bytes as-is
- [ ] Lone surrogates (U+D800-U+DFFF) are rejected (`ERR_UTF8`)

## BYTES Encoding

- [ ] Same framing as STRING but with tag `0x02`
- [ ] No UTF-8 validation on content -- arbitrary bytes are allowed

## BOOLEAN Encoding

- [ ] Tag `0x05` + exactly one byte payload
- [ ] `true` -> payload `0x01`
- [ ] `false` -> payload `0x00`
- [ ] Decoding: any payload value other than `0x00` or `0x01` -> `ERR_CANON_MCF`
- [ ] Booleans are distinct from strings: `true` ≠ `"true"`, `false` ≠ `"false"`
- [ ] In Python: check `isinstance(x, bool)` before `isinstance(x, int)` (bool is a subclass of int in Python. Yes, really. PEP 285. Look it up.)

## INTEGER Encoding

- [ ] Tag `0x06` + exactly 8 bytes: signed big-endian
- [ ] 0 encodes as `0x06` followed by 8 zero bytes
- [ ] Range: -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807
- [ ] Out-of-range values -> `ERR_TYPE`
- [ ] Python/Ruby: you must explicitly range-check because integers are arbitrary-precision
- [ ] JavaScript: `JSON.parse` silently loses precision above 2^53. Handle with care. (This one will absolutely bite you if you dont test for it.)

## MAP Key Ordering

This is the single most critical fork surface in the protocol. Get this wrong and everything else is pointless.

- [ ] Keys sorted by raw UTF-8 bytes, unsigned octet comparison (`memcmp` semantics)
- [ ] NOT Unicode code-point order
- [ ] NOT locale collation
- [ ] NOT UTF-16 code unit order (looking at you, JavaScript)
- [ ] Prefix rule: shorter key sorts before longer key when one is a prefix of the other
- [ ] Java: mask bytes with `(b & 0xFF)` in comparators

## MAP Key Uniqueness

- [ ] Duplicate keys -> `ERR_DUP_KEY`
- [ ] Comparison is by raw bytes (after JSON escape resolution if coming from JSON adapter)

## Depth and Size Limits

- [ ] MAX_DEPTH = 32 (containers only -- scalars dont count)
- [ ] MAX_MAP_ENTRIES = 65,535
- [ ] MAX_LIST_ENTRIES = 65,535
- [ ] MAX_CANON_BYTES = 1,048,576 (1 MiB)
- [ ] Enforce MAX_CANON_BYTES before allocating buffers (this is a security requirement, not just a nice-to-have)

## Error Precedence

- [ ] If multiple violations apply, report the first in this order:
  1. ERR_CANON_HDR
  2. ERR_CANON_MCF
  3. ERR_SCHEMA
  4. ERR_TYPE
  5. ERR_UTF8
  6. ERR_DUP_KEY
  7. ERR_KEY_ORDER
  8. ERR_LIMIT_DEPTH
  9. ERR_LIMIT_SIZE
- [ ] Error precedence must not vary based on internal parsing strategy (streaming vs tree)

## JSON-STRICT Adapter

- [ ] JSON object -> MAP
- [ ] JSON array -> LIST
- [ ] JSON string -> STRING
- [ ] JSON boolean -> BOOLEAN (not STRING -- this changed in v1.1)
- [ ] JSON null -> `ERR_TYPE`
- [ ] JSON integer (no decimal, no exponent, within int64) -> INTEGER
- [ ] JSON float (decimal point or exponent) -> `ERR_TYPE`
- [ ] `1.0` -> `ERR_TYPE` (yes, even though its mathematically an integer. Token-level check.)
- [ ] BOM at start of input -> `ERR_SCHEMA` (even after whitespace)
- [ ] Duplicate keys after escape resolution -> `ERR_DUP_KEY`
- [ ] Surrogate code points in strings -> `ERR_UTF8`

## Fast-Path Validation (mid_from_canon_bytes)

- [ ] Validate CANON_HDR exactly
- [ ] Parse exactly one root MCF value
- [ ] Enforce all validations: UTF-8, key uniqueness, key ordering, limits, boolean payload
- [ ] Reject trailing bytes after root value (`ERR_CANON_MCF`)
- [ ] Hash the input bytes directly (dont re-encode through the model layer)

## Final Check

- [ ] All 95 conformance vectors pass
- [ ] Cross-check MIDs against at least one other language implementation
- [ ] `{"action":"deploy","target":"prod"}` produces `map1:bd70ec1e184b4d5a3c44507584cbaf8a937300df8e13e68f2b22faf67347246f` in your implementation

If that last MID doesnt match, stop. Something is wrong. Don't ship it.

(If it starts with `map1:42`, you have found the Answer. Please open a Discussion.)
