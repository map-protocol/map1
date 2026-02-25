//! MAP v1.1 constants — canonical header, MCF type tags, and normative limits.
//!
//! Spec references: §3.2 (type tags), §4 (limits), §5.1 (CANON_HDR).

/// Frozen spec version this implementation conforms to.
pub const SPEC_VERSION: &str = "1.1";

/// 5-byte canonical header: ASCII "MAP1" + NUL terminator.
/// The "1" is the major version of the canonical framing, not the spec version.
/// See Appendix A6: BOOLEAN and INTEGER additions don't change this prefix.
pub const CANON_HDR: &[u8; 5] = b"MAP1\x00";

// ── MCF type tags (single byte each) ─────────────────────────
// Tags 0x01–0x04 unchanged from v1.0.
// Tags 0x05–0x06 added in v1.1 to resolve the boolean-string collision
// and to accept integers that v1.0 rejected.

pub const TAG_STRING: u8 = 0x01;
pub const TAG_BYTES: u8 = 0x02;
pub const TAG_LIST: u8 = 0x03;
pub const TAG_MAP: u8 = 0x04;
/// v1.1: payload is 0x01 (true) or 0x00 (false)
pub const TAG_BOOLEAN: u8 = 0x05;
/// v1.1: payload is int64 big-endian, always 8 bytes
pub const TAG_INTEGER: u8 = 0x06;

// ── Normative safety limits (§4) ─────────────────────────────
// These exist to prevent DoS via deeply nested or oversized inputs.
// Implementations MUST enforce MAX_CANON_BYTES before allocating buffers.

/// Maximum total CANON_BYTES length (1 MiB).
pub const MAX_CANON_BYTES: usize = 1_048_576;

/// Maximum depth of nested LIST/MAP containers.
pub const MAX_DEPTH: u32 = 32;

/// Maximum number of entries in a single MAP.
pub const MAX_MAP_ENTRIES: u32 = 65_535;

/// Maximum number of entries in a single LIST.
pub const MAX_LIST_ENTRIES: u32 = 65_535;
