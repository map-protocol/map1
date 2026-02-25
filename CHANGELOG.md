# Changelog

## v1.1.0 — The Type System Grows Up

**2026-02-24**

MAP v1.0 had four types. That wasn't enough.

The problem showed up quickly: `true` and `"true"` produced the same MID. In v1.0, booleans were collapsed to their string representations before encoding. That meant `{"approved": true}` — a machine assertion — was indistinguishable from `{"approved": "true"}` — four characters in a text field. For agent receipts and audit trails, that's a real bug.

v1.1 fixes this by expanding the type system from four to six types:

- **BOOLEAN** (tag 0x05) — `true` encodes as `MAP1\x00\x05\x01`, `false` as `MAP1\x00\x05\x00`. These are now distinct from the strings `"true"` and `"false"`.
- **INTEGER** (tag 0x06) — signed 64-bit, big-endian. `42` encodes as 8 bytes of int64. v1.0 rejected integers outright; v1.1 accepts them because port numbers, retry counts, and sequence numbers are everywhere in real descriptors.

The rest of the type system is unchanged. STRING (0x01), BYTES (0x02), LIST (0x03), and MAP (0x04) work exactly as they did in v1.0. **Any descriptor that used only those four types produces the same MID in v1.1 as it did in v1.0.** The canonical example `{"action":"deploy","target":"prod","version":"2.1.0"}` still produces `map1:02f660...`.

### What's new

- Six-type canonical model: STRING, BYTES, LIST, MAP, BOOLEAN, INTEGER.
- JSON-STRICT adapter: token-level float detection rejects `3.14`, `1.0`, `1e5`, and `0.0`. Integers within int64 range are accepted. Booleans map to BOOLEAN.
- 95 conformance test vectors (up from 53), covering boolean encoding, integer encoding, float rejection, mixed-type maps, int64 boundary values, and canonical round-trip for all new types.
- Four reference implementations: Python, Node.js/TypeScript, Go, Rust. All pass all 95 vectors.
- `prepare()` convenience function (Python) for normalizing application data before MID computation — floats become strings, None keys are omitted, integers are range-checked.
- Boolean-string collision footgun eliminated.

### What broke

If you computed MIDs for descriptors containing booleans in v1.0 (via string collapse), those MIDs will differ in v1.1. This is intentional. Recompute under v1.1.

Descriptors containing only strings, bytes, lists, and maps are unaffected.

### Migration

For most users: update the library, run your tests, done. The only breaking change is boolean identity, and only if you were passing booleans through the v1.0 string-collapse path.

---

## v1.0.0 — Initial Release

**2026-02-10**

The first stable release of the MAP specification and reference implementations.

Four-type canonical model (STRING, BYTES, LIST, MAP). JSON-STRICT adapter with BOM rejection, surrogate detection, duplicate-key detection. 53 conformance test vectors. Python and Node.js reference implementations.

Introduced FULL and BIND projections, RFC 6901 JSON Pointer support for field selection, `memcmp` key ordering, and the `map1:`-prefixed MID format.
