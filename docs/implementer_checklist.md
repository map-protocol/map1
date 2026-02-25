# Implementer Checklist

Building a MAP v1.1 implementation? Work through this list. Every item maps to a normative spec requirement.

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
- [ ] No Unicode normalization — encode bytes as-is
- [ ] Lone surrogates (U+D800–U+DFFF) are rejected (`ERR_UTF8`)

## BYTES Encoding

- [ ] Same framing as STRING but with tag `0x02`
- [ ] No UTF-8 validation on content — arbitrary bytes are allowed

## BOOLEAN Encoding

- [ ] Tag `0x05` + exactly one byte payload
- [ ] `true` → payload `0x01`
- [ ] `false` → payload `0x00`
- [ ] Decoding: any payload value other than `0x00` or `0x01` → `ERR_CANON_MCF`
- [ ] Booleans are distinct from strings: `true` ≠ `"true"`, `false` ≠ `"false"`
- [ ] In Python: check `isinstance(x, bool)` before `isinstance(x, int)` (bool is a subclass of int)

## INTEGER Encoding

- [ ] Tag `0x06` + exactly 8 bytes: signed 64-bit, big-endian (two's complement)
- [ ] Range: −9,223,372,036,854,775,808 to 9,223,372,036,854,775,807
- [ ] Values outside int64 range → `ERR_TYPE`
- [ ] `0` encodes as `0x06` + `0x0000000000000000`
- [ ] Negative values use standard two's complement: `-1` → `0x06` + `0xFFFFFFFFFFFFFFFF`
- [ ] Decoding: exactly 8 bytes after tag; fewer → `ERR_CANON_MCF`

## Float Rejection

- [ ] JSON tokens with `.` (decimal point) → `ERR_TYPE`
- [ ] JSON tokens with `e` or `E` (exponent) → `ERR_TYPE`
- [ ] `1.0` is rejected even though mathematically integral — token-level detection
- [ ] `0.0` is rejected
- [ ] `1e5` is rejected
- [ ] This applies to the JSON-STRICT adapter; native API users won't encounter JSON tokens

## MAP Encoding

- [ ] Keys sorted by `memcmp` on UTF-8 bytes (unsigned byte comparison)
- [ ] Duplicate keys → `ERR_DUP_KEY`
- [ ] Keys must be strings — no other type allowed as a key
- [ ] Entry count is 4-byte big-endian; max 65,535 entries
- [ ] Key ordering: signed byte traps — `0x80` sorts after `0x7F` in unsigned comparison

## LIST Encoding

- [ ] Elements in order (no sorting)
- [ ] Element count is 4-byte big-endian; max 65,535 elements
- [ ] Empty list is valid: tag `0x03` + `0x00000000`

## Null Handling

- [ ] JSON `null` → `ERR_TYPE`
- [ ] Language-native null/nil/None → `ERR_TYPE`

## JSON-STRICT Adapter

- [ ] BOM rejection: UTF-8 BOM (`0xEF 0xBB 0xBF`) at start of content → `ERR_SCHEMA`
- [ ] BOM after leading whitespace: also rejected
- [ ] Lone surrogates in strings → `ERR_UTF8`
- [ ] Duplicate keys (after escape resolution) → `ERR_DUP_KEY`
- [ ] Duplicate detection: `{"a":1,"\u0061":2}` has duplicate keys (both decode to `"a"`)
- [ ] JSON booleans → BOOLEAN type
- [ ] JSON integer tokens → INTEGER type (range-checked)
- [ ] JSON float tokens → `ERR_TYPE`
- [ ] JSON null → `ERR_TYPE`
- [ ] `Infinity`, `-Infinity`, `NaN` → `ERR_CANON_MCF`

### JavaScript-Specific Warnings

- [ ] `JSON.parse()` converts all numbers to IEEE 754 doubles — integers above 2^53 lose precision silently. Intercept at parse time or use BigInt.
- [ ] JavaScript's default string sort uses UTF-16 code units, not UTF-8 bytes. Implement UTF-8 byte comparison explicitly for key ordering.
- [ ] `typeof true === "boolean"` — don't conflate with strings.

## Safety Limits

- [ ] MAX_CANON_BYTES: 1,048,576 (1 MiB) — reject inputs that would exceed this before allocating buffers
- [ ] MAX_DEPTH: 32 — nested containers (MAPs and LISTs) beyond 32 levels → `ERR_LIMIT_DEPTH`
- [ ] MAX_MAP_ENTRIES: 65,535
- [ ] MAX_LIST_ENTRIES: 65,535

## Error Precedence

- [ ] When multiple errors apply, report the highest-precedence one
- [ ] Precedence order (highest first): `ERR_CANON_HDR` > `ERR_CANON_MCF` > `ERR_SCHEMA` > `ERR_TYPE` > `ERR_UTF8` > `ERR_DUP_KEY` > `ERR_KEY_ORDER` > `ERR_LIMIT_DEPTH` > `ERR_LIMIT_SIZE`

## MID Format

- [ ] Output: `map1:` prefix + lowercase hex SHA-256 of CANON_BYTES
- [ ] CANON_BYTES = CANON_HDR (5 bytes) + MCF-encoded value
- [ ] Total MID string length: 71 characters (5 prefix + 64 hex digits)

## Conformance

- [ ] Run all 95 test vectors from `conformance_vectors_v11.json`
- [ ] Compare against `conformance_expected_v11.json`
- [ ] Zero tolerance — every vector must match exactly
- [ ] Test both MID output and error codes
