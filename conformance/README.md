# Conformance Test Suite

MAP v1.1 ships with **95 conformance test vectors**. Every implementation must pass all 95 with zero tolerance — no approximate matching, no skips, no "known failures."

## Files

- `conformance_vectors_v11.json` — 95 test inputs (base64-encoded where needed), with mode and pointer specifications
- `conformance_expected_v11.json` — 95 expected outputs: either a MID string or an error code

Each vector has a `test_id` that matches between the two files.

## Vector Categories

The test suite covers the full MAP v1.1 surface:

**Core encoding:** STRING, BYTES, LIST, MAP encoding and round-tripping through canonical bytes.

**Boolean (v1.1):** `BOOL_STANDALONE_TRUE`, `BOOL_STANDALONE_FALSE`, `BOOL_MAP_TRUE`, `BOOL_MAP_FALSE`, `BOOL_TRUE_VS_STRING`, `BOOL_FALSE_VS_STRING`, `BOOL_LIST_TRUE`, `BOOL_LIST_STRING_TRUE`, `BOOL_CANON_TRUE`, `BOOL_CANON_FALSE`, `BOOL_CANON_BAD_PAYLOAD`, `BOOL_CANON_BAD_PAYLOAD_FF`. Verifies that booleans encode correctly, round-trip through canonical bytes, and are distinct from their string representations.

**Integer (v1.1):** `INT_SIMPLE_42`, `INT_VS_STRING_42`, `INT_ZERO`, `INT_VS_STRING_ZERO`, `INT_NEGATIVE`, `INT_NEGATIVE_LARGE`, `INT_STANDALONE_42`, `INT_STANDALONE_NEG`, `INT_MAX`, `INT_MIN`, `INT_OVERFLOW_POS`, `INT_OVERFLOW_NEG`, `INT_CANON_42`, `INT_CANON_ZERO`, `INT_CANON_NEG1`, `INT_CANON_MAX`, `INT_CANON_MIN`, `INT_CANON_TRUNCATED`. Covers positive, negative, zero, boundary values, overflow rejection, and canonical round-trip.

**Float rejection (v1.1):** `FLOAT_REJECT_DECIMAL`, `FLOAT_REJECT_1_DOT_0`, `FLOAT_REJECT_EXP_LOWER`, `FLOAT_REJECT_EXP_UPPER`, `FLOAT_REJECT_NEG_EXP`, `FLOAT_REJECT_ZERO_DOT`. Verifies that decimal points and exponent notation trigger `ERR_TYPE`.

**Mixed types (v1.1):** `MIXED_MAP`, `MIXED_LIST`, `MIXED_NESTED`. Descriptors combining strings, booleans, and integers in maps and lists.

**BIND projection:** Pointer parsing, omit-siblings, subsumption, empty pointer, unmatched pointers, LIST traversal rejection, boolean/integer selection.

**JSON-STRICT adapter:** BOM rejection, surrogate detection, duplicate keys, escape equivalence, null rejection, `Infinity`/`NaN` rejection, malformed JSON.

**Key ordering:** `memcmp` ordering, signed byte traps, astral character ordering.

**Unicode:** No normalization (NFC ≠ NFD), embedded NUL, noncharacters.

**Safety limits:** `MAX_DEPTH` enforcement at 32 levels (both MAP and LIST nesting), `MAX_CANON_BYTES` enforcement.

**Error precedence:** Multi-fault inputs where the highest-precedence error must be reported.

## Running the Tests

### Python

```bash
python -m pytest tests/test_conformance.py -v
```

### Node.js / TypeScript

```bash
npm test
```

### Go

```bash
go test ./conformance/...
```

### Rust

```bash
cargo test --test conformance
```

## Writing a Test Runner

Each vector in `conformance_vectors_v11.json` has:

- `test_id` — unique identifier for cross-referencing with expected results
- `mode` — one of `json_strict_full`, `json_strict_bind`, `canon_full`, `canon_bind`
- `input_b64` — base64-encoded input bytes
- `pointers` — (BIND mode only) array of RFC 6901 pointer strings

Each entry in `conformance_expected_v11.json` has either:

- `mid` — the expected MID string (test passes if output matches)
- `err` — the expected error code (test passes if the implementation raises this error)

The test runner should:

1. Decode `input_b64` to raw bytes
2. Based on `mode`, call the appropriate API function
3. Compare the output MID or error code against the expected value
4. Report pass/fail per vector

No partial credit. Every vector must pass.
