//! MAP v1.1 CANON_BYTES and MID computation.
//!
//! CANON_BYTES = CANON_HDR || MCF(root_value)  (§5.2)
//! MID = "map1:" || hex_lower(sha256(CANON_BYTES))  (§5.3)

use sha2::{Digest, Sha256};

use crate::constants::*;
use crate::decode::mcf_decode_validate;
use crate::encode::mcf_encode_value;
use crate::errors::*;
use crate::value::MapValue;

/// Compute lowercase hex SHA-256 digest.
fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    // format as lowercase hex
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Encode a canonical-model value to CANON_BYTES = CANON_HDR + MCF.
pub fn canon_bytes_from_value(val: &MapValue) -> Result<Vec<u8>, MapError> {
    let body = mcf_encode_value(val, 0)?;
    let mut canon = Vec::with_capacity(CANON_HDR.len() + body.len());
    canon.extend_from_slice(CANON_HDR);
    canon.extend(body);
    if canon.len() > MAX_CANON_BYTES {
        return Err(MapError::new(
            ERR_LIMIT_SIZE,
            "canon bytes exceed MAX_CANON_BYTES",
        ));
    }
    Ok(canon)
}

/// Compute MID from a canonical-model value.
pub fn mid_from_value(val: &MapValue) -> Result<String, MapError> {
    let canon = canon_bytes_from_value(val)?;
    Ok(format!("map1:{}", sha256_hex(&canon)))
}

/// Validate pre-built CANON_BYTES and return MID.
///
/// This is the "fast-path" entry point (§3.7) — it fully validates the
/// binary structure but hashes the input bytes directly rather than
/// re-encoding through the model layer.
pub fn mid_from_canon_bytes(canon: &[u8]) -> Result<String, MapError> {
    if canon.len() > MAX_CANON_BYTES {
        return Err(MapError::new(
            ERR_LIMIT_SIZE,
            "canon bytes exceed MAX_CANON_BYTES",
        ));
    }
    if !canon.starts_with(CANON_HDR) {
        return Err(MapError::new(ERR_CANON_HDR, "bad CANON_HDR"));
    }

    let off = CANON_HDR.len();
    let end = mcf_decode_validate(canon, off, 0)?;
    if end != canon.len() {
        return Err(MapError::new(
            ERR_CANON_MCF,
            "trailing bytes after MCF root",
        ));
    }

    Ok(format!("map1:{}", sha256_hex(canon)))
}
