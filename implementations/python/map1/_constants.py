"""MAP v1.1 constants — canonical header, MCF type tags, and normative limits.

Spec references: §3.2 (type tags), §4 (limits), §5.1 (CANON_HDR).
"""

from __future__ import annotations

__spec_version__ = "1.1"
__spec_date__ = "2026-02-24"

# 5-byte canonical header: ASCII "MAP1" + NUL terminator.
# This never changes across minor versions — the "1" is the major version
# of the canonical framing, not the spec version.  See Appendix A6.
CANON_HDR = b"MAP1\x00"

# ── MCF type tags (single byte each) ─────────────────────────
# Tags 0x01–0x04 are unchanged from v1.0.
# Tags 0x05–0x06 added in v1.1 to resolve the boolean-string collision
# and to accept integers that v1.0 rejected.
TAG_STRING: int = 0x01
TAG_BYTES: int = 0x02
TAG_LIST: int = 0x03
TAG_MAP: int = 0x04
TAG_BOOLEAN: int = 0x05  # v1.1: payload is 0x01 (true) or 0x00 (false)
TAG_INTEGER: int = 0x06  # v1.1: payload is int64 big-endian, always 8 bytes

# ── Signed 64-bit integer range ──────────────────────────────
# Python ints are arbitrary-precision, so we must explicitly range-check.
# Languages with native int64 (Go, Rust) get this from the type system.
INT64_MIN: int = -(2**63)
INT64_MAX: int = 2**63 - 1

# ── Normative safety limits (§4) ─────────────────────────────
# These exist to prevent DoS via deeply nested or oversized inputs.
# Implementations MUST enforce MAX_CANON_BYTES before allocating buffers.
MAX_CANON_BYTES: int = 1_048_576   # 1 MiB
MAX_DEPTH: int = 32
MAX_MAP_ENTRIES: int = 65_535
MAX_LIST_ENTRIES: int = 65_535
