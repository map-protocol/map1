MAP v1 — Specification v1.0
Canon: MAP1 (v1)
Status: v1.0 (frozen)

This version is v0.2.2 + (A) JSON BOM stance (STRICT reject) and
(B) safety-limits vs reported-error precedence reconciliation.
It also makes explicit the already-required adapter determinism rule that
duplicate detection occurs after JSON escape resolution (no last-wins forks). No changes to CANON_HDR,
MCF tags, ordering, projection semantics, or MID format.

============================================================
0. OVERVIEW
============================================================

MAP v1 defines:

1) A canonical model (STRING, BYTES, LIST, MAP).
2) A canonical binary encoding (MCF) for that model.
3) A canonical byte stream (CANON_BYTES) = CANON_HDR || MCF(root_value).
4) A deterministic identifier (MID) = sha256(CANON_BYTES) with "map1:" prefix.
5) Projection rules (FULL, FULL-MINIMUM, BIND) to derive a stable identity surface.

MAP is identity-only. MAP does not grant authority, does not assert safety,
and does not interpret semantics.

============================================================
1. TERMINOLOGY
============================================================

Descriptor
- A structured data object (conceptually a MAP) representing a mutation, request,
  or state transition proposal.

Projection Mode
- FULL: canonicalize the entire descriptor.
- FULL-MINIMUM: reserved for v1.1 (see Appendix D).
- BIND: canonicalize only fields selected by JSON-Pointer paths (§2.3).

CANON_HDR
- The 5-byte header: ASCII "MAP1" followed by 0x00.

MCF
- MAP Canonical Format: a deterministic, typed, binary encoding of the canonical model.

CANON_BYTES
- CANON_HDR || MCF(root_value)

MID
- "map1:" || hex_lower(sha256(CANON_BYTES))

============================================================
2. PROJECTION (NORMATIVE)
============================================================

2.1 Root
BIND root requirement:
For BIND projection, the parsed root_value MUST be a MAP. If the parsed root_value is not a MAP, implementations MUST reject deterministically with ERR_SCHEMA.

The input to all MAP v1 identity functions is a descriptor that is modeled as a MAP.

2.2 FULL Projection
FULL projection produces a canonical model value equal to the descriptor MAP.

2.3 BIND Projection Semantics
BIND projection constructs a projected MAP by selecting values from the descriptor
using RFC 6901 JSON-Pointer paths.

Normative rules:

(0) Pointer-set rules (normative)
(a) Pointer parsing
    Each pointer in pointer_set MUST parse according to RFC 6901. Any pointer parse failure MUST reject with ERR_SCHEMA.

(b) Duplicate pointers (fail-closed)
    pointer_set MUST NOT contain duplicate pointers (byte-identical strings). If duplicates are present, reject deterministically with ERR_SCHEMA.

(c) Unmatched pointers (fail-closed, with one exception)
    A pointer “matches” if it selects a value in the descriptor under RFC 6901 traversal rules.
    If no pointers match any value in the descriptor, project() returns an EMPTY MAP (count=0) as specified in rule (3).
    Otherwise (i.e., at least one pointer matches), if any pointer does not match, reject deterministically with ERR_SCHEMA.

(d) Overlapping pointers (subsumption)
    If pointer P1 is a strict path-prefix of pointer P2 (P2 begins with P1 followed by "/"), then P1 subsumes P2; P2 has no additional effect on the projection result.

(e) Empty pointer "" (MAP-root FULL-equivalent)
    The empty pointer "" selects the entire MAP root (RFC 6901 whole-document pointer applied to a MAP root).
    For the purpose of rule (c), the empty pointer "" is a matching pointer (it always selects the MAP root).
    If pointer_set contains "", the projection result is FULL-equivalent over the MAP root and "" subsumes all other pointers.
    This rule does not change the BIND root requirement: non-MAP roots MUST still reject with ERR_SCHEMA.

(1) Omit siblings (mechanical rule)
- For each MAP encountered along a pointer path, the projected result MUST include only
  the single member needed to continue that path (and ultimately reach the leaf).
- All sibling members at that MAP level MUST be omitted from the projected result.

(2) Minimal enclosing structure
- The projected output MUST include only the minimal enclosing MAP structure necessary
  to represent the selected leaf values at their paths.

(3) If no pointer paths match
- If no pointer paths match any value in the descriptor, project() returns an EMPTY MAP (count=0).
- This is never null/absent; it is always a MAP with count=0.

(4) LIST traversal is forbidden (Option 1 — LOCKED)
- BIND pointers MUST NOT traverse LISTs.
- If any pointer token would traverse a LIST at any step, project() MUST reject deterministically
  with ERR_SCHEMA.

(5) JSON-Pointer parsing
- Pointer parsing MUST comply fully with RFC 6901, including "~0" and "~1" decoding.
- Conformance MUST include keys containing literal "~" and "/" with correct escaped pointer paths.

2.4 Underscore Open-Field Discipline (FULL-MINIMUM)
[Reserved for v1.1 — see Appendix D.]

2.5 Absence vs Empty
Absence and empty are canonically distinct:
- An omitted member contributes no bytes to CANON_BYTES.
- An empty MAP contributes bytes for an empty MAP (type tag + count=0).

============================================================
3. CANONICAL ENCODING (MCF) (NORMATIVE)
============================================================

3.1 Canonical Model Types
- STRING: a byte sequence that MUST be valid UTF-8 encoding of Unicode scalar values only.
- BYTES: arbitrary byte sequence.
- LIST: ordered sequence of canonical model values.
- MAP: ordered sequence of key/value pairs where keys are STRING and must be unique and correctly ordered.

3.2 Type Tags
MCF encodes a single value as:

STRING: 0x01 || uint32be(byte_len) || utf8_bytes
BYTES : 0x02 || uint32be(byte_len) || raw_bytes
LIST  : 0x03 || uint32be(count)    || value_1 || ... || value_n
MAP   : 0x04 || uint32be(count)    || (key_1 || val_1) || ... || (key_n || val_n)

Constraints:
- MAP keys MUST be encoded as STRING values.
- MAP key ordering MUST follow §3.5.
Implementations MUST NOT perform any Unicode normalization (NFC/NFD/NFKC/NFKD) on STRING values or MAP keys.
- MAP keys MUST be unique by raw UTF-8 bytes.

3.3 Length/Count Fields (Fork-hardening)
- All uint32be length/count fields MUST be decoded as UNSIGNED 32-bit integers.
- Implementations MUST treat negative/signed interpretations as invalid decoding.

3.4 STRING UTF-8 Rules
- STRING bytes MUST be valid UTF-8.
- Decoded code points MUST be Unicode scalar values only (no surrogates U+D800–U+DFFF).
- Implementations MUST NOT “repair” invalid sequences (no U+FFFD substitution).
- Violations MUST raise ERR_UTF8.

3.5 MAP Key Ordering (Critical Fork Surface)
Ordering is unsigned-octet lexicographic compare over raw UTF-8 bytes (memcmp semantics).

Normative:
- Compare keys by their raw UTF-8 byte arrays using unsigned octets (0..255).
- No UTF-16 ordering, no locale collation, no codepoint ordering.
- Prefix rule: if one key is a strict prefix of another, the shorter key sorts first.

Implementation note (non-normative):
- In languages with signed bytes (e.g., Java), comparator MUST mask bytes (b & 0xFF).

3.6 Duplicate Keys
- If two MAP keys are byte-identical, reject with ERR_DUP_KEY.

3.7 Fast-Path Validation for Pre-Serialized CANON_BYTES
If an implementation accepts pre-serialized CANON_BYTES (e.g., mid_from_canon_bytes), it MUST:
- Validate CANON_HDR exactly.
- Parse exactly ONE root MCF value.
- Enforce each of the following validations (no omissions):
  (a) UTF-8 validity and scalar constraints on ALL STRINGs (including forbidding surrogate code points).
  (b) MAP key uniqueness on ALL MAPs (no duplicate keys).
  (c) MAP key ordering on ALL MAPs (unsigned-octet lexicographic compare over raw UTF-8 bytes).
  (d) Container limits (MAX_DEPTH, MAX_MAP_ENTRIES, MAX_LIST_ENTRIES).
  (e) Total size limits (MAX_CANON_BYTES and any other configured size limits).
  (f) Exactly one root MCF value, and EOF immediately after the root (no trailing bytes).
- Verify EOF immediately after the single root value; any trailing bytes MUST raise ERR_CANON_MCF.

============================================================
4. NORMATIVE LIMITS
============================================================

MAX_CANON_BYTES   = 1,048,576  (1 MiB)   // total CANON_BYTES length
MAX_DEPTH         = 32         // depth of nested LIST/MAP containers
MAX_MAP_ENTRIES   = 65,535
MAX_LIST_ENTRIES  = 65,535

Depth definition (normative):
- Depth applies only to container values: MAP and LIST.
- Root descriptor value has depth = 1 if it is a MAP or LIST.
  (In MAP v1 identity functions, the root descriptor is a MAP; thus root depth = 1.)
- For any container C (MAP or LIST) that contains a child value V:
    - If V is a container (MAP or LIST), then depth(V) = depth(C) + 1.
    - If V is a scalar (STRING or BYTES), it does not increase depth.
- The overall descriptor depth is the maximum depth over all containers in the tree.
- Exceeding MAX_DEPTH MUST reject deterministically with ERR_LIMIT_DEPTH.

Size-limit precedence (fork-hardening):
- Implementations MUST enforce MAX_CANON_BYTES BEFORE allocating buffers based on untrusted lengths.
- If decoded length/count (plus already-consumed bytes) would exceed MAX_CANON_BYTES, report ERR_LIMIT_SIZE
  (not ERR_CANON_MCF).

============================================================
5. CANON_BYTES AND MID (NORMATIVE)
============================================================

5.1 CANON_HDR
CANON_HDR is exactly 5 bytes: 0x4D 0x41 0x50 0x31 0x00  ("MAP1" + NUL)

5.2 CANON_BYTES
CANON_BYTES = CANON_HDR || MCF(root_value)

5.3 MID
MID = "map1:" || hex_lower(sha256(CANON_BYTES))

============================================================
6. ERRORS (NORMATIVE)
============================================================

6.1 Error Codes
ERR_CANON_HDR   - invalid header
ERR_CANON_MCF   - malformed MCF (parse failure, trailing bytes, truncated)
ERR_SCHEMA      - invalid descriptor shape for the selected mode (e.g., BIND pointer traversal into LIST)
ERR_TYPE        - unsupported type in adapter layer (e.g., JSON null, JSON number in JSON-STRICT)
ERR_UTF8        - invalid UTF-8 or forbidden scalar values (including surrogates)
ERR_DUP_KEY     - duplicate MAP key
ERR_KEY_ORDER   - MAP keys not in required order
ERR_LIMIT_DEPTH - exceeds MAX_DEPTH
ERR_LIMIT_SIZE  - exceeds MAX_CANON_BYTES or other size limits

JSON adapter parse failures (normative):
- In JSON-STRICT modes, the adapter MUST parse input JSON text strictly under RFC 8259 (no extensions).
- Any JSON syntax failure (invalid JSON text, including trailing commas, unterminated strings/objects, extra roots,
  or trailing non-whitespace bytes after the single root value) MUST reject deterministically with ERR_CANON_MCF.

6.2 Error Code Precedence (Reported)
If multiple violations apply, implementations MUST report the first applicable error in this precedence order:

ERR_CANON_HDR
ERR_CANON_MCF
ERR_SCHEMA
ERR_TYPE
ERR_UTF8
ERR_DUP_KEY
ERR_KEY_ORDER
ERR_LIMIT_DEPTH
ERR_LIMIT_SIZE

Reported-code rule (normative):
- Implementations MAY detect violations in any internal order (streaming vs tree),
  but MUST report only the highest-precedence applicable error code from the list above.

Safety vs precedence rule (normative; fork-hardening):
- For any input that is fully processable within the configured safety limits (including MAX_CANON_BYTES, MAX_DEPTH,
  and entry-count limits), implementations MUST determine the full set of applicable violations that are determinable
  under those safety limits, and MUST report exactly one error: the single highest-precedence error from the list above.
- Implementations MAY short-circuit (stop further validation) only when continuing would exceed a configured safety limit
  or would require unsafe allocation/unbounded processing. In that case, the implementation MUST still report the
  highest-precedence error among the violations already determinable before the safety limit would be exceeded.
- Implementations MUST NOT vary reported error codes based on internal parsing strategy (streaming vs tree) for inputs
  that are fully processable within the configured safety limits.

Non-normative implementer note:
- Validators may short-circuit for safety, but MUST still apply the reported-code rule to the determinable violations
  encountered prior to termination.

============================================================
7. REQUIRED API SURFACE
============================================================

An implementation MUST provide the following functions (or equivalent behavior), with identical semantics.

7.1 Canonical Bytes
canonical_bytes_full(descriptor_map) -> bytes | ERR_*
canonical_bytes_bind(descriptor_map, pointer_set) -> bytes | ERR_*

Rules:
- canonical_bytes_* MUST produce exactly: CANON_HDR || MCF(root_value)
- canonical_bytes_* MUST enforce all normative requirements (ordering, UTF-8 scalar validity, limits, etc.).
- For BIND: pointer_set MUST be parsed using RFC 6901; projection semantics are defined in §2.3.

7.2 MID
mid_full(descriptor_map) -> MID | ERR_*
mid_bind(descriptor_map, pointer_set) -> MID | ERR_*
mid_from_canon_bytes(canon_bytes) -> MID | ERR_*

Rules:
- MID = "map1:" || hex_lower(sha256(canon_bytes))
- mid_from_canon_bytes MUST fully validate canon_bytes per §3.7 (fast-path validation).
- MID does not encode projection mode; systems MUST NOT infer FULL vs BIND from MID alone (Appendix A).

============================================================
8. JSON ADAPTER (NORMATIVE) — JSON-STRICT PROFILE
============================================================

MAP v1 defines a single normative JSON ingestion profile: JSON-STRICT.

Numbers policy (resolved for v1 compliance):
- JSON numbers are REJECTED in v1 compliance. Period.
- If numeric support is desired later, it must be introduced as a separately named adapter profile
  (e.g., JSON-RFC8785), and MUST NOT be “optional” inside the same compliance tier.

8.1 Parsing Requirements
- Input JSON MUST be parsed using an RFC 8259-compliant parser.
- JSON escape sequences (e.g., \uXXXX) MUST be fully resolved to Unicode scalar values before mapping to STRING.
- The adapter MUST reject any unpaired surrogate escape sequences (\uD800–\uDFFF) and any surrogate code points.
- The adapter MUST NOT "repair" or substitute U+FFFD; invalid input MUST be rejected with ERR_UTF8.

8.1.1 BOM Stance (STRICT; fork-hardening)
- JSON-STRICT inputs MUST be parsed as RFC 8259 JSON text without a leading UTF-8 BOM.
- If the first bytes of the input are the UTF-8 BOM sequence 0xEF 0xBB 0xBF, the adapter MUST reject with ERR_SCHEMA.
- BOM is rejected even if preceded by whitespace (byte-level strictness).

8.2 Type Mapping (JSON-STRICT)
- JSON object  -> MAP
- JSON array   -> LIST
- JSON string  -> STRING (UTF-8 bytes of the resolved scalar sequence)
- JSON boolean -> STRING "true" or STRING "false" (lowercase ASCII)
- JSON null    -> ERR_TYPE (rejected)
- JSON number  -> ERR_TYPE (rejected)

8.3 Duplicate Object Keys
Duplicate detection is required at the JSON adapter boundary.

Normative:
- If the JSON text contains duplicate keys in the same object, the adapter MUST reject with ERR_DUP_KEY.
- Duplicate detection MUST occur after escape resolution (e.g., "a" and "\u0061" are duplicates).
- Implementations MUST use a parser capable of detecting duplicates or implement equivalent detection.

============================================================
9. SECURITY & INTEROP NOTES (NON-NORMATIVE)
============================================================

- The canonical core can be correct and still fork at adapters. That is why JSON-STRICT is intentionally narrow.
- Limits MUST be enforced before allocation to avoid DoS and to prevent alloc-before-limit fork behavior.
- Reject parity matters: deterministic error precedence prevents “streaming vs tree” from becoming a fork.

============================================================
10. CHANGELOG
============================================================

v0.2.6
- Additive BIND hardening: BIND root MUST be MAP; pointer-set rules for parse failure, duplicates, unmatched pointers, overlap subsumption, and empty pointer "" (FULL-equivalent over MAP root only).

v0.2.5
- Based on v0.2.2 (no canonical rebaseline).
- Adds JSON-STRICT BOM stance: STRICT reject (ERR_SCHEMA), byte-level (also rejected if preceded by whitespace).
- Adds safety-limits vs reported-error precedence reconciliation rule (§6.2), preventing streaming/tree error-code forks.
- Makes adapter duplicate-key determinism explicit: duplicate detection occurs after escape resolution (e.g., "a" and "\u0061"). (This is a fork-hardening clarification consistent with v0.2.2 intent and Appendix vectors.)

v0.2.4
- Based on v0.2.2 (no canonical rebaseline).
- Adds JSON-STRICT BOM stance: STRICT reject (ERR_SCHEMA), byte-level (also rejected if preceded by whitespace).
- Adds safety-limits vs reported-error precedence reconciliation rule (§6.2), preventing streaming/tree error-code forks.

v0.2.2
- Consolidation canon: retains v0.2.1 fork-hardening deltas and restores dropped integration material.
- Adds ERR_SCHEMA formally (needed for BIND list-traversal rejection).
- Keeps BIND omit-siblings MUST and LIST traversal rejection (Option 1 locked).
- Updates conformance add-on vectors list (Appendix C).

============================================================
APPENDIX A: INTEGRATION GUIDANCE (NON-NORMATIVE)
============================================================

A1) Identity is not authority
MAP provides stable identity bytes and hashes. It does not decide whether a mutation is allowed.
If you interpret a MID as “safe” or “approved,” you MUST bind that meaning to an external authority system.

A2) Trust boundaries SHOULD reconstruct
If a trust boundary accepts a MID or CANON_BYTES from an untrusted party, it SHOULD reconstruct CANON_BYTES from the
actual descriptor (and pointers, if BIND) rather than trusting caller-supplied bytes. Otherwise you risk “orphan MIDs”
that cannot be reproduced by correct implementations.

A3) Projection context is out-of-band
MID does not encode projection mode. If your system’s meaning differs for FULL vs BIND, you must bind that context
out-of-band and must not infer FULL vs BIND alone.

A4) Underscore discipline is a caller convention
FULL-MINIMUM is a caller-selected convention. If systems in the same identity domain mix FULL and FULL-MINIMUM, they will
generate different MIDs for the same descriptor. Treat that as an identity mismatch, not a bug.

A5) Empty BIND projections
BIND projections that produce an empty MAP may be valid at the MAP layer, but many applications SHOULD treat this as an
application-layer error (an “empty identity surface” is usually suspicious).

============================================================
APPENDIX B: MAP v1 LAYER DIAGRAM (NON-NORMATIVE)
============================================================

Layer 0: Raw input (JSON / internal structures / pre-serialized bytes)
   |
   v
Layer 1: Adapter profile (JSON-STRICT)
   - decode escapes to Unicode scalar values
   - reject surrogates, duplicates, unsupported types
   - (v0.2.4) reject BOM
   |
   v
Layer 2: Canonical model (STRING/BYTES/LIST/MAP)
   |
   v
Layer 3: Projection (FULL / FULL-MINIMUM / BIND)
   - BIND: RFC6901 pointers, omit siblings, reject LIST traversal
   |
   v
Layer 4: Canonical encoding (MCF)
   |
   v
Layer 5: CANON_BYTES = "MAP1\0" || MCF(root)
   |
   v
Layer 6: MID = "map1:" + sha256(CANON_BYTES)

============================================================
APPENDIX C — CONFORMANCE SUITE MINIMUM ADD-ON VECTORS (v0.2.5)
============================================================

These vectors add coverage only; they MUST NOT require rebaselining existing golden outputs.

C1. Escape equivalence (key and value)
- JSON inputs {"A":"x"} and {"\u0041":"x"} MUST produce identical CANON_BYTES and MID.
- JSON inputs {"k":"A"} and {"k":"\u0041"} MUST produce identical CANON_BYTES and MID.

C2. Lone surrogate reject (adapter boundary)
- Any JSON string containing an unpaired surrogate escape MUST be rejected with ERR_UTF8.
  Example: {"k":"x\uD800y"}.

C3. UTF-16 vs UTF-8 ordering trap (FULL)
- Two keys that sort differently under UTF-16 vs UTF-8 bytes MUST be ordered by UTF-8 bytes.

C4. Fast-path trailing bytes reject
- A valid CANON_BYTES value with any trailing garbage MUST be rejected with ERR_CANON_MCF.

C5. Depth boundary (32 pass / 33 fail)
- Depth 32 MUST be accepted.
- Depth 33 MUST be rejected with ERR_LIMIT_DEPTH.

C6. RFC 6901 tilde decoding (BIND)
- Conformance MUST include keys containing literal "~" and "/" and pointer paths that use "~0" and "~1" correctly.

C7. Prefix ordering (raw UTF-8 bytes)
- If one key is a strict prefix of another, the shorter key MUST sort first.

C8. BIND omit-siblings behavior
- For descriptor {"a":{"x":"1","y":"2"},"b":"keep"} with pointer_set {"/a/x"},
  the projected MAP MUST be {"a":{"x":"1"}}.

C9. BIND LIST traversal rejection (Option 1)
- If any pointer token would traverse a LIST, project() MUST reject deterministically with ERR_SCHEMA.

C10. Duplicate-after-unescape (adapter boundary)
- JSON object with keys "a" and "\u0061" in same object MUST reject with ERR_DUP_KEY.

C11. BOM rejection (adapter boundary; v0.2.4)
- If JSON input begins with UTF-8 BOM (EF BB BF), adapter MUST reject with ERR_SCHEMA.
- Reject BOM even if preceded by whitespace.

C12. Reported error precedence under safety limits (v0.2.4)
- At least one vector MUST exercise overlapping violations such that a higher-precedence violation is determinable
  before safety termination, and the expected reported error is that higher-precedence code (not ERR_LIMIT_*).

APPENDIX D — FULL-MINIMUM (RESERVED FOR v1.1)

The FULL-MINIMUM projection mode is deferred to v1.1. The following text
is included here as a non-normative preview of the intended semantics.

FULL-MINIMUM is a caller-selected convention that strips "open fields"
starting with underscore.

Draft rules (v1.1):
- If and only if the caller selects FULL-MINIMUM, then any MAP member
  whose key's FIRST UTF-8 BYTE is 0x5F ("_") MUST be omitted from
  the canonical model, unless that key is explicitly locked by the
  application.
- This test is on the first UTF-8 byte of the key, not on Unicode
  code points.

============================================================
END
