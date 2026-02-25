//! MAP v1.1 MCF decoder — fast-path validation for pre-serialized CANON_BYTES.
//!
//! Implements §3.7: full structural validation of MCF binary data without
//! round-tripping through the canonical model.  This is the "fast path"
//! used by `mid_from_canon_bytes`.
//!
//! Validation requirements (§3.7):
//!   (a) UTF-8 validity and scalar constraints on ALL STRINGs
//!   (b) MAP key uniqueness on ALL MAPs
//!   (c) MAP key ordering on ALL MAPs
//!   (d) Container limits (MAX_DEPTH, MAX_MAP_ENTRIES, MAX_LIST_ENTRIES)
//!   (e) Total size limits (MAX_CANON_BYTES)
//!   (f) Exactly one root MCF value, EOF immediately after
//!   (g) BOOLEAN payload_byte is exactly 0x00 or 0x01

use crate::constants::*;
use crate::encode::validate_utf8_scalar_bytes;
use crate::errors::*;

// TODO: zero-copy canon_bytes validation — currently we allocate strings
// for key comparison; could instead compare raw byte slices in-place.

/// Read an unsigned 32-bit big-endian integer from `buf` at `off`.
fn read_u32be(buf: &[u8], off: usize) -> Result<(u32, usize), MapError> {
    if off + 4 > buf.len() {
        return Err(MapError::new(ERR_CANON_MCF, "truncated u32"));
    }
    let val = u32::from_be_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]]);
    Ok((val, off + 4))
}

/// Decode one MCF value from `buf` at `off`.  Returns the new offset.
///
/// Depth semantics mirror the encoder: root starts at 0, containers
/// check depth + 1 against MAX_DEPTH, scalars don't increment.
pub fn mcf_decode_validate(buf: &[u8], off: usize, depth: u32) -> Result<usize, MapError> {
    if off >= buf.len() {
        return Err(MapError::new(ERR_CANON_MCF, "truncated tag"));
    }
    let tag = buf[off];
    let mut off = off + 1;

    match tag {
        TAG_STRING => {
            let (n, new_off) = read_u32be(buf, off)?;
            off = new_off;
            let n = n as usize;
            if off + n > buf.len() {
                return Err(MapError::new(ERR_CANON_MCF, "truncated string payload"));
            }
            // Validate UTF-8 and scalar code points (§3.4)
            validate_utf8_scalar_bytes(&buf[off..off + n])?;
            Ok(off + n)
        }

        TAG_BYTES => {
            let (n, new_off) = read_u32be(buf, off)?;
            off = new_off;
            let n = n as usize;
            if off + n > buf.len() {
                return Err(MapError::new(ERR_CANON_MCF, "truncated bytes payload"));
            }
            Ok(off + n)
        }

        TAG_LIST => {
            if depth + 1 > MAX_DEPTH {
                return Err(MapError::new(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH"));
            }
            let (count, new_off) = read_u32be(buf, off)?;
            off = new_off;
            if count > MAX_LIST_ENTRIES {
                return Err(MapError::new(
                    ERR_LIMIT_SIZE,
                    "list entry count exceeds limit",
                ));
            }
            for _ in 0..count {
                off = mcf_decode_validate(buf, off, depth + 1)?;
            }
            Ok(off)
        }

        TAG_MAP => {
            if depth + 1 > MAX_DEPTH {
                return Err(MapError::new(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH"));
            }
            let (count, new_off) = read_u32be(buf, off)?;
            off = new_off;
            if count > MAX_MAP_ENTRIES {
                return Err(MapError::new(
                    ERR_LIMIT_SIZE,
                    "map entry count exceeds limit",
                ));
            }

            let mut prev_key: Option<Vec<u8>> = None;
            for _ in 0..count {
                // Keys must be STRING-tagged per §3.2
                if off >= buf.len() {
                    return Err(MapError::new(ERR_CANON_MCF, "truncated map key tag"));
                }
                if buf[off] != TAG_STRING {
                    return Err(MapError::new(ERR_SCHEMA, "map key must be STRING"));
                }

                // Parse the key: skip tag, read length, validate UTF-8
                let (key_len, key_off) = read_u32be(buf, off + 1)?;
                let key_len = key_len as usize;
                if key_off + key_len > buf.len() {
                    return Err(MapError::new(ERR_CANON_MCF, "truncated string payload"));
                }
                let key_bytes = &buf[key_off..key_off + key_len];
                validate_utf8_scalar_bytes(key_bytes)?;
                off = key_off + key_len;

                // Enforce ordering and uniqueness on the wire (§3.5, §3.6)
                if let Some(ref prev) = prev_key {
                    match prev.as_slice().cmp(key_bytes) {
                        std::cmp::Ordering::Equal => {
                            return Err(MapError::new(ERR_DUP_KEY, "duplicate key in MCF"));
                        }
                        std::cmp::Ordering::Greater => {
                            return Err(MapError::new(
                                ERR_KEY_ORDER,
                                "key order violation in MCF",
                            ));
                        }
                        std::cmp::Ordering::Less => {}
                    }
                }
                prev_key = Some(key_bytes.to_vec());

                // Decode the value
                off = mcf_decode_validate(buf, off, depth + 1)?;
            }
            Ok(off)
        }

        // ── v1.1 types ──────────────────────────────────────────
        TAG_BOOLEAN => {
            // Exactly 1 payload byte, must be 0x00 or 0x01 (§3.2).
            // Any other value is malformed encoding, not a type error.
            if off >= buf.len() {
                return Err(MapError::new(ERR_CANON_MCF, "truncated boolean payload"));
            }
            let payload = buf[off];
            if payload != 0x00 && payload != 0x01 {
                return Err(MapError::new(
                    ERR_CANON_MCF,
                    format!("invalid boolean payload 0x{:02x}", payload),
                ));
            }
            Ok(off + 1)
        }

        TAG_INTEGER => {
            // Exactly 8 payload bytes, signed big-endian (§3.2).
            if off + 8 > buf.len() {
                return Err(MapError::new(ERR_CANON_MCF, "truncated integer payload"));
            }
            // No range check needed — any 8 bytes represent a valid i64.
            Ok(off + 8)
        }

        _ => Err(MapError::new(
            ERR_CANON_MCF,
            format!("unknown MCF tag 0x{:02x}", tag),
        )),
    }
}
