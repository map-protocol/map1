//! # map1 — MAP v1.1 Rust implementation
//!
//! Compute deterministic identifiers (MIDs) for structured descriptors
//! using the MAP v1 canonical format.
//!
//! ```no_run
//! use map1::{mid_full, MapValue};
//!
//! let descriptor = MapValue::Map(vec![
//!     ("action".into(), MapValue::String("deploy".into())),
//!     ("target".into(), MapValue::String("prod".into())),
//!     ("version".into(), MapValue::String("2.1.0".into())),
//! ]);
//! let mid = mid_full(&descriptor).unwrap();
//! ```
//!
//! v1.1 adds BOOLEAN and INTEGER types.  Booleans and integers are now
//! distinct from their string representations.

pub mod constants;
pub mod decode;
pub mod encode;
pub mod errors;
pub mod json_adapter;
pub mod mid;
pub mod projection;
pub mod value;

pub use constants::SPEC_VERSION;
pub use errors::{MapError, ERR_CANON_HDR, ERR_CANON_MCF, ERR_DUP_KEY, ERR_KEY_ORDER,
                 ERR_LIMIT_DEPTH, ERR_LIMIT_SIZE, ERR_SCHEMA, ERR_TYPE, ERR_UTF8};
pub use value::MapValue;

use json_adapter::parse_json_strict;
use mid::{canon_bytes_from_value, mid_from_value};
use projection::{bind_project, full_project};

// ── Core API (§7) ────────────────────────────────────────────

/// Compute a MID over the full descriptor (FULL projection).
///
/// Accepts a `MapValue` tree.  Keys must be pre-sorted by raw UTF-8 byte
/// order (the encoder validates this).
pub fn mid_full(descriptor: &MapValue) -> Result<String, MapError> {
    let val = full_project(descriptor);
    mid_from_value(&val)
}

/// Compute a MID over selected fields (BIND projection).
///
/// Pointers are RFC 6901 JSON Pointer strings (e.g., "/action", "/config/port").
pub fn mid_bind(descriptor: &MapValue, pointers: &[&str]) -> Result<String, MapError> {
    let val = bind_project(descriptor, pointers)?;
    mid_from_value(&val)
}

/// Return CANON_BYTES (header + MCF) for the full descriptor.
pub fn canonical_bytes_full(descriptor: &MapValue) -> Result<Vec<u8>, MapError> {
    let val = full_project(descriptor);
    canon_bytes_from_value(&val)
}

/// Return CANON_BYTES for selected fields (BIND projection).
pub fn canonical_bytes_bind(
    descriptor: &MapValue,
    pointers: &[&str],
) -> Result<Vec<u8>, MapError> {
    let val = bind_project(descriptor, pointers)?;
    canon_bytes_from_value(&val)
}

// ── JSON-STRICT API ─────────────────────────────────────────

/// Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + FULL).
pub fn mid_full_json(raw: &[u8]) -> Result<String, MapError> {
    let (val, dup_found) = parse_json_strict(raw)?;
    let canon = canon_bytes_from_value(&val)?;
    // Raise dup_key only if no higher-precedence error already fired.
    if dup_found {
        return Err(MapError::new(ERR_DUP_KEY, "duplicate key in JSON"));
    }
    Ok(format!("map1:{}", sha256_hex(&canon)))
}

/// Compute a MID from raw UTF-8 JSON bytes (JSON-STRICT + BIND).
pub fn mid_bind_json(raw: &[u8], pointers: &[&str]) -> Result<String, MapError> {
    let (val, dup_found) = parse_json_strict(raw)?;
    let proj = bind_project(&val, pointers)?;
    let canon = canon_bytes_from_value(&proj)?;
    if dup_found {
        return Err(MapError::new(ERR_DUP_KEY, "duplicate key in JSON"));
    }
    Ok(format!("map1:{}", sha256_hex(&canon)))
}

/// Validate pre-built CANON_BYTES and return MID (§3.7 fast-path).
pub fn mid_from_canon_bytes(canon: &[u8]) -> Result<String, MapError> {
    mid::mid_from_canon_bytes(canon)
}

// ── Internal helpers ─────────────────────────────────────────

fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
}
