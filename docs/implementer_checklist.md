# Implementer Checklist

This checklist is for implementers writing new MAP implementations (Go, Rust, etc.).

## Checklist

1. Read the spec: `spec/MAP_v1.0.md`.

2. Implement MCF encoding for all four types:
   - STRING: tag `0x01` + `uint32be(len)` + UTF-8 bytes
   - BYTES:  tag `0x02` + `uint32be(len)` + raw bytes
   - LIST:   tag `0x03` + `uint32be(count)` + encoded items
   - MAP:    tag `0x04` + `uint32be(count)` + sorted (key, value) pairs

3. Key ordering: sort MAP keys by unsigned-octet `memcmp` over raw UTF-8 bytes.
   NOT Unicode codepoint order. NOT UTF-16 code unit order. NOT locale collation.

4. Duplicate key detection:
   - MAP keys must be strictly ascending after sorting.
   - Equal keys → `ERR_DUP_KEY`.
   - Out-of-order keys → `ERR_KEY_ORDER`.

5. UTF-8 scalar validation:
   - All STRING values and MAP keys must be valid UTF-8.
   - Reject surrogate code points `U+D800`–`U+DFFF` explicitly.

6. Depth tracking:
   - Containers increment depth. Scalars do not.
   - Root container is depth 1.
   - Check fires before recursing into a child container:
     `if current_depth + 1 > MAX_DEPTH → ERR_LIMIT_DEPTH`.

7. Canonical bytes:
   - `CANON_BYTES = CANON_HDR + MCF(root_value)`
   - `CANON_HDR` is exactly `b"MAP1\x00"` (5 bytes). Never changes.

8. MID derivation:
   - `MID = "map1:" + lowercase_hex(sha256(CANON_BYTES))`
   - Prefix is always lowercase and always present.

9. Implement `mid_from_canon_bytes` (fast-path validation):
   - Check CANON_HDR
   - Parse and fully validate the MCF body
   - Hash the input bytes directly (no re-encoding)
   - Reject trailing bytes after the root value

10. JSON-STRICT adapter (if you support JSON input):
   - Reject BOM (including after leading whitespace)
   - Strict UTF-8 decode
   - Detect duplicate keys AFTER escape resolution
     ("a\u0062" and "ab" must be treated as the same key)
   - true/false → STRING "true"/"false"
   - null → `ERR_TYPE`
   - numbers → `ERR_TYPE`
   - surrogate escapes (`\uD800`–`\uDFFF`) → `ERR_UTF8`

11. BIND projection (if you support BIND):
   - Parse RFC 6901 pointers (`~0 → ~`, `~1 → /`)
   - Reject duplicate pointers
   - Reject LIST traversal
   - Unmatched pointers:
     - all unmatched → return empty MAP (not error)
     - some matched + some unmatched → `ERR_SCHEMA`
   - Handle subsumption (shorter pointer subsumes longer)
   - Build minimal enclosing structure (omit-siblings rule)

12. Error precedence: if multiple errors are possible, report the highest-precedence one.
   Order (highest first):
   `ERR_CANON_HDR, ERR_CANON_MCF, ERR_SCHEMA, ERR_TYPE, ERR_UTF8, ERR_DUP_KEY, ERR_KEY_ORDER, ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE`

13. Run conformance: all 53 vectors must pass. Zero tolerance.

14. Emit a PASS_REPORT (see `conformance/PASS_REPORT.schema.json`).
    Include `spec_sha256`, `vectors_sha256`, `expected_sha256`.

## Common Mistakes

- Sorting keys using string comparison instead of byte comparison
- Using signed byte comparison instead of unsigned
- Failing to reject trailing bytes after the MCF root value
- Treating duplicate JSON keys as “last wins”
- Inconsistent depth starting point between encoders/adapters
