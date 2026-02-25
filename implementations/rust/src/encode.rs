//! MAP v1.1 MCF encoder — deterministic binary encoding of canonical model values.
//!
//! Encodes a `MapValue` tree into MCF bytes per §3.2.  Each value is
//! self-describing via its type tag, and every container encodes its
//! count as uint32be.  No implicit typing, no schema negotiation.
//!
//! Encoding format per type:
//!   STRING  : 0x01 || uint32be(byte_len) || utf8_bytes
//!   BYTES   : 0x02 || uint32be(byte_len) || raw_bytes
//!   LIST    : 0x03 || uint32be(count)    || value_1 || ... || value_n
//!   MAP     : 0x04 || uint32be(count)    || (key_1 || val_1) || ... || (key_n || val_n)
//!   BOOLEAN : 0x05 || payload_byte (0x01 for true, 0x00 for false)
//!   INTEGER : 0x06 || int64be(value)

use crate::constants::*;
use crate::errors::*;
use crate::value::MapValue;

// TODO: consider implementing the Write trait for streaming encode,
// which would allow writing directly to a sha2 hasher and cutting
// peak memory usage roughly in half for large descriptors.

/// Validate that a string contains only valid UTF-8 scalar values (§3.4).
///
/// Rust strings are always valid UTF-8, but the spec also requires
/// rejecting surrogate code points (U+D800–U+DFFF).  Rust's str type
/// already excludes encoded surrogates since they produce invalid UTF-8
/// sequences, but we check explicitly for defense-in-depth.
pub fn validate_utf8_scalar(s: &str) -> Result<(), MapError> {
    for ch in s.chars() {
        let cp = ch as u32;
        if (0xD800..=0xDFFF).contains(&cp) {
            return Err(MapError::new(
                ERR_UTF8,
                format!("surrogate code-point U+{:04X}", cp),
            ));
        }
    }
    Ok(())
}

/// Validate raw bytes as valid UTF-8 with no surrogates (§3.4).
pub fn validate_utf8_scalar_bytes(b: &[u8]) -> Result<(), MapError> {
    let s = std::str::from_utf8(b).map_err(|_| MapError::new(ERR_UTF8, "invalid UTF-8"))?;
    validate_utf8_scalar(s)
}

// ── Key ordering (§3.5) ──────────────────────────────────────
// This is the single most critical fork surface in the entire spec.
// Ordering is raw unsigned-octet comparison (memcmp semantics), NOT
// Unicode code-point order, NOT locale collation, NOT UTF-16 order.
//
// In Rust, &[u8] comparison is already unsigned-byte lexicographic,
// so key_a.as_bytes().cmp(key_b.as_bytes()) gives the correct order.

/// Compare two keys by raw UTF-8 bytes using unsigned-octet memcmp (§3.5).
#[inline]
fn key_cmp(a: &[u8], b: &[u8]) -> std::cmp::Ordering {
    a.cmp(b)
}

/// Assert that keys are strictly ascending by memcmp (no duplicates).
fn ensure_sorted_unique(keys: &[&[u8]]) -> Result<(), MapError> {
    for i in 1..keys.len() {
        match key_cmp(keys[i - 1], keys[i]) {
            std::cmp::Ordering::Equal => {
                return Err(MapError::new(ERR_DUP_KEY, "duplicate key"));
            }
            std::cmp::Ordering::Greater => {
                return Err(MapError::new(ERR_KEY_ORDER, "key order violation"));
            }
            std::cmp::Ordering::Less => {}
        }
    }
    Ok(())
}

/// Encode a canonical-model value into MCF bytes.
///
/// The `depth` parameter tracks container nesting:
///   - Root call starts at depth 0.
///   - Entering a MAP or LIST checks depth + 1 against MAX_DEPTH.
///   - Scalars (STRING, BYTES, BOOLEAN, INTEGER) don't increment depth.
// TODO: benchmark Vec::with_capacity pre-sizing for typical descriptor
// shapes (10-50 keys, 2-3 nesting levels) to reduce reallocation.
pub fn mcf_encode_value(val: &MapValue, depth: u32) -> Result<Vec<u8>, MapError> {
    match val {
        MapValue::Boolean(b) => {
            // §3.2: BOOLEAN is 0x05 followed by 0x01 (true) or 0x00 (false).
            Ok(vec![TAG_BOOLEAN, if *b { 0x01 } else { 0x00 }])
        }

        MapValue::Integer(i) => {
            // §3.2: INTEGER is 0x06 followed by 8 bytes of signed big-endian.
            // i64::to_be_bytes() gives two's complement big-endian, which is
            // exactly what the spec requires.  No sign-to-unsigned conversion
            // needed — Rust guarantees two's complement for integer types.
            let mut buf = Vec::with_capacity(9);
            buf.push(TAG_INTEGER);
            buf.extend_from_slice(&i.to_be_bytes());
            Ok(buf)
        }

        MapValue::String(s) => {
            validate_utf8_scalar(s)?;
            let raw = s.as_bytes();
            let len = raw.len();
            if len > u32::MAX as usize {
                return Err(MapError::new(ERR_CANON_MCF, "string length exceeds u32"));
            }
            let mut buf = Vec::with_capacity(1 + 4 + len);
            buf.push(TAG_STRING);
            buf.extend_from_slice(&(len as u32).to_be_bytes());
            buf.extend_from_slice(raw);
            Ok(buf)
        }

        MapValue::Bytes(b) => {
            let len = b.len();
            if len > u32::MAX as usize {
                return Err(MapError::new(ERR_CANON_MCF, "bytes length exceeds u32"));
            }
            let mut buf = Vec::with_capacity(1 + 4 + len);
            buf.push(TAG_BYTES);
            buf.extend_from_slice(&(len as u32).to_be_bytes());
            buf.extend_from_slice(b);
            Ok(buf)
        }

        MapValue::List(items) => {
            if depth + 1 > MAX_DEPTH {
                return Err(MapError::new(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH"));
            }
            if items.len() > MAX_LIST_ENTRIES as usize {
                return Err(MapError::new(
                    ERR_LIMIT_SIZE,
                    "list entry count exceeds limit",
                ));
            }
            let mut buf = Vec::new();
            buf.push(TAG_LIST);
            buf.extend_from_slice(&(items.len() as u32).to_be_bytes());
            for item in items {
                buf.extend(mcf_encode_value(item, depth + 1)?);
            }
            Ok(buf)
        }

        MapValue::Map(entries) => {
            if depth + 1 > MAX_DEPTH {
                return Err(MapError::new(ERR_LIMIT_DEPTH, "depth exceeds MAX_DEPTH"));
            }
            if entries.len() > MAX_MAP_ENTRIES as usize {
                return Err(MapError::new(
                    ERR_LIMIT_SIZE,
                    "map entry count exceeds limit",
                ));
            }

            // Validate keys: UTF-8 scalar, collect as bytes for sort check
            let mut key_bytes: Vec<&[u8]> = Vec::with_capacity(entries.len());
            for (k, _) in entries {
                validate_utf8_scalar(k)?;
                key_bytes.push(k.as_bytes());
            }

            // Verify keys are sorted and unique (§3.5, §3.6)
            ensure_sorted_unique(&key_bytes)?;

            let mut buf = Vec::new();
            buf.push(TAG_MAP);
            buf.extend_from_slice(&(entries.len() as u32).to_be_bytes());
            for (k, v) in entries {
                // Keys are always STRING-tagged (§3.2)
                let raw = k.as_bytes();
                buf.push(TAG_STRING);
                buf.extend_from_slice(&(raw.len() as u32).to_be_bytes());
                buf.extend_from_slice(raw);
                buf.extend(mcf_encode_value(v, depth + 1)?);
            }
            Ok(buf)
        }
    }
}

// TODO: #[inline] on hot encode paths — profile first to confirm
// which paths actually benefit from inlining.
